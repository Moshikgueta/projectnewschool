import type { ReactNode } from 'react';
import { signOut } from '@/server/actions/auth';
import { requireArea } from '@/server/auth/session';
import { AppShell } from '@/ui/AppShell';

export default async function LearnLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('learn');
  return (
    <AppShell
      areaLabel="Student"
      userName={user.displayName}
      nav={[{ href: '/learn', label: 'My courses' }]}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
