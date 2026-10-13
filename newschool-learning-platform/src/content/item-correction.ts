// Correcting the answer key of a question students have answered (ADR-041).
// What may change is the key only (and multiple choice's "several answers"
// flag, which follows it): the options, words, pairs and their ids stay, so
// every past answer still means what the student chose. The database checks
// the same (app.correct_answered_item).

import { z } from 'zod';
import { canonical, decompileItem, sameAnswers, type AuthoredItem } from './activities-file';
import { checkItem, itemSchemas, type ItemData, type ItemKey, type ItemType } from './items';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const accepted = z.string().trim().min(1).max(200);

/** The corrected answer, in terms of the stored item's ids. */
export const correctionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('multipleChoice'), optionIds: z.array(id).min(1).max(8) }),
  z.strictObject({ type: z.literal('trueFalse'), value: z.boolean() }),
  z.strictObject({
    type: z.literal('fillBlank'),
    blanks: z.array(z.array(accepted).min(1).max(10)).min(1).max(10),
    accents: z.enum(['strict', 'lenient']),
  }),
  z.strictObject({ type: z.literal('matching'), pairs: z.record(id, id) }),
  z.strictObject({
    type: z.literal('reorderSentence'),
    accept: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  }),
]);
export type Correction = z.infer<typeof correctionSchema>;

/** Question types whose answers can be corrected (the auto-graded ones). */
export const CORRECTABLE_TYPES = [
  'multipleChoice',
  'trueFalse',
  'fillBlank',
  'matching',
  'reorderSentence',
] as const satisfies readonly ItemType[];
export type CorrectableType = (typeof CORRECTABLE_TYPES)[number];

export function isCorrectable(type: string): type is CorrectableType {
  return (CORRECTABLE_TYPES as readonly string[]).includes(type);
}

export type StoredForCorrection = { type: string; data: unknown; key: unknown };

export type CorrectionProblem =
  | 'typeMismatch'
  | 'unreadable'
  | 'unchanged'
  | 'unknownOption'
  | 'blankCount'
  | 'pairs'
  | 'sameWords';

export type CorrectedItem = {
  type: CorrectableType;
  data: Record<string, unknown>;
  key: Record<string, unknown>;
};

const words = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .sort((a, b) => a.localeCompare(b))
    .join(' ');

/**
 * The stored item with a corrected key, or why the correction cannot be
 * made. Order checks (ADR-024) are not applied: the stored order of an
 * answered question cannot change.
 */
export function applyCorrection(
  stored: StoredForCorrection,
  correction: Correction,
): { ok: true; item: CorrectedItem } | { ok: false; problem: CorrectionProblem } {
  if (stored.type !== correction.type) return { ok: false, problem: 'typeMismatch' };
  const type = correction.type;
  const dataParsed = itemSchemas[type].data.safeParse(stored.data);
  const keyParsed = itemSchemas[type].key.safeParse(stored.key ?? undefined);
  if (!dataParsed.success || !keyParsed.success) return { ok: false, problem: 'unreadable' };
  const oldData = stored.data as Record<string, unknown>;
  let data: Record<string, unknown> = oldData;
  let key: Record<string, unknown>;

  switch (correction.type) {
    case 'multipleChoice': {
      const options = (dataParsed.data as ItemData<'multipleChoice'>).options.map((o) => o.id);
      const chosen = [...new Set(correction.optionIds)];
      if (chosen.some((o) => !options.includes(o))) return { ok: false, problem: 'unknownOption' };
      // Stored in display order, like the import does.
      key = { optionIds: options.filter((o) => chosen.includes(o)) };
      const multiple = chosen.length > 1;
      if (multiple !== Boolean(oldData.multiple)) data = { ...oldData, multiple };
      break;
    }
    case 'trueFalse':
      key = { value: correction.value };
      break;
    case 'fillBlank': {
      const text = (dataParsed.data as ItemData<'fillBlank'>).text;
      const count = (text.match(/_{3,}/g) ?? []).length;
      if (correction.blanks.length !== count) return { ok: false, problem: 'blankCount' };
      // Other grading options (case) stay as they were.
      key = {
        ...(stored.key as Record<string, unknown>),
        blanks: correction.blanks.map((accept) => ({ accept })),
        accents: correction.accents,
      };
      break;
    }
    case 'matching': {
      const d = dataParsed.data as ItemData<'matching'>;
      const left = d.left.map((o) => o.id);
      const right = new Set(d.right.map((o) => o.id));
      const pairs = correction.pairs;
      if (
        Object.keys(pairs).length !== left.length ||
        left.some((l) => !pairs[l] || !right.has(pairs[l]!))
      )
        return { ok: false, problem: 'pairs' };
      key = { pairs: Object.fromEntries(left.map((l) => [l, pairs[l]!])) };
      break;
    }
    case 'reorderSentence': {
      const tokens = words(
        (dataParsed.data as ItemData<'reorderSentence'>).tokens.map((t) => t.text).join(' '),
      );
      const accept = [...new Set(correction.accept.map((a) => a.trim().replace(/\s+/g, ' ')))];
      if (accept.some((a) => words(a) !== tokens)) return { ok: false, problem: 'sameWords' };
      key = { accept };
      break;
    }
  }

  // The same cross-checks as an import, except order (it cannot change).
  const problems = checkItem(type, data, key).filter((p) => !p.startsWith('data:'));
  if (problems.length) return { ok: false, problem: 'unreadable' };
  if (canonical(key) === canonical(stored.key) && canonical(data) === canonical(stored.data))
    return { ok: false, problem: 'unchanged' };
  return { ok: true, item: { type, data, key } };
}

