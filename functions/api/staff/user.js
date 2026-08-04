/* /api/staff/users/:id — one account.
     PATCH               → name · username · email · role · active · screens · sid · pass
     DELETE              → remove the account and its sessions/tokens
     POST  …/:id/reset   → mint a reset link for manual relay (no email service)

   All admin-only. The id comes from the path; src/worker.js parses it and
   passes it in as `params.id`, Pages-Functions style. */

import { json } from '../../_shared.js';
import {
  requireAdmin, readJson, packPassword, initialsOf, publicUser, validRole,
  validEmail, endAllSessions, issueResetToken, resetLink, MIN_PASS
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
  await env.DB.prepare('DELETE FROM staff_users WHERE id=?').bind(target.id).run();
  return json({ ok: true });
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
