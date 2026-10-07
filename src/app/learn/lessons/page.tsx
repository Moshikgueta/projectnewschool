import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getMyLessons } from '@/server/queries/lessons';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { ProgressBar } from '@/ui/Progress';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('learn.lessons'))('title') };
}

/** A student's own attendance, packages and private lessons. */
export default async function MyLessonsPage() {
  const user = await requireArea('learn');
  const [data, t, ts, format] = await Promise.all([
    getMyLessons(user),
    getTranslations('learn.lessons'),
    getTranslations('office.student'),
    getFormatter(),
  ]);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: user.timezone,
    });
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { day: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="private-heading" title={t('private')}>
          {data.packages.length === 0 && data.upcoming.length === 0 && data.past.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('noPrivate')}</p>
            </Card>
          ) : (
            <>
              {data.packages.map((p) => (
                <Card key={p.id} className="flex flex-col gap-2">
                  <p className="font-semibold">
                    {ts('packageLine', { lessons: p.lessons, minutes: p.minutesPerLesson })}
                  </p>
                  <p className="tabular-nums">
                    {ts('balance', { used: p.used, booked: p.booked, left: p.left })}
                  </p>
                  <ProgressBar
                    label={t('used', { used: p.used, total: p.lessons })}
                    value={(Math.min(p.used, p.lessons) / p.lessons) * 100}
                  />
                  <p className="text-sm text-muted">
                    {p.expiresOn ? t('validUntil', { date: day(p.expiresOn) }) : t('noExpiry')}
                    {p.paid ? '' : ` · ${ts('unpaid')}`}
                  </p>
                  {p.alerts.low || p.alerts.expiring ? (
                    <p className="text-sm text-warning-ink">{t('talkToOffice')}</p>
                  ) : null}
                </Card>
              ))}
              <Card>
                <h3 className="mb-2 font-semibold">{t('upcoming')}</h3>
                {data.upcoming.length === 0 ? (
                  <p className="text-fg-secondary">{t('noUpcoming')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.upcoming.map((l) => (
                      <li key={l.id} className="py-2">
                        <p className="font-medium tabular-nums">{when(l.startsAt)}</p>
                        <p className="text-sm text-fg-secondary">
                          {ts('lessonWith', { teacher: l.teacherName })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-sm text-muted">{t('cancelPolicy')}</p>
              </Card>
              {data.past.length ? (
                <Card>
                  <h3 className="mb-2 font-semibold">{t('history')}</h3>
                  <ul className="flex flex-col divide-y divide-border">
                    {data.past.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div>
                          <p className="tabular-nums">{when(l.startsAt)}</p>
                          <p className="text-sm text-fg-secondary">
                            {ts('lessonWith', { teacher: l.teacherName })}
                          </p>
                        </div>
                        <Badge tone={l.status === 'done' ? 'success' : 'neutral'}>
                          {ts(`status.${l.status}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          )}
        </Section>

        <Section id="attendance-heading" title={t('attendance')}>
          <Card className="flex flex-col gap-3">
            {data.attendance.rate ? (
              <p className="text-lg font-semibold">{t('rate', data.attendance.rate)}</p>
            ) : (
              <p className="text-fg-secondary">{t('noAttendance')}</p>
            )}
            {data.attendance.recent.length ? (
              <ul className="flex flex-col divide-y divide-border">
                {data.attendance.recent.map((a) => (
                  <li
                    key={a.sessionId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div>
                      <p className="tabular-nums">{when(a.startsAt)}</p>
                      <p className="text-sm text-fg-secondary">{a.groupName}</p>
                    </div>
                    <Badge tone={a.status === 'absent' ? 'warning' : 'neutral'}>
                      {t(`status.${a.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm text-muted">{t('excusedHint')}</p>
          </Card>
        </Section>
      </div>
    </div>
  );
}
