import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function TeachLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('teach');
  return (
    <AppShell
      areaLabel="Teacher"
      userName={user.displayName}
      nav={[{ href: '/teach', label: 'My groups' }]}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
