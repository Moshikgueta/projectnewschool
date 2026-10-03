import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { NotebookView } from '@/content/render/NotebookView';
import { finishSection, saveAnswer } from '@/server/actions/notebook';
import { requireArea } from '@/server/auth/session';
import { markSectionOpened } from '@/server/learner/progress';
import { getStudentSection } from '@/server/queries/notebook';
import { Button, ButtonLink } from '@/ui/Button';
import { Badge } from '@/ui/Card';
import { PageTitle } from '@/ui/Page';

type Params = { params: Promise<{ sectionId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.list');
  return { title: t('title') };
}

export default async function NotebookSectionPage({ params }: Params) {
  const user = await requireArea('learn');
  const id = z.uuid().safeParse((await params).sectionId);
  if (!id.success) notFound();

  // Sections of other courses, drafts and unknown ids all come back empty
  // from the database and are reported the same way.
  const section = await getStudentSection(user, id.data);
  if (!section) notFound();
  await markSectionOpened(user, section.id);

  const t = await getTranslations('notebook');
  const hasAnswers = section.blocks.some(
    (b) =>
      (b?.type === 'sentenceFrame' ||
        b?.type === 'reflection' ||
        b?.type === 'discussionQuestions') &&
      b.answerable,
  );

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink href="/learn/notebook" variant="tertiary" className="self-start">
        {t('section.back')}
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
