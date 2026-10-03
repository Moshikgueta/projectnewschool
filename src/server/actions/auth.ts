'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { safeNextPath } from '@/domain/auth/access';
import { getEnv } from '@/server/env';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type FormState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'sent' };

const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

const signInSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
  next: z.string().max(500).optional(),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('auth.signIn');
  // The same message for unknown email and wrong password, so the form cannot
  // be used to discover which addresses have accounts.
  const failed: FormState = { status: 'error', message: t('failed') };

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) return failed;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return error.status === 429 ? { status: 'error', message: t('rateLimited') } : failed;

  // safeNextPath only lets same-site paths through (no open redirect).
  redirect(safeNextPath(parsed.data.next, '/') as Route);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z.object({ email }).safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: (await getTranslations('auth.forgot'))('invalidEmail') };
  }

  const supabase = await createSupabaseServerClient();
  // The result is deliberately ignored: the answer is the same whether or not
  // the address has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/set-password`,
  });
  return { status: 'sent' };
}

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('auth.setPassword');
  const schema = z
    .object({
      password: z.string().min(PASSWORD_MIN, t('tooShort')).max(PASSWORD_MAX, t('tooLong')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { message: t('mismatch'), path: ['confirm'] });

  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? t('failed') };
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/login');

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const key =
      error.code === 'weak_password' ? 'weak' : error.code === 'same_password' ? 'same' : 'failed';
    return { status: 'error', message: t(key) };
  }
  redirect('/');
}
