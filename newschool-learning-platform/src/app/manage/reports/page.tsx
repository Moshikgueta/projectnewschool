import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readFilter, ReportsPage } from '@/app/_reports/ReportsPage';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('reports.list'))('metaTitle') };
}

/** Mistake reports from students, every course (pedagogical manager, MFA). */
export default async function ManagerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireArea('manage');
  const { status } = await searchParams;
  return <ReportsPage user={user} area="manage" filter={readFilter(status)} />;
}
