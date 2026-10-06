import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('office');
  const t = await getTranslations();
  return (
    <AppShell
      areaLabel={t('areas.office')}
      userName={user.displayName}
      signOutAction={signOut}
      languageAction={setInterfaceLanguage}
      nav={[
        { href: '/office', label: t('office.nav.timetable'), icon: 'timetable' },
        { href: '/office/rooms', label: t('office.nav.rooms'), icon: 'rooms' },
      ]}
    >
      {children}
    </AppShell>
  );
}
