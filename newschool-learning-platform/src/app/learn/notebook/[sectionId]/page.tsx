import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookSectionPage } from '../../BookPages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.books.notebook');
  return { title: t('title') };
}

export default async function NotebookSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  return <BookSectionPage kind="notebook" sectionId={(await params).sectionId} />;
}
