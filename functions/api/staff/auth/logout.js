/* POST /api/staff/auth/logout — drops the session row and clears the cookie.
   Server-side deletion is the point: the shared staffroom machine must not
   keep a replayable token after someone signs out. */

import { json } from '../../../_shared.js';
import { endSession, clearStaffCookie } from '../../../_staff.js';

export async function onRequestPost({ request, env }) {
  await endSession(request, env);
  return json({ ok: true }, 200, { 'Set-Cookie': clearStaffCookie });
}
