/* POST /api/staff/auth/reset-request — {user} (email or username).

   Always answers {ok:true} so the response cannot be used to find out which
   school emails exist, and NEVER returns the token itself: this endpoint is
   unauthenticated, so echoing the token back would hand account takeover to
   anyone who can guess an address. The token leaves the server only by email.

   DATABASE-HANDOFF.md's "no email service yet → return the token so an admin
   can relay it" lives at POST /api/staff/users/:id/reset instead, behind the
   admin guard. `sent:false` is the UI's cue to point the user at the office. */

import { json, emailConfigured, sendEmail } from '../../../_shared.js';
import { readJson, findByHandle, issueResetToken, resetLink } from '../../../_staff.js';

function resetHtml(link, name) {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;color:#201e1d;max-width:560px;margin:0 auto">
  <h2 style="color:#006786">איפוס סיסמה · חדר המורים</h2>
  <p>שלום ${name || ''},</p>
  <p>התקבלה בקשה לאיפוס הסיסמה לחשבון הזה. הקישור תקף לשעה אחת:</p>
  <p style="margin:22px 0"><a href="${link}"
     style="background:#201e1d;color:#fff;border-radius:11px;padding:12px 26px;text-decoration:none;font-weight:700">בחירת סיסמה חדשה</a></p>
  <p style="color:#605d5d;font-size:13px">אם לא ביקשתם איפוס — התעלמו מהמייל הזה; הסיסמה לא שונתה.</p>
</div>`;
}

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);
  const handle = String(b.user || b.email || '').trim().toLowerCase();
  if (!handle) return json({ ok: false, error: 'צריך שם משתמש או אימייל.' }, 400);

  const canMail = emailConfigured(env);
  const u = await findByHandle(env, handle);

  /* No account, a disabled account, or no mail service — same shape either
     way; only the `sent` flag (a property of the server, not of the account)
     differs, and it is what the screen uses to choose its copy. */
  if (u && u.active && canMail) {
    const token = await issueResetToken(env, u.id);
    await sendEmail(env, u.email, 'איפוס סיסמה · חדר המורים',
      resetHtml(resetLink(request, token), u.name));
  }
  return json({ ok: true, sent: canMail });
}
