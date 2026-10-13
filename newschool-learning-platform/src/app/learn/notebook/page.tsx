import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookListPage } from '../BookPages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.books.notebook');
  return { title: t('title') };
}

export default async function NotebookPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  return <BookListPage kind="notebook" requestedCourse={(await searchParams).course} />;
}
