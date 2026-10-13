import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { STRONG_FROM } from '@/domain/learning/progress';
import { requireArea } from '@/server/auth/session';
import { getProgressPage } from '@/server/queries/progress';
import { ButtonLink } from '@/ui/Button';
import { Badge, Card } from '@/ui/Card';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { ProgressBar } from '@/ui/Progress';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('progress');
  return { title: t('metaTitle') };
}

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireArea('learn');
  const [{ course: requested }, t, td, format] = await Promise.all([
    searchParams,
    getTranslations('progress'),
    getTranslations('learn.dashboard'),
    getFormatter(),
  ]);
  const { courses, course, progress, words } = await getProgressPage(user, requested);

  if (!course || !progress) {
    return (
      <>
        <PageTitle>{t('title')}</PageTitle>
        <EmptyState title={t('noCourses')}>{t('empty')}</EmptyState>
      </>
    );
  }

  const { week } = progress;
  // Local dates come as YYYY-MM-DD; noon UTC keeps the weekday right in any zone.
  const dayName = (date: string, style: 'short' | 'long') =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      weekday: style,
      ...(style === 'long' ? { day: 'numeric', month: 'long' } : {}),
      timeZone: 'UTC',
    });
  const percent = (n: number) => Math.round(n * 100);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
        {courses.length > 1 ? (
          <CourseSwitcher
            action="/learn/progress"
            label={td('courseSwitcher')}
            submitLabel={td('continueCta')}
            current={course.courseId}
            courses={courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
          />
        ) : null}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="week-heading" title={t('week')}>
          <Card className="flex flex-col gap-4">
            <p className="text-2xl font-semibold tabular-nums">
              {t('weekValue', { days: week.practisedDays, goal: week.goal })}
            </p>
            <ol className="grid grid-cols-7 gap-2">
              {week.days.map((d) => (
                <li key={d.date} className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={`size-8 rounded-full border-2 ${
                      d.practised ? 'border-primary bg-primary' : 'border-border-strong bg-surface'
                    }`}
                  />
                  <span aria-hidden="true" className="text-xs text-muted">
                    {dayName(d.date, 'short')}
                  </span>
                  <span className="sr-only">
                    {t(d.practised ? 'dayPractised' : 'dayNot', { day: dayName(d.date, 'long') })}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-fg-secondary">
              {week.practisedDays >= week.goal ? t('weekMet') : t('weekHint', { goal: week.goal })}
            </p>
          </Card>
        </Section>

        <Section id="revisit-heading" title={t('revisit')}>
          {progress.revisit.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('revisitEmpty')}</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {progress.revisit.map((k) => (
                <li key={k.id}>
                  <Card className="flex flex-col gap-3">
                    <div>
                      <p className="font-semibold">{k.label}</p>
                      <p className="text-sm text-muted">
                        {t('revisitLine', { correct: k.correct, answers: k.answers })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {k.activities.map((a) => (
                        <ButtonLink
                          key={a.id}
                          href={`/learn/activities/${a.id}` as Route}
                          variant="secondary"
                        >
                          {t('practise', { title: a.title })}
                        </ButtonLink>
                      ))}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section id="cycles-heading" title={t('cycles')}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {progress.cycles.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{c.title}</p>
                  {c.complete ? (
                    <Badge tone="success">{t('complete')}</Badge>
                  ) : c.active ? (
                    <Badge tone="brand">{t('active')}</Badge>
                  ) : null}
                </div>
                <ProgressBar
                  label={t('cycleBar', { title: c.title })}
                  value={c.percent}
                  valueText={`${c.percent}%`}
                />
                <p className="text-sm text-muted">
                  {c.percent}% ·{' '}
                  {t('cycleActivities', { done: c.activitiesDone, total: c.activitiesTotal })} ·{' '}
                  {t('cycleSections', { done: c.sectionsDone, total: c.sectionsTotal })}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="skills-heading" title={t('skills')}>
          {progress.skills.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('empty')}</p>
            </Card>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {progress.skills.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{k.label}</span>
                    {k.accuracy !== null && k.accuracy >= STRONG_FROM ? (
                      <Badge tone="success">{t('strong')}</Badge>
                    ) : null}
                  </div>
                  {k.accuracy === null ? (
                    <span className="text-sm text-muted">
                      {t('tooEarly', { answers: k.answers })}
                    </span>
                  ) : (
                    <>
                      <ProgressBar
                        label={k.label}
                        value={percent(k.accuracy)}
                        valueText={t('accuracy', { percent: percent(k.accuracy) })}
                      />
                      <span className="text-sm text-muted">
                        {t('skillLine', { correct: k.correct, answers: k.answers })}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="vocabulary-heading"
          title={t('vocabulary')}
          action={
            <Link
              href={`/learn/vocabulary?course=${course.courseId}` as Route}
              className="text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('reviewWords')}
            </Link>
          }
        >
          <Card className="flex flex-col gap-3">
            <p className="text-2xl font-semibold tabular-nums">
              {t('vocabularyValue', { strong: words.strong, total: words.total })}
            </p>
            <ProgressBar
              label={t('vocabulary')}
              value={words.total ? (words.strong / words.total) * 100 : 0}
              valueText={t('vocabularyValue', { strong: words.strong, total: words.total })}
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
