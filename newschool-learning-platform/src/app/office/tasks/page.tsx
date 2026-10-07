import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TasksPanel } from '@/app/_staff/TasksPanel';
import { requireArea } from '@/server/auth/session';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.tasks'))('title') };
}

export default async function OfficeTasksPage() {
  const user = await requireArea('office');
  const t = await getTranslations('staff.tasks');
  return (
    <div className="flex flex-col gap-6">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <TasksPanel user={user} area="office" />
    </div>
  );
}
