'use server';

import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { safeNextPath } from '@/domain/auth/access';
import { getEnv } from '@/server/env';
import {
  codeEntryThrottled,
  findStudentByCode,
  isStudentOnly,
  recordCodeMiss,
  signInTokenFor,
} from '@/server/privileged/student-codes';
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

/**
 * The caller's address, for the wrong-code throttle. On the hosting platform
 * the first x-forwarded-for entry is set by its edge, not by the browser.
 * Locally everyone shares one bucket, which only makes the throttle stricter.
 */
async function callerAddress(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/**
 * Sign in with a student entry code (moved from the staff room). The code
 * finds the student; the server then mints a one-time token for that account
 * and exchanges it for a normal session, so from here on the student is
 * signed in exactly as if they had used a password, with the same RLS.
 */
export async function signInWithCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('auth.code');
  // One message for every way a code can be wrong, so the form says nothing
  // about which codes or accounts exist.
  const failed: FormState = { status: 'error', message: t('failed') };
  const input = z.string().max(40).safeParse(formData.get('code'));

  const caller = await callerAddress();
  if (await codeEntryThrottled(caller)) return { status: 'error', message: t('rateLimited') };

  const studentId = input.success ? await findStudentByCode(input.data) : null;
  if (!studentId) {
    await recordCodeMiss(caller);
    return failed;
  }
  // A code opens a student account and nothing more (staff use a password
  // and MFA); a code left on an account that has since gained a staff role
  // does not work.
  if (!(await isStudentOnly(studentId))) return failed;
  const tokenHash = await signInTokenFor(studentId);
  if (!tokenHash) return failed;

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (error) return failed;
  redirect('/learn');
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
