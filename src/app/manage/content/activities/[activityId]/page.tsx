import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getActivityForEdit } from '@/server/queries/cms';
import { ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { ActivityMetaForm } from '../../ContentForms';
import { ActivityEditor } from './ActivityEditor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.activity'))('metaTitle') };
}

export default async function ActivityEditorPage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  await requireArea('manage');
  const id = z.uuid().safeParse((await params).activityId);
  if (!id.success) notFound();
  const activity = await getActivityForEdit(id.data);
  if (!activity) notFound();
  const [t, ts] = await Promise.all([
    getTranslations('cms.activity'),
    getTranslations('cms.section'),
  ]);
  const answeredItems = Object.values(activity.answered).filter((n) => n > 0).length;

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={`/manage/content/cycles/${activity.cycleId}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {ts('backToCycle', { cycle: activity.cycleTitle })}
      </ButtonLink>
      <PageTitle subtitle={`${activity.courseTitle} · ${activity.cycleTitle}`}>
        <bdi dir="auto" lang={activity.courseLang}>
          {activity.title}
        </bdi>
      </PageTitle>
      <Section id="activity-details-heading" title={ts('details')}>
        <Card>
          <ActivityMetaForm
            activityId={activity.id}
            title={activity.title}
            phase={activity.phase}
            scoring={activity.scoring}
            minutes={activity.minutes}
            status={activity.status}
          />
        </Card>
      </Section>
      <Section id="activity-content-heading" title={t('questions')}>
        {activity.status === 'published' ? (
          <p className="rounded-md bg-warning-light px-4 py-3 text-[0.9375rem] text-warning-ink">
            {t('publishedWarning')}
          </p>
        ) : null}
        {answeredItems ? (
          <p className="rounded-md bg-info-light px-4 py-3 text-[0.9375rem] text-info-ink">
            {t('answeredNote', { count: answeredItems })}
          </p>
        ) : null}
        {activity.fromStored ? <p className="text-sm text-muted">{t('fromStored')}</p> : null}
        <ActivityEditor
          activityId={activity.id}
          activitySlug={activity.slug}
          updatedAt={activity.updatedAt}
          yaml={activity.yaml}
          courseLang={activity.courseLang}
          answered={activity.answered}
        />
      </Section>
    </div>
  );
}
