'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { safeNextPath } from '@/domain/auth/access';
import { requireUser } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type EnrollState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'enrolling'; factorId: string; qrCode: string; secret: string };

export type VerifyState = { status: 'idle' } | { status: 'error'; message: string };

/** Start TOTP enrollment: returns the QR code to scan with an authenticator app. */
export async function startTotpEnrollment(): Promise<EnrollState> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  // Clear abandoned, never-verified factors so retries don't pile up.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) {
    return { status: 'error', message: (await getTranslations('auth.mfa'))('startFailed') };
  }
  return {
    status: 'enrolling',
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Verify a TOTP code; on success the session is upgraded to aal2. */
export async function verifyTotp(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  await requireUser();
  const t = await getTranslations('auth.mfa');
  const parsed = z
    .object({
      factorId: z.uuid(),
      code: z.string().regex(/^\d{6}$/, t('codeFormat')),
      next: z.string().max(500).optional(),
    })
    .safeParse({
      factorId: formData.get('factorId'),
      code: String(formData.get('code') ?? '').replace(/\s/g, ''),
      next: formData.get('next') ?? undefined,
    });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? t('codeFormat') };
  }

  const supabase = await createSupabaseServerClient();
  // The factor must belong to the signed-in user; Supabase checks this too.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.all.some((f) => f.id === parsed.data.factorId)) {
    return { status: 'error', message: t('startAgain') };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return { status: 'error', message: t('codeFailed') };

  redirect(safeNextPath(parsed.data.next, '/') as Route); // same-site paths only
}
