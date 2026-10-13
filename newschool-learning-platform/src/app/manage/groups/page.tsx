import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { listCoursesForManager, listGroupsForManager } from '@/server/queries/manage';
import { Badge } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { NewGroupForm } from './NewGroupForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('manage.groups'))('title') };
}

export default async function GroupsPage() {
  await requireArea('manage');
  const [groups, courses, t] = await Promise.all([
    listGroupsForManager(),
    listCoursesForManager(),
    getTranslations('manage.groups'),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>

      <Section id="groups-heading" title={t('title')}>
        {groups.length === 0 ? (
          <EmptyState title={t('empty')}>{t('emptyBody')}</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[0.9375rem]">
              <thead className="bg-surface-secondary text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colGroup')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colCourse')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colTeachers')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colStudents')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/manage/groups/${g.id}` as Route}
                        className="font-medium text-primary hover:underline"
                      >
                        {g.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{g.courseTitle}</td>
                    <td className="px-4 py-3">
                      {g.teachers.length ? (
                        g.teachers.join(', ')
                      ) : (
                        <span className="text-muted">{t('noTeacher')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{g.activeStudents}</td>
                    <td className="px-4 py-3">
                      <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>
                        {t(`status.${g.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="max-w-md">
        <Section id="new-group-heading" title={t('new')}>
          <NewGroupForm courses={courses.map((c) => ({ value: c.id, label: c.title }))} />
        </Section>
      </div>
    </div>
  );
}
