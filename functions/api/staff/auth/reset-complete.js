/* POST /api/staff/auth/reset-complete — {token, pass}. Consumes a valid,
   unexpired, unused token and sets the new password.

   Every existing session for that user is dropped: a password reset is the
   one moment where "someone else may be holding my login" is the whole
   point, so old cookies must stop working. It does NOT sign the user in —
   they return to the login screen and use the password they just chose. */

import { json } from '../../../_shared.js';
import {
  readJson, tokenHash, packPassword, endAllSessions, MIN_PASS
} from '../../../_staff.js';

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);
  const token = String(b.token || '').slice(0, 128);
  const pass = String(b.pass || '');
  if (!token) return json({ ok: false, error: 'חסר טוקן איפוס.' }, 400);
  if (pass.length < MIN_PASS) {
    return json({ ok: false, error: `הסיסמה צריכה להיות לפחות ${MIN_PASS} תווים` }, 400);
  }

  const row = await env.DB.prepare('SELECT * FROM staff_reset_tokens WHERE token_hash=?')
    .bind(await tokenHash(token)).first();
  if (!row || row.used || row.expires_at < Date.now()) {
    return json({ ok: false, error: 'הקישור כבר לא בתוקף — בקשו קישור איפוס חדש.' }, 400);
  }

  await env.DB.prepare(
    'UPDATE staff_users SET pass_hash=?, must_change=0, failed_attempts=0, locked_until=0 WHERE id=?'
  ).bind(await packPassword(pass), row.user_id).run();
  await env.DB.prepare('UPDATE staff_reset_tokens SET used=1 WHERE token_hash=?')
    .bind(row.token_hash).run();
  await endAllSessions(env, row.user_id);

  return json({ ok: true });
}
