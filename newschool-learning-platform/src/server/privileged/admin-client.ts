import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/server/db.types';
import { getEnv } from '@/server/env';

// The ONLY place the Supabase secret key is read. It bypasses Row Level
// Security, so callers must already have authorized the action with the
// user's own session, and must take user ids from that session — never from
// request input. ESLint keeps app/, ui/ and queries out of this module.
const secretSchema = z.string().min(20, 'SUPABASE_SECRET_KEY is missing');

export function createPrivilegedClient() {
  const secret = secretSchema.parse(process.env.SUPABASE_SECRET_KEY);
  return createClient<Database>(getEnv().NEXT_PUBLIC_SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
