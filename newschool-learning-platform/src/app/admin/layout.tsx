import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('admin');
  const t = await getTranslations();
  return (
    <AppShell
      areaLabel={t('areas.admin')}
      userName={user.displayName}
      signOutAction={signOut}
      languageAction={setInterfaceLanguage}
      nav={[{ href: '/admin', label: t('admin.nav.accounts'), icon: 'groups' }]}
    >
      {children}
    </AppShell>
  );
}
