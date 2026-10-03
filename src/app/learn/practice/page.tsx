import type { Metadata, Route } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getPracticeList, type PracticeActivity } from '@/server/queries/activities';
import { Badge, CardLink } from '@/ui/Card';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { EmptyState, PageTitle, Section } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('activity.practice');
  return { title: t('title') };
}

const TONE = { not_started: 'neutral', in_progress: 'brand', completed: 'success' } as const;

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireArea('learn');
  const [{ course: requested }, t, ta, td, format] = await Promise.all([
    searchParams,
    getTranslations('activity.practice'),
    getTranslations('activity'),
    getTranslations('learn.dashboard'),
    getFormatter(),
  ]);
  const { courses, course, homework, cycles } = await getPracticeList(user, requested);

  const card = (a: PracticeActivity) => (
    <li key={a.id}>
      <CardLink
        href={
          (a.openAttemptId
            ? `/learn/attempts/${a.openAttemptId}`
            : `/learn/activities/${a.id}`) as Route
        }
        className="flex h-full flex-col gap-2"
      >
        <span className="font-medium text-fg">{a.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
          {a.minutes ? <span>{ta('minutes', { minutes: a.minutes })}</span> : null}
          {a.dueAt ? (
            <span>
              {t('due', {
                date: format.dateTime(new Date(a.dueAt), {
                  day: 'numeric',
                  month: 'short',
                  timeZone: user.timezone,
                }),
              })}
            </span>
          ) : null}
        </span>
      </CardLink>
    </li>
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
        {courses.length > 1 && course ? (
          <CourseSwitcher
            action="/learn/practice"
            label={td('courseSwitcher')}
            submitLabel={td('continueCta')}
            current={course.courseId}
            courses={courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
          />
        ) : null}
      </div>
      {cycles.length === 0 ? (
        <EmptyState title={t('empty')}>{t('emptyBody')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {homework.length ? (
            <Section id="homework-heading" title={t('homework')}>
              <ul className="grid gap-3 sm:grid-cols-2">{homework.map(card)}</ul>
            </Section>
          ) : null}
          {cycles.map((cycle) => (
            <Section
              key={cycle.id}
              id={`cycle-${cycle.id}`}
              title={cycle.title}
              action={cycle.active ? <Badge tone="brand">{t('activeCycle')}</Badge> : undefined}
            >
              <ul className="grid gap-3 sm:grid-cols-2">{cycle.activities.map(card)}</ul>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
