/* POST /api/staff/auth/signup — the self-serve "יצירת חשבון" screen.

   The account is created INACTIVE and does not log anyone in. Anything else
   would let a stranger mint themselves a 'מורה' login and read the school's
   student records; the handoff's model is that an admin grants access. The
   signup screen therefore ends in "waiting for the office", and the admin
   panel's account list is where it gets switched on. */

import { json } from '../../../_shared.js';
import {
  readJson, packPassword, randomId, initialsOf, validEmail, MIN_PASS
} from '../../../_staff.js';

/* A teacher's default screen set, mirroring the dashboard's own default. */
const TEACHER_SCREENS = ['dashboard', 'students', 'notebooks', 'groups', 'calendar', 'syllabus', 'feedback', 'guides'];

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const pass = String(b.pass || '');
  /* Always מורה. Students do not sign themselves up any more: their way in is
     a code the teacher issues, so a self-opened 'תלמיד' account would be an
     account with no door — inactive, passworded, and unreachable by
     /auth/code, sitting in the admin list looking like something to approve. */
  const role = 'מורה';

  if (!name || !email) return json({ ok: false, error: 'צריך שם ואימייל' }, 400);
  if (!validEmail(email)) return json({ ok: false, error: 'האימייל לא תקין' }, 400);
  if (pass.length < MIN_PASS) {
    return json({ ok: false, error: `הסיסמה צריכה להיות לפחות ${MIN_PASS} תווים` }, 400);
  }

  const exists = await env.DB.prepare('SELECT id FROM staff_users WHERE email=?').bind(email).first();
  if (exists) return json({ ok: false, error: 'כבר קיים חשבון עם האימייל הזה' }, 409);

  await env.DB.prepare(
    `INSERT INTO staff_users
       (id, email, username, pass_hash, role, name, initials, active, must_change,
        screens, student_id, failed_attempts, locked_until, created_at)
     VALUES (?,?,NULL,?,?,?,?,0,0,?,NULL,0,0,?)`
  ).bind(
    randomId(), email, await packPassword(pass), role, name, initialsOf(name),
    JSON.stringify(TEACHER_SCREENS),
    Date.now()
  ).run();

  return json({ ok: true, pending: true });
}
