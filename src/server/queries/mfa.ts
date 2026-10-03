import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server';

export async function listVerifiedTotpFactors(): Promise<{ id: string; name: string | null }[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? [])
    .filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, name: f.friendly_name ?? null }));
}
