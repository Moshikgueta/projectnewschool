'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import type { ItemProgress } from '@/domain/grading/attempt';
import type { Solution } from '@/domain/grading/solution';
import { Button } from '@/ui/Button';
import { ProgressBar } from '@/ui/Progress';
import type { PublicItem } from '../items';
import { isComplete, ItemInput, type Draft } from './ItemInput';
import type { CheckAction, CheckResult } from './types';

export type PlayerItem = {
  id: string;
  item: PublicItem | null;
  /** The question, rendered on the server from its content blocks. */
  prompt: ReactNode;
  progress: ItemProgress | null;
};

type Feedback =
  | { kind: 'result'; result: Extract<CheckResult, { ok: true }> }
  | { kind: 'problem'; reason: Extract<CheckResult, { ok: false }>['reason'] };

/**
 * The exercise player: one question at a time. Answers are checked on the
 * server (ADR-006); this component never has the answer key. Every check is
 * saved, so leaving and coming back resumes where the student stopped.
 */
export function ActivityPlayer({
  attemptId,
  items,
  scored,
  lang,
  check,
  finish,
}: {
  attemptId: string;
  items: PlayerItem[];
  scored: boolean;
  lang: string;
  check: CheckAction;
  finish: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations('activity');
  const firstOpen = items.findIndex(
    (i) => !i.progress || (!scored && i.progress.status === 'incorrect'),
  );
  const [index, setIndex] = useState(firstOpen === -1 ? Math.max(0, items.length - 1) : firstOpen);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(items.map((i) => [i.id, (i.progress?.answer as Draft | undefined) ?? {}])),
  );
  const [progress, setProgress] = useState<Record<string, ItemProgress | null>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.progress])),
  );
  const [feedback, setFeedback] = useState<Record<string, Feedback | undefined>>({});
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  const current = items[index];
  if (!current) return null;
  const answered = Object.values(progress).filter(Boolean).length;
  const status = progress[current.id]?.status;
  // Correct answers stay put; scored activities allow one answer per question.
  const locked = status === 'correct' || (scored && !!status);
  const last = index === items.length - 1;

  function go(to: number) {
    setIndex(to);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function onCheck() {
    const item = current?.item;
    if (!current || !item) return;
    const draft = drafts[current.id] ?? {};
    if (!isComplete(item, draft)) {
      setFeedback((f) => ({ ...f, [current.id]: { kind: 'problem', reason: 'invalid' } }));
      return;
    }
    startTransition(async () => {
      const result = await check(attemptId, current.id, draft);
      if (!result.ok) {
        setFeedback((f) => ({ ...f, [current.id]: { kind: 'problem', reason: result.reason } }));
        return;
      }
      setFeedback((f) => ({ ...f, [current.id]: { kind: 'result', result } }));
      setProgress((p) => ({
        ...p,
        [current.id]: {
          status: p[current.id]?.status === 'correct' ? 'correct' : result.status,
          tries: result.tries,
          answer: draft,
          firstScore: p[current.id]?.firstScore ?? 0,
        },
      }));
    });
  }

  const fb = feedback[current.id];
  const parts = fb?.kind === 'result' ? fb.result.parts : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <ProgressBar
          value={(answered / Math.max(1, items.length)) * 100}
          label={t('progressLabel')}
          valueText={t('finishHint', { answered, total: items.length })}
        />
      </div>

      <section
        aria-labelledby="question-heading"
        className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5"
      >
        <h2
          id="question-heading"
          ref={heading}
          tabIndex={-1}
          className="text-sm font-medium text-muted outline-none"
        >
          {t('questionOf', { current: index + 1, total: items.length })}
        </h2>
        <div>{current.prompt}</div>
        {current.item ? (
          <ItemInput
            key={current.id}
            item={current.item}
            value={drafts[current.id] ?? {}}
            onChange={(next) => {
              setDrafts((d) => ({ ...d, [current.id]: next }));
              if (fb?.kind === 'problem') setFeedback((f) => ({ ...f, [current.id]: undefined }));
            }}
            disabled={locked || pending}
            lang={lang}
            parts={parts}
          />
        ) : (
          <p className="text-sm text-muted">{t('unavailable')}</p>
        )}

        <div role="status" aria-live="polite" className="min-h-6">
          <FeedbackView feedback={fb} status={status} scored={scored} />
        </div>

        {current.item && !locked ? (
          <div>
            <Button type="button" onClick={onCheck} loading={pending}>
              {scored || current.item.type === 'shortAnswer' || current.item.type === 'reflection'
                ? t('saveAnswer')
                : t('check')}
            </Button>
          </div>
        ) : null}
      </section>

      <nav
        aria-label={t('progressLabel')}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button
          type="button"
          variant="secondary"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          {t('previous')}
        </Button>
        {last ? (
          <form action={finish} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="attemptId" value={attemptId} />
            <span className="text-sm text-muted">
              {t('finishHint', { answered, total: items.length })}
            </span>
            <Button type="submit">{t('finish')}</Button>
          </form>
        ) : (
          <Button
            type="button"
            variant={status ? 'primary' : 'secondary'}
            onClick={() => go(index + 1)}
          >
            {t('next')}
          </Button>
        )}
      </nav>
    </div>
  );
}

function FeedbackView({
  feedback,
  status,
  scored,
}: {
  feedback: Feedback | undefined;
  status: ItemProgress['status'] | undefined;
  scored: boolean;
}) {
  const t = useTranslations('activity');
  if (feedback?.kind === 'problem') {
    return <p className="font-medium text-error-ink">{t(feedback.reason)}</p>;
  }
  if (feedback?.kind === 'result') {
    const r = feedback.result;
    if (r.status === 'saved')
      return <p className="text-fg-secondary">{scored ? t('savedScored') : t('saved')}</p>;
    return (
      <div className="flex flex-col gap-1">
        <p className={`font-semibold ${r.correct ? 'text-success-ink' : 'text-warning-ink'}`}>
          {r.correct
            ? r.accentReminder
              ? t('accent')
              : t('correct')
            : r.accentReminder
              ? t('accentStrict')
              : t('incorrect')}
        </p>
        {r.feedback.map((f) => (
          <p key={f} className="text-fg-secondary">
            {f}
          </p>
        ))}
        {r.solution ? <SolutionView solution={r.solution} /> : null}
      </div>
    );
  }
  // Restored from an earlier visit.
  if (status === 'correct') return <p className="font-semibold text-success-ink">{t('correct')}</p>;
  if (status === 'saved' || (scored && status))
    return <p className="text-fg-secondary">{scored ? t('savedScored') : t('saved')}</p>;
  return null;
}

function SolutionView({ solution }: { solution: Solution }) {
  const t = useTranslations('activity');
  return (
    <div className="mt-1 rounded-md bg-surface-secondary px-3 py-2">
      <p className="text-sm font-medium text-muted">{t('answerIs')}</p>
      {'truth' in solution ? (
        <p>{solution.truth ? t('true') : t('false')}</p>
      ) : (
        solution.lines.map((line, i) => (
          <p key={i} dir="auto">
            {line}
          </p>
        ))
      )}
    </div>
  );
}
