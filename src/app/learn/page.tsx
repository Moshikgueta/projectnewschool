import type { Metadata } from 'next';
import { requireArea } from '@/server/auth/session';
import { listMyCourses } from '@/server/queries/student';
import { EmptyState, PageTitle } from '@/ui/AppShell';

export const metadata: Metadata = { title: 'My courses' };

export default async function LearnHome() {
  const user = await requireArea('learn');
  const courses = await listMyCourses(user.id);

  return (
    <>
      <PageTitle subtitle="The courses you are enrolled in.">My courses</PageTitle>
      {courses.length === 0 ? (
        <EmptyState title="No courses yet">
          When the school enrolls you in a group, your course appears here.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Courses">
          {courses.map((c) => (
            <li key={c.groupId} className="rounded-lg border border-border bg-surface p-5">
              <p className="text-sm text-muted">
                <span lang={c.languageCode}>{c.languageName}</span> · {c.levelTitle}
              </p>
              <h2 className="mt-1 text-lg font-semibold" lang={c.languageCode} dir={c.direction}>
                {c.courseTitle}
              </h2>
              <p className="mt-2 text-[0.9375rem] text-fg-secondary">{c.groupName}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
