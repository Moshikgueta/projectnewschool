import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ResourceList } from '@/app/_staff/ResourceList';
import { requireArea } from '@/server/auth/session';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { ResourceForm } from './ResourceForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.resources'))('title') };
}

export default async function ManagerResourcesPage() {
  await requireArea('manage');
  const t = await getTranslations('staff.resources');
  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <ResourceList editable />
      <Section id="add-resource-heading" title={t('add')}>
        <Card>
          <ResourceForm />
        </Card>
      </Section>
    </div>
  );
}
