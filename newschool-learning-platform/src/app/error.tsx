'use client';

import { useTranslations } from 'next-intl';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  // Never show error details to users; they go to error monitoring once it is set up.
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-xl font-semibold">{t('errorTitle')}</h1>
      <p className="text-fg-secondary">{t('errorBody')}</p>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 self-start font-medium text-primary hover:underline"
      >
        {t('tryAgain')}
      </button>
    </main>
  );
}
