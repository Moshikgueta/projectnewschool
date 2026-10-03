import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getStudentNotebook } from '@/server/queries/notebook';
import { Badge, CardLink } from '@/ui/Card';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { EmptyState, PageTitle, Section } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.list');
  return { title: t('title') };
}

const STATUS_TONE = { not_started: 'neutral', in_progress: 'brand', completed: 'success' } as const;

export default async function NotebookPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireArea('learn');
  const [{ course: requested }, t, td] = await Promise.all([
    searchParams,
    getTranslations('notebook.list'),
    getTranslations('learn.dashboard'),
  ]);
  const { courses, course, cycles } = await getStudentNotebook(user, requested);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
        {courses.length > 1 && course ? (
          <CourseSwitcher
            action="/learn/notebook"
            label={td('courseSwitcher')}
            submitLabel={td('continueCta')}
            current={course.courseId}
            courses={courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
          />
        ) : null}
      </div>
      {cycles.length === 0 ? (
        <EmptyState title={t('empty')}>{t('emptyBody')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {cycles.map((cycle) => (
            <Section
              key={cycle.id}
              id={`cycle-${cycle.id}`}
              title={cycle.title}
              action={cycle.active ? <Badge tone="brand">{t('activeCycle')}</Badge> : undefined}
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {cycle.sections.map((s) => (
                  <li key={s.id}>
                    <CardLink
                      href={`/learn/notebook/${s.id}` as Route}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="font-medium text-fg">{s.title}</span>
                      <Badge tone={STATUS_TONE[s.status]}>{t(`status.${s.status}`)}</Badge>
                    </CardLink>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
