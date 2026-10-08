import 'server-only';
import { isRole, type Role } from '@/domain/auth/access';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type AccountRow = { id: string; displayName: string; roles: Role[]; createdAt: string };

/** All accounts with their roles. RLS lets only an MFA-verified admin see them. */
export async function listAccounts(): Promise<AccountRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, created_at, user_roles!user_roles_user_id_fkey ( role )')
    .order('display_name');
  if (error) throw new Error(`Could not load accounts: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    createdAt: p.created_at,
    roles: p.user_roles.map((r) => r.role).filter(isRole),
  }));
}
