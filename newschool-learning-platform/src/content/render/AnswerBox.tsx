'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';

export type AnswerState = { status: 'idle' | 'saved' | 'error' };
export type AnswerAction = (prev: AnswerState, formData: FormData) => Promise<AnswerState>;

/**
 * Optional, ungraded answer to a sentence frame, question or reflection
 * (decision C2). Saved privately; visible to the student's own teacher.
 */
export function AnswerBox({
  sectionId,
  blockId,
  itemIndex,
  label,
  initial,
  action,
  lang,
}: {
  sectionId: string;
  blockId: string;
  itemIndex: number;
  label: string;
  initial: string;
  action: AnswerAction;
  lang: string;
}) {
  const t = useTranslations('notebook');
  const id = useId();
  const [state, formAction, pending] = useActionState<AnswerState, FormData>(action, {
    status: 'idle',
  });
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="blockId" value={blockId} />
      <input type="hidden" name="itemIndex" value={itemIndex} />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        name="answer"
        lang={lang}
        dir="auto"
        rows={2}
        maxLength={2000}
        defaultValue={initial}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md border border-primary bg-primary-light px-4 text-[0.9375rem] font-medium text-primary hover:bg-surface-secondary disabled:opacity-50"
        >
          {t('save')}
        </button>
        <span role="status" className="text-sm text-muted">
          {state.status === 'saved' ? t('saved') : state.status === 'error' ? t('saveFailed') : ''}
        </span>
      </div>
    </form>
  );
}
