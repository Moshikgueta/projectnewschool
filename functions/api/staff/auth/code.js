/* POST /api/staff/auth/code — {code}. The student door.

   A student types one short code and nothing else. That single field is the
   whole point: the ones who have to remember an email and a password simply
   stop signing in, so the friction was removed rather than reduced.

   What it is NOT is a weaker version of the password login. Because the code
   alone identifies the account, a guess is aimed at every student at once
   rather than at one named person, so the per-account lockout in login.js is
   the wrong instrument here — see the throttle in _staff.js. The session it
   hands back is the ordinary one: same table, same cookie, same "disabling
   the account kills it immediately" behaviour as any staff login. */

import { json } from '../../../_shared.js';
import {
  readJson, findByCode, normalizeCode, startSession, sessionCookie, publicUser,
  codeConfigured, codeThrottled, noteCodeMiss, STUDENT_ROLE
} from '../../../_staff.js';

export async function onRequestPost({ request, env }) {
  /* Fails closed: with no pepper set, every stored hash is unreachable
     anyway, and answering anything else would imply the door works. */
  if (!codeConfigured(env)) {
    return json({ ok: false, error: 'כניסה בקוד עדיין לא הופעלה. פנו למשרד בית הספר.' }, 503);
  }

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const typed = normalizeCode(b.code);
  if (!typed) return json({ ok: false, error: 'צריך להקליד את הקוד.' }, 400);

  if (await codeThrottled(env, request)) {
    return json({ ok: false, error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' }, 429);
  }

  /* One message for a code that matches nothing, a code belonging to a
     disabled account, and a code on an account whose role was changed away
     from תלמיד. Telling them apart would turn this endpoint into a way to
     confirm which codes are real. */
  const wrong = { ok: false, error: 'הקוד לא מזוהה. בקשו קוד חדש מהמורה.' };
  const u = await findByCode(env, typed);

  if (!u || !u.active || u.role !== STUDENT_ROLE) {
    await noteCodeMiss(env, request);
    return json(wrong, 401);
  }

  const token = await startSession(env, u.id);
  return json({ ok: true, user: publicUser(u) }, 200, { 'Set-Cookie': sessionCookie(token) });
}
