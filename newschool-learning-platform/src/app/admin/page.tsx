import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { listAccounts } from '@/server/queries/admin';
import { PageTitle, Section } from '@/ui/Page';
import { InviteForm } from './InviteForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin'))('title') };
}

export default async function AdminHome() {
  const user = await requireArea('admin');
  const [accounts, t, format] = await Promise.all([
    listAccounts(),
    getTranslations('admin'),
    getFormatter(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <div className="max-w-md">
        <Section id="invite-heading" title={t('inviteTitle')}>
          <InviteForm />
        </Section>
      </div>
      <Section id="accounts-heading" title={t('allAccounts', { count: accounts.length })}>
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
      </Section>
    </div>
  );
}
