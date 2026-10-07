import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { moveCycle } from '@/server/actions/cms';
import { requireArea } from '@/server/auth/session';
import { getContentCourse } from '@/server/queries/cms';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { ButtonLink } from '@/ui/Button';
import { CourseForm, NewCycleForm } from '../ContentForms';
import { MoveButtons } from '../MoveButtons';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.course'))('metaTitle') };
}

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';

export default async function ContentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  await requireArea('manage');
  const id = z.uuid().safeParse((await params).courseId);
  if (!id.success) notFound();
  const course = await getContentCourse(id.data);
  if (!course) notFound();
  const [t, tc] = await Promise.all([getTranslations('cms.course'), getTranslations('cms')]);

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink href="/manage" variant="tertiary" className="self-start">
        {t('back')}
      </ButtonLink>
      <PageTitle subtitle={course.levelTitle}>
        <bdi dir="auto" lang={course.languageCode}>
          {course.title}
        </bdi>
      </PageTitle>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section id="cycles-heading" title={t('cycles')}>
          {course.cycles.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('noCycles')}</p>
            </Card>
          ) : (
            <Card>
              <ol className="flex flex-col divide-y divide-border">
                {course.cycles.map((c, i) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex min-w-0 flex-col">
                      <Link href={`/manage/content/cycles/${c.id}` as Route} className={LINK}>
                        <bdi dir="auto" lang={course.languageCode}>
                          {c.title}
                        </bdi>
                      </Link>
                      {c.goal ? <span className="text-sm text-muted">{c.goal}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={c.status === 'published' ? 'success' : 'neutral'}>
                        {tc(`status.${c.status}`)}
                      </Badge>
                      <MoveButtons
                        action={moveCycle}
                        id={c.id}
                        title={c.title}
                        first={i === 0}
                        last={i === course.cycles.length - 1}
                      />
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card>
            <h3 className="mb-3 font-semibold">{t('addCycle')}</h3>
            <NewCycleForm courseId={course.id} />
          </Card>
        </Section>
        <Section id="course-details-heading" title={t('details')}>
          <Card>
            <CourseForm
              courseId={course.id}
              title={course.title}
              description={course.description}
              status={course.status}
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
