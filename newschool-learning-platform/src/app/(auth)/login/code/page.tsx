import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSessionUser } from '@/server/auth/session';
import { CodeForm } from './CodeForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.code'))('title') };
}

export default async function CodeLoginPage() {
  if (await getSessionUser()) redirect('/');
  const t = await getTranslations('auth.code');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted">{t('intro')}</p>
      </div>
      <CodeForm />
      <Link href="/login" className="text-[0.9375rem] font-medium text-primary hover:underline">
        {t('back')}
      </Link>
    </div>
  );
}
