'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ActivityFormDoc } from '@/content/activity-editor';
import type { EditorProblem } from '@/content/editor';
import { ITEM_TYPES, itemFields, itemSummary, newItem, type ItemType } from '@/content/item-forms';
import { Badge } from '@/ui/Card';
import { FieldInput, setKey } from '../../FieldInput';

type Rec = Record<string, unknown>;

const SMALL_BUTTON =
  'min-h-11 min-w-11 rounded-md px-2 text-sm font-medium text-muted hover:bg-surface-secondary hover:text-fg disabled:opacity-40';
const INPUT = 'min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-fg';

/**
 * An exercise's questions, each opened into the form of its type. A question
 * students have answered says so: its options and answers are locked (the
 * server refuses a change) and it cannot be removed.
 */
export function ItemListEditor({
  doc,
  onChange,
  problems,
  answered,
}: {
  doc: ActivityFormDoc;
  onChange: (doc: ActivityFormDoc) => void;
  problems: EditorProblem[];
  answered: Record<string, number>;
}) {
  const t = useTranslations('cms.activity');
  const tf = useTranslations('cms.form');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<ItemType>('multipleChoice');
  const items = doc.items;
  const setItems = (next: Rec[]) => onChange({ ...doc, items: next });
  const idOf = (item: Rec, i: number) => (typeof item.id === 'string' ? item.id : `item-${i}`);
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      {doc.instructions.length ? (
        <p className="text-sm text-muted">{t('instructionsInYaml')}</p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => {
          const id = idOf(item, i);
          const type = item.type as ItemType;
          const known = ITEM_TYPES.includes(type);
          const own = problems.filter((p) => p.path.startsWith(`items[${i}]`));
          const count = answered[id] ?? 0;
          const isOpen = open.has(id);
          const blocksPrompt = Array.isArray(item.prompt);
          const fields = known
            ? itemFields(type).filter((f) => !(blocksPrompt && f.key === 'prompt'))
            : [];
          return (
            <li key={`${id}-${i}`} className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`${id}-form`}
                  onClick={() => toggle(id)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start"
                >
                  <span aria-hidden="true" className="rtl:-scale-x-100">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="font-semibold">{t('question', { n: i + 1 })}</span>
                  <Badge tone="brand">{known ? t(`types.${type}`) : t('unknownType')}</Badge>
                  <span className="truncate text-[0.9375rem]" dir="auto">
                    {itemSummary(item) || tf('empty')}
                  </span>
                  {count ? <Badge tone="warning">{t('answeredBy', { count })}</Badge> : null}
                  {own.length ? (
                    <Badge tone="error">{tf('problemCount', { count: own.length })}</Badge>
                  ) : null}
                </button>
                <span className="flex">
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === 0}
                    aria-label={t('moveUp', { n: i + 1 })}
                    onClick={() => {
                      const next = [...items];
                      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                      setItems(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === items.length - 1}
                    aria-label={t('moveDown', { n: i + 1 })}
                    onClick={() => {
                      const next = [...items];
                      [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                      setItems(next);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={!known}
                    aria-label={t('duplicateLabel', { n: i + 1 })}
                    onClick={() => {
                      const used = new Set(items.map(idOf));
                      const copy = { ...structuredClone(item), id: newItem(type, used).id };
                      setItems([...items.slice(0, i + 1), copy, ...items.slice(i + 1)]);
                    }}
                  >
                    {tf('duplicate')}
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={count > 0}
                    aria-label={t('removeLabel', { n: i + 1 })}
                    title={count > 0 ? t('cannotRemoveAnswered') : undefined}
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    {tf('remove')}
                  </button>
                </span>
              </div>
              {isOpen ? (
                <div id={`${id}-form`} className="flex flex-col gap-4 border-t border-border p-4">
                  {count ? (
                    <p className="rounded-md bg-warning-light p-3 text-sm text-warning-ink">
                      {t('lockedNote', { count })}
                    </p>
                  ) : null}
                  {own.length ? (
                    <ul className="list-disc rounded-md bg-error-light p-3 ps-8 text-sm text-error-ink">
                      {own.map((p, k) => (
                        <li key={k}>
                          <code dir="ltr">
                            {p.path.slice(`items[${i}]`.length).replace(/^\./, '') || id}
                          </code>
                          : <bdi>{p.message}</bdi>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {blocksPrompt ? <p className="text-sm text-muted">{t('promptInYaml')}</p> : null}
                  {fields.map((field) => (
                    <FieldInput
                      key={field.key}
                      field={field}
                      value={item[field.key]}
                      onChange={(v) =>
                        setItems(items.map((it, j) => (j === i ? setKey(it, field.key, v) : it)))
                      }
                      idBase={id}
                      activities={[]}
                    />
                  ))}
                  <p className="text-sm text-muted">
                    {t('questionId')} <code dir="ltr">{id}</code>
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-item-type" className="text-[0.9375rem] font-medium">
            {t('questionType')}
          </label>
          <select
            id="add-item-type"
            value={adding}
            onChange={(e) => setAdding(e.target.value as ItemType)}
            className={INPUT}
          >
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border-strong px-4 font-medium"
          onClick={() => {
            const item = newItem(adding, new Set(items.map(idOf)));
            setItems([...items, item]);
            setOpen((s) => new Set([...s, item.id as string]));
          }}
        >
          {t('addQuestion')}
        </button>
      </div>
    </div>
  );
}
