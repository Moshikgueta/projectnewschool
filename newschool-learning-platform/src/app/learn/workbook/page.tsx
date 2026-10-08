import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookListPage } from '../BookPages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.books.workbook');
  return { title: t('title') };
}

export default async function WorkbookPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  return <BookListPage kind="workbook" requestedCourse={(await searchParams).course} />;
}
