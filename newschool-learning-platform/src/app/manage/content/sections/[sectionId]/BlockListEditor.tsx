'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BLOCK_FIELDS, BLOCK_TYPES, blockSummary, newBlock } from '@/content/block-forms';
import type { EditorProblem } from '@/content/editor';
import type { BlockType } from '@/content/schema';
import { Badge } from '@/ui/Card';
import { FieldInput, setKey } from './FieldInput';

type Rec = Record<string, unknown>;
export type EditorDoc = { blocks: Rec[]; teacherNotes: Rec[] };

const SMALL_BUTTON =
  'min-h-11 min-w-11 rounded-md px-2 text-sm font-medium text-muted hover:bg-surface-secondary hover:text-fg disabled:opacity-40';
const INPUT = 'min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-fg';

/**
 * The page as a list of blocks, each opened into a form drawn from its type's
 * field description; plus the teacher notes. Problems found by the checks are
 * shown on the block they belong to.
 */
export function BlockListEditor({
  doc,
  onChange,
  problems,
  activities,
}: {
  doc: EditorDoc;
  onChange: (doc: EditorDoc) => void;
  problems: EditorProblem[];
  activities: { slug: string; title: string }[];
}) {
  const t = useTranslations('cms.form');
  const tt = useTranslations('cms.blockTypes');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<BlockType>('text');
  const blocks = doc.blocks;
  const setBlocks = (next: Rec[]) => onChange({ ...doc, blocks: next });
  const idOf = (b: Rec, i: number) => (typeof b.id === 'string' ? b.id : `block-${i}`);
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{t('formattingHint')}</span>
        {(
          [
            ['**', 'fmtBold'],
            ['*', 'fmtItalic'],
          ] as const
        ).map(([mark, key]) => (
          <span key={key}>
            <code dir="ltr" className="rounded bg-surface-secondary px-1">
              {mark}
              {t(key)}
              {mark}
            </code>
          </span>
        ))}
        <code dir="ltr" className="rounded bg-surface-secondary px-1">
          [{t('fmtLink')}](https://…)
        </code>
        <span>
          <code dir="ltr" className="rounded bg-surface-secondary px-1">
            ____
          </code>{' '}
          {t('fmtBlank')}
        </span>
      </p>
      {blocks.length === 0 ? <p className="text-fg-secondary">{t('emptyPage')}</p> : null}
      <ol className="flex flex-col gap-3">
        {blocks.map((block, i) => {
          const id = idOf(block, i);
          const type = block.type as BlockType;
          const fields = BLOCK_FIELDS[type] ?? [];
          const own = problems.filter((p) => p.path.startsWith(`blocks[${i}]`));
          const isOpen = open.has(id);
          const name = tt(type in BLOCK_FIELDS ? type : 'unknown');
          return (
            <li key={id} className="rounded-lg border border-border bg-surface">
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
                  <Badge tone="brand">{name}</Badge>
                  <span className="truncate text-[0.9375rem]" dir="auto">
                    {blockSummary(block) || t('empty')}
                  </span>
                  {own.length ? (
                    <Badge tone="error">{t('problemCount', { count: own.length })}</Badge>
                  ) : null}
                  <span className="sr-only">{t('blockNumber', { n: i + 1 })}</span>
                </button>
                <span className="flex">
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === 0}
                    aria-label={t('moveUp', { n: i + 1 })}
                    onClick={() => {
                      const next = [...blocks];
                      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                      setBlocks(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={i === blocks.length - 1}
                    aria-label={t('moveDown', { n: i + 1 })}
                    onClick={() => {
                      const next = [...blocks];
                      [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                      setBlocks(next);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    aria-label={t('duplicateLabel', { n: i + 1 })}
                    onClick={() => {
                      const used = new Set(blocks.map(idOf));
                      const copy = { ...structuredClone(block), id: newBlock(type, used).id };
                      setBlocks([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
                    }}
                  >
                    {t('duplicate')}
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    aria-label={t('removeLabel', { n: i + 1 })}
                    onClick={() => {
                      // Notes anchored here move to the top of the page.
                      onChange({
                        blocks: blocks.filter((_, j) => j !== i),
                        teacherNotes: doc.teacherNotes.map((n) =>
                          n.anchor === id ? { ...n, anchor: null } : n,
                        ),
                      });
                    }}
                  >
                    {t('remove')}
                  </button>
                </span>
              </div>
              {isOpen ? (
                <div id={`${id}-form`} className="flex flex-col gap-4 border-t border-border p-4">
                  {own.length ? (
                    <ul className="list-disc rounded-md bg-error-light p-3 ps-8 text-sm text-error-ink">
                      {own.map((p, k) => (
                        <li key={k}>
                          <code dir="ltr">
                            {p.path.slice(`blocks[${i}]`.length).replace(/^\./, '') || type}
                          </code>
                          : <bdi>{p.message}</bdi>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {fields.map((field) => (
                    <FieldInput
                      key={field.key}
                      field={field}
                      value={block[field.key]}
                      onChange={(v) =>
                        setBlocks(blocks.map((b, j) => (j === i ? setKey(b, field.key, v) : b)))
                      }
                      idBase={id}
                      activities={activities}
                    />
                  ))}
                  {type !== 'activity' ? (
                    <FieldInput
                      field={{ key: 'lang', kind: 'lang', optional: true }}
                      value={block.lang}
                      onChange={(v) =>
                        setBlocks(blocks.map((b, j) => (j === i ? setKey(b, 'lang', v) : b)))
                      }
                      idBase={id}
                      activities={activities}
                    />
                  ) : null}
                  <p className="text-sm text-muted">
                    {t('blockId')} <code dir="ltr">{id}</code>
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-block-type" className="text-[0.9375rem] font-medium">
            {t('blockType')}
          </label>
          <select
            id="add-block-type"
            value={adding}
            onChange={(e) => setAdding(e.target.value as BlockType)}
            className={INPUT}
          >
            {BLOCK_TYPES.map((type) => (
              <option key={type} value={type}>
                {tt(type)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border-strong px-4 font-medium"
          onClick={() => {
            const block = newBlock(adding, new Set(blocks.map(idOf)));
            setBlocks([...blocks, block]);
            setOpen((s) => new Set([...s, block.id as string]));
          }}
        >
          {t('addBlock')}
        </button>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">{t('notes')}</legend>
        <p className="text-sm text-muted">{t('notesHint')}</p>
        {doc.teacherNotes.map((note, i) => {
          const setNote = (key: string, v: unknown) =>
            onChange({
              ...doc,
              teacherNotes: doc.teacherNotes.map((n, j) => (j === i ? setKey(n, key, v) : n)),
            });
          const own = problems.filter((p) => p.path.startsWith(`teacherNotes[${i}]`));
          return (
            <div
              key={typeof note.id === 'string' ? note.id : i}
              className="flex flex-col gap-3 rounded-md border border-border p-3"
            >
              {own.length ? (
                <p className="rounded-md bg-error-light p-2 text-sm text-error-ink">
                  {own.map((p) => p.message).join(' ')}
                </p>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`note-${i}-anchor`} className="text-[0.9375rem] font-medium">
                  {t('anchor')}
                </label>
                <select
                  id={`note-${i}-anchor`}
                  value={typeof note.anchor === 'string' ? note.anchor : ''}
                  onChange={(e) =>
                    onChange({
                      ...doc,
                      teacherNotes: doc.teacherNotes.map((n, j) =>
                        j === i ? { ...n, anchor: e.target.value || null } : n,
                      ),
                    })
                  }
                  className={INPUT}
                >
                  <option value="">{t('anchorTop')}</option>
                  {blocks.map((b, k) => (
                    <option key={idOf(b, k)} value={idOf(b, k)}>
                      {k + 1}.{' '}
                      {tt(
                        (b.type as BlockType) in BLOCK_FIELDS ? (b.type as BlockType) : 'unknown',
                      )}
                      {blockSummary(b) ? ` · ${blockSummary(b)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <FieldInput
                field={{ key: 'text', kind: 'text' }}
                value={note.text}
                onChange={(v) => setNote('text', v)}
                idBase={`note-${i}`}
                activities={activities}
              />
              <FieldInput
                field={{ key: 'minutes', kind: 'number', min: 1, max: 120, optional: true }}
                value={note.minutes}
                onChange={(v) => setNote('minutes', v)}
                idBase={`note-${i}`}
                activities={activities}
              />
              <button
                type="button"
                className={`${SMALL_BUTTON} self-start`}
                aria-label={t('removeNote', { n: i + 1 })}
                onClick={() =>
                  onChange({ ...doc, teacherNotes: doc.teacherNotes.filter((_, j) => j !== i) })
                }
              >
                {t('remove')}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="min-h-11 self-start rounded-md border border-border-strong px-3 text-sm font-medium"
          onClick={() => {
            const used = new Set([
              ...blocks.map(idOf),
              ...doc.teacherNotes.map((n) => String(n.id)),
            ]);
            let n = 1;
            while (used.has(`note-${n}`)) n++;
            onChange({
              ...doc,
              teacherNotes: [...doc.teacherNotes, { id: `note-${n}`, anchor: null, text: '' }],
            });
          }}
        >
          {t('addNote')}
        </button>
      </fieldset>
    </div>
  );
}
