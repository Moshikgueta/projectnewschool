import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getAttempt } from '@/server/queries/student';
import { PageTitle } from '@/ui/Page';

// Phase 1 stub of an attempt view. It exists to prove the IDOR rule end to
// end: another student's attempt id returns the same 404 as an id that does
// not exist. Phase 4 turns this into the real activity player.
export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireArea('learn');
  const id = z.uuid().safeParse((await params).attemptId);
  if (!id.success) notFound();

  const attempt = await getAttempt(id.data);
  if (!attempt) notFound();

  const [t, format] = await Promise.all([getTranslations('learn.attempt'), getFormatter()]);
  return (
    <>
      <PageTitle subtitle={attempt.status === 'submitted' ? t('completed') : t('inProgress')}>
        {attempt.activityTitle}
      </PageTitle>
      <p className="text-fg-secondary">
        {t('started', {
          date: format.dateTime(new Date(attempt.startedAt), {
            dateStyle: 'medium',
            timeZone: user.timezone,
          }),
        })}
      </p>
    </>
  );
}
