import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function ManageLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('manage');
  const t = await getTranslations();
  return (
    <AppShell
      areaLabel={t('areas.manage')}
      userName={user.displayName}
      signOutAction={signOut}
      languageAction={setInterfaceLanguage}
      nav={[{ href: '/manage', label: t('manage.nav.overview'), icon: 'settings' }]}
    >
      {children}
    </AppShell>
  );
}
