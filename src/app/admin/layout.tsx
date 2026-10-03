import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('admin');
  return (
    <AppShell
      areaLabel="Administration"
      userName={user.displayName}
      nav={[{ href: '/admin', label: 'Accounts' }]}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
