// The form editor's description of each block type (Phase 8, ADR-035): which
// fields it has, in what order, and of what kind, so one form component can
// draw any block. The block schemas (schema.ts) stay the rules; a unit test
// keeps these descriptions in step with them.

import { inlineToPlainText } from './inline';
import type { BlockType } from './schema';

export type FieldSpec =
  /** One line of text. */
  (
    | { key: string; kind: 'line'; optional?: boolean }
    /** Formatted text (**bold**, *italic*, links, ____), several lines. */
    | { key: string; kind: 'text'; optional?: boolean }
    /** Plain text, several lines (copied as it is, e.g. a message for the AI tutor). */
    | { key: string; kind: 'plain' }
    | { key: string; kind: 'choice'; options: readonly (string | number)[] }
    | { key: string; kind: 'number'; min: number; max: number; optional: true }
    /** A checkbox; `initial` is its value in a new record (default: checked). */
    | { key: string; kind: 'boolean'; initial?: boolean }
    /** A language code (e.g. "es", "he"). */
    | { key: string; kind: 'lang'; optional: true }
    | { key: string; kind: 'url'; optional?: boolean }
    /** A list of short texts, one per line. */
    | { key: string; kind: 'lines'; optional?: boolean }
    /** One row of cells, separated by " | ". */
    | { key: string; kind: 'cells'; optional: true }
    /** Table rows: one row per line, cells separated by " | ". */
    | { key: string; kind: 'rows' }
    /** A list of small records (each with its own fields). */
    | { key: string; kind: 'list'; fields: FieldSpec[] }
    /** An optional record (e.g. a resource: label + link). */
    | { key: string; kind: 'group'; fields: FieldSpec[]; optional: true }
    /** An exercise of this course, by slug. */
    | { key: string; kind: 'activity' }
  ) & {
    /** The message key of the field's label (`cms.fields`), when not its key. */
    label?: string;
    /** The message key of a hint shown under the label (`cms.form`), where the kind has one. */
    hint?: string;
  };

export const BLOCK_FIELDS: Record<BlockType, FieldSpec[]> = {
  heading: [
    { key: 'level', kind: 'choice', options: [2, 3, 4] },
    { key: 'text', kind: 'line' },
  ],
  text: [{ key: 'text', kind: 'text' }],
  callout: [
    { key: 'tone', kind: 'choice', options: ['tip', 'culture', 'info', 'warning'] },
    { key: 'title', kind: 'line', optional: true },
    { key: 'text', kind: 'text' },
  ],
  examples: [
    {
      key: 'items',
      kind: 'list',
      fields: [
        { key: 'text', kind: 'text' },
        { key: 'gloss', kind: 'text', optional: true },
      ],
    },
  ],
  dialogue: [
    {
      key: 'lines',
      kind: 'list',
      fields: [
        { key: 'speaker', kind: 'line' },
        { key: 'text', kind: 'text' },
      ],
    },
  ],
  table: [
    { key: 'caption', kind: 'line', optional: true },
    { key: 'header', kind: 'cells', optional: true },
    { key: 'rows', kind: 'rows' },
  ],
  vocabulary: [
    { key: 'title', kind: 'line', optional: true },
    { key: 'glossLang', kind: 'lang', optional: true },
    {
      key: 'items',
      kind: 'list',
      fields: [
        { key: 'term', kind: 'line' },
        { key: 'gloss', kind: 'line' },
      ],
    },
    { key: 'link', kind: 'url', optional: true },
  ],
  cycleOverview: [
    {
      key: 'skills',
      kind: 'list',
      fields: [
        { key: 'name', kind: 'line' },
        { key: 'description', kind: 'text', optional: true },
      ],
    },
  ],
  sentenceFrame: [
    { key: 'prompt', kind: 'text', optional: true },
    { key: 'frame', kind: 'text' },
    { key: 'example', kind: 'text', optional: true },
    { key: 'answerable', kind: 'boolean' },
  ],
  discussionQuestions: [
    { key: 'title', kind: 'line', optional: true },
    {
      key: 'items',
      kind: 'list',
      fields: [
        { key: 'question', kind: 'text' },
        { key: 'frame', kind: 'text', optional: true },
      ],
    },
    { key: 'answerable', kind: 'boolean' },
  ],
  classActivity: [
    { key: 'title', kind: 'line' },
    { key: 'skills', kind: 'lines', optional: true },
    { key: 'minutes', kind: 'number', min: 1, max: 120, optional: true },
    { key: 'steps', kind: 'lines' },
    { key: 'example', kind: 'text', optional: true },
    { key: 'wordBank', kind: 'lines', optional: true },
    {
      key: 'resource',
      kind: 'group',
      optional: true,
      fields: [
        { key: 'label', kind: 'line' },
        { key: 'url', kind: 'url' },
      ],
    },
  ],
  wordBank: [{ key: 'words', kind: 'lines' }],
  ruleSummary: [
    { key: 'skill', kind: 'line' },
    {
      key: 'rules',
      kind: 'list',
      fields: [
        { key: 'text', kind: 'text' },
        { key: 'examples', kind: 'lines', optional: true },
      ],
    },
  ],
  aiTutorPrompt: [
    { key: 'title', kind: 'line', optional: true },
    { key: 'intro', kind: 'text', optional: true },
    { key: 'message', kind: 'plain' },
  ],
  externalLink: [
    { key: 'label', kind: 'line' },
    { key: 'url', kind: 'url' },
    { key: 'description', kind: 'text', optional: true },
  ],
  speakingPrompt: [
    { key: 'text', kind: 'text' },
    { key: 'minutes', kind: 'number', min: 1, max: 60, optional: true },
  ],
  reflection: [
    { key: 'prompt', kind: 'text' },
    { key: 'answerable', kind: 'boolean' },
  ],
  activity: [{ key: 'activity', kind: 'activity' }],
};

export const BLOCK_TYPES = Object.keys(BLOCK_FIELDS) as BlockType[];

/** A starting value for a field: empty where the author must write something. */
function initial(field: FieldSpec): unknown {
  if ('optional' in field && field.optional) return undefined;
  switch (field.kind) {
    case 'choice':
      return field.options[0];
    case 'boolean':
      return field.initial ?? true;
    case 'lines':
      return [];
    case 'rows':
      return [['']];
    case 'list':
      return [record(field.fields)];
    default:
      return '';
  }
}

export function record(fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = initial(f);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** A new block of a type, with an id not used on the page. */
export function newBlock(type: BlockType, usedIds: ReadonlySet<string>): Record<string, unknown> {
  const stem = type.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  let n = 1;
  while (usedIds.has(`${stem}-${n}`)) n++;
  return { id: `${stem}-${n}`, type, ...record(BLOCK_FIELDS[type]) };
}

const SUMMARY_KEYS = ['text', 'title', 'label', 'skill', 'frame', 'prompt', 'message', 'activity'];

/** A few words to recognise a block by in the list. */
export function blockSummary(block: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const v = block[key];
    if (typeof v === 'string' && v.trim()) return clip(inlineToPlainText(v));
  }
  for (const key of ['items', 'lines', 'skills', 'rules', 'words', 'rows'] as const) {
    const v = block[key];
    if (Array.isArray(v) && v.length) {
      const first = v[0];
      const text =
        typeof first === 'string'
          ? first
          : Array.isArray(first)
            ? first.join(' · ')
            : first && typeof first === 'object'
              ? Object.values(first).find((x) => typeof x === 'string')
              : '';
      if (typeof text === 'string' && text.trim()) return clip(inlineToPlainText(text));
    }
  }
  return '';
}

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
}
