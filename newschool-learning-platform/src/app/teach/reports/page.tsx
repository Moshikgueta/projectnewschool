import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readFilter, ReportsPage } from '@/app/_reports/ReportsPage';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('reports.list'))('metaTitle') };
}

/** Mistake reports from students about the courses this teacher teaches. */
export default async function TeacherReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireArea('teach');
  const { status } = await searchParams;
  return <ReportsPage user={user} area="teach" filter={readFilter(status)} />;
}
