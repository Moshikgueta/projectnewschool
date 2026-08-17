/* /api/staff/users/:id — one account.
     PATCH               → name · username · email · role · active · screens · sid · pass
     DELETE              → remove the account and its sessions/tokens
     POST  …/:id/reset   → mint a reset link for manual relay (no email service)
     POST  …/:id/code    → issue a student's entry code (teachers may too)

   Admin-only except the last. The id comes from the path; src/worker.js
   parses it and passes it in as `params.id`, Pages-Functions style. */

import { json } from '../../_shared.js';
import {
  requireAdmin, requireCodeIssuer, readJson, packPassword, initialsOf, publicUser,
  validRole, validEmail, endAllSessions, issueResetToken, resetLink,
  issueStudentCode, revokeStudentCode, formatCode, codeConfigured,
  STUDENT_ROLE, MIN_PASS
} from '../../_staff.js';

async function load(env, id) {
  return env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(id).first();
}

export async function onRequestPatch({ request, env, params }) {
  const guard = await requireAdmin(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החשבון לא נמצא.' }, 404);

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const sets = [], vals = [];
  const set = (col, val) => { sets.push(col + '=?'); vals.push(val); };

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return json({ ok: false, error: 'צריך שם' }, 400);
    set('name', name);
    set('initials', initialsOf(name));
  }
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!validEmail(email)) return json({ ok: false, error: 'האימייל לא תקין' }, 400);
    set('email', email);
  }
  if (b.user !== undefined) {
    const username = String(b.user).trim().toLowerCase();
    set('username', username || null);
  }
  if (b.role !== undefined) {
    if (!validRole(String(b.role))) return json({ ok: false, error: 'תפקיד לא מוכר' }, 400);
    set('role', String(b.role));
  }
  if (b.screens !== undefined) {
    set('screens', Array.isArray(b.screens) ? JSON.stringify(b.screens) : null);
  }
  if (b.sid !== undefined) set('student_id', String(b.sid).trim() || null);
  if (b.pass !== undefined) {
    const pass = String(b.pass);
    if (pass.length < MIN_PASS) {
      return json({ ok: false, error: `הסיסמה צריכה להיות לפחות ${MIN_PASS} תווים` }, 400);
    }
    set('pass_hash', await packPassword(pass));
    set('must_change', 1);
  }

  /* Guard rails on the two changes that can lock the school out of its own
     admin panel: an admin may not demote or disable their own account, and
     the last active admin may not be demoted or disabled by anyone. */
  let deactivating = false, demoting = false;
  if (b.active !== undefined) {
    const active = b.active ? 1 : 0;
    deactivating = !active && !!target.active;
    set('active', active);
  }
  if (b.role !== undefined) demoting = target.role === 'אדמין' && String(b.role) !== 'אדמין';

  if ((deactivating || demoting)) {
    if (target.id === guard.user.id) {
      return json({ ok: false, error: 'אי אפשר להשבית או לשנות את התפקיד של החשבון שאיתו התחברת.' }, 400);
    }
    if (target.role === 'אדמין') {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM staff_users WHERE role='אדמין' AND active=1"
      ).first();
      if ((row ? row.n : 0) <= 1) {
        return json({ ok: false, error: 'זה האדמין הפעיל האחרון — צריך אדמין אחד לפחות.' }, 400);
      }
    }
  }

  if (!sets.length) return json({ ok: true, user: publicUser(target) });

  try {
    await env.DB.prepare(`UPDATE staff_users SET ${sets.join(', ')} WHERE id=?`)
      .bind(...vals, target.id).run();
  } catch (e) {
    /* The only realistic failure is the UNIQUE index on email/username. */
    return json({ ok: false, error: 'כבר קיים חשבון עם השם או האימייל הזה' }, 409);
  }

  /* A new password, a disabled account or a changed role must not leave a
     live session running under the old terms. */
  if (b.pass !== undefined || deactivating || b.role !== undefined) {
    await endAllSessions(env, target.id);
  }

  /* Someone who is no longer a student has no business holding a student's
     entry code. /auth/code re-checks the role anyway, so this is belt and
     braces — but it also stops a stale row from lingering under the UNIQUE
     index and blocking a later re-issue. */
  if (b.role !== undefined && target.role === STUDENT_ROLE && String(b.role) !== STUDENT_ROLE) {
    await revokeStudentCode(env, target.id);
  }

  return json({ ok: true, user: publicUser(await load(env, target.id)) });
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireAdmin(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החשבון לא נמצא.' }, 404);
  if (target.id === guard.user.id) {
    return json({ ok: false, error: 'אי אפשר למחוק את החשבון שאיתו התחברת.' }, 400);
  }
  if (target.role === 'אדמין' && target.active) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM staff_users WHERE role='אדמין' AND active=1"
    ).first();
    if ((row ? row.n : 0) <= 1) {
      return json({ ok: false, error: 'זה האדמין הפעיל האחרון — צריך אדמין אחד לפחות.' }, 400);
    }
  }

  await env.DB.prepare('DELETE FROM staff_sessions WHERE user_id=?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM staff_reset_tokens WHERE user_id=?').bind(target.id).run();
  await revokeStudentCode(env, target.id);
  await env.DB.prepare('DELETE FROM staff_users WHERE id=?').bind(target.id).run();
  return json({ ok: true });
}

/* POST /api/staff/users/:id/code — issue (or re-issue) a student's entry code.

   Open to teachers as well as admins, because the code is handed over in
   class: routing it through the office is how it ends up never handed over.
   A teacher already sees this student's work, so nothing is exposed that
   was not already visible.

   Like the temporary password and the reset link, the raw code is returned
   exactly once. It is stored as a peppered hash, so nothing can recover it
   afterwards — losing it means issuing another. */
export async function onRequestPostCode({ request, env, params }) {
  const guard = await requireCodeIssuer(request, env);
  if (guard.res) return guard.res;

  if (!codeConfigured(env)) {
    return json({ ok: false, error: 'כניסה בקוד לא מוגדרת בשרת (חסר STUDENT_CODE_PEPPER).' }, 503);
  }

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החשבון לא נמצא.' }, 404);
  if (target.role !== STUDENT_ROLE) {
    return json({ ok: false, error: 'קוד כניסה קיים רק לחשבון של תלמיד/ה.' }, 400);
  }
  if (!target.active) {
    return json({ ok: false, error: 'החשבון מושבת — צריך להפעיל אותו לפני הנפקת קוד.' }, 400);
  }

  const code = await issueStudentCode(env, target.id, guard.user.id);
  /* The previous code stopped working the moment this one was written, so
     any session opened with it has to go too. */
  await endAllSessions(env, target.id);

  return json({ ok: true, code: formatCode(code), name: target.name }, 201);
}

/* POST /api/staff/users/:id/reset — the manual-relay path from
   DATABASE-HANDOFF.md. Behind the admin guard precisely because it hands
   back a live token; the public reset-request endpoint never does. */
export async function onRequestPost({ request, env, params }) {
  const guard = await requireAdmin(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החשבון לא נמצא.' }, 404);

  const token = await issueResetToken(env, target.id);
  return json({ ok: true, link: resetLink(request, token), email: target.email, name: target.name });
}
