'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { record, type FieldSpec } from '@/content/block-forms';

const INPUT =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg';
const AREA = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-fg';
const SMALL_BUTTON =
  'min-h-11 rounded-md px-2 text-sm font-medium text-muted hover:bg-surface-secondary hover:text-fg disabled:opacity-40';

type Value = unknown;
type Rec = Record<string, unknown>;

/** Set or clear a key: empty optional values are left out, as the schemas expect. */
export function setKey(rec: Rec, key: string, value: Value): Rec {
  const next = { ...rec };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  return next;
}

/** Text whose shape is decided on change (a list, a table): typed freely, parsed as you go. */
function useDraft(initial: string) {
  return useState(initial);
}

function Label({ id, text, hint }: { id: string; text: string; hint?: string }) {
  return (
    <>
      <label htmlFor={id} className="text-[0.9375rem] font-medium">
        {text}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  idBase,
  activities,
}: {
  field: FieldSpec;
  value: Value;
  onChange: (value: Value) => void;
  idBase: string;
  activities: { slug: string; title: string }[];
}) {
  const t = useTranslations('cms.fields');
  const tf = useTranslations('cms.form');
  const id = `${idBase}-${field.key}`;
  const optional = 'optional' in field && field.optional;
  const name = (field.label ?? field.key) as 'text';
  const label = optional ? t('optional', { field: t(name) }) : t(name);
  const hint = field.hint ? tf(field.hint as 'rowsHint') : undefined;
  const str = typeof value === 'string' ? value : '';

  switch (field.kind) {
    case 'line':
    case 'lang':
    case 'url':
      return (
        <div className="flex flex-col gap-1.5">
          <Label id={id} text={label} />
          <input
            id={id}
            type={field.kind === 'url' ? 'url' : 'text'}
            dir={field.kind === 'line' ? 'auto' : 'ltr'}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            className={field.kind === 'lang' ? `${INPUT} max-w-32` : INPUT}
          />
        </div>
      );
    case 'text':
    case 'plain':
      return (
        <div className="flex flex-col gap-1.5">
          <Label id={id} text={label} />
          <textarea
            id={id}
            dir="auto"
            rows={field.kind === 'plain' ? 6 : 3}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            className={AREA}
          />
        </div>
      );
    case 'choice':
      return (
        <div className="flex flex-col gap-1.5">
          <Label id={id} text={label} />
          <select
            id={id}
            value={String(value ?? field.options[0])}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(typeof field.options[0] === 'number' ? Number(raw) : raw);
            }}
            className={`${INPUT} max-w-xs`}
          >
            {field.options.map((o) => (
              <option key={String(o)} value={String(o)}>
                {typeof o === 'number'
                  ? t('levelOption', { n: o })
                  : t(`options.${o}` as 'options.tip')}
              </option>
            ))}
          </select>
        </div>
      );
    case 'number':
      return (
        <div className="flex flex-col gap-1.5">
          <Label id={id} text={label} />
          <input
            id={id}
            type="number"
            min={field.min}
            max={field.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            className={`${INPUT} max-w-32`}
          />
        </div>
      );
    case 'boolean':
      return (
        <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
          <input
            type="checkbox"
            checked={value === undefined ? (field.initial ?? true) : value !== false}
            onChange={(e) => onChange(e.target.checked)}
            className="size-5 accent-primary"
          />
          {t(name)}
        </label>
      );
    case 'activity':
      return (
        <div className="flex flex-col gap-1.5">
          <Label id={id} text={label} />
          <select
            id={id}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            className={`${INPUT} max-w-md`}
          >
            <option value="">{tf('chooseActivity')}</option>
            {activities.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.title}
              </option>
            ))}
            {str && !activities.some((a) => a.slug === str) ? (
              <option value={str}>{str}</option>
            ) : null}
          </select>
        </div>
      );
    case 'lines':
      return (
        <LinesInput
          id={id}
          label={label}
          hint={hint ?? tf('onePerLine')}
          value={value}
          onChange={onChange}
          optional={!!optional}
        />
      );
    case 'cells':
      return (
        <CellsInput
          id={id}
          label={label}
          hint={tf('cellsHint')}
          value={value}
          onChange={onChange}
        />
      );
    case 'rows':
      return (
        <RowsInput
          id={id}
          label={label}
          hint={hint ?? tf('rowsHint')}
          value={value}
          onChange={onChange}
        />
      );
    case 'group': {
      const present = !!value && typeof value === 'object';
      return (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-[0.9375rem] font-medium">{label}</legend>
          <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
            <input
              type="checkbox"
              checked={present}
              onChange={(e) => onChange(e.target.checked ? record(field.fields) : undefined)}
              className="size-5 accent-primary"
            />
            {tf('include', { field: t(name as 'resource') })}
          </label>
          {present
            ? field.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={(value as Rec)[f.key]}
                  onChange={(v) => onChange(setKey(value as Rec, f.key, v))}
                  idBase={id}
                  activities={activities}
                />
              ))
            : null}
        </fieldset>
      );
    }
    case 'list': {
      const items = Array.isArray(value) ? (value as Rec[]) : [];
      const update = (next: Rec[]) => onChange(next);
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[0.9375rem] font-medium">{label}</legend>
          <ol className="flex flex-col gap-3">
            {items.map((item, i) => (
              <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-muted">{tf('item', { n: i + 1 })}</span>
                  <span className="flex">
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={i === 0}
                      aria-label={tf('moveItemUp', { n: i + 1 })}
                      onClick={() => {
                        const next = [...items];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        update(next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={i === items.length - 1}
                      aria-label={tf('moveItemDown', { n: i + 1 })}
                      onClick={() => {
                        const next = [...items];
                        [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                        update(next);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      aria-label={tf('removeItem', { n: i + 1 })}
                      onClick={() => update(items.filter((_, j) => j !== i))}
                    >
                      {tf('remove')}
                    </button>
                  </span>
                </div>
                {field.fields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={item[f.key]}
                    onChange={(v) =>
                      update(items.map((it, j) => (j === i ? setKey(it, f.key, v) : it)))
                    }
                    idBase={`${id}-${i}`}
                    activities={activities}
                  />
                ))}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="min-h-11 self-start rounded-md border border-border-strong px-3 text-sm font-medium"
            onClick={() => update([...items, record(field.fields)])}
          >
            {tf('addItem', { field: label })}
          </button>
        </fieldset>
      );
    }
  }
}

function LinesInput({
  id,
  label,
  hint,
  value,
  onChange,
  optional,
}: {
  id: string;
  label: string;
  hint: string;
  value: Value;
  onChange: (v: Value) => void;
  optional: boolean;
}) {
  const [draft, setDraft] = useDraft(Array.isArray(value) ? (value as string[]).join('\n') : '');
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={id} text={label} hint={hint} />
      <textarea
        id={id}
        dir="auto"
        rows={4}
        value={draft}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value);
          const lines = e.target.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          onChange(optional && lines.length === 0 ? undefined : lines);
        }}
        className={AREA}
      />
    </div>
  );
}

const splitCells = (line: string) => line.split('|').map((c) => c.trim());

function CellsInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: Value;
  onChange: (v: Value) => void;
}) {
  const [draft, setDraft] = useDraft(Array.isArray(value) ? (value as string[]).join(' | ') : '');
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={id} text={label} hint={hint} />
      <input
        id={id}
        dir="auto"
        value={draft}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value.trim() ? splitCells(e.target.value) : undefined);
        }}
        className={INPUT}
      />
    </div>
  );
}

function RowsInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: Value;
  onChange: (v: Value) => void;
}) {
  const [draft, setDraft] = useDraft(
    Array.isArray(value) ? (value as string[][]).map((r) => r.join(' | ')).join('\n') : '',
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={id} text={label} hint={hint} />
      <textarea
        id={id}
        dir="auto"
        rows={5}
        value={draft}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(
            e.target.value
              .split('\n')
              .filter((l) => l.trim())
              .map(splitCells),
          );
        }}
        className={`${AREA} font-mono text-sm`}
      />
    </div>
  );
}
