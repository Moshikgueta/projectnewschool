import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { NotebookView } from '@/content/render/NotebookView';
import { startActivity } from '@/server/actions/attempts';
import { requireArea } from '@/server/auth/session';
import { getActivity, listMyAttempts } from '@/server/queries/activities';
import { Button, ButtonLink } from '@/ui/Button';
import { PageTitle, Section } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('activity');
  return { title: t('metaTitle') };
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const user = await requireArea('learn');
  const id = z.uuid().safeParse((await params).activityId);
  if (!id.success) notFound();

  // Drafts, other courses and unknown ids all come back empty from the database.
  const activity = await getActivity(id.data);
  if (!activity) notFound();

  const [attempts, t, format] = await Promise.all([
    listMyAttempts(user, activity.id),
    getTranslations('activity'),
    getFormatter(),
  ]);
  const open = attempts.find((a) => a.status === 'in_progress');
  const finished = attempts.filter((a) => a.status === 'submitted');

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink href="/learn/practice" variant="tertiary" className="self-start">
        {t('results.back')}
      </ButtonLink>
      <PageTitle
        subtitle={[
          activity.cycleTitle,
          t('questions', { count: activity.items.length }),
          activity.minutes ? t('minutes', { minutes: activity.minutes }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        {activity.title}
      </PageTitle>
      <p className="text-fg-secondary">{t(`scoring.${activity.scoring}`)}</p>
      {activity.instructions.length ? (
        <NotebookView
          view="student"
          sectionId={activity.id}
          blocks={activity.instructions}
          courseLang={activity.courseLang}
          aiTutorUrl={null}
        />
      ) : null}
      <form action={startActivity}>
        <input type="hidden" name="activityId" value={activity.id} />
        <Button type="submit">
          {open ? t('resume') : finished.length ? t('again') : t('start')}
        </Button>
      </form>
      {finished.length ? (
        <Section id="earlier-heading" title={t('earlier')}>
          <ul className="flex flex-col gap-1 text-fg-secondary">
            {finished.map((a) => (
              <li key={a.id}>
                {t('earlierLine', {
                  date: format.dateTime(new Date(a.submittedAt ?? a.updatedAt), {
                    dateStyle: 'medium',
                    timeZone: user.timezone,
                  }),
                  result:
                    activity.scoring === 'scored' && a.maxScore
                      ? t('resultScored', { score: a.score ?? 0, max: a.maxScore })
                      : t('resultPractice'),
                })}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
