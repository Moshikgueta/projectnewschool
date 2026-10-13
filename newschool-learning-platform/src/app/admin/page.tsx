import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { parsePageRequest, searchTerm } from '@/domain/paging';
import { requireArea } from '@/server/auth/session';
import { listAccounts } from '@/server/queries/admin';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { Pager } from '@/ui/Pager';
import { InviteForm } from './InviteForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin'))('title') };
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    size?: string | string[];
  }>;
}) {
  const user = await requireArea('admin');
  const params = await searchParams;
  const query = searchTerm(params.q);
  const [{ rows: accounts, info }, t, format] = await Promise.all([
    listAccounts(query, parsePageRequest(params)),
    getTranslations('admin'),
    getFormatter(),
  ]);
  const size = params.size ? info.size : undefined;
  const pager = (
    <Pager info={info} path="/admin" params={{ q: query, size }} label={t('pagerLabel')} />
  );

  return (
    <div className="flex flex-col gap-10">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <div className="max-w-md">
        <Section id="invite-heading" title={t('inviteTitle')}>
          <InviteForm />
        </Section>
      </div>
      <Section id="accounts-heading" title={t('allAccounts')}>
        <form role="search" className="flex flex-wrap items-end gap-2" action="/admin">
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
        {accounts.length === 0 ? <EmptyState title={t('empty')} /> : pager}
        {accounts.length === 0 ? null : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[0.9375rem]">
              <thead className="bg-surface-secondary text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colName')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colRoles')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colCreated')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{a.displayName}</td>
                    <td className="px-4 py-2">
                      {a.roles.map((r) => t(`roles.${r}`)).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {format.dateTime(new Date(a.createdAt), {
                        dateStyle: 'medium',
                        timeZone: user.timezone,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
