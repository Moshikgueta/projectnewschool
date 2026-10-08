import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { safeNextPath } from '@/domain/auth/access';
import { requireUser } from '@/server/auth/session';
import { listVerifiedTotpFactors } from '@/server/queries/mfa';
import { MfaEnroll, MfaVerify } from './MfaForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.mfa'))('title') };
}

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

  const [factors, t] = await Promise.all([listVerifiedTotpFactors(), getTranslations('auth.mfa')]);
  const factor = factors[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-fg-secondary">{factor ? t('verifyIntro') : t('enrollIntro')}</p>
      </div>
      {factor ? <MfaVerify factorId={factor.id} next={next} /> : <MfaEnroll next={next} />}
    </div>
  );
}
