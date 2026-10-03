import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/server/db.types';
import { sessionCookieOptions } from './cookie-options';

/**
 * Refreshes the Supabase session on every request (access tokens are short
 * lived) and passes refreshed cookies both to the page being rendered and
 * back to the browser.
 */
export async function refreshSession(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response; // env validation fails loudly in the page itself

  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        requestHeaders.set('cookie', request.cookies.toString());
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the token and refreshes it when needed. Do not put code between
  // client creation and this call (Supabase SSR guidance).
  await supabase.auth.getClaims();

  return response;
}
