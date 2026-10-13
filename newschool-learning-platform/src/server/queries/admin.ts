import 'server-only';
import { isRole, type Role } from '@/domain/auth/access';
import { searchTerm, type PageInfo, type PageRequest } from '@/domain/paging';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { readCountedPage } from './paging';

export type AccountRow = { id: string; displayName: string; roles: Role[]; createdAt: string };

/**
 * A page of the accounts with their roles, by name, optionally searched by
 * name. RLS lets only an MFA-verified admin see them; the database pages and
 * counts (10,000+ accounts at school scale).
 */
export async function listAccounts(
  query: string,
  request: PageRequest,
): Promise<{ rows: AccountRow[]; info: PageInfo }> {
  const supabase = await createSupabaseServerClient();
  const q = searchTerm(query);
  const { rows, info } = await readCountedPage('accounts', request, (from, to) => {
    let accounts = supabase
      .from('profiles')
      .select('id, display_name, created_at, user_roles!user_roles_user_id_fkey ( role )', {
        count: 'exact',
      })
      .order('display_name')
      .order('id');
    if (q) accounts = accounts.ilike('display_name', `%${q}%`);
    return accounts.range(from, to);
  });
  return {
    info,
    rows: rows.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      createdAt: p.created_at,
      roles: p.user_roles.map((r) => r.role).filter(isRole),
    })),
  };
}
