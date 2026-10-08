import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/ui/Logo';

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <Logo />
      <h1 className="text-xl font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="text-fg-secondary">{t('errors.notFoundBody')}</p>
      <Link href="/" className="font-medium text-primary hover:underline">
        {t('common.goHome')}
      </Link>
    </main>
  );
}
