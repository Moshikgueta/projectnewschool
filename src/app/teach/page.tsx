import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getTeacherDay, type DayClass } from '@/server/queries/attendance';
import { listTaughtGroups } from '@/server/queries/teacher';
import { Card, CardLink } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { ProgressBar } from '@/ui/Progress';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('teach.today'))('title') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';

export default async function TeachHome() {
  const user = await requireArea('teach');
  const [groups, day, t, tg, format] = await Promise.all([
    listTaughtGroups(user.id),
    getTeacherDay(user.id, user.timezone),
    getTranslations('teach.today'),
    getTranslations('teach.groups'),
    getFormatter(),
  ]);
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', timeZone: user.timezone });
  const date = (iso: string, withTime = false) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: user.timezone,
    });
  const attendanceHref = (c: DayClass) => `/teach/groups/${c.groupId}/classes/${c.id}` as Route;

  return (
    <>
      <PageTitle
        subtitle={format.dateTime(new Date(), {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: user.timezone,
        })}
      >
        {t('title')}
      </PageTitle>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="today-classes-heading" title={t('classes')}>
          {day.today.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('noClasses')}</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {day.today.map((c) => (
                <li key={c.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{time(c.startsAt)}</p>
                      <p>
                        <Link href={`/teach/groups/${c.groupId}` as Route} className={LINK}>
                          {c.groupName}
                        </Link>
                      </p>
                      <p className="text-sm text-muted">
                        {[
                          c.room ? t('room', { room: c.room }) : null,
                          t('marked', { marked: c.marked, total: c.students }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Link
                      href={attendanceHref(c)}
                      className={LINK}
                      aria-label={t('takeFor', { group: c.groupName, date: time(c.startsAt) })}
                    >
                      {t('take')}
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {day.privateLessons.length ? (
          <Section id="private-today-heading" title={t('privateLessons')}>
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {day.privateLessons.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-semibold tabular-nums">
                      {time(l.startsAt)}–{time(l.endsAt)}
                    </span>
                    <bdi>{l.studentName}</bdi>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        ) : null}

        <Section id="to-take-heading" title={t('toTake')}>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('toTakeHint')}</p>
            {day.toTake.length === 0 ? (
              <p className="text-fg-secondary">{t('toTakeEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {day.toTake.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{c.groupName}</p>
                      <p className="text-sm text-muted tabular-nums">
                        {date(c.startsAt, true)} ·{' '}
                        {t('marked', { marked: c.marked, total: c.students })}
                      </p>
                    </div>
                    <Link
                      href={attendanceHref(c)}
                      className={LINK}
                      aria-label={t('takeFor', {
                        group: c.groupName,
                        date: date(c.startsAt, true),
                      })}
                    >
                      {t('take')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>

        <Section id="homework-due-heading" title={t('homework')}>
          {day.homework.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('homeworkEmpty')}</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {day.homework.map((h) => (
                <li key={h.id}>
                  <Card className="flex flex-col gap-2">
                    <p className="font-medium">{h.title}</p>
                    <p className="text-sm text-muted">
                      {t('homeworkLine', { group: h.groupName, date: date(h.dueAt) })}
                    </p>
                    <ProgressBar
                      label={tg('doneCount', { done: h.done, total: h.total })}
                      value={h.total ? (h.done / h.total) * 100 : 0}
                    />
                    <p className="text-sm text-fg-secondary">
                      {tg('doneCount', { done: h.done, total: h.total })}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="groups-heading" title={t('groups')}>
          {groups.length === 0 ? (
            <EmptyState title={tg('empty')}>{tg('emptyBody')}</EmptyState>
          ) : (
            <ul className="grid gap-4" aria-labelledby="groups-heading">
              {groups.map((g) => (
                <li key={g.id}>
                  <CardLink href={`/teach/groups/${g.id}` as Route}>
                    <h3 className="text-lg font-semibold">{g.name}</h3>
                    <p className="mt-1 text-[0.9375rem] text-fg-secondary">
                      {g.courseTitle ?? tg('unpublished')} ·{' '}
                      {tg('students', { count: g.studentCount })}
                    </p>
                  </CardLink>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
