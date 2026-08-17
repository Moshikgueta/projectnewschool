/* ============================================================
   New School · שרת החשבונות
   נתיב בפרויקט:  functions/api/staff/[[path]].js

   מיישם בדיוק את המסלולים ש-dashboard.html ו-mobile.html פונים אליהם:

     POST   /api/staff/bootstrap             יצירת האדמין הראשון (פעם אחת)
     POST   /api/staff/auth/login            {user, pass}
     POST   /api/staff/auth/logout
     GET    /api/staff/auth/me
     POST   /api/staff/auth/signup           {name, email, pass, role}
     POST   /api/staff/auth/reset-request    {user}
     POST   /api/staff/auth/reset-complete   {token, pass}
     GET    /api/staff/users
     POST   /api/staff/users                 {name, user, email, pass, role}
     PATCH  /api/staff/users/:id             {name|user|email|role|screens|active|pass}
     DELETE /api/staff/users/:id
     POST   /api/staff/users/:id/reset       מפיק קישור איפוס

   אימות: עוגיית HttpOnly. האתר והשרת על אותו דומיין, ולכן אין CORS.
   ============================================================ */

const ROLES = ["מורה", "אדמין", "מנהל פדגוגי", "מנהלת קבלה", "תלמיד"];
const ADMIN_ROLE = "אדמין";
const SCREENS = ["dashboard","students","notebooks","groups","materials","calendar","planner","syllabus","feedback","guides"];
const COOKIE = "ns_session";
const SESSION_DAYS = 14;
const RESET_MINUTES = 60;

/* ---------- תשובות ---------- */

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      extraHeaders || {}
    )
  });
}
const fail = (error, status) => json({ ok: false, error }, status || 400);

/* ---------- עזרים ---------- */

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* סיסמה זמנית קריאה, בלי תווים מתחלפים */
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = new Uint32Array(8);
  crypto.getRandomValues(r);
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[r[i] % chars.length];
  return out;
}

async function hashPassword(password, saltBytes, iterations) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const iter = iterations || 120000;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256
  );
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}

async function verifyPassword(password, stored) {
  const p = String(stored || "").split("$");
  if (p.length !== 4 || p[0] !== "pbkdf2") return false;
  const candidate = await hashPassword(password, unb64(p[2]), parseInt(p[1], 10));
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "")); }

/* שורת מסד נתונים אל האובייקט שהדשבורד מצפה לו */
function shape(row) {
  if (!row) return null;
  let screens;
  try { screens = row.screens ? JSON.parse(row.screens) : SCREENS.slice(); }
  catch (e) { screens = SCREENS.slice(); }
  return {
    id: row.id,
    name: row.name,
    teacherName: row.name,
    user: row.username,
    email: row.email || "",
    role: row.role,
    screens,
    active: row.active !== 0,
    mustChange: row.must_change === 1
  };
}

/* ---------- הפעלות ---------- */

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare(
    "insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)"
  ).bind(await sha256Hex(token), userId, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()).run();
  return token;
}

