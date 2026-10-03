import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getGroup } from '@/server/queries/teacher';
import { EmptyState, PageTitle } from '@/ui/AppShell';

export const metadata: Metadata = { title: 'Group' };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireArea('teach');
  const id = z.uuid().safeParse((await params).groupId);
  if (!id.success) notFound();

  // A group the teacher doesn't teach comes back empty from the database,
  // and is reported exactly like a group that doesn't exist.
  const group = await getGroup(id.data);
  if (!group) notFound();

  return (
    <>
      <PageTitle subtitle={group.courseTitle ?? 'Course not published yet'}>{group.name}</PageTitle>
      {group.students.length === 0 ? (
        <EmptyState title="No students in this group yet" />
      ) : (
        <section aria-labelledby="students-heading">
          <h2 id="students-heading" className="mb-3 text-lg font-semibold">
            Students
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.students.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3">
                <span>{s.displayName}</span>
                <span className="text-sm text-muted">{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
