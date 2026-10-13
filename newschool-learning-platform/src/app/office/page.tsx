import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getOfficeDay } from '@/server/queries/office';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { PackageAlertBadges } from './students/PackageAlertBadges';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.home'))('title') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';

export default async function OfficeHome() {
  const user = await requireArea('office');
  const [day, t, ts, format] = await Promise.all([
    getOfficeDay(user.timezone),
    getTranslations('office.home'),
    getTranslations('office.student'),
    getFormatter(),
  ]);
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', timeZone: user.timezone });
  const student = (id: string) => `/office/students/${id}` as Route;

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
        <Section id="lessons-today-heading" title={t('lessons')}>
          <Card>
            {day.lessons.length === 0 ? (
              <p className="text-fg-secondary">{t('noLessons')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {day.lessons.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="font-semibold tabular-nums">
                        {time(l.startsAt)}–{time(l.endsAt)}
                      </p>
                      <p>
                        <Link href={student(l.studentId)} className={LINK}>
                          {l.studentName}
                        </Link>{' '}
                        <span className="text-fg-secondary">
                          {ts('lessonWith', { teacher: l.teacherName })}
                        </span>
                      </p>
                    </div>
                    <Badge>{ts(`status.${l.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>

        <Section id="follow-up-heading" title={t('followUp')}>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('followUpHint')}</p>
            {day.followUp.length === 0 ? (
              <p className="text-fg-secondary">{t('followUpEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {day.followUp.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1 py-2">
                    <Link href={student(p.studentId)} className={LINK}>
                      {p.studentName}
                    </Link>
                    <p className="text-sm text-fg-secondary">
                      {ts('balance', { used: p.used, booked: p.booked, left: p.left })}
                    </p>
                    <PackageAlertBadges alerts={p.alerts} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}
