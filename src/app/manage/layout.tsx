import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function ManageLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('manage');
  return (
    <AppShell
      areaLabel="Pedagogical management"
      userName={user.displayName}
      nav={[{ href: '/manage', label: 'Overview' }]}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
