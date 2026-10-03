import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { isAutoGraded } from '@/content/items';
import { ActivityPlayer } from '@/content/player/ActivityPlayer';
import { NotebookView } from '@/content/render/NotebookView';
import { checkAnswer, finishAttempt, startActivity } from '@/server/actions/attempts';
import { requireArea } from '@/server/auth/session';
import { getMyAttempt, type AttemptView } from '@/server/queries/activities';
import { Button, ButtonLink } from '@/ui/Button';
import { Badge } from '@/ui/Card';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('activity');
  return { title: t('metaTitle') };
}

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireArea('learn');
  const id = z.uuid().safeParse((await params).attemptId);
  if (!id.success) notFound();

  // Another student's attempt id returns the same 404 as an id that does not exist.
  const attempt = await getMyAttempt(user, id.data);
  if (!attempt) notFound();
  const { activity } = attempt;

  const t = await getTranslations('activity');
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink
        href={`/learn/activities/${activity.id}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {activity.cycleTitle}
      </ButtonLink>
      <PageTitle subtitle={t(`scoring.${activity.scoring}`)}>{activity.title}</PageTitle>
      {attempt.status === 'in_progress' ? (
        <ActivityPlayer
          attemptId={attempt.id}
          scored={activity.scoring === 'scored'}
          lang={activity.courseLang}
          check={checkAnswer}
          finish={finishAttempt}
          items={activity.items.map((entry) => ({
            id: entry.rawId,
            item: entry.item,
            progress: attempt.state.items[entry.rawId] ?? null,
            prompt: (
              <NotebookView
                view="student"
                sectionId={activity.id}
                blocks={entry.prompt}
                courseLang={activity.courseLang}
                aiTutorUrl={null}
              />
            ),
          }))}
        />
      ) : (
        <Results attempt={attempt} />
      )}
    </article>
  );
}

async function Results({ attempt }: { attempt: AttemptView }) {
  const t = await getTranslations('activity');
  const { activity, state } = attempt;
  const graded = activity.items.filter((i) => i.item && isAutoGraded(i.item.type));
  const rightFirstTime = graded.filter((i) => {
    const p = state.items[i.rawId];
    return p && i.item && p.firstScore >= i.item.points;
  }).length;
  const tone = {
    correct: 'success',
    incorrect: 'warning',
    saved: 'neutral',
    skipped: 'neutral',
  } as const;

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-5">
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 id="results-heading" className="text-xl font-semibold">
          {t('results.title')}
        </h2>
        <p className="mt-1 text-fg-secondary">
          {activity.scoring === 'scored' && attempt.maxScore
            ? t('results.scoredSummary', { score: attempt.score ?? 0, max: attempt.maxScore })
            : t('results.practiceSummary', { correct: rightFirstTime, total: graded.length })}
        </p>
      </div>
      <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
        {activity.items.map((entry, i) => {
          const status = state.items[entry.rawId]?.status ?? 'skipped';
          return (
            <li key={entry.rawId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>{t('results.item', { n: i + 1 })}</span>
              <Badge tone={tone[status]}>{t(`results.status.${status}`)}</Badge>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-3">
        <form action={startActivity}>
          <input type="hidden" name="activityId" value={activity.id} />
          <Button type="submit">{t('again')}</Button>
        </form>
        <ButtonLink href="/learn/practice" variant="secondary">
          {t('results.back')}
        </ButtonLink>
      </div>
    </section>
  );
}
