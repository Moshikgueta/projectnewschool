/* POST /api/staff/bootstrap — creates the FIRST admin account, once.

   The chicken-and-egg fix: every other account is created by an admin, so
   there has to be one way in that predates them. Two locks, both required:
     · STAFF_BOOTSTRAP_TOKEN must be set as a Worker secret and matched;
     · staff_users must be empty.
   After the first account exists this endpoint answers 409 forever, so
   leaving the secret in place is not a standing door. Delete it anyway. */

import { json, timingSafeEqual } from '../../_shared.js';
import {
  readJson, packPassword, randomId, initialsOf, publicUser, staffCount,
  validEmail, MIN_PASS
} from '../../_staff.js';

/* GET /api/staff/bootstrap — may a first admin still be created here?

   The login screen asks on mount, so it can show a setup form instead of a
   sign-in form that nobody can satisfy yet. Answering anonymous callers gives
   away only "this school has not been set up", which is already evident from
   the fact that no credential works — and POST still demands the secret, so
   knowing the answer buys nothing. */
export async function onRequestGet({ env }) {
  const open = !!env.STAFF_BOOTSTRAP_TOKEN && !(await staffCount(env));
  return json({ ok: true, needsSetup: open });
}

export async function onRequestPost({ request, env }) {
  if (!env.STAFF_BOOTSTRAP_TOKEN) {
    return json({ ok: false, error: 'bootstrap disabled' }, 404);
  }
  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const given = String(b.token || '');
  if (!given || !timingSafeEqual(given, String(env.STAFF_BOOTSTRAP_TOKEN))) {
    return json({ ok: false, error: 'bootstrap token mismatch' }, 403);
  }
  if (await staffCount(env)) {
    return json({ ok: false, error: 'staff accounts already exist' }, 409);
  }

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const username = String(b.user || '').trim().toLowerCase() || null;
  const pass = String(b.pass || '');
  if (!name || !validEmail(email)) return json({ ok: false, error: 'צריך שם ואימייל תקין' }, 400);
  if (pass.length < MIN_PASS) {
    return json({ ok: false, error: `הסיסמה צריכה להיות לפחות ${MIN_PASS} תווים` }, 400);
  }

  const id = randomId();
  await env.DB.prepare(
    `INSERT INTO staff_users
       (id, email, username, pass_hash, role, name, initials, active, must_change,
        screens, student_id, failed_attempts, locked_until, created_at)
     VALUES (?,?,?,?,'אדמין',?,?,1,0,NULL,NULL,0,0,?)`
  ).bind(id, email, username, await packPassword(pass), name, initialsOf(name), Date.now()).run();

  const row = await env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(id).first();
  return json({ ok: true, user: publicUser(row) }, 201);
}
