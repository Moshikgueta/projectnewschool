'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
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

const signInSchema = z.object({
  email,
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

// The same message for unknown email and wrong password, so the form cannot
// be used to discover which addresses have accounts.
const SIGN_IN_FAILED = 'The email or password is incorrect.';

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) return { status: 'error', message: SIGN_IN_FAILED };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.status === 429) {
      return { status: 'error', message: 'Too many attempts. Wait a few minutes and try again.' };
    }
    return { status: 'error', message: SIGN_IN_FAILED };
  }

  // safeNextPath only lets same-site paths through (no open redirect).
  redirect(safeNextPath(parsed.data.next, '/') as Route);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

const resetSchema = z.object({ email });

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { status: 'error', message: 'Enter a valid email address.' };

  const supabase = await createSupabaseServerClient();
  // The result is deliberately ignored: the answer is the same whether or not
  // the address has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/set-password`,
  });
  return { status: 'sent' };
}

const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .max(200, 'Use at most 200 characters.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'The two passwords do not match.',
    path: ['confirm'],
  });

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the password.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/login');

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message =
      error.code === 'weak_password'
        ? 'That password is too common or too weak. Choose a longer, less predictable one.'
        : error.code === 'same_password'
          ? 'Choose a password you have not used for this account before.'
          : 'The password could not be changed. Open the link from the email again.';
    return { status: 'error', message };
  }
  redirect('/');
}
