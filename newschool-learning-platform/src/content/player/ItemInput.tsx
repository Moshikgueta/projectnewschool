'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { ItemData, PublicItem } from '../items';
import { InlineText } from '../render/InlineText';

// One input per item type. Native controls only (radio, checkbox, select,
// buttons, text inputs), so touch, keyboard and screen readers all work
// without custom widgets. Answers are plain JSON in the shape of
// itemSchemas[type].answer.

export type Draft = Record<string, unknown>;

type Props = {
  item: PublicItem;
  value: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  lang: string;
  /** Per-part correctness from the last check (blanks, pairs). */
  parts?: boolean[];
};

const CHOICE =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border-strong bg-surface px-4 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary-light has-[:disabled]:cursor-default';
const FIELD =
  'min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base aria-[invalid=true]:border-error';

export function ItemInput(props: Props) {
  switch (props.item.type) {
    case 'multipleChoice':
      return <MultipleChoice {...props} data={props.item.data} />;
    case 'trueFalse':
      return <TrueFalse {...props} />;
    case 'fillBlank':
      return <FillBlank {...props} data={props.item.data} />;
    case 'matching':
      return <Matching {...props} data={props.item.data} />;
    case 'reorderSentence':
      return <Reorder {...props} data={props.item.data} />;
    case 'shortAnswer':
    case 'reflection':
      return <Text {...props} maxLength={props.item.data.maxLength} />;
  }
}

/** Whether a draft is complete enough to check. */
export function isComplete(item: PublicItem, value: Draft): boolean {
  switch (item.type) {
    case 'multipleChoice':
      return Array.isArray(value.optionIds) && value.optionIds.length > 0;
    case 'trueFalse':
      return typeof value.value === 'boolean';
    case 'fillBlank': {
      const blanks = (item.data.text.match(/_{3,}/g) ?? []).length;
      const v = (value.blanks as string[] | undefined) ?? [];
      return v.length === blanks && v.every((b) => b.trim().length > 0);
    }
    case 'matching': {
      const pairs = (value.pairs as Record<string, string> | undefined) ?? {};
      return item.data.left.every((l) => !!pairs[l.id]);
    }
    case 'reorderSentence':
      return ((value.tokenIds as string[] | undefined) ?? []).length === item.data.tokens.length;
    case 'shortAnswer':
    case 'reflection':
      return typeof value.text === 'string' && value.text.trim().length > 0;
  }
}

