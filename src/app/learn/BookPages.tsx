import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { NotebookView } from '@/content/render/NotebookView';
import { finishSection, saveAnswer } from '@/server/actions/notebook';
import { requireArea } from '@/server/auth/session';
import { markSectionOpened } from '@/server/learner/progress';
import { getActivityTitles } from '@/server/queries/activities';
import { getStudentNotebook, getStudentSection, type BookKind } from '@/server/queries/notebook';
import { Button, ButtonLink } from '@/ui/Button';
import { Badge, CardLink } from '@/ui/Card';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { EmptyState, PageTitle, Section } from '@/ui/Page';

// The notebook (in class) and the workbook (on your own) are both books of
// sections, cycle by cycle; these two pages serve both.

const STATUS_TONE = { not_started: 'neutral', in_progress: 'brand', completed: 'success' } as const;

export async function BookListPage({
  kind,
  requestedCourse,
}: {
  kind: BookKind;
  requestedCourse?: string;
}) {
  const user = await requireArea('learn');
  const [t, tb, td] = await Promise.all([
    getTranslations('notebook.list'),
    getTranslations(`notebook.books.${kind}`),
    getTranslations('learn.dashboard'),
  ]);
  const { courses, course, cycles } = await getStudentNotebook(user, requestedCourse, kind);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle subtitle={tb('subtitle')}>{tb('title')}</PageTitle>
        {courses.length > 1 && course ? (
          <CourseSwitcher
            action={`/learn/${kind}`}
            label={td('courseSwitcher')}
            submitLabel={td('continueCta')}
            current={course.courseId}
            courses={courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
          />
        ) : null}
      </div>
      {cycles.length === 0 ? (
        <EmptyState title={tb('empty')}>{t('emptyBody')}</EmptyState>
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
                      href={`/learn/${kind}/${s.id}` as Route}
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

export async function BookSectionPage({ kind, sectionId }: { kind: BookKind; sectionId: string }) {
  const user = await requireArea('learn');
  const id = z.uuid().safeParse(sectionId);
  if (!id.success) notFound();

  // Sections of other courses, drafts, unknown ids and sections of the other
  // book all come back the same way.
  const section = await getStudentSection(user, id.data);
  if (!section || section.kind !== kind) notFound();
  await markSectionOpened(user, section.id);

  const activityIds = section.blocks.flatMap((b) => (b?.type === 'activity' ? [b.activityId] : []));
  const [t, tb, activities] = await Promise.all([
    getTranslations('notebook'),
    getTranslations(`notebook.books.${kind}`),
    getActivityTitles(activityIds),
  ]);
  const hasAnswers = section.blocks.some(
    (b) =>
      (b?.type === 'sentenceFrame' ||
        b?.type === 'reflection' ||
        b?.type === 'discussionQuestions') &&
      b.answerable,
  );

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink href={`/learn/${kind}` as Route} variant="tertiary" className="self-start">
        {tb('back')}
      </ButtonLink>
      <PageTitle subtitle={t('section.cycle', { title: section.cycleTitle })}>
        {section.title}
      </PageTitle>
      {hasAnswers ? <p className="text-sm text-muted">{t('privateNote')}</p> : null}
      <NotebookView
        view="student"
        sectionId={section.id}
        blocks={section.blocks}
        courseLang={section.courseLang}
        answers={section.answers}
        answerAction={saveAnswer}
        aiTutorUrl={section.aiTutorUrl}
        activities={activities}
      />
      <footer className="flex items-center gap-3 border-t border-border pt-6">
        {section.status === 'completed' ? (
          <Badge tone="success">{t('section.finished')}</Badge>
        ) : (
          <form action={finishSection}>
            <input type="hidden" name="sectionId" value={section.id} />
            <Button type="submit">{t('section.finish')}</Button>
          </form>
        )}
      </footer>
    </article>
  );
}