/** The correction a stored item's current key amounts to (the form's starting values). */
export function currentAnswer(stored: StoredForCorrection): Correction | null {
  if (!isCorrectable(stored.type)) return null;
  const key = itemSchemas[stored.type].key.safeParse(stored.key ?? undefined);
  if (!key.success) return null;
  switch (stored.type) {
    case 'multipleChoice':
      return {
        type: 'multipleChoice',
        optionIds: (key.data as ItemKey<'multipleChoice'>).optionIds,
      };
    case 'trueFalse':
      return { type: 'trueFalse', value: (key.data as ItemKey<'trueFalse'>).value };
    case 'fillBlank': {
      const k = key.data as ItemKey<'fillBlank'>;
      return { type: 'fillBlank', blanks: k.blanks.map((b) => b.accept), accents: k.accents };
    }
    case 'matching':
      return { type: 'matching', pairs: (key.data as ItemKey<'matching'>).pairs };
    case 'reorderSentence':
      return { type: 'reorderSentence', accept: (key.data as ItemKey<'reorderSentence'>).accept };
  }
}

/**
 * The corrected question in the authored form, for the editor's saved
 * source: the author's own version (wording, option order, feedback) with the
 * corrected answers. Falls back to the stored question read back when the two
 * cannot be lined up (e.g. two options with the same text).
 */
export function correctedSource(
  source: AuthoredItem | null,
  stored: { slug: string; prompt: unknown; points: number; feedback: unknown },
  corrected: CorrectedItem,
): AuthoredItem | null {
  const fromStored = decompileItem({
    slug: stored.slug,
    type: corrected.type,
    prompt: stored.prompt,
    data: corrected.data,
    points: stored.points,
    key: corrected.key,
    feedback: stored.feedback,
  });
  if (!fromStored) return null;
  if (!source || source.type !== corrected.type || source.id !== stored.slug) return fromStored;

  let merged: AuthoredItem = source;
  if (source.type === 'multipleChoice' && fromStored.type === 'multipleChoice') {
    const right = new Set(fromStored.options.filter((o) => o.correct).map((o) => o.text));
    merged = {
      ...source,
      options: source.options.map((o) => ({ ...o, correct: right.has(o.text) })),
    };
  } else if (source.type === 'trueFalse' && fromStored.type === 'trueFalse') {
    merged = { ...source, answer: fromStored.answer };
  } else if (source.type === 'fillBlank' && fromStored.type === 'fillBlank') {
    merged = { ...source, blanks: fromStored.blanks, accents: fromStored.accents };
  } else if (source.type === 'matching' && fromStored.type === 'matching') {
    const rightOf = new Map(fromStored.pairs.map(([l, r]) => [l, r]));
    merged = {
      ...source,
      pairs: source.pairs.map(([l, r]) => [l, rightOf.get(l) ?? r] as [string, string]),
    };
  } else if (source.type === 'reorderSentence' && fromStored.type === 'reorderSentence') {
    merged = {
      ...source,
      sentence: fromStored.sentence,
      alsoAccept: fromStored.alsoAccept,
    };
  }
  return sameAnswers(merged, fromStored) ? merged : fromStored;
}