async function currentUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `select u.*, s.expires_at as sess_exp
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (new Date(row.sess_exp) < new Date()) {
    await env.DB.prepare("delete from sessions where token_hash = ?").bind(hash).run();
    return null;
  }
  if (row.active === 0) return null;
  return { row, hash };
}

/* ============================================================
   הנתב
   ============================================================ */

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const method = request.method;
  const url = new URL(request.url);

  let body = {};
  if (method === "POST" || method === "PATCH") {
    body = await request.json().catch(() => ({}));
  }

  try {
    /* ---------- הקמה ראשונית ---------- */
    if (seg[0] === "bootstrap") {
      /* אפשר גם מהדפדפן:
         /api/staff/bootstrap?secret=...&email=...&pass=...&name=... */
      const q = url.searchParams;
      const secret = body.secret || q.get("secret");
      if (!env.SETUP_SECRET || secret !== env.SETUP_SECRET) return fail("אין הרשאה", 403);

      const existing = await env.DB.prepare("select count(*) as c from users").first();
      if (existing.c > 0) return fail("כבר קיימים חשבונות במערכת", 409);

      const email = String(body.email || q.get("email") || "").toLowerCase().trim();
      const pass = String(body.pass || q.get("pass") || "");
      const name = String(body.name || q.get("name") || "אדמין").trim();
      const username = String(body.user || q.get("user") || "admin").toLowerCase().trim();

      if (!validEmail(email)) return fail("האימייל לא תקין");
      if (pass.length < 6) return fail("הסיסמה צריכה להיות לפחות 6 תווים");

      const id = crypto.randomUUID();
      await env.DB.prepare(
        `insert into users (id, name, username, email, role, password_hash, screens, active, must_change)
         values (?, ?, ?, ?, ?, ?, ?, 1, 0)`
      ).bind(id, name, username, email, ADMIN_ROLE, await hashPassword(pass), JSON.stringify(SCREENS)).run();

      return json({ ok: true, user: shape({ id, name, username, email, role: ADMIN_ROLE, screens: JSON.stringify(SCREENS), active: 1, must_change: 0 }) });
    }

    /* ---------- כניסה ---------- */
    if (seg[0] === "auth" && seg[1] === "login" && method === "POST") {
      const handle = String(body.user || "").toLowerCase().trim();
      const row = await env.DB.prepare(
        "select * from users where lower(username) = ? or lower(email) = ?"
      ).bind(handle, handle).first();

      const ok = row ? await verifyPassword(String(body.pass || ""), row.password_hash) : false;
      if (!ok) return fail("שם משתמש או סיסמה שגויים", 401);
      if (row.active === 0) return fail("החשבון ממתין לאישור משרד בית הספר", 403);

      const token = await createSession(env, row.id);
      return json({ ok: true, user: shape(row) }, 200,
        { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }

    /* ---------- יציאה ---------- */
    if (seg[0] === "auth" && seg[1] === "logout" && method === "POST") {
      const me = await currentUser(request, env);
      if (me) await env.DB.prepare("delete from sessions where token_hash = ?").bind(me.hash).run();
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }

    /* ---------- מי אני ---------- */
    if (seg[0] === "auth" && seg[1] === "me" && method === "GET") {
      const me = await currentUser(request, env);
      if (!me) return json({ ok: false });
      return json({ ok: true, user: shape(me.row) });
    }

    /* ---------- הרשמה עצמית ---------- */
    if (seg[0] === "auth" && seg[1] === "signup" && method === "POST") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").toLowerCase().trim();
      const pass = String(body.pass || "");
      const role = body.role === "תלמיד" ? "תלמיד" : "מורה";

      if (!name || !validEmail(email)) return fail("צריך שם ואימייל תקין");
      if (pass.length < 6) return fail("הסיסמה צריכה להיות לפחות 6 תווים");

      const dup = await env.DB.prepare("select id from users where lower(email) = ?").bind(email).first();
      /* אותה תשובה בין אם קיים ובין אם לא, כדי לא לחשוף מי רשום */
      if (dup) return json({ ok: true });

      let username = email.split("@")[0].replace(/[^a-z0-9._-]/g, "");
      const taken = await env.DB.prepare("select id from users where lower(username) = ?").bind(username).first();
      if (taken) username = username + "." + randomHex(2);

      await env.DB.prepare(
        `insert into users (id, name, username, email, role, password_hash, screens, active, must_change)
         values (?, ?, ?, ?, ?, ?, ?, 0, 0)`
      ).bind(crypto.randomUUID(), name, username, email, role, await hashPassword(pass), JSON.stringify(SCREENS)).run();

      return json({ ok: true });
    }

    /* ---------- בקשת איפוס ---------- */
    if (seg[0] === "auth" && seg[1] === "reset-request" && method === "POST") {
      const handle = String(body.user || "").toLowerCase().trim();
      const row = await env.DB.prepare(
        "select id from users where lower(username) = ? or lower(email) = ?"
      ).bind(handle, handle).first();

      if (row) {
        const token = randomHex(32);
        await env.DB.prepare(
          "insert into resets (token_hash, user_id, expires_at, used) values (?, ?, ?, 0)"
        ).bind(await sha256Hex(token), row.id,
               new Date(Date.now() + RESET_MINUTES * 60000).toISOString()).run();
      }
      /* שליחת מיילים עוד לא מחוברת, ולכן sent=false בכוונה.
         המשרד מפיק קישור ידנית דרך פאנל החשבונות. */
      return json({ ok: true, sent: false });
    }

    /* ---------- השלמת איפוס ---------- */
    if (seg[0] === "auth" && seg[1] === "reset-complete" && method === "POST") {
      const token = String(body.token || "");
      const pass = String(body.pass || "");
      if (pass.length < 6) return fail("הסיסמה צריכה להיות לפחות 6 תווים");

      const hash = await sha256Hex(token);
      const row = await env.DB.prepare("select * from resets where token_hash = ?").bind(hash).first();
      if (!row || row.used === 1 || new Date(row.expires_at) < new Date()) {
        return fail("הקישור פג או כבר נוצל", 400);
      }

      await env.DB.prepare("update users set password_hash = ?, must_change = 0 where id = ?")
        .bind(await hashPassword(pass), row.user_id).run();
      await env.DB.prepare("update resets set used = 1 where token_hash = ?").bind(hash).run();
      await env.DB.prepare("delete from sessions where user_id = ?").bind(row.user_id).run();

      return json({ ok: true });
    }

    /* ==========================================================
       מכאן והלאה: ניהול חשבונות, לאדמין בלבד
       ========================================================== */
    if (seg[0] === "users") {
      const me = await currentUser(request, env);
      if (!me) return fail("נדרשת התחברות", 401);
      if (me.row.role !== ADMIN_ROLE) return fail("אין הרשאה", 403);

      /* רשימה */
      if (seg.length === 1 && method === "GET") {
        const { results } = await env.DB.prepare(
          "select * from users order by created_at"
        ).all();
        return json({ ok: true, users: (results || []).map(shape) });
      }

      /* יצירה */
      if (seg.length === 1 && method === "POST") {
        const name = String(body.name || "").trim();
        const username = String(body.user || "").toLowerCase().trim();
        const email = String(body.email || "").toLowerCase().trim();
        const role = ROLES.includes(body.role) ? body.role : "מורה";
        if (!name || !username) return fail("צריך שם ושם משתמש");
        if (email && !validEmail(email)) return fail("האימייל לא תקין");

        const dup = await env.DB.prepare(
          "select id from users where lower(username) = ? or (? <> '' and lower(email) = ?)"
        ).bind(username, email, email).first();
        if (dup) return fail("שם המשתמש או האימייל כבר קיימים", 409);

        const supplied = String(body.pass || "").trim();
        const temp = supplied || tempPassword();
        const id = crypto.randomUUID();

        await env.DB.prepare(
          `insert into users (id, name, username, email, role, password_hash, screens, active, must_change)
           values (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        ).bind(id, name, username, email, role, await hashPassword(temp),
               JSON.stringify(SCREENS), supplied ? 0 : 1).run();

        const row = await env.DB.prepare("select * from users where id = ?").bind(id).first();
        return json({ ok: true, user: shape(row), tempPassword: temp });
      }

      const id = seg[1];

      /* קישור איפוס ידני */
      if (seg.length === 3 && seg[2] === "reset" && method === "POST") {
        const target = await env.DB.prepare("select id from users where id = ?").bind(id).first();
        if (!target) return fail("החשבון לא נמצא", 404);
        const token = randomHex(32);
        await env.DB.prepare(
          "insert into resets (token_hash, user_id, expires_at, used) values (?, ?, ?, 0)"
        ).bind(await sha256Hex(token), id,
               new Date(Date.now() + RESET_MINUTES * 60000).toISOString()).run();
        return json({ ok: true, link: `${url.origin}/dashboard.html?reset=${token}` });
      }

      /* עדכון */
      if (seg.length === 2 && method === "PATCH") {
        const target = await env.DB.prepare("select * from users where id = ?").bind(id).first();
        if (!target) return fail("החשבון לא נמצא", 404);

        const sets = [], vals = [];

        if (typeof body.name === "string" && body.name.trim()) { sets.push("name = ?"); vals.push(body.name.trim()); }
        if (typeof body.user === "string" && body.user.trim()) { sets.push("username = ?"); vals.push(body.user.toLowerCase().trim()); }
        if (typeof body.email === "string") {
          if (body.email && !validEmail(body.email)) return fail("האימייל לא תקין");
          sets.push("email = ?"); vals.push(body.email.toLowerCase().trim());
        }
        if (typeof body.role === "string") {
          if (!ROLES.includes(body.role)) return fail("תפקיד לא מוכר");
          if (id === me.row.id && body.role !== ADMIN_ROLE) return fail("אי אפשר להוריד לעצמך את הרשאת האדמין");
          sets.push("role = ?"); vals.push(body.role);
        }
        if (Array.isArray(body.screens)) {
          const clean = body.screens.filter((k) => SCREENS.includes(k));
          sets.push("screens = ?"); vals.push(JSON.stringify(clean));
        }
        if (typeof body.active === "boolean") {
          if (id === me.row.id && !body.active) return fail("אי אפשר להשבית את עצמך");
          sets.push("active = ?"); vals.push(body.active ? 1 : 0);
          if (!body.active) await env.DB.prepare("delete from sessions where user_id = ?").bind(id).run();
        }

        let cutSessions = false;
        if (typeof body.pass === "string" && body.pass) {
          if (body.pass.length < 6) return fail("הסיסמה צריכה להיות לפחות 6 תווים");
          sets.push("password_hash = ?"); vals.push(await hashPassword(body.pass));
          sets.push("must_change = 0");
          cutSessions = true;
        }

        if (!sets.length) return fail("אין מה לעדכן");

        vals.push(id);
        await env.DB.prepare(`update users set ${sets.join(", ")} where id = ?`).bind(...vals).run();
        if (cutSessions) await env.DB.prepare("delete from sessions where user_id = ?").bind(id).run();

        const row = await env.DB.prepare("select * from users where id = ?").bind(id).first();
        return json({ ok: true, user: shape(row) });
      }

      /* מחיקה */
      if (seg.length === 2 && method === "DELETE") {
        if (id === me.row.id) return fail("אי אפשר למחוק את עצמך");
        const res = await env.DB.prepare("delete from users where id = ?").bind(id).run();
        if (!res.meta.changes) return fail("החשבון לא נמצא", 404);
        await env.DB.prepare("delete from sessions where user_id = ?").bind(id).run();
        return json({ ok: true });
      }
    }

    return fail("מסלול לא קיים", 404);

  } catch (err) {
    return fail("שגיאת שרת", 500);
  }
}
