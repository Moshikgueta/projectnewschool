import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/domain/auth/access';
import { listVerifiedTotpFactors } from '@/server/queries/mfa';
import { requireUser } from '@/server/auth/session';
import { Logo } from '@/ui/Logo';
import { MfaEnroll, MfaVerify } from './MfaForms';

export const metadata: Metadata = { title: 'Two-step verification' };

// Staff with manager or admin powers must confirm a code from an authenticator
// app; their session is then upgraded (aal2) and the database grants those powers.
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const next = safeNextPath((await searchParams).next, '/');
  if (user.aal === 'aal2') redirect(next as Route); // checked by safeNextPath

  const factors = await listVerifiedTotpFactors();
  const factor = factors[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
        <p className="text-fg-secondary">
          {factor
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Your role needs a second step at sign-in. Set up an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password).'}
        </p>
      </div>
      {factor ? <MfaVerify factorId={factor.id} next={next} /> : <MfaEnroll next={next} />}
    </main>
  );
}
