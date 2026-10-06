import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { cancelClass, removeAssignment } from '@/server/actions/teach';
import { requireArea } from '@/server/auth/session';
import { listGroupNotebook } from '@/server/queries/notebook';
import { getGroupOverview } from '@/server/queries/teaching';
import { Avatar, Badge, Card, CardLink } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { ProgressBar } from '@/ui/Progress';
import { ActiveCycleForm, AssignForm, ClassForm } from './TeachForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('teach.groups'))('title') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';
const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline';

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const user = await requireArea('teach');
  const id = z.uuid().safeParse((await params).groupId);
  if (!id.success) notFound();

  // A group the teacher doesn't teach comes back empty from the database,
  // and is reported exactly like a group that doesn't exist.
  const group = await getGroupOverview(id.data);
  if (!group) notFound();

  const [t, td, tn, format, notebook] = await Promise.all([
    getTranslations('teach.group'),
    getTranslations('learn.dashboard'),
    getTranslations('notebook'),
    getFormatter(),
    listGroupNotebook(group.courseId, group.id),
  ]);
  const when = (iso: string, withTime = false) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      ...(withTime ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: user.timezone,
    });
  const active = group.cycles.find((c) => c.state === 'active') ?? null;
  const cycleTitle = new Map(group.cycles.map((c) => [c.id, c.title]));
  const teacherView = (activityId: string) =>
    `/teach/groups/${group.id}/activities/${activityId}` as Route;

  return (
    <>
      <PageTitle subtitle={[group.courseTitle, group.scheduleNote].filter(Boolean).join(' · ')}>
        {group.name}
      </PageTitle>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="homework-heading" title={t('homework')}>
            {group.assignments.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noHomework')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {group.assignments.map((a) => (
                  <li key={a.id}>
                    <Card className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          {a.activityId ? (
                            <Link
                              href={teacherView(a.activityId)}
                              className={LINK}
                              lang={group.courseLang}
                            >
                              {a.title}
                            </Link>
                          ) : (
                            <span className="font-medium" lang={group.courseLang}>
                              {a.title}
                            </span>
                          )}
                          <p className="text-sm text-muted">
                            {a.dueAt ? t('due', { date: when(a.dueAt) }) : t('noDue')}
                            {a.note ? ` · ${a.note}` : ''}
                          </p>
                        </div>
                        <form action={removeAssignment}>
                          <input type="hidden" name="groupId" value={group.id} />
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <button
                            type="submit"
                            className={QUIET_BUTTON}
                            aria-label={t('removeLabel', { title: a.title })}
                          >
                            {t('remove')}
                          </button>
                        </form>
                      </div>
                      {a.kind !== 'vocabulary' ? (
                        <>
                          <ProgressBar
                            label={t('doneCount', { done: a.done, total: a.total })}
                            value={a.total ? (a.done / a.total) * 100 : 0}
                          />
                          <p className="text-sm text-fg-secondary">
                            {t('doneCount', { done: a.done, total: a.total })}
                          </p>
                        </>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {group.activities.length ? (
              <Card>
                <h3 className="mb-3 font-semibold">{t('assign')}</h3>
                <AssignForm
                  groupId={group.id}
                  activities={group.activities.map((a) => ({
                    id: a.id,
                    label: `${cycleTitle.get(a.cycleId) ?? ''} · ${a.title}`,
                  }))}
                />
              </Card>
            ) : null}
          </Section>

          <Section id="students-heading" title={t('students')}>
            {group.students.length === 0 ? (
              <EmptyState title={t('empty')} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-[34rem] text-start text-[0.9375rem]">
                  <thead className="bg-surface-secondary text-sm text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-start font-medium">
                        {t('studentCol')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">
                        {t('lastActive')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">
                        {t('cycleCol')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">
                        {t('accuracyCol')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.students.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="px-4 py-3 text-start font-normal">
                          <span className="flex items-center gap-3">
                            <Avatar name={s.name} />
                            <bdi>{s.name}</bdi>
                            {s.status !== 'active' ? (
                              <Badge>{t(`status.${s.status}`)}</Badge>
                            ) : null}
                          </span>
                        </th>
                        <td className="px-4 py-3">
                          {s.lastActiveAt ? when(s.lastActiveAt) : t('notYet')}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {t('cycleDone', { done: s.cycleDone, total: s.cycleTotal })}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {s.accuracy === null
                            ? t('tooFew')
                            : t('accuracy', { percent: Math.round(s.accuracy * 100) })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="difficulties-heading" title={t('difficulties')}>
            <p className="text-sm text-muted">{t('difficultiesHint')}</p>
            {group.difficulties.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noDifficulties')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {group.difficulties.map((d) => (
                  <li key={d.itemId}>
                    <Card className="flex flex-col gap-1">
                      <p className="font-medium" lang={group.courseLang} dir="auto">
                        {d.question}
                      </p>
                      <p className="text-sm text-fg-secondary">
                        {t('difficultyLine', { wrong: d.wrong, students: d.students })}
                      </p>
                      {d.commonWrong ? (
                        <p className="text-sm text-fg-secondary">
                          {t('commonWrong', {
                            answer:
                              'truth' in d.commonWrong
                                ? t(d.commonWrong.truth ? 'true' : 'false')
                                : `⁨${d.commonWrong.text}⁩`,
                            count: d.commonWrongCount,
                          })}
                        </p>
                      ) : null}
                      <Link href={teacherView(d.activityId)} className={`${LINK} text-sm`}>
                        {t('teacherView')}: <span lang={group.courseLang}>{d.activityTitle}</span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {active ? (
            <Section id="activities-heading" title={t('activities')}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.activities
                  .filter((a) => a.cycleId === active.id)
                  .map((a) => (
                    <li key={a.id}>
                      <CardLink href={teacherView(a.id)}>
                        <span className="font-medium text-fg" lang={group.courseLang}>
                          {a.title}
                        </span>
                      </CardLink>
                    </li>
                  ))}
              </ul>
            </Section>
          ) : null}

          {notebook.map((cycle, i) => (
            <Section
              key={cycle.cycle}
              id={`notebook-${i}`}
              title={`${tn('teacher.notebook')}: ${cycle.cycle}`}
              action={
                cycle.active ? <Badge tone="brand">{tn('list.activeCycle')}</Badge> : undefined
              }
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {cycle.sections.map((s) => (
                  <li key={s.id}>
                    <CardLink href={`/teach/groups/${group.id}/notebook/${s.id}` as Route}>
                      <span className="font-medium text-fg">{s.title}</span>
                    </CardLink>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>

        <aside className="flex min-w-0 flex-col gap-10">
          <Section id="cycle-heading" title={t('activeCycle')}>
            <Card className="flex flex-col gap-4">
              <p className="text-lg font-semibold">{active ? active.title : t('noActiveCycle')}</p>
              {group.cycles.length ? (
                <ActiveCycleForm
                  groupId={group.id}
                  cycles={group.cycles}
                  current={active?.id ?? null}
                />
              ) : null}
            </Card>
          </Section>

          <Section id="classes-heading" title={t('nextClass')}>
            <Card className="flex flex-col gap-4">
              {group.upcomingClasses.length === 0 ? (
                <p className="text-fg-secondary">{t('noClass')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {group.upcomingClasses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="tabular-nums">{when(c.startsAt, true)}</span>
                      <form action={cancelClass}>
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="sessionId" value={c.id} />
                        <button
                          type="submit"
                          className={QUIET_BUTTON}
                          aria-label={t('cancelClass', { date: when(c.startsAt, true) })}
                        >
                          {t('remove')}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <ClassForm groupId={group.id} />
            </Card>
          </Section>

          <Section id="recent-heading" title={t('recent')}>
            {group.recent.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('recentEmpty')}</p>
              </Card>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {group.recent.map((e, i) => (
                  <li key={i} className="flex flex-col px-4 py-3">
                    <span>
                      <bdi className="font-medium">{e.student}</bdi> ·{' '}
                      {td(`events.${e.type}`, { title: `⁨${e.title}⁩` })}
                    </span>
                    <span className="text-sm text-muted">{when(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
