import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { listOfficeStudents } from '@/server/queries/office';
import { Badge, Card } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { NewStudentForm } from './StudentForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.students'))('title') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';

export default async function OfficeStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireArea('office');
  const { q = '' } = await searchParams;
  const query = q.slice(0, 80);
  const [students, t] = await Promise.all([
    listOfficeStudents(user.timezone, query),
    getTranslations('office.students'),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <form role="search" className="flex flex-wrap items-end gap-2" action="/office/students">
        <label className="flex flex-col gap-1.5 text-[0.9375rem] font-medium">
          {t('search')}
          <input
            type="search"
            name="q"
            defaultValue={query}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base font-normal"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md border border-border-strong bg-surface px-4 font-medium"
        >
          {t('searchButton')}
        </button>
      </form>

      {students.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[32rem] text-start text-[0.9375rem]">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="bg-surface-secondary text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('nameCol')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('phoneCol')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('leftCol')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="px-4 py-3 text-start font-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/office/students/${s.id}` as Route} className={LINK}>
                        <bdi>{s.name}</bdi>
                      </Link>
                      {s.needsAttention ? <Badge tone="warning">{t('attention')}</Badge> : null}
                    </span>
                  </th>
                  <td className="px-4 py-3 tabular-nums" dir="ltr">
                    {s.phone}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Section id="add-student-heading" title={t('add')}>
        <Card>
          <NewStudentForm />
        </Card>
      </Section>
    </div>
  );
}
