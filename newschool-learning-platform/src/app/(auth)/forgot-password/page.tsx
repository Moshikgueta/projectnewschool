import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.forgot'))('title') };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth.forgot');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-fg-secondary">{t('intro')}</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-[0.9375rem] font-medium text-primary hover:underline">
        {t('back')}
      </Link>
    </div>
  );
}
