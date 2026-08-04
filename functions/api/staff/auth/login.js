/* POST /api/staff/auth/login — {user, pass} where `user` is an email or the
   short username. Credentials are checked in D1, never in the browser, and
   the role that comes back is the one the dashboard gates its screens on. */

import { json } from '../../../_shared.js';
import {
  readJson, findByHandle, checkPassword, startSession, sessionCookie,
  publicUser, lockedOut, noteFailure, noteSuccess
} from '../../../_staff.js';

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);
  const handle = String(b.user || b.email || '').trim().toLowerCase();
  const pass = String(b.pass || b.password || '');
  if (!handle || !pass) return json({ ok: false, error: 'צריך שם משתמש וסיסמה.' }, 400);

  const u = await findByHandle(env, handle);
  /* One message for "no such account" and "wrong password" — telling them
     apart is a gift to whoever is guessing school emails. */
  const wrong = { ok: false, error: 'שם משתמש או סיסמה שגויים' };

  if (!u) return json(wrong, 401);
  if (lockedOut(u)) {
    return json({ ok: false, error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' }, 429);
  }
  if (!(await checkPassword(pass, u.pass_hash))) {
    await noteFailure(env, u);
    return json(wrong, 401);
  }
  if (!u.active) {
    return json({ ok: false, error: 'החשבון הושבת. לפנות למשרד בית הספר.' }, 403);
  }

  await noteSuccess(env, u);
  const token = await startSession(env, u.id);
  return json({ ok: true, user: publicUser(u) }, 200, { 'Set-Cookie': sessionCookie(token) });
}
