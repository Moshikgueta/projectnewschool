import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getAttempt } from '@/server/queries/student';
import { PageTitle } from '@/ui/AppShell';

export const metadata: Metadata = { title: 'Activity' };

// Phase 1 stub of an attempt view. It exists to prove the IDOR rule end to
// end: another student's attempt id returns the same 404 as an id that does
// not exist. Phase 4 turns this into the real activity player.
export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireArea('learn');
  const id = z.uuid().safeParse((await params).attemptId);
  if (!id.success) notFound();

  const attempt = await getAttempt(id.data);
  if (!attempt) notFound();

  return (
    <>
      <PageTitle subtitle={attempt.status === 'submitted' ? 'Completed' : 'In progress'}>
        {attempt.activityTitle}
      </PageTitle>
      <p className="text-fg-secondary">
        Started {new Date(attempt.startedAt).toLocaleDateString('en-GB')}
      </p>
    </>
  );
}
