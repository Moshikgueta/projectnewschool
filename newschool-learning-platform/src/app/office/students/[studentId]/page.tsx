import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { allowedStatuses } from '@/domain/office/packages';
import { localDay } from '@/domain/teaching/attendance';
import { cancelLesson, markPackagePaid } from '@/server/actions/office-records';
import { requireArea } from '@/server/auth/session';
import { getOfficeStudent, getTeacherOptions } from '@/server/queries/office';
import { ButtonLink } from '@/ui/Button';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { PackageAlertBadges } from '../PackageAlertBadges';
import {
  BookLessonForm,
  LessonStatusForm,
  OfficeCodeForm,
  PackageForm,
  RecordForm,
} from '../StudentForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.students'))('title') };
}

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline';

export default async function OfficeStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const user = await requireArea('office');
  const id = z.uuid().safeParse((await params).studentId);
  if (!id.success) notFound();
  // Null for anyone who is not a student: reported like an unknown id.
  const student = await getOfficeStudent(id.data, user.timezone);
  if (!student) notFound();

  const [t, teachers, format] = await Promise.all([
    getTranslations('office.student'),
    getTeacherOptions(),
    getFormatter(),
  ]);
  const now = new Date();
  const date = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: user.timezone,
    });
  const money = (n: number) =>
    format.number(n, { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
  const upcoming = student.lessons.filter((l) => new Date(l.startsAt) > now).reverse();
  const past = student.lessons.filter((l) => new Date(l.startsAt) <= now);

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink href="/office/students" variant="tertiary" className="self-start">
        {t('back')}
      </ButtonLink>
      <PageTitle>{student.name}</PageTitle>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="packages-heading" title={t('packages')}>
            {student.packages.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noPackages')}</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {student.packages.map((p) => (
                  <li key={p.id}>
                    <Card className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            {t('packageLine', { lessons: p.lessons, minutes: p.minutesPerLesson })}
                          </p>
                          <p className="text-sm text-muted">
                            {p.expiresOn
                              ? t('validityUntil', {
                                  from: date(p.startsOn),
                                  until: date(p.expiresOn),
                                })
                              : t('validity', { from: date(p.startsOn) })}
                            {p.price !== null ? ` · ${t('price', { price: money(p.price) })}` : ''}
                            {p.note ? ` · ${p.note}` : ''}
                          </p>
                        </div>
                        {p.paidAt ? (
                          <Badge tone="success">{t('paid')}</Badge>
                        ) : (
                          <form action={markPackagePaid}>
                            <input type="hidden" name="packageId" value={p.id} />
                            <button
                              type="submit"
                              className={QUIET_BUTTON}
                              aria-label={t('markPaidLabel', { date: date(p.startsOn) })}
                            >
                              {t('markPaid')}
                            </button>
                          </form>
                        )}
                      </div>
                      <p className="tabular-nums">
                        {t('balance', { used: p.used, booked: p.booked, left: p.left })}
                      </p>
                      <PackageAlertBadges alerts={p.alerts} />
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <Card>
              <h3 className="mb-3 font-semibold">{t('addPackage')}</h3>
              <PackageForm studentId={student.id} today={localDay(now, user.timezone)} />
            </Card>
          </Section>

          <Section id="lessons-heading" title={t('lessonsTitle')}>
            {student.lessons.length === 0 ? (
              <Card>
                <p className="text-fg-secondary">{t('noLessons')}</p>
              </Card>
            ) : (
              <Card>
                <p className="mb-2 text-sm text-muted">{t('cancelHint')}</p>
                <ul className="flex flex-col divide-y divide-border">
                  {[...upcoming, ...past].map((l) => {
                    const cancelled =
                      l.status === 'cancelled_early' || l.status === 'cancelled_late';
                    return (
                      <li key={l.id} className="flex flex-col gap-2 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium tabular-nums">{when(l.startsAt)}</p>
                            <p className="text-sm text-fg-secondary">
                              {t('lessonWith', { teacher: l.teacherName })}
                              {l.packageId ? '' : ` · ${t('noPackageUsed')}`}
                              {l.note ? ` · ${l.note}` : ''}
                            </p>
                          </div>
                          <Badge tone={l.status === 'done' ? 'success' : 'neutral'}>
                            {t(`status.${l.status}`)}
                          </Badge>
                        </div>
                        {!cancelled ? (
                          <div className="flex flex-wrap items-end gap-3">
                            {new Date(l.startsAt) <= now ? (
                              <LessonStatusForm
                                lessonId={l.id}
                                current={l.status}
                                allowed={allowedStatuses(new Date(l.startsAt), now)}
                                dateLabel={when(l.startsAt)}
                              />
                            ) : null}
                            {l.status === 'scheduled' ? (
                              <form action={cancelLesson}>
                                <input type="hidden" name="lessonId" value={l.id} />
                                <button
                                  type="submit"
                                  className={QUIET_BUTTON}
                                  aria-label={t('cancelLabel', { date: when(l.startsAt) })}
                                >
                                  {t('cancel')}
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
            {teachers.length ? (
              <Card>
                <h3 className="mb-3 font-semibold">{t('book')}</h3>
                <BookLessonForm studentId={student.id} teachers={teachers} />
              </Card>
            ) : null}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Section id="contact-heading" title={t('contact')}>
            <Card>
              <RecordForm
                studentId={student.id}
                phone={student.phone}
                contactEmail={student.contactEmail}
                officeNote={student.officeNote}
              />
            </Card>
          </Section>
          <Section id="code-heading" title={t('code')}>
            <Card>
              <OfficeCodeForm studentId={student.id} />
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
