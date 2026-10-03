import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { EmptyState, PageTitle } from '@/ui/Page';

type Section = 'notebook' | 'workbook' | 'practice' | 'vocabulary';

/** Placeholder for student sections built in Phases 3–4, so navigation is complete now. */
export async function SoonPage({ section }: { section: Section }) {
  await requireArea('learn');
  const t = await getTranslations('learn');
  return (
    <>
      <PageTitle>{t(`nav.${section}`)}</PageTitle>
      <EmptyState title={t('soon.title')}>{t(`soon.${section}`)}</EmptyState>
    </>
  );
}
