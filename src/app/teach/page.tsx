import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { listTaughtGroups } from '@/server/queries/teacher';
import { CardLink } from '@/ui/Card';
import { EmptyState, PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('teach.groups'))('title') };
}

export default async function TeachHome() {
  const user = await requireArea('teach');
  const [groups, t] = await Promise.all([
    listTaughtGroups(user.id),
    getTranslations('teach.groups'),
  ]);

  return (
    <>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      {groups.length === 0 ? (
        <EmptyState title={t('empty')}>{t('emptyBody')}</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('title')}>
          {groups.map((g) => (
            <li key={g.id}>
              <CardLink href={`/teach/groups/${g.id}` as Route}>
                <h2 className="text-lg font-semibold">{g.name}</h2>
                <p className="mt-1 text-[0.9375rem] text-fg-secondary">
                  {g.courseTitle ?? t('unpublished')} · {t('students', { count: g.studentCount })}
                </p>
              </CardLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
