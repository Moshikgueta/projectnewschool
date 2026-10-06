import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { isolate, languageName } from '@/domain/i18n/text';
import { partOfDay } from '@/domain/learning/time';
import { requireArea } from '@/server/auth/session';
import { getStudentDashboard, type ContinueItem } from '@/server/queries/dashboard';
import { ButtonLink } from '@/ui/Button';
import { Badge, Card, CardLink, LanguageChip } from '@/ui/Card';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { ForwardArrow } from '@/ui/icons';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { ProgressBar, Stat } from '@/ui/Progress';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('learn.dashboard');
  return { title: t('metaTitle') };
}

function continueHref(item: ContinueItem | null): Route {
  if (item?.kind === 'activity') return `/learn/attempts/${item.attemptId}` as Route;
  if (item?.kind === 'section') return `/learn/notebook/${item.sectionId}` as Route;
  return '/learn/notebook';
}

export default async function StudentHome({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireArea('learn');
  const [{ course: requested }, t, format, locale] = await Promise.all([
    searchParams,
    getTranslations('learn.dashboard'),
    getFormatter(),
    getLocale(),
  ]);
  const now = new Date();
  const data = await getStudentDashboard(user, requested, now);
  const greeting = t(`greeting.${partOfDay(now, user.timezone)}`, {
    name: user.displayName.split(' ')[0] ?? user.displayName,
  });

  if (!data.course) {
    return (
      <>
        <PageTitle>{greeting}</PageTitle>
        <EmptyState title={t('noCourses')}>{t('noCoursesBody')}</EmptyState>
      </>
    );
  }

  const { course, counts, progress } = data;
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', timeZone: user.timezone });

  const cards: { href: Route; title: string; body: string; count: string }[] = [
    {
      href: '/learn/notebook',
      title: t('cards.notebook'),
      body: t('cards.notebookBody'),
      count: t('counts.sections', { count: counts.notebookSections }),
    },
    {
      href: '/learn/workbook',
      title: t('cards.workbook'),
      body: t('cards.workbookBody'),
      count: t('counts.sections', { count: counts.workbookSections }),
    },
    {
      href: '/learn/practice',
      title: t('cards.practice'),
      body: t('cards.practiceBody'),
      count: t('counts.activities', { count: counts.activities }),
    },
    {
      href: '/learn/vocabulary',
      title: t('cards.vocabulary'),
      body: t('cards.vocabularyBody'),
      count: t('counts.words', { count: counts.words }),
    },
    {
      href: '/learn/practice',
      title: t('cards.homework'),
      body: t('cards.homeworkBody'),
      count: t('counts.homework', { count: counts.homework }),
    },
    {
      href: '/learn/practice',
      title: t('cards.review'),
      body: t('cards.reviewBody'),
      count: t('counts.review', { count: counts.reviewActivities }),
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <PageTitle
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <LanguageChip
                code={course.languageCode}
                name={languageName(course.languageCode, locale, course.languageName)}
              />
              <span>{course.levelTitle}</span>
              <span className="text-muted">{course.groupName}</span>
            </span>
          }
        >
          {greeting}
        </PageTitle>
        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href={continueHref(data.continueItem)}>
            {t('continueCta')}
            <ForwardArrow />
          </ButtonLink>
          {data.courses.length > 1 ? (
            <CourseSwitcher
              label={t('courseSwitcher')}
              courses={data.courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
              current={course.courseId}
              submitLabel={t('continueCta')}
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="continue-heading" title={t('continueTitle')}>
            {data.continueItem ? (
              <CardLink href={continueHref(data.continueItem)}>
                <span className="text-sm text-muted">
                  {data.continueItem.kind === 'activity'
                    ? t('continueActivity')
                    : t('continueSection')}
                </span>
                <span className="mt-1 flex items-center justify-between gap-3 text-lg font-semibold">
                  <span lang={course.languageCode} dir={course.direction}>
                    {data.continueItem.title}
                  </span>
                  <ForwardArrow className="size-5 shrink-0 text-primary" />
                </span>
              </CardLink>
            ) : (
              <Card>
                <p className="text-fg-secondary">{t('nothingToContinue')}</p>
              </Card>
            )}
          </Section>

          <Section id="course-heading" title={t('myCourse')}>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <li key={card.title}>
                  <CardLink href={card.href} className="h-full">
                    <span className="block font-semibold text-fg">{card.title}</span>
                    <span className="mt-1 block text-[0.9375rem] text-fg-secondary">
                      {card.body}
                    </span>
                    <span className="mt-3 block text-sm font-medium text-primary">
                      {card.count}
                    </span>
                  </CardLink>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="recommended-heading" title={t('recommended')}>
            {data.recommendations.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('recommendedEmpty')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.recommendations.map((rec) => (
                  <li key={rec.key}>
                    <CardLink
                      href={
                        rec.attemptId
                          ? (`/learn/attempts/${rec.attemptId}` as Route)
                          : '/learn/practice'
                      }
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={rec.kind === 'assignment' ? 'brand' : 'neutral'}>
                          {rec.kind === 'assignment' ? t('rec.assignment') : t('rec.unfinished')}
                        </Badge>
                        {rec.dueAt ? (
                          <span className="text-sm text-muted">
                            {t('rec.due', { date: date(rec.dueAt) })}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="mt-2 block font-semibold"
                        lang={course.languageCode}
                        dir={course.direction}
                      >
                        {rec.title}
                      </span>
                    </CardLink>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-10">
          <Section
            id="progress-heading"
            title={t('progress')}
            action={
              <Link
                href={`/learn/progress?course=${course.courseId}` as Route}
                className="text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('seeProgress')}
              </Link>
            }
          >
            <Card>
              <dl className="flex flex-col gap-6">
                <Stat label={t('activitiesCompleted')} value={progress.activitiesCompleted} />
                <Stat
                  label={t('practiceWeek')}
                  value={t('practiceWeekValue', {
                    days: progress.practiceDays,
                    goal: progress.practiceGoal,
                  })}
                >
                  <ProgressBar
                    label={t('practiceWeek')}
                    value={
                      (Math.min(progress.practiceDays, progress.practiceGoal) /
                        progress.practiceGoal) *
                      100
                    }
                    valueText={t('practiceWeekValue', {
                      days: progress.practiceDays,
                      goal: progress.practiceGoal,
                    })}
                  />
                </Stat>
                {progress.cycle ? (
                  <Stat
                    label={`${t('cycleProgress')}: ${progress.cycle.title}`}
                    value={t('cycleProgressValue', { percent: progress.cycle.percent })}
                  >
                    <ProgressBar
                      label={`${t('cycleProgress')}: ${progress.cycle.title}`}
                      value={progress.cycle.percent}
                    />
                  </Stat>
                ) : (
                  <Stat
                    label={t('cycleProgress')}
                    value={
                      <span className="text-base font-normal text-muted">{t('noActiveCycle')}</span>
                    }
                  />
                )}
              </dl>
            </Card>
          </Section>

          <Section id="recent-heading" title={t('recent')}>
            {data.recent.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('recentEmpty')}</p>
              </Card>
            ) : (
              <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                {data.recent.map((item, i) => (
                  <li key={`${item.occurredAt}-${i}`} className="flex flex-col gap-0.5 px-4 py-3">
                    <span className="text-[0.9375rem]">
                      {t(`events.${item.type}`, { title: isolate(item.title) })}
                    </span>
                    <time dateTime={item.occurredAt} className="text-sm text-muted">
                      {date(item.occurredAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
