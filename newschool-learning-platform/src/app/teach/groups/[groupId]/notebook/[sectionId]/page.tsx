import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { NotebookView } from '@/content/render/NotebookView';
import { requireArea } from '@/server/auth/session';
import { getTeacherSection } from '@/server/queries/notebook';
import { ButtonLink } from '@/ui/Button';
import { PageTitle } from '@/ui/Page';

type Params = { params: Promise<{ groupId: string; sectionId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notebook.teacher');
  return { title: t('notebook') };
}

export default async function TeacherSectionPage({ params }: Params) {
  await requireArea('teach');
  const raw = await params;
  const groupId = z.uuid().safeParse(raw.groupId);
  const sectionId = z.uuid().safeParse(raw.sectionId);
  if (!groupId.success || !sectionId.success) notFound();

  // Null unless the caller teaches this group and the section belongs to its
  // course; every other case looks exactly like a missing page.
  const section = await getTeacherSection(groupId.data, sectionId.data);
  if (!section) notFound();

  const t = await getTranslations('notebook');
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink
        href={`/teach/groups/${groupId.data}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('teacher.back')}
      </ButtonLink>
      <PageTitle
        subtitle={`${section.groupName} · ${t('section.cycle', { title: section.cycleTitle })}`}
      >
        {section.title}
      </PageTitle>
      <p className="rounded-md bg-surface-secondary px-4 py-3 text-sm text-fg-secondary">
        {t('teacher.notesHint')}
      </p>
      <NotebookView
        view="teacher"
        sectionId={section.id}
        blocks={section.blocks}
        courseLang={section.courseLang}
        notes={section.notes}
        groupAnswers={section.groupAnswers}
        aiTutorUrl={section.aiTutorUrl}
      />
    </article>
  );
}
