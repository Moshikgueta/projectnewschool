import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TasksPanel } from '@/app/_staff/TasksPanel';
import { requireArea } from '@/server/auth/session';
import { ButtonLink } from '@/ui/Button';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.tasks'))('title') };
}

export default async function TeacherTasksPage() {
  const user = await requireArea('teach');
  const [t, tt] = await Promise.all([
    getTranslations('staff.tasks'),
    getTranslations('staff.tools'),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/teach/tools" variant="tertiary" className="self-start">
        {tt('title')}
      </ButtonLink>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <TasksPanel user={user} area="teach" />
    </div>
  );
}
