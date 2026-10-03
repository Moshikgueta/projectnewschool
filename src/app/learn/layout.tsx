import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function LearnLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('learn');
  const t = await getTranslations();
  return (
    <AppShell
      areaLabel={t('areas.learn')}
      userName={user.displayName}
      signOutAction={signOut}
      languageAction={setInterfaceLanguage}
      nav={[
        { href: '/learn', label: t('learn.nav.home'), icon: 'home' },
        { href: '/learn/notebook', label: t('learn.nav.notebook'), icon: 'notebook' },
        { href: '/learn/workbook', label: t('learn.nav.workbook'), icon: 'workbook' },
        { href: '/learn/practice', label: t('learn.nav.practice'), icon: 'practice' },
        { href: '/learn/vocabulary', label: t('learn.nav.vocabulary'), icon: 'vocabulary' },
      ]}
    >
      {children}
    </AppShell>
  );
}
