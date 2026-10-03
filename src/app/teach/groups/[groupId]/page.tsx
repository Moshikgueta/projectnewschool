import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getGroup } from '@/server/queries/teacher';
import { Avatar, Badge } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireArea('teach');
  const id = z.uuid().safeParse((await params).groupId);
  if (!id.success) notFound();

  // A group the teacher doesn't teach comes back empty from the database,
  // and is reported exactly like a group that doesn't exist.
  const group = await getGroup(id.data);
  if (!group) notFound();

  const [t, tg] = await Promise.all([
    getTranslations('teach.group'),
    getTranslations('teach.groups'),
  ]);
  return (
    <>
      <PageTitle subtitle={group.courseTitle ?? tg('unpublished')}>{group.name}</PageTitle>
      {group.students.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <Section id="students-heading" title={t('students')}>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.students.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={s.displayName} />
                <span className="flex-1">{s.displayName}</span>
                <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
                  {t(`status.${s.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
