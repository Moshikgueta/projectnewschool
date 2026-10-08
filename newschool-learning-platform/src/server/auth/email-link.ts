import 'server-only';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/server/supabase/server';

const ALLOWED: readonly EmailOtpType[] = ['invite', 'recovery', 'email', 'email_change'];

/**
 * Exchanges the one-time token from an invite or password-reset email for a
 * session. Returns false for anything malformed, expired or already used.
 */
export async function confirmEmailLink(
  tokenHash: string | null,
  type: string | null,
): Promise<boolean> {
  if (!tokenHash || !type || !(ALLOWED as readonly string[]).includes(type)) return false;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  return !error;
}
