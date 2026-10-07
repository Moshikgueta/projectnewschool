import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function TeachLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('teach');
  const t = await getTranslations();
  return (
    <AppShell
      areaLabel={t('areas.teach')}
      userName={user.displayName}
      signOutAction={signOut}
      languageAction={setInterfaceLanguage}
      nav={[
        { href: '/teach', label: t('teach.nav.groups'), icon: 'groups' },
        { href: '/teach/timetable', label: t('teach.nav.timetable'), icon: 'timetable' },
        { href: '/teach/tools', label: t('staff.nav.tools'), icon: 'tools' },
      ]}
    >
      {children}
    </AppShell>
  );
}
