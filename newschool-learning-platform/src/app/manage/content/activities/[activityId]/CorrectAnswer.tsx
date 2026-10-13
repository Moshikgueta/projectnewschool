'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import type { Correction } from '@/content/item-correction';
import type { CorrectionResult } from '@/server/actions/corrections';
import type { CorrectableItem } from '@/server/queries/cms';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';

const AREA = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-fg';
const SELECT =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg';

type Option = { id: string; text: string };
type Action = (input: unknown) => Promise<CorrectionResult>;

export type CorrectionActions = { preview: Action; apply: Action; recheck: Action };

/** What the form holds while it is typed (text areas stay text until checked). */
type Draft = {
  optionIds: string[];
  value: boolean;
  blanks: string[];
  accents: 'strict' | 'lenient';
  pairs: Record<string, string>;
  sentences: string;
};

function toDraft(answer: Correction): Draft {
  return {
    optionIds: answer.type === 'multipleChoice' ? answer.optionIds : [],
    value: answer.type === 'trueFalse' ? answer.value : true,
    blanks: answer.type === 'fillBlank' ? answer.blanks.map((b) => b.join('\n')) : [],
    accents: answer.type === 'fillBlank' ? answer.accents : 'lenient',
    pairs: answer.type === 'matching' ? answer.pairs : {},
    sentences: answer.type === 'reorderSentence' ? answer.accept.join('\n') : '',
  };
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function toCorrection(type: Correction['type'], d: Draft): Correction {
  switch (type) {
    case 'multipleChoice':
      return { type, optionIds: d.optionIds };
    case 'trueFalse':
      return { type, value: d.value };
    case 'fillBlank':
      return { type, blanks: d.blanks.map(lines), accents: d.accents };
    case 'matching':
      return { type, pairs: d.pairs };
    case 'reorderSentence':
      return { type, accept: lines(d.sentences) };
  }
}

const list = (v: unknown): Option[] => (Array.isArray(v) ? (v as Option[]) : []);

/**
 * "Correct the answer" for a question students have answered (ADR-041,
 * pedagogical manager only). The manager sets the right answer, writes why,
 * checks the effect on past answers, then confirms; the server re-checks
 * every past answer with the same grader as live answers.
 */
export function CorrectAnswer({
  item,
  n,
  actions,
  reportId,
  startOpen,
}: {
  item: CorrectableItem;
  n: number;
  actions: CorrectionActions;
  reportId: string | null;
  startOpen: boolean;
}) {
  const t = useTranslations('cms.correction');
  const format = useFormatter();
  const base = useId();
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<Draft>(() => toDraft(item.answer));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ for: string; result: CorrectionResult } | null>(null);
  const [outcome, setOutcome] = useState<CorrectionResult | null>(null);
  const [pending, start] = useTransition();

  const correction = toCorrection(item.type, draft);
  const snapshot = JSON.stringify(correction);
  const checked = preview?.for === snapshot && preview.result.ok ? preview.result : null;
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setOutcome(null);
  };

  function check() {
    start(async () => {
      const result = await actions.preview({ itemId: item.itemId, correction });
      setPreview({ for: snapshot, result });
    });
  }
  function confirm() {
    start(async () => {
      const result = await actions.apply({
        itemId: item.itemId,
        correction,
        reason,
        reportId,
      });
      setOutcome(result);
      if (result.ok) {
        setPreview(null);
        setReason('');
      }
    });
  }
  function recheck(id: string) {
    start(async () => setOutcome(await actions.recheck(id)));
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const last = item.last;

  return (
    <div className="flex flex-col gap-3">
      {last ? (
        <p className="text-sm text-muted">
          {t('last', { date: date(last.at), reason: last.reason })}
        </p>
      ) : null}
      {last && !last.rechecked && !(outcome?.ok && !outcome.pending) ? (
        <div className="flex flex-col gap-2">
          <Alert tone="warning">{t('pending')}</Alert>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            loading={pending}
            onClick={() => recheck(last.id)}
          >
            {t('recheck')}
          </Button>
        </div>
      ) : null}
      {!open ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          aria-label={t('actionLabel', { n })}
          onClick={() => setOpen(true)}
        >
          {t('action')}
        </Button>
      ) : (
        <section
          aria-labelledby={`${base}-title`}
          className="flex flex-col gap-4 rounded-md border border-primary/40 bg-primary-light/40 p-4"
        >
          <h3 id={`${base}-title`} className="font-semibold">
            {t('title')}
          </h3>
          <p className="text-sm text-fg-secondary">{t('intro')}</p>
          {reportId ? <p className="text-sm text-fg-secondary">{t('fromReport')}</p> : null}

          {item.type === 'multipleChoice' ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[0.9375rem] font-medium">{t('optionsLegend')}</legend>
              {list(item.data.options).map((o) => (
                <label key={o.id} className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={draft.optionIds.includes(o.id)}
                    onChange={(e) =>
                      set({
                        optionIds: e.target.checked
                          ? [...draft.optionIds, o.id]
                          : draft.optionIds.filter((x) => x !== o.id),
                      })
                    }
                  />
                  <bdi>{o.text}</bdi>
                </label>
              ))}
            </fieldset>
          ) : null}

          {item.type === 'trueFalse' ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[0.9375rem] font-medium">{t('truthLegend')}</legend>
              {([true, false] as const).map((v) => (
                <label
                  key={String(v)}
                  className="flex min-h-11 items-center gap-2 text-[0.9375rem]"
                >
                  <input
                    type="radio"
                    name={`${base}-truth`}
                    className="size-5 accent-primary"
                    checked={draft.value === v}
                    onChange={() => set({ value: v })}
                  />
                  {t(v ? 'true' : 'false')}
                </label>
              ))}
            </fieldset>
          ) : null}

          {item.type === 'fillBlank' ? (
            <>
              <p className="text-[0.9375rem]">
                {t('textHint')} <bdi>{String(item.data.text ?? '')}</bdi>
              </p>
              {draft.blanks.map((value, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <label htmlFor={`${base}-blank-${i}`} className="text-[0.9375rem] font-medium">
                    {t('blankLabel', { n: i + 1 })}
                  </label>
                  <textarea
                    id={`${base}-blank-${i}`}
                    rows={2}
                    dir="auto"
                    value={value}
                    onChange={(e) =>
                      set({ blanks: draft.blanks.map((b, j) => (j === i ? e.target.value : b)) })
                    }
                    className={AREA}
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${base}-accents`} className="text-[0.9375rem] font-medium">
                  {t('accents')}
                </label>
                <select
                  id={`${base}-accents`}
                  value={draft.accents}
                  onChange={(e) => set({ accents: e.target.value as Draft['accents'] })}
                  className={SELECT}
                >
                  {(['lenient', 'strict'] as const).map((a) => (
                    <option key={a} value={a}>
                      {t(`accentsOptions.${a}`)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          {item.type === 'matching'
            ? list(item.data.left).map((l) => (
                <div key={l.id} className="flex flex-col gap-1.5">
                  <label htmlFor={`${base}-pair-${l.id}`} className="text-[0.9375rem] font-medium">
                    {t('matchLabel', { left: l.text })}
                  </label>
                  <select
                    id={`${base}-pair-${l.id}`}
                    value={draft.pairs[l.id] ?? ''}
                    onChange={(e) => set({ pairs: { ...draft.pairs, [l.id]: e.target.value } })}
                    className={SELECT}
                  >
                    {list(item.data.right).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.text}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            : null}

          {item.type === 'reorderSentence' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${base}-sentences`} className="text-[0.9375rem] font-medium">
                {t('sentencesLabel')}
              </label>
              <p id={`${base}-sentences-hint`} className="text-sm text-muted">
                {t('wordsHint', {
                  words: list(item.data.tokens)
                    .map((w) => w.text)
                    .join(' · '),
                })}
              </p>
              <textarea
                id={`${base}-sentences`}
                rows={3}
                dir="auto"
                aria-describedby={`${base}-sentences-hint`}
                value={draft.sentences}
                onChange={(e) => set({ sentences: e.target.value })}
                className={AREA}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${base}-reason`} className="text-[0.9375rem] font-medium">
              {t('reason')}
            </label>
            <p id={`${base}-reason-hint`} className="text-sm text-muted">
              {t('reasonHint')}
            </p>
            <textarea
              id={`${base}-reason`}
              rows={2}
              dir="auto"
              maxLength={500}
              aria-describedby={`${base}-reason-hint`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={AREA}
            />
          </div>

          <div aria-live="polite" className="flex flex-col gap-2">
            {preview && preview.for === snapshot && !preview.result.ok ? (
              <Alert tone="error">{preview.result.message}</Alert>
            ) : null}
            {checked ? (
              <div className="rounded-md border border-border bg-surface p-3 text-[0.9375rem]">
                <p className="font-semibold">{t('effectTitle')}</p>
                <ul className="mt-1 list-disc ps-5">
                  <li>{t('effectResponses', { count: checked.effect.responses })}</li>
                  <li>{t('effectCorrect', { count: checked.effect.becameCorrect })}</li>
                  <li>{t('effectIncorrect', { count: checked.effect.becameIncorrect })}</li>
                  {checked.effect.partialChanged ? (
                    <li>{t('effectPartial', { count: checked.effect.partialChanged })}</li>
                  ) : null}
                  <li>
                    {checked.effect.attempts
                      ? t('effectStudents', {
                          students: checked.effect.students,
                          attempts: checked.effect.attempts,
                        })
                      : t('effectNone')}
                  </li>
                </ul>
              </div>
            ) : null}
            {outcome ? (
              <Alert tone={outcome.ok ? (outcome.pending ? 'warning' : 'success') : 'error'}>
                {outcome.message}
              </Alert>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" loading={pending} onClick={check}>
              {t('preview')}
            </Button>
            <Button
              type="button"
              loading={pending}
              disabled={!checked || reason.trim().length < 3}
              onClick={confirm}
            >
              {t('confirm')}
            </Button>
            <Button
              type="button"
              variant="tertiary"
              onClick={() => {
                setOpen(false);
                setPreview(null);
                setDraft(toDraft(item.answer));
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
