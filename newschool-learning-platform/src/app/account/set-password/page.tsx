import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/server/auth/session';
import { SetPasswordForm } from './SetPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.setPassword'))('title') };
}

// Reached from an invite or password-reset email (via /auth/confirm, which
// signs the person in with the one-time link).
export default async function SetPasswordPage() {
  const user = await requireUser();
  const t = await getTranslations('auth.setPassword');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {user.email ? <p className="text-fg-secondary">{t('for', { email: user.email })}</p> : null}
      </div>
      <SetPasswordForm />
    </div>
  );
}
