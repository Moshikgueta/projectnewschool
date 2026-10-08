import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookSectionPage } from '../../BookPages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.books.workbook');
  return { title: t('title') };
}

export default async function WorkbookSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  return <BookSectionPage kind="workbook" sectionId={(await params).sectionId} />;
}
