'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useDeferredValue, useMemo, useState } from 'react';
import { compileItem } from '@/content/activities-file';
import { parseActivityYaml } from '@/content/activity-editor';
import { NotebookView } from '@/content/render/NotebookView';
import { solutionOf } from '@/domain/grading/solution';
import { saveActivityContent, type EditorState } from '@/server/actions/cms';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { Badge } from '@/ui/Card';

const initial: EditorState = { status: 'idle' };

/**
 * An exercise's items in YAML (the content files' authored form), checked
 * as they are typed, with a preview of each question and its right answer.
 * Items students have answered are marked: their options and answers are
 * locked (the server and the database refuse such changes).
 */
export function ActivityEditor({
  activityId,
  activitySlug,
  updatedAt,
  yaml,
  courseLang,
  answered,
}: {
  activityId: string;
  activitySlug: string;
  updatedAt: string;
  yaml: string;
  courseLang: string;
  answered: Record<string, number>;
}) {
  const t = useTranslations('cms.activity');
  const ts = useTranslations('cms.section');
  const [text, setText] = useState(yaml);
  const [state, action, pending] = useActionState(saveActivityContent, initial);
  const deferred = useDeferredValue(text);
  const result = useMemo(() => parseActivityYaml(deferred, activitySlug), [deferred, activitySlug]);
  const problems = result.ok
    ? state.status === 'error'
      ? (state.problems ?? [])
      : []
    : result.problems;

  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <form action={action} className="flex min-w-0 flex-col gap-3" noValidate>
        <input type="hidden" name="activityId" value={activityId} />
        <input type="hidden" name="updatedAt" value={updatedAt} />
        <label htmlFor="activity-yaml" className="font-semibold">
          {t('editorLabel')}
        </label>
        <p id="activity-yaml-hint" className="text-sm text-muted">
          {t('hint')}
        </p>
        <textarea
          id="activity-yaml"
          name="yaml"
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="ltr"
          spellCheck={false}
          rows={28}
          aria-describedby="activity-yaml-hint activity-yaml-problems"
          aria-invalid={!result.ok}
          className="rounded-md border border-border-strong bg-surface p-3 font-mono text-sm leading-relaxed text-fg aria-invalid:border-error"
        />
        <div id="activity-yaml-problems" aria-live="polite">
          {problems.length ? (
            <div className="rounded-md border border-error/30 bg-error-light p-3 text-error-ink">
              <p className="font-semibold">{ts('problemsTitle')}</p>
              <ul className="mt-1 list-disc ps-5 text-sm">
                {problems.map((p, i) => (
                  <li key={i}>
                    {p.path ? <code dir="ltr">{p.path}</code> : null}
                    {p.path ? ': ' : null}
                    <bdi>{p.message}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-success-ink">{ts('valid')}</p>
          )}
        </div>
        <Button type="submit" loading={pending} disabled={!result.ok} className="self-start">
          {ts('save')}
        </Button>
        {state.status === 'ok' ? <Alert tone="success">{state.message}</Alert> : null}
        {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      </form>

      <section aria-labelledby="activity-preview-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="activity-preview-heading" className="font-semibold">
          {t('preview')}
        </h2>
        {result.ok ? (
          <ol className="flex flex-col gap-4">
            {result.doc.items.map((item, i) => {
              const compiled = compileItem(activitySlug, item);
              const solution = compiled.key
                ? solutionOf({
                    type: compiled.type,
                    data: compiled.data,
                    key: compiled.key,
                  } as Parameters<typeof solutionOf>[0])
                : null;
              const count = answered[item.id] ?? 0;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t('question', { n: i + 1 })}</span>
                    <Badge>{t(`types.${compiled.type}`)}</Badge>
                    <code dir="ltr" className="text-sm text-muted">
                      {item.id}
                    </code>
                    {count ? <Badge tone="warning">{t('answeredBy', { count })}</Badge> : null}
                  </div>
                  <NotebookView
                    sectionId={`preview-${item.id}`}
                    blocks={compiled.prompt}
                    courseLang={courseLang}
                    view="student"
                    aiTutorUrl={null}
                  />
                  {item.type === 'multipleChoice' ? (
                    <ul className="flex flex-col gap-1 text-[0.9375rem]">
                      {item.options.map((o, k) => (
                        <li key={k} dir="auto">
                          {o.correct ? '✓ ' : '· '}
                          {o.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="rounded-md bg-success-light px-3 py-2 text-[0.9375rem] text-success-ink">
                    {solution === null
                      ? t('openAnswer')
                      : 'truth' in solution
                        ? t('answer', { answer: t(solution.truth ? 'true' : 'false') })
                        : t('answer', { answer: solution.lines.join(' · ') })}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-fg-secondary">{ts('previewEmpty')}</p>
        )}
      </section>
    </div>
  );
}
