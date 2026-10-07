'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ROLES } from '@/domain/auth/access';
import { requireArea } from '@/server/auth/session';
import { getEnv } from '@/server/env';
import { createPrivilegedClient } from '@/server/privileged/admin-client';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type InviteState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'invited'; email: string };

/**
 * Invite a person and give them one role. Only an MFA-verified admin may do
 * this: the area guard checks first, and the role grant is written with the
 * admin's own session, so the database's RLS policy (admin + aal2) enforces
 * it again. The secret key is used only for the invite email itself.
 */
export async function inviteUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireArea('admin');
  const t = await getTranslations('admin.errors');
  const inviteSchema = z.object({
    email: z
      .email(t('invalidEmail'))
      .max(254)
      .transform((v) => v.trim().toLowerCase()),
    displayName: z.string().trim().min(1, t('nameRequired')).max(120),
    role: z.enum(ROLES),
  });
  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    displayName: formData.get('displayName'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? t('sendFailed') };
  }
  const { email, displayName, role } = parsed.data;

  const privileged = createPrivilegedClient();
  const { data: invited, error: inviteError } = await privileged.auth.admin.inviteUserByEmail(
    email,
    {
      data: { display_name: displayName },
      redirectTo: `${getEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/set-password`,
    },
  );
  if (inviteError || !invited.user) {
    return {
      status: 'error',
      message: inviteError?.code === 'email_exists' ? t('exists') : t('sendFailed'),
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error: roleError } = await supabase
    .from('user_roles')
    .insert({ user_id: invited.user.id, role, granted_by: admin.id });
  if (roleError) {
    // Don't leave an account without a role behind.
    await privileged.auth.admin.deleteUser(invited.user.id);
    return {
      status: 'error',
      message: t('roleFailed'),
    };
  }

  revalidatePath('/admin');
  return { status: 'invited', email };
}
