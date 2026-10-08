import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getSectionForEdit } from '@/server/queries/cms';
import { ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { SectionMetaForm } from '../../ContentForms';
import { SectionEditor } from './SectionEditor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.section'))('metaTitle') };
}

export default async function SectionEditorPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  await requireArea('manage');
  const id = z.uuid().safeParse((await params).sectionId);
  if (!id.success) notFound();
  const section = await getSectionForEdit(id.data);
  if (!section) notFound();
  const [t, tb] = await Promise.all([getTranslations('cms.section'), getTranslations('cms.books')]);

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={`/manage/content/cycles/${section.cycleId}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('backToCycle', { cycle: section.cycleTitle })}
      </ButtonLink>
      <PageTitle subtitle={`${section.courseTitle} · ${section.cycleTitle} · ${tb(section.book)}`}>
        <bdi dir="auto" lang={section.courseLang}>
          {section.title}
        </bdi>
      </PageTitle>
      <Section id="details-heading" title={t('details')}>
        <Card>
          <SectionMetaForm
            sectionId={section.id}
            title={section.title}
            phase={section.phase ?? 'during_class'}
            status={section.status}
          />
        </Card>
      </Section>
      <Section id="content-heading" title={t('content')}>
        {section.status === 'published' ? (
          <p className="rounded-md bg-warning-light px-4 py-3 text-[0.9375rem] text-warning-ink">
            {t('publishedWarning')}
          </p>
        ) : null}
        <SectionEditor
          sectionId={section.id}
          updatedAt={section.updatedAt}
          yaml={section.yaml}
          courseLang={section.courseLang}
          aiTutorUrl={section.aiTutorUrl}
          activities={section.activities}
        />
      </Section>
    </div>
  );
}
