import type { Metadata } from 'next';
import { requireArea } from '@/server/auth/session';
import { listAccounts } from '@/server/queries/admin';
import { PageTitle } from '@/ui/AppShell';
import { InviteForm } from './InviteForm';

export const metadata: Metadata = { title: 'Accounts' };

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  teacher: 'Teacher',
  pedagogical_manager: 'Pedagogical manager',
  admin: 'Admin',
};

export default async function AdminHome() {
  await requireArea('admin');
  const accounts = await listAccounts();

  return (
    <>
      <PageTitle subtitle="Invite people and see who has which role.">Accounts</PageTitle>
      <section aria-labelledby="invite-heading" className="mb-10 max-w-md">
        <h2 id="invite-heading" className="mb-3 text-lg font-semibold">
          Invite someone
        </h2>
        <InviteForm />
      </section>
      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="mb-3 text-lg font-semibold">
          All accounts ({accounts.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-start text-[0.9375rem]">
            <thead className="bg-surface-secondary text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  Roles
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">{a.displayName}</td>
                  <td className="px-4 py-2">
                    {a.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {new Date(a.createdAt).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
