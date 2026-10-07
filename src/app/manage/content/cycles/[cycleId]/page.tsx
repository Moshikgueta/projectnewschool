import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { moveSection, setActivityStatus } from '@/server/actions/cms';
import { requireArea } from '@/server/auth/session';
import { getContentCycle } from '@/server/queries/cms';
import { Badge, Card } from '@/ui/Card';
import { ButtonLink } from '@/ui/Button';
import { PageTitle, Section } from '@/ui/Page';
import { CycleForm, NewSectionForm } from '../../ContentForms';
import { MoveButtons } from '../../MoveButtons';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.cycle'))('metaTitle') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';
const STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;

export default async function ContentCyclePage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  await requireArea('manage');
  const id = z.uuid().safeParse((await params).cycleId);
  if (!id.success) notFound();
  const cycle = await getContentCycle(id.data);
  if (!cycle) notFound();
  const [t, tc] = await Promise.all([getTranslations('cms.cycle'), getTranslations('cms')]);

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={`/manage/content/${cycle.courseId}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('backToCourse', { course: cycle.courseTitle })}
      </ButtonLink>
      <PageTitle subtitle={cycle.courseTitle}>
        <bdi dir="auto">{cycle.title}</bdi>
      </PageTitle>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          {(['notebook', 'workbook'] as const).map((book) => {
            const sections = cycle.sections.filter((s) => s.book === book);
            return (
              <Section key={book} id={`${book}-heading`} title={tc(`books.${book}`)}>
                <Card>
                  {sections.length === 0 ? (
                    <p className="text-fg-secondary">{t('noSections')}</p>
                  ) : (
                    <ol className="flex flex-col divide-y divide-border">
                      {sections.map((s, i) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <span className="flex min-w-0 flex-col">
                            <Link
                              href={`/manage/content/sections/${s.id}` as Route}
                              className={LINK}
                              aria-label={t('openEditor', { title: s.title })}
                            >
                              <bdi dir="auto">{s.title}</bdi>
                            </Link>
                            {s.phase ? (
                              <span className="text-sm text-muted">{tc(`phase.${s.phase}`)}</span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge tone={s.status === 'published' ? 'success' : 'neutral'}>
                              {tc(`status.${s.status}`)}
                            </Badge>
                            <MoveButtons
                              action={moveSection}
                              id={s.id}
                              title={s.title}
                              first={i === 0}
                              last={i === sections.length - 1}
                            />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </Section>
            );
          })}
          <Section id="add-section-heading" title={t('addSection')}>
            <Card>
              <NewSectionForm cycleId={cycle.id} />
            </Card>
          </Section>
          <Section id="activities-heading" title={t('activities')}>
            <Card className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('activitiesHint')}</p>
              {cycle.activities.length === 0 ? (
                <p className="text-fg-secondary">{t('noActivities')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {cycle.activities.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-end justify-between gap-2 py-2">
                      <span className="flex flex-col">
                        <bdi dir="auto" className="font-medium">
                          {a.title}
                        </bdi>
                        <code dir="ltr" className="text-sm text-muted">
                          {a.slug}
                        </code>
                      </span>
                      <form action={setActivityStatus} className="flex items-end gap-2">
                        <input type="hidden" name="activityId" value={a.id} />
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="sr-only">
                            {t('activityStatusLabel', { title: a.title })}
                          </span>
                          <select
                            name="status"
                            defaultValue={a.status}
                            className="min-h-11 rounded-md border border-border-strong bg-surface px-2"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {tc(`status.${s}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="min-h-11 rounded-md border border-border-strong px-3 text-sm font-medium"
                          aria-label={t('setStatusLabel', { title: a.title })}
                        >
                          {t('setStatus')}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
        </div>
        <Section id="cycle-details-heading" title={t('details')}>
          <Card>
            <CycleForm
              cycleId={cycle.id}
              title={cycle.title}
              goal={cycle.goal}
              status={cycle.status}
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
