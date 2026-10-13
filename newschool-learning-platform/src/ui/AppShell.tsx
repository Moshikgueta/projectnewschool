import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Avatar } from './Card';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';
import { NavLinks, type NavItem } from './NavLinks';

type Props = {
  areaLabel: string;
  userName: string;
  nav: NavItem[];
  signOutAction: () => Promise<void>;
  languageAction: (formData: FormData) => Promise<void>;
  /** Extra controls in the top bar, e.g. the student's course switcher. */
  toolbar?: ReactNode;
  children: ReactNode;
};

/**
 * The one shell for every signed-in area: side rail on desktop, bottom tab
 * bar on phones, top bar with account controls. Logical properties only, so
 * the whole layout mirrors in right-to-left languages.
 */
export async function AppShell({
  areaLabel,
  userName,
  nav,
  signOutAction,
  languageAction,
  toolbar,
  children,
}: Props) {
  const t = await getTranslations('common');
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        {t('skipToContent')}
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-8 border-e border-border bg-surface px-4 py-6 md:flex">
        <div className="flex flex-col gap-1 px-3">
          <Logo />
          <span className="text-sm text-muted">{areaLabel}</span>
        </div>
        <NavLinks items={nav} variant="rail" label={t('mainNav')} />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-border bg-surface">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <div className="md:hidden">
              <Logo />
            </div>
            {toolbar}
            <div className="ms-auto flex items-center gap-2">
              <Suspense>
                <LanguageSwitcher action={languageAction} />
              </Suspense>
              <span className="hidden items-center gap-2 sm:inline-flex">
                <Avatar name={userName} />
                <span className="text-sm text-fg-secondary">{userName}</span>
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="min-h-11 rounded-md px-2 text-sm font-medium text-primary hover:underline"
                >
                  {t('signOut')}
                </button>
              </form>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-28 md:pb-12">
          {children}
        </main>
      </div>

      <NavLinks items={nav} variant="bar" label={t('mainNav')} />
    </div>
  );
}