function MultipleChoice({
  data,
  value,
  onChange,
  disabled,
  lang,
}: Props & { data: ItemData<'multipleChoice'> }) {
  const t = useTranslations('activity');
  const name = useId();
  const chosen = new Set((value.optionIds as string[] | undefined) ?? []);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted">
        {data.multiple ? t('chooseAll') : t('chooseOne')}
      </legend>
      {data.options.map((o) => (
        <label key={o.id} className={CHOICE}>
          <input
            type={data.multiple ? 'checkbox' : 'radio'}
            name={name}
            className="size-5 accent-primary"
            checked={chosen.has(o.id)}
            disabled={disabled}
            onChange={(e) => {
              const next = data.multiple ? new Set(chosen) : new Set<string>();
              if (e.currentTarget.checked) next.add(o.id);
              else next.delete(o.id);
              onChange({ optionIds: [...next] });
            }}
          />
          <span lang={lang} dir="auto">
            {o.text}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function TrueFalse({ value, onChange, disabled }: Props) {
  const t = useTranslations('activity');
  const name = useId();
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t('chooseOne')}</legend>
      {[true, false].map((v) => (
        <label key={String(v)} className={`${CHOICE} min-w-32`}>
          <input
            type="radio"
            name={name}
            className="size-5 accent-primary"
            checked={value.value === v}
            disabled={disabled}
            onChange={() => onChange({ value: v })}
          />
          <span>{v ? t('true') : t('false')}</span>
        </label>
      ))}
    </fieldset>
  );
}

function FillBlank({
  data,
  value,
  onChange,
  disabled,
  lang,
  parts,
}: Props & { data: ItemData<'fillBlank'> }) {
  const t = useTranslations('activity');
  const segments = data.text.split(/_{3,}/);
  const blanks = (value.blanks as string[] | undefined) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p lang={lang} dir="auto" className="text-lg leading-loose">
        {segments.map((segment, i) => (
          <span key={i}>
            {segment ? <InlineText text={segment} /> : null}
            {i < segments.length - 1 ? (
              <input
                type="text"
                aria-label={t('blank', { n: i + 1 })}
                aria-invalid={parts ? parts[i] === false : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                lang={lang}
                dir="auto"
                maxLength={200}
                disabled={disabled}
                value={blanks[i] ?? ''}
                onChange={(e) => {
                  const next = Array.from(
                    { length: segments.length - 1 },
                    (_, j) => blanks[j] ?? '',
                  );
                  next[i] = e.currentTarget.value;
                  onChange({ blanks: next });
                }}
                className={`${FIELD} mx-1 inline-block w-36 align-baseline`}
              />
            ) : null}
          </span>
        ))}
      </p>
      {data.wordBank?.length ? (
        <div>
          <p className="mb-1 text-sm font-medium text-muted">{t('wordBank')}</p>
          <ul className="flex flex-wrap gap-2" lang={lang}>
            {data.wordBank.map((w) => (
              <li
                key={w}
                dir="auto"
                className="rounded-full bg-surface-secondary px-3 py-1 text-[0.9375rem]"
              >
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Matching({
  data,
  value,
  onChange,
  disabled,
  lang,
  parts,
}: Props & { data: ItemData<'matching'> }) {
  const t = useTranslations('activity');
  const pairs = (value.pairs as Record<string, string> | undefined) ?? {};
  return (
    <ul className="flex flex-col gap-3">
      {data.left.map((l, i) => (
        <li key={l.id} className="grid items-center gap-2 sm:grid-cols-2">
          <span lang={lang} dir="auto" className="font-medium">
            {l.text}
          </span>
          <select
            aria-label={t('matchFor', { word: l.text })}
            aria-invalid={parts ? parts[i] === false : undefined}
            disabled={disabled}
            value={pairs[l.id] ?? ''}
            onChange={(e) => onChange({ pairs: { ...pairs, [l.id]: e.currentTarget.value } })}
            className={FIELD}
          >
            <option value="">{t('choose')}</option>
            {data.right.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}

function Reorder({
  data,
  value,
  onChange,
  disabled,
  lang,
}: Props & { data: ItemData<'reorderSentence'> }) {
  const t = useTranslations('activity');
  const chosen = (value.tokenIds as string[] | undefined) ?? [];
  const byId = new Map(data.tokens.map((tok) => [tok.id, tok.text]));
  const available = data.tokens.filter((tok) => !chosen.includes(tok.id));
  const chip =
    'min-h-11 rounded-md border px-3 text-base disabled:cursor-default disabled:opacity-60';
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-sm font-medium text-muted" id={`${data.tokens[0]?.id}-line`}>
          {t('yourSentence')}
        </p>
        <div
          className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-dashed border-border-strong p-2"
          lang={lang}
          dir="auto"
        >
          {chosen.length === 0 ? (
            <span className="text-sm text-muted">{t('emptySentence')}</span>
          ) : null}
          {chosen.map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-label={t('removeWord', { word: byId.get(id) ?? '' })}
              onClick={() => onChange({ tokenIds: chosen.filter((c) => c !== id) })}
              className={`${chip} border-primary bg-primary-light text-primary`}
            >
              {byId.get(id)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-muted">{t('words')}</p>
        <div className="flex flex-wrap gap-2" lang={lang} dir="auto">
          {available.map((tok) => (
            <button
              key={tok.id}
              type="button"
              disabled={disabled}
              aria-label={t('addWord', { word: tok.text })}
              onClick={() => onChange({ tokenIds: [...chosen, tok.id] })}
              className={`${chip} border-border-strong bg-surface hover:border-primary`}
            >
              {tok.text}
            </button>
          ))}
          {chosen.length > 0 && !disabled ? (
            <button
              type="button"
              onClick={() => onChange({ tokenIds: [] })}
              className="min-h-11 px-2 text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('clear')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Text({ value, onChange, disabled, lang, maxLength }: Props & { maxLength: number }) {
  const t = useTranslations('activity');
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {t('yourAnswer')}
      </label>
      <textarea
        id={id}
        rows={4}
        lang={lang}
        dir="auto"
        maxLength={maxLength}
        disabled={disabled}
        value={(value.text as string | undefined) ?? ''}
        onChange={(e) => onChange({ text: e.currentTarget.value })}
        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
      />
    </div>
  );
}
