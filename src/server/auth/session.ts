import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import {
  decideAccess,
  isRole,
  type Area,
  type AssuranceLevel,
  type Role,
} from '@/domain/auth/access';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type SessionUser = {
  id: string;
  email: string | null;
  aal: AssuranceLevel;
  roles: Role[];
  displayName: string;
  uiLocale: string | null;
  timezone: string;
};

/**
 * The signed-in user for this request, or null. Identity comes from the
 * verified JWT (signature checked by getClaims), never from unverified cookie
 * contents. Roles are read from the database on every request (ADR-007).
 * Cached per request, so layouts and pages can all call it.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const { claims } = data;
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', claims.sub),
    supabase
      .from('profiles')
      .select('display_name, ui_locale, timezone')
      .eq('id', claims.sub)
      .maybeSingle(),
  ]);

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
    roles: (roleRows ?? []).map((r) => r.role).filter(isRole),
    displayName: profile?.display_name ?? '',
    uiLocale: profile?.ui_locale ?? null,
    timezone: profile?.timezone ?? 'Asia/Jerusalem',
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Guard for an area's layout, pages and actions. Layouts alone are not a
 * security boundary in Next.js, so pages and server actions call this too.
 */
export async function requireArea(area: Area): Promise<SessionUser> {
  const user = await getSessionUser();
  switch (decideAccess(user, area)) {
    case 'allow':
      return user as SessionUser;
    case 'sign-in':
      redirect(`/login?next=/${area}`);
    case 'needs-mfa':
      redirect(`/account/mfa?next=/${area}`);
    case 'not-found':
      notFound();
  }
}
