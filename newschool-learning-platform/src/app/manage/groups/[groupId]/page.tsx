import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getGroupForManager, listPeopleWithRole } from '@/server/queries/manage';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { CyclesForm, DetailsForm, EnrollmentRow, EnrollForm, TeacherForms } from './GroupForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('manage.groups'))('title') };
}

export default async function ManageGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  await requireArea('manage');
  const id = z.uuid().safeParse((await params).groupId);
  if (!id.success) notFound();

  const [group, teachers, students, t] = await Promise.all([
    getGroupForManager(id.data),
    listPeopleWithRole('teacher'),
    listPeopleWithRole('student'),
    getTranslations('manage.group'),
  ]);
  if (!group) notFound();

  const activeIds = new Set(
    group.enrollments.filter((e) => e.status === 'active').map((e) => e.studentId),
  );
  const teacherIds = new Set(group.teachers.map((tch) => tch.id));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Link
          href="/manage/groups"
          className="text-[0.9375rem] font-medium text-primary hover:underline"
        >
          {t('back')}
        </Link>
        <PageTitle subtitle={group.courseTitle}>{group.name}</PageTitle>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="details-heading" title={t('details')}>
          <Card>
            <DetailsForm
              group={{
                id: group.id,
                name: group.name,
                status: group.status,
                scheduleNote: group.scheduleNote,
              }}
            />
          </Card>
        </Section>

        <Section id="teachers-heading" title={t('teachers')}>
          <Card>
            <TeacherForms
              groupId={group.id}
              assigned={group.teachers}
              candidates={teachers.filter((p) => !teacherIds.has(p.id))}
            />
          </Card>
        </Section>
      </div>

      <Section id="students-heading" title={t('students')}>
        <Card>
          <div className="flex flex-col gap-6">
            {group.enrollments.length === 0 ? (
              <p className="text-fg-secondary">{t('noStudents')}</p>
            ) : (
              <ul className="divide-y divide-border" aria-labelledby="students-heading">
                {group.enrollments.map((e) => (
                  <li key={e.id} className="py-3">
                    <EnrollmentRow groupId={group.id} enrollment={e} />
                  </li>
                ))}
              </ul>
            )}
            <EnrollForm
              groupId={group.id}
              candidates={students.filter((s) => !activeIds.has(s.id))}
            />
          </div>
        </Card>
      </Section>

      <Section id="cycles-heading" title={t('cycles')}>
        <p className="text-[0.9375rem] text-muted">{t('cyclesHint')}</p>
        {group.cycles.length === 0 ? (
          <Card>
            <p className="text-fg-secondary">{t('noCycles')}</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {group.cycles.map((c) => (
              <li key={c.id}>
                <Card>
                  <CyclesForm groupId={group.id} courseId={group.courseId} cycle={c} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
