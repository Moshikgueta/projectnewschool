import type { Metadata } from 'next';
import { requireArea } from '@/server/auth/session';
import { EmptyState, PageTitle } from '@/ui/AppShell';

export const metadata: Metadata = { title: 'Pedagogical management' };

export default async function ManageHome() {
  await requireArea('manage');
  return (
    <>
      <PageTitle subtitle="Courses, cycles, groups and enrollments.">
        Pedagogical management
      </PageTitle>
      <EmptyState title="Management screens arrive in Phase 2">
        Groups and enrollments come first (needed for the pilot); the full content editor is Phase
        8.
      </EmptyState>
    </>
  );
}
