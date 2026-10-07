'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useDeferredValue, useMemo, useState } from 'react';
import { parseSectionYaml } from '@/content/editor';
import { NotebookView } from '@/content/render/NotebookView';
import { saveSectionContent, type EditorState } from '@/server/actions/cms';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';

const initial: EditorState = { status: 'idle' };

/**
 * The section's YAML on one side, checked and previewed as it is typed on the
 * other (student or teacher view). The server checks it again on save and
 * refuses to overwrite a newer save.
 */
export function SectionEditor({
  sectionId,
  updatedAt,
  yaml,
  courseLang,
  aiTutorUrl,
  activities,
}: {
  sectionId: string;
  updatedAt: string;
  yaml: string;
  courseLang: string;
  aiTutorUrl: string | null;
  activities: { id: string; slug: string; title: string; minutes: number | null }[];
}) {
  const t = useTranslations('cms.section');
  const [text, setText] = useState(yaml);
  const [view, setView] = useState<'student' | 'teacher'>('student');
  const [state, action, pending] = useActionState(saveSectionContent, initial);
  const deferred = useDeferredValue(text);
  const idBySlug = useMemo(() => new Map(activities.map((a) => [a.slug, a.id])), [activities]);
  const titles = useMemo(
    () => Object.fromEntries(activities.map((a) => [a.id, { title: a.title, minutes: a.minutes }])),
    [activities],
  );
  const result = useMemo(() => parseSectionYaml(deferred, idBySlug), [deferred, idBySlug]);
  const serverProblems = state.status === 'error' ? (state.problems ?? []) : [];
  const problems = result.ok ? serverProblems : result.problems;

  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <form action={action} className="flex min-w-0 flex-col gap-3" noValidate>
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="updatedAt" value={updatedAt} />
        <label htmlFor="section-yaml" className="font-semibold">
          {t('editorLabel')}
        </label>
        <p id="section-yaml-hint" className="text-sm text-muted">
          {t('contentHint')}
        </p>
        <textarea
          id="section-yaml"
          name="yaml"
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="ltr"
          spellCheck={false}
          rows={28}
          aria-describedby="section-yaml-hint section-yaml-problems"
          aria-invalid={!result.ok}
          className="rounded-md border border-border-strong bg-surface p-3 font-mono text-sm leading-relaxed text-fg aria-invalid:border-error"
        />
        <div id="section-yaml-problems" aria-live="polite">
          {problems.length ? (
            <div className="rounded-md border border-error/30 bg-error-light p-3 text-error-ink">
              <p className="font-semibold">{t('problemsTitle')}</p>
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
            <p className="text-sm text-success-ink">{t('valid')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending} disabled={!result.ok}>
            {t('save')}
          </Button>
        </div>
        {state.status === 'ok' ? <Alert tone="success">{state.message}</Alert> : null}
        {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      </form>

      <section aria-labelledby="preview-heading" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="preview-heading" className="font-semibold">
            {t('preview')}
          </h2>
          <div role="group" aria-label={t('preview')} className="flex gap-2">
            {(['student', 'teacher'] as const).map((v) => (
              <Button
                key={v}
                type="button"
                variant={view === v ? 'primary' : 'secondary'}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {t(v === 'student' ? 'studentView' : 'teacherView')}
              </Button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-dashed border-border-strong bg-background p-4">
          {result.ok && result.blocks.length ? (
            <NotebookView
              sectionId={sectionId}
              blocks={result.blocks}
              courseLang={courseLang}
              view={view}
              notes={result.teacherNotes}
              aiTutorUrl={aiTutorUrl}
              activities={titles}
            />
          ) : (
            <p className="text-fg-secondary">{t('previewEmpty')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
