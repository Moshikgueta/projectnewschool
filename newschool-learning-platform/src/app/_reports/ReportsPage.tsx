import type { Route } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { SessionUser } from '@/server/auth/session';
import { setReportStatusAsManager, setReportStatusAsTeacher } from '@/server/actions/reports';
import {
  listReports,
  myGroupPerCourse,
  type ContentReport,
  type ReportStatus,
} from '@/server/queries/reports';
import { Badge, Card } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { LatestOnly } from '@/ui/Pager';

// Mistake reports (ADR-040), for the pedagogical manager (/manage/reports)
// and for teachers (/teach/reports). The list is read with the caller's own
// session, so RLS decides which reports each sees.

const FILTERS = ['open', 'resolved', 'all'] as const;
type Filter = (typeof FILTERS)[number];

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline';
const LINK = 'text-sm font-medium text-primary underline-offset-4 hover:underline';

export function readFilter(value: string | undefined): Filter {
  return FILTERS.includes(value as Filter) ? (value as Filter) : 'open';
}

export async function ReportsPage({
  user,
  area,
  filter,
}: {
  user: SessionUser;
  area: 'manage' | 'teach';
  filter: Filter;
}) {
  const [{ reports, total }, groups, t, format] = await Promise.all([
    listReports(filter satisfies ReportStatus | 'all'),
    area === 'teach' ? myGroupPerCourse(user.id) : Promise.resolve(new Map<string, string>()),
    getTranslations('reports.list'),
    getFormatter(),
  ]);
  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: user.timezone,
    });

  // By course, courses with the most reports first.
  const byCourse = new Map<string, { title: string; reports: ContentReport[] }>();
  for (const r of reports) {
    const entry = byCourse.get(r.course.id) ?? { title: r.course.title, reports: [] };
    entry.reports.push(r);
    byCourse.set(r.course.id, entry);
  }
  const courses = [...byCourse.entries()].sort(
    (a, b) => b[1].reports.length - a[1].reports.length || a[1].title.localeCompare(b[1].title),
  );

  const href = (r: ContentReport): Route | null => {
    if (area === 'manage') {
      if (r.activity) return `/manage/content/activities/${r.activity.id}` as Route;
      if (r.section) return `/manage/content/sections/${r.section.id}` as Route;
      return null;
    }
    const group = groups.get(r.course.id);
    if (!group) return null;
    if (r.activity) return `/teach/groups/${group}/activities/${r.activity.id}` as Route;
    if (r.section) return `/teach/groups/${group}/notebook/${r.section.id}` as Route;
    return null;
  };
  const what = (r: ContentReport): string => {
    if (r.activity) {
      const title = r.activity.title || t('unavailable');
      return r.question ? t('question', { title, n: r.question }) : t('exercise', { title });
    }
    return t('page', { title: r.section?.title || t('unavailable') });
  };
  // A reported question: the manager goes straight to correcting its answer (ADR-041).
  const correctHref = (r: ContentReport): Route | null =>
    area === 'manage' && r.activity && r.itemId
      ? (`/manage/content/activities/${r.activity.id}?correct=${r.itemId}&report=${r.id}` as Route)
      : null;
  const setStatus = area === 'manage' ? setReportStatusAsManager : setReportStatusAsTeacher;
  const base = area === 'manage' ? '/manage/reports' : '/teach/reports';

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={area === 'manage' ? t('manageSubtitle') : t('teachSubtitle')}>
        {area === 'manage' ? t('manageTitle') : t('teachTitle')}
      </PageTitle>
      <nav aria-label={t('filterLabel')} className="-mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`${base}?status=${f}` as Route}
            aria-current={f === filter ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-fg-secondary hover:bg-surface-secondary aria-[current=page]:border-primary aria-[current=page]:bg-primary-light aria-[current=page]:text-primary"
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </nav>
      <LatestOnly shown={reports.length} total={total} />
      {courses.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        courses.map(([courseId, course]) => (
          <Section
            key={courseId}
            id={`reports-${courseId}`}
            title={<span dir="auto">{course.title}</span>}
            action={
              <span className="text-sm text-muted">
                {t('count', { count: course.reports.length })}
              </span>
            }
          >
            <ul className="flex flex-col gap-3">
              {course.reports.map((r) => {
                const link = href(r);
                const correct = correctHref(r);
                const label = what(r);
                return (
                  <li key={r.id}>
                    <Card className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={r.status === 'open' ? 'warning' : 'success'}>
                            {r.status === 'open' ? t('open') : t('resolved')}
                          </Badge>
                          <span className="font-medium" dir="auto">
                            {label}
                          </span>
                        </span>
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={r.status === 'open' ? 'resolved' : 'open'}
                          />
                          <button
                            type="submit"
                            className={QUIET_BUTTON}
                            aria-label={t(r.status === 'open' ? 'resolveLabel' : 'reopenLabel', {
                              date: date(r.createdAt),
                              title: label,
                            })}
                          >
                            {r.status === 'open' ? t('resolve') : t('reopen')}
                          </button>
                        </form>
                      </div>
                      <p dir="auto" className="whitespace-pre-line">
                        {r.message}
                      </p>
                      {r.suggestedAnswer ? (
                        <p className="text-fg-secondary">
                          <span className="font-medium">{t('suggested')}</span>{' '}
                          <bdi>{r.suggestedAnswer}</bdi>
                        </p>
                      ) : null}
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                        <span>
                          {r.reporterName ? t('from', { name: r.reporterName }) : t('fromStudent')}{' '}
                          · {date(r.createdAt)}
                        </span>
                        {r.status === 'resolved' && r.resolvedAt ? (
                          <span>
                            {r.resolverName
                              ? t('resolvedBy', { name: r.resolverName, date: date(r.resolvedAt) })
                              : t('resolvedOn', { date: date(r.resolvedAt) })}
                          </span>
                        ) : null}
                        {link ? (
                          <Link href={link} className={LINK}>
                            {area === 'manage' ? t('openInEditor') : t('openTeacherView')}
                          </Link>
                        ) : null}
                        {correct ? (
                          <Link
                            href={correct}
                            className={LINK}
                            aria-label={t('correctAnswerLabel', { title: label })}
                          >
                            {t('correctAnswer')}
                          </Link>
                        ) : null}
                      </p>
                      {r.correction ? (
                        <p className="text-sm text-success-ink">
                          {t('corrected', {
                            date: date(r.correction.at),
                            reason: r.correction.reason,
                          })}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))
      )}
    </div>
  );
}
