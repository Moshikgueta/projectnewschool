import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { listPlannerGroups } from '@/server/queries/staff';
import { ButtonLink } from '@/ui/Button';
import { PageTitle } from '@/ui/Page';
import { LessonPlanBuilder } from './LessonPlanBuilder';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.plan'))('title') };
}

export default async function LessonPlanPage() {
  const user = await requireArea('teach');
  const [groups, t, tt] = await Promise.all([
    listPlannerGroups(user.id),
    getTranslations('staff.plan'),
    getTranslations('staff.tools'),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/teach/tools" variant="tertiary" className="self-start">
        {tt('title')}
      </ButtonLink>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <LessonPlanBuilder groups={groups} />
    </div>
  );
}
