import type { CookieOptionsWithName } from '@supabase/ssr';

// The browser never talks to Supabase directly (server-first architecture), so
// the session cookie can be HttpOnly: page scripts — including any injected
// script — cannot read the session token.
export const sessionCookieOptions: CookieOptionsWithName = {
  name: 'ns-session',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};
