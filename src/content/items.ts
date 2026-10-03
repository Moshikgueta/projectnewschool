// Exercise item schemas (docs/CONTENT-MODEL.md §4). Every item type has three
// shapes, kept strictly apart:
//
//   data    what the student's browser receives (options, tokens, the text)
//   key     the correct answer and grading options: server only (ADR-006)
//   answer  what the browser sends back to be checked
//
// `data` must never reveal the key: tokens and the right-hand column of a
// matching item are stored shuffled (see `shuffledFor`), and the content
// tooling refuses data that still matches the key's order.

import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const text = z.string().trim().min(1).max(500);
const option = z.object({ id, text });

/** Inline-format feedback, keyed by option id, "correct" or "incorrect". */
export const feedbackSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  z.string().min(1).max(1000),
);
export type Feedback = z.infer<typeof feedbackSchema>;

const uniqueIds = (list: { id: string }[]) => new Set(list.map((o) => o.id)).size === list.length;

export const itemSchemas = {
  multipleChoice: {
    data: z.object({
      options: z.array(option).min(2).max(8).refine(uniqueIds, 'Option ids must be unique'),
      /** More than one option may be correct; the student is told so. */
      multiple: z.boolean().default(false),
    }),
    key: z.object({ optionIds: z.array(id).min(1).max(8) }),
    answer: z.object({ optionIds: z.array(id).max(8) }),
  },
  trueFalse: {
    data: z.object({}),
    key: z.object({ value: z.boolean() }),
    answer: z.object({ value: z.boolean() }),
  },
  fillBlank: {
    data: z.object({
      /** Inline text; every run of 3+ underscores is one blank. */
      text: z.string().min(1).max(2000),
      wordBank: z.array(text).max(30).optional(),
    }),
    key: z.object({
      blanks: z
        .array(z.object({ accept: z.array(z.string().trim().min(1).max(200)).min(1).max(10) }))
        .min(1)
        .max(10),
      /** lenient: a missing or wrong accent still counts, with a reminder. */
      accents: z.enum(['strict', 'lenient']).default('lenient'),
      caseSensitive: z.boolean().default(false),
    }),
    answer: z.object({ blanks: z.array(z.string().max(200)).max(10) }),
  },
  matching: {
    data: z.object({
      left: z.array(option).min(2).max(8).refine(uniqueIds, 'Ids must be unique'),
      right: z.array(option).min(2).max(10).refine(uniqueIds, 'Ids must be unique'),
    }),
    key: z.object({ pairs: z.record(id, id) }),
    answer: z.object({ pairs: z.record(id, id) }),
  },
  reorderSentence: {
    data: z.object({
      tokens: z.array(option).min(2).max(20).refine(uniqueIds, 'Ids must be unique'),
    }),
    /** Accepted sentences; the student's tokens are joined with spaces and compared. */
    key: z.object({ accept: z.array(z.string().trim().min(1).max(500)).min(1).max(5) }),
    answer: z.object({ tokenIds: z.array(id).max(20) }),
  },
  shortAnswer: {
    data: z.object({ maxLength: z.number().int().min(1).max(2000).default(500) }),
    key: z.object({}).optional(),
    answer: z.object({ text: z.string().max(2000) }),
  },
  reflection: {
    data: z.object({ maxLength: z.number().int().min(1).max(2000).default(1000) }),
    key: z.object({}).optional(),
    answer: z.object({ text: z.string().max(2000) }),
  },
} as const;

export type ItemType = keyof typeof itemSchemas;
export const ITEM_TYPES = Object.keys(itemSchemas) as ItemType[];

export type ItemData<T extends ItemType> = z.infer<(typeof itemSchemas)[T]['data']>;
export type ItemKey<T extends ItemType> = z.infer<(typeof itemSchemas)[T]['key']>;
export type ItemAnswer<T extends ItemType> = z.infer<(typeof itemSchemas)[T]['answer']>;

/** Item types the server grades; the others are saved for the teacher. */
export function isAutoGraded(type: ItemType): boolean {
  return type !== 'shortAnswer' && type !== 'reflection';
}

/** A public item as the player needs it, validated. Null if malformed. */
export type PublicItem = {
  [T in ItemType]: { id: string; type: T; data: ItemData<T>; points: number };
}[ItemType];

