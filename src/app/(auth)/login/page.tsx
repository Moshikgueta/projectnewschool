import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSessionUser } from '@/server/auth/session';
import { Alert } from '@/ui/Alert';
import { LoginForm } from './LoginForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.signIn'))('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (await getSessionUser()) redirect('/');
  const [{ next, error }, t] = await Promise.all([searchParams, getTranslations('auth.signIn')]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      {error === 'link' ? <Alert tone="error">{t('linkExpired')}</Alert> : null}
      <LoginForm next={next ?? ''} />
      <Link
        href="/forgot-password"
        className="text-[0.9375rem] font-medium text-primary hover:underline"
      >
        {t('forgot')}
      </Link>
    </div>
  );
}
