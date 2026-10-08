'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES } from '@/domain/i18n/locales';
import { Icon } from './icons';

/**
 * Switches the interface language (Hebrew ⇄ English). The action saves the
 * choice and returns to the same page.
 */
export function LanguageSwitcher({ action }: { action: (formData: FormData) => Promise<void> }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const target = LOCALES.find((l) => l !== locale) ?? locale;

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={target} />
      <input type="hidden" name="back" value={search ? `${pathname}?${search}` : pathname} />
      <button
        type="submit"
        lang={target}
        aria-label={`${t('languageLabel')}: ${t(`languages.${target}`)}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-surface-secondary hover:text-fg"
      >
        <Icon name="language" className="size-4" />
        {t(`languages.${target}`)}
      </button>
    </form>
  );
}
