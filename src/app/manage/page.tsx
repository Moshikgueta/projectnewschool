import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { EmptyState, PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('manage'))('title') };
}

export default async function ManageHome() {
  await requireArea('manage');
  const t = await getTranslations('manage');
  return (
    <>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <EmptyState title={t('comingTitle')}>{t('comingBody')}</EmptyState>
    </>
  );
}
