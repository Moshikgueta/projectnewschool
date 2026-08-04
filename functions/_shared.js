/* Primitives shared by every endpoint: JSON responses, constant-time compare,
   PBKDF2 hashing, and the optional email sender.

   The PBKDF2 and email code is ported verbatim from the espanolsindolordecabeza
   course project, which has been running it in production — deliberately not
   rewritten. Anything specific to that project (payments, the paid-access
   window, the signed buyer cookie) was left behind; sessions here live in the
   database instead, see _staff.js. */

const enc = new TextEncoder();

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── passwords ─────────────────────────────────────────────────────────── */

export async function hashPassword(pass, saltHex) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: hex(bits), salt: hex(salt) };
}

/* ── email (env-gated: silently skipped unless Resend is configured) ───── */

export function emailConfigured(env) {
  return !!(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(env, to, subject, html) {
  if (!emailConfigured(env)) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html })
    });
    return r.ok;
  } catch {
    return false;
  }
}
