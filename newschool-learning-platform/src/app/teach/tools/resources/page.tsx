import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ResourceList } from '@/app/_staff/ResourceList';
import { requireArea } from '@/server/auth/session';
import { ButtonLink } from '@/ui/Button';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.resources'))('title') };
}

export default async function TeacherResourcesPage() {
  await requireArea('teach');
  const [t, tt] = await Promise.all([
    getTranslations('staff.resources'),
    getTranslations('staff.tools'),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/teach/tools" variant="tertiary" className="self-start">
        {tt('title')}
      </ButtonLink>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <ResourceList />
    </div>
  );
}