export function parsePublicItem(raw: {
  id: string;
  type: string;
  data: unknown;
  points: number;
}): PublicItem | null {
  if (!(raw.type in itemSchemas)) return null;
  const type = raw.type as ItemType;
  const data = itemSchemas[type].data.safeParse(raw.data);
  return data.success
    ? ({ id: raw.id, type, data: data.data, points: raw.points } as PublicItem)
    : null;
}

export function parseAnswer<T extends ItemType>(type: T, raw: unknown): ItemAnswer<T> | null {
  const parsed = itemSchemas[type].answer.safeParse(raw);
  return parsed.success ? (parsed.data as ItemAnswer<T>) : null;
}

export function parseKey<T extends ItemType>(type: T, raw: unknown): ItemKey<T> | null {
  const parsed = itemSchemas[type].key.safeParse(raw ?? undefined);
  return parsed.success ? (parsed.data as ItemKey<T>) : null;
}

/**
 * Cross-checks between an item's data and key, used when content is imported:
 * the key may only refer to ids in the data, and the data must not give the
 * answer away by its order.
 */
export function checkItem(type: ItemType, data: unknown, key: unknown): string[] {
  const d = itemSchemas[type].data.safeParse(data);
  const k = itemSchemas[type].key.safeParse(key);
  const problems: string[] = [];
  if (!d.success)
    problems.push(...d.error.issues.map((i) => `data.${i.path.join('.')}: ${i.message}`));
  if (!k.success)
    problems.push(...k.error.issues.map((i) => `key.${i.path.join('.')}: ${i.message}`));
  if (!d.success || !k.success) return problems;

  if (type === 'multipleChoice') {
    const data = d.data as ItemData<'multipleChoice'>;
    const key = k.data as ItemKey<'multipleChoice'>;
    const ids = new Set(data.options.map((o) => o.id));
    for (const o of key.optionIds) if (!ids.has(o)) problems.push(`key: unknown option "${o}"`);
    if (!data.multiple && key.optionIds.length > 1)
      problems.push('key: several correct options but multiple is false');
  }
  if (type === 'fillBlank') {
    const data = d.data as ItemData<'fillBlank'>;
    const key = k.data as ItemKey<'fillBlank'>;
    const blanks = (data.text.match(/_{3,}/g) ?? []).length;
    if (blanks !== key.blanks.length)
      problems.push(`key: ${key.blanks.length} answers for ${blanks} blanks`);
  }
  if (type === 'matching') {
    const data = d.data as ItemData<'matching'>;
    const key = k.data as ItemKey<'matching'>;
    const left = data.left.map((o) => o.id);
    const right = new Set(data.right.map((o) => o.id));
    for (const l of left) if (!key.pairs[l]) problems.push(`key: no match for "${l}"`);
    for (const r of Object.values(key.pairs))
      if (!right.has(r)) problems.push(`key: unknown right item "${r}"`);
    if (left.every((l, i) => key.pairs[l] === data.right[i]?.id))
      problems.push('data: the right column is in answer order; shuffle it');
    else if (left.every((l) => key.pairs[l]?.slice(1) === l.slice(1)))
      problems.push('data: the ids pair up (l1–r1…); number the right column in display order');
  }
  if (type === 'reorderSentence') {
    const data = d.data as ItemData<'reorderSentence'>;
    const key = k.data as ItemKey<'reorderSentence'>;
    const inOrder = data.tokens.map((t) => t.text).join(' ');
    const byId = [...data.tokens]
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
      .map((t) => t.text)
      .join(' ');
    if (key.accept.some((a) => a === inOrder))
      problems.push('data: the tokens are in answer order; shuffle them');
    else if (key.accept.some((a) => a === byId))
      problems.push('data: the token ids follow the answer order; number them in display order');
  }
  return problems;
}

/**
 * Deterministic shuffle (seeded by a string), so an item's stored order is
 * stable across imports but unrelated to the answer. Retries a few seeds if
 * the shuffle lands on the original order.
 */
export function shuffledFor<T>(
  seed: string,
  list: readonly T[],
  isOriginal: (out: T[]) => boolean,
): T[] {
  for (let attempt = 0; attempt < 8; attempt++) {
    let h = 2166136261;
    for (const ch of `${seed}#${attempt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      const j = h % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    if (!isOriginal(out)) return out;
  }
  return [...list].reverse();
}
