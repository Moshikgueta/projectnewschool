import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getStudentInGroup, type HomeworkStatus } from '@/server/queries/teaching-student';
import { ButtonLink } from '@/ui/Button';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { ProgressBar } from '@/ui/Progress';
import { AssignForm } from '../../TeachForms';

type Params = { params: Promise<{ groupId: string; studentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('teach.student'))('metaTitle') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';
const TONE: Record<HomeworkStatus, 'success' | 'neutral' | 'error' | 'brand'> = {
  done: 'success',
  open: 'brand',
  overdue: 'error',
  untracked: 'neutral',
};

/**
 * One student of a group, as their teacher sees them. A student who is not in
 * the group, or a group the caller does not teach, is "not found", exactly
 * like a page that does not exist.
 */
export default async function TeacherStudentPage({ params }: Params) {
  const user = await requireArea('teach');
  const raw = await params;
  const groupId = z.uuid().safeParse(raw.groupId);
  const studentId = z.uuid().safeParse(raw.studentId);
  if (!groupId.success || !studentId.success) notFound();

  const data = await getStudentInGroup(user.id, groupId.data, studentId.data);
  if (!data) notFound();
  const { group, student, progress } = data;

  const [t, tg, ta, format] = await Promise.all([
    getTranslations('teach.student'),
    getTranslations('teach.group'),
    getTranslations('teach.attendance'),
    getFormatter(),
  ]);
  const when = (iso: string, withTime = false) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      ...(withTime ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: user.timezone,
    });
  const teacherView = (activityId: string) =>
    `/teach/groups/${group.id}/activities/${activityId}` as Route;
  const cycles = progress.cycles.filter((c) => c.activitiesTotal + c.sectionsTotal > 0);

  return (
    <div className="flex flex-col gap-6">
      <ButtonLink
        href={`/teach/groups/${group.id}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('back', { group: group.name })}
      </ButtonLink>
      <PageTitle
        subtitle={[
          group.courseTitle,
          // A calendar date (no time of day): formatted as such, in UTC.
          t('since', {
            date: format.dateTime(new Date(`${student.startedOn}T00:00:00Z`), {
              dateStyle: 'medium',
              timeZone: 'UTC',
            }),
          }),
          data.lastActiveAt ? t('lastActive', { date: when(data.lastActiveAt) }) : t('neverActive'),
        ].join(' · ')}
      >
        <span className="flex flex-wrap items-center gap-3">
          <bdi>{student.name}</bdi>
          {student.status !== 'active' ? <Badge>{tg(`status.${student.status}`)}</Badge> : null}
        </span>
      </PageTitle>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="student-homework-heading" title={t('homework')}>
            {data.homework.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noHomework')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                {data.homework.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      {h.activityId ? (
                        <Link
                          href={teacherView(h.activityId)}
                          className={LINK}
                          lang={group.courseLang}
                        >
                          {h.title}
                        </Link>
                      ) : (
                        <span className="font-medium" lang={group.courseLang}>
                          {h.title}
                        </span>
                      )}
                      <p className="text-sm text-muted">
                        {h.dueAt ? tg('due', { date: when(h.dueAt) }) : tg('noDue')}
                        {h.note ? ` · ${h.note}` : ''}
                      </p>
                    </div>
                    <span className="flex flex-wrap gap-2">
                      {h.personal ? <Badge>{t('personal')}</Badge> : null}
                      <Badge tone={TONE[h.status]}>{t(`homeworkStatus.${h.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.assignable.length ? (
              <Card>
                <h3 className="mb-1 font-semibold">
                  {t('assignTitle', { name: `⁨${student.name}⁩` })}
                </h3>
                <p className="mb-3 text-sm text-muted">
                  {t('assignHint', { name: `⁨${student.name}⁩` })}
                </p>
                <AssignForm
                  groupId={group.id}
                  onlyStudent={student.id}
                  students={[]}
                  activities={data.assignable.map((a) => ({
                    id: a.id,
                    label: `${a.cycleTitle} · ${a.title}${a.byStaff ? ` (${tg('byStaff')})` : ''}`,
                  }))}
                />
              </Card>
            ) : null}
          </Section>

          <Section id="student-attempts-heading" title={t('attempts')}>
            {data.attempts.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noAttempts')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                {data.attempts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={teacherView(a.activityId)}
                        className={LINK}
                        lang={group.courseLang}
                        aria-label={t('teacherView', { title: a.title })}
                      >
                        {a.title}
                      </Link>
                      <p className="text-sm text-muted">{when(a.at, true)}</p>
                    </div>
                    <span className="flex flex-wrap items-center gap-2">
                      {a.score !== null && a.maxScore ? (
                        <span className="tabular-nums">
                          {t('score', { score: a.score, max: a.maxScore })}
                        </span>
                      ) : null}
                      <Badge tone={a.status === 'submitted' ? 'success' : 'neutral'}>
                        {t(`attemptStatus.${a.status}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="student-progress-heading" title={t('progress')}>
            <Card className="flex flex-col gap-4">
              <p className="text-fg-secondary">
                {t('week', { days: progress.week.practisedDays, goal: progress.week.goal })}
              </p>
              <ul className="flex flex-col gap-4">
                {cycles.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1.5">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {c.title}
                      {c.active ? <Badge tone="brand">{t('activeCycle')}</Badge> : null}
                    </p>
                    <ProgressBar
                      value={c.percent}
                      label={t('cyclePercent', { percent: c.percent, title: c.title })}
                    />
                    <p className="text-sm text-muted tabular-nums">
                      {t('cycleLine', {
                        activitiesDone: c.activitiesDone,
                        activitiesTotal: c.activitiesTotal,
                        sectionsDone: c.sectionsDone,
                        sectionsTotal: c.sectionsTotal,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('revisit')}</h3>
              {progress.revisit.length === 0 ? (
                <p className="text-fg-secondary">{t('noRevisit')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {progress.revisit.map((s) => (
                    <li key={s.id}>
                      <p className="font-medium">{s.label}</p>
                      <p className="text-sm text-muted">
                        {t('skillLine', {
                          percent: Math.round((s.accuracy ?? 0) * 100),
                          answers: s.answers,
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="student-attendance-heading" title={t('attendance')}>
            <Card className="flex flex-col gap-3">
              {data.attendance.rate ? (
                <p className="font-medium tabular-nums">
                  {t('attendanceRate', data.attendance.rate)}
                </p>
              ) : (
                <p className="text-fg-secondary">{t('attendanceNone')}</p>
              )}
              {data.attendance.recent.length ? (
                <>
                  <h3 className="text-sm font-medium text-muted">{t('recentClasses')}</h3>
                  <ul className="flex flex-col divide-y divide-border">
                    {data.attendance.recent.map((m) => (
                      <li key={m.startsAt} className="flex items-center justify-between gap-2 py-2">
                        <span className="tabular-nums">{when(m.startsAt, true)}</span>
                        <Badge
                          tone={
                            m.status === 'present'
                              ? 'success'
                              : m.status === 'absent'
                                ? 'error'
                                : m.status === 'late'
                                  ? 'warning'
                                  : 'neutral'
                          }
                        >
                          {ta(`status.${m.status}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          </Section>

          <Section id="student-notebook-heading" title={t('notebook')}>
            <Card className="flex flex-col gap-2">
              {data.notebook.length === 0 ? (
                <p className="text-fg-secondary">{t('noNotebook')}</p>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    {t('notebookHint', { name: `⁨${student.name}⁩` })}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {data.notebook.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/teach/groups/${group.id}/notebook/${s.id}` as Route}
                          className={LINK}
                        >
                          {s.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
