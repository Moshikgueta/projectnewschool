import Link from 'next/link';
import type { Metadata } from 'next';
import { requireArea } from '@/server/auth/session';
import { listTaughtGroups } from '@/server/queries/teacher';
import { EmptyState, PageTitle } from '@/ui/AppShell';

export const metadata: Metadata = { title: 'My groups' };

export default async function TeachHome() {
  const user = await requireArea('teach');
  const groups = await listTaughtGroups(user.id);

  return (
    <>
      <PageTitle subtitle="The groups you teach.">My groups</PageTitle>
      {groups.length === 0 ? (
        <EmptyState title="No groups yet">
          A pedagogical manager assigns teachers to groups.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Groups">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/teach/groups/${g.id}`}
                className="block rounded-lg border border-border bg-surface p-5 hover:border-primary"
              >
                <h2 className="text-lg font-semibold">{g.name}</h2>
                <p className="mt-1 text-[0.9375rem] text-fg-secondary">
                  {g.courseTitle ?? 'Course not published yet'} · {g.studentCount}{' '}
                  {g.studentCount === 1 ? 'student' : 'students'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
