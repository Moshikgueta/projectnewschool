import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { InlineText } from '@/content/render/InlineText';
import { NotebookView } from '@/content/render/NotebookView';
import { requireArea } from '@/server/auth/session';
import { getTeacherActivity } from '@/server/queries/teaching';
import { ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('activity'))('metaTitle') };
}

type Params = { params: Promise<{ groupId: string; activityId: string }> };

export default async function TeacherActivityPage({ params }: Params) {
  await requireArea('teach');
  const raw = await params;
  const groupId = z.uuid().safeParse(raw.groupId);
  const activityId = z.uuid().safeParse(raw.activityId);
  if (!groupId.success || !activityId.success) notFound();

  // Null unless the caller teaches the group and the activity is in its course.
  const data = await getTeacherActivity(groupId.data, activityId.data);
  if (!data) notFound();
  const { activity } = data;

  const [t, tg, ta] = await Promise.all([
    getTranslations('teach.activity'),
    getTranslations('teach.group'),
    getTranslations('activity'),
  ]);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink
        href={`/teach/groups/${data.groupId}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('back')}
      </ButtonLink>
      <PageTitle
        subtitle={`${data.groupName} · ${activity.cycleTitle} · ${ta(`scoring.${activity.scoring}`)}`}
      >
        {activity.title}
      </PageTitle>
      <p className="rounded-md bg-surface-secondary px-4 py-3 text-sm text-fg-secondary">
        {t('keysHint')}
      </p>
      <ol className="flex flex-col gap-4">
        {activity.items.map((entry, i) => {
          const info = data.items[i]!;
          return (
            <li key={entry.rawId}>
              <Card className="flex flex-col gap-3">
                <h2 className="text-sm font-medium text-muted">{t('question', { n: i + 1 })}</h2>
                <NotebookView
                  view="student"
                  sectionId={activity.id}
                  blocks={entry.prompt}
                  courseLang={activity.courseLang}
                  aiTutorUrl={null}
                />
                {entry.item?.type === 'multipleChoice' ? (
                  <ul className="flex flex-col gap-1" lang={activity.courseLang}>
                    {entry.item.data.options.map((o) => (
                      <li key={o.id} dir="auto" className="text-fg-secondary">
                        • {o.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="rounded-md border border-dashed border-warning bg-warning-light px-3 py-2">
                  <p className="text-sm font-semibold text-warning-ink">{t('answer')}</p>
                  {info.solution === null ? (
                    <p className="text-sm">{t('notGraded')}</p>
                  ) : 'truth' in info.solution ? (
                    <p>{tg(info.solution.truth ? 'true' : 'false')}</p>
                  ) : (
                    info.solution.lines.map((line, j) => (
                      <p key={j} lang={activity.courseLang} dir="auto">
                        {line}
                      </p>
                    ))
                  )}
                  {info.feedback.length ? (
                    <>
                      <p className="mt-2 text-sm font-semibold text-warning-ink">{t('feedback')}</p>
                      <ul className="text-sm">
                        {info.feedback.map((f, j) => (
                          <li key={j} dir="auto">
                            <InlineText text={f} />
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
                <p className="text-sm text-fg-secondary">
                  {info.result.students
                    ? t('groupResult', {
                        correct: info.result.correct,
                        students: info.result.students,
                      })
                    : t('noResult')}
                </p>
              </Card>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
