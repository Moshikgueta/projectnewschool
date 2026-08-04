/* GET /api/staff/auth/me — the session's user, re-read from D1 on every call.
   This is what makes the session server-authoritative: the dashboard asks on
   mount instead of trusting whatever localStorage remembers. */

import { json } from '../../../_shared.js';
import { currentStaff, publicUser } from '../../../_staff.js';

export async function onRequestGet({ request, env }) {
  const u = await currentStaff(request, env);
  if (!u) return json({ ok: false });
  return json({ ok: true, user: publicUser(u) });
}
