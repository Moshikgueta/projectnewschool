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
  const role = b.role === 'תלמיד' ? 'תלמיד' : 'מורה';   /* only these two are self-selectable */

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
    role === 'מורה' ? JSON.stringify(TEACHER_SCREENS) : null,
    Date.now()
  ).run();

  return json({ ok: true, pending: true });
}
