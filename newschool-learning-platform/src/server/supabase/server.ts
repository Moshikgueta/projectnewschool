import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/server/db.types';
import { getEnv } from '@/server/env';
import { sessionCookieOptions } from './cookie-options';

/**
 * Supabase client acting as the signed-in user. Every query made with it is
 * subject to Row Level Security for that user — this is the client all
 * queries and actions use by default.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: sessionCookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // src/proxy.ts refreshes the session on every request instead.
          }
        },
      },
    },
  );
}
