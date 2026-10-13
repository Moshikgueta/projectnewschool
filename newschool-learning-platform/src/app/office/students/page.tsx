import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { parsePageRequest, searchTerm } from '@/domain/paging';
import { requireArea } from '@/server/auth/session';
import { listOfficeStudents } from '@/server/queries/office';
import { Badge, Card } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { Pager } from '@/ui/Pager';
import { NewStudentForm } from './StudentForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.students'))('title') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';

export default async function OfficeStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    size?: string | string[];
  }>;
}) {
  const user = await requireArea('office');
  const params = await searchParams;
  const query = searchTerm(params.q);
  const request = parsePageRequest(params);
  const [{ rows: students, info }, t] = await Promise.all([
    listOfficeStudents(user.timezone, query, request),
    getTranslations('office.students'),
  ]);
  const size = params.size ? info.size : undefined;

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
        {size ? <input type="hidden" name="size" value={size} /> : null}
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
        <div className="flex flex-col gap-3">
          <Pager
            info={info}
            path="/office/students"
            params={{ q: query, size }}
            label={t('pagerLabel')}
          />
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
