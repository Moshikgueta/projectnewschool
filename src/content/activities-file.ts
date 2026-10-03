// Exercises in content files. Authors write each item in a short form close
// to how a teacher thinks ("these options, this one is right"); `compileItem`
// turns it into the stored shape: public `data`, a server-only `key` and
// per-option `feedback` (src/content/items.ts). Stored order never reveals
// the answer: tokens and matches are shuffled deterministically by slug.

import { z } from 'zod';
import { checkItem, shuffledFor, type ItemType } from './items';
import { blockSchema, type Block } from './schema';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes');
const text = z.string().trim().min(1).max(500);
const lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

const common = {
  id: slug,
  /** The question: inline text, or content blocks for richer prompts. */
  prompt: z.union([z.string().min(1).max(2000), z.array(blockSchema).min(1).max(20)]),
  /** Language of a text prompt (defaults to the course language). */
  lang: lang.optional(),
  points: z.number().min(0).max(100).default(1),
  feedback: z
    .strictObject({
      correct: z.string().min(1).max(1000).optional(),
      incorrect: z.string().min(1).max(1000).optional(),
    })
    .default({}),
};

export const authoredItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...common,
    type: z.literal('multipleChoice'),
    options: z
      .array(
        z.strictObject({
          text,
          correct: z.boolean().default(false),
          feedback: z.string().min(1).max(1000).optional(),
        }),
      )
      .min(2)
      .max(8),
  }),
  z.strictObject({ ...common, type: z.literal('trueFalse'), answer: z.boolean() }),
  z.strictObject({
    ...common,
    type: z.literal('fillBlank'),
    /** Sentence with ___ for each blank. */
    text: z.string().min(1).max(2000),
    /** Accepted answers per blank, in order. */
    blanks: z
      .array(z.array(z.string().trim().min(1).max(200)).min(1).max(10))
      .min(1)
      .max(10),
    wordBank: z.array(text).max(30).optional(),
    accents: z.enum(['strict', 'lenient']).default('lenient'),
  }),
  z.strictObject({
    ...common,
    type: z.literal('matching'),
    pairs: z
      .array(z.tuple([text, text]))
      .min(2)
      .max(8),
  }),
  z.strictObject({
    ...common,
    type: z.literal('reorderSentence'),
    /** The correct sentence; words are split on spaces. */
    sentence: z.string().trim().min(3).max(500),
    /** Other word orders that are also correct. */
    alsoAccept: z.array(z.string().trim().min(1).max(500)).max(4).default([]),
  }),
  z.strictObject({
    ...common,
    type: z.literal('shortAnswer'),
    maxLength: z.number().int().min(1).max(2000).default(500),
  }),
  z.strictObject({
    ...common,
    type: z.literal('reflection'),
    maxLength: z.number().int().min(1).max(2000).default(1000),
  }),
]);
export type AuthoredItem = z.infer<typeof authoredItemSchema>;

export const authoredActivitySchema = z.strictObject({
  slug,
  title: z.string().min(1).max(200),
  phase: z
    .enum(['before_class', 'during_class', 'after_class', 'review', 'optional'])
    .default('after_class'),
  scoring: z.enum(['none', 'practice', 'scored']).default('practice'),
  minutes: z.number().int().min(1).max(240).optional(),
  instructions: z.array(blockSchema).max(20).default([]),
  items: z.array(authoredItemSchema).min(1).max(60),
});
export type AuthoredActivity = z.infer<typeof authoredActivitySchema>;

export type CompiledItem = {
  slug: string;
  type: ItemType;
  prompt: Block[];
  points: number;
  data: Record<string, unknown>;
  key: Record<string, unknown> | null;
  feedback: Record<string, string>;
};

export function compileItem(activitySlug: string, item: AuthoredItem): CompiledItem {
  const seed = `${activitySlug}/${item.id}`;
  const prompt: Block[] =
    typeof item.prompt === 'string'
      ? [
          {
            id: 'prompt',
            type: 'text',
            text: item.prompt,
            ...(item.lang ? { lang: item.lang } : {}),
          },
        ]
      : item.prompt;
  const feedback: Record<string, string> = { ...item.feedback };
  const base = { slug: item.id, type: item.type, prompt, points: item.points, feedback };

  switch (item.type) {
    case 'multipleChoice': {
      // Shuffled once, then numbered in display order: neither the position
      // nor the id of an option says which one is right.
      const order = shuffledFor(seed, item.options, () => false);
      const options = order.map((o, i) => ({ id: `o${i + 1}`, text: o.text }));
      order.forEach((o, i) => {
        if (o.feedback) feedback[`o${i + 1}`] = o.feedback;
      });
      const correct = options.filter((_, i) => order[i]!.correct).map((o) => o.id);
      return {
        ...base,
        data: { options, multiple: correct.length > 1 },
        key: { optionIds: correct },
      };
    }
    case 'trueFalse':
      return { ...base, data: {}, key: { value: item.answer } };
    case 'fillBlank':
      return {
        ...base,
        data: { text: item.text, ...(item.wordBank ? { wordBank: item.wordBank } : {}) },
        key: { blanks: item.blanks.map((accept) => ({ accept })), accents: item.accents },
      };
    case 'matching': {
      const left = item.pairs.map(([l], i) => ({ id: `l${i + 1}`, text: l }));
      const order = shuffledFor(
        seed,
        item.pairs.map(([, r], i) => ({ pair: i, text: r })),
        (out) => out.every((r, i) => r.pair === i),
      );
      const right = order.map((r, i) => ({ id: `r${i + 1}`, text: r.text }));
      return {
        ...base,
        data: { left, right },
        key: {
          pairs: Object.fromEntries(
            left.map((l, i) => [l.id, right[order.findIndex((r) => r.pair === i)]!.id]),
          ),
        },
      };
    }
    case 'reorderSentence': {
      const words = item.sentence.split(/\s+/);
      const order = shuffledFor(seed, words, (out) => out.join(' ') === item.sentence);
      return {
        ...base,
        data: { tokens: order.map((text, i) => ({ id: `t${i + 1}`, text })) },
        key: { accept: [item.sentence, ...item.alsoAccept] },
      };
    }
    case 'shortAnswer':
    case 'reflection':
      return { ...base, data: { maxLength: item.maxLength }, key: null };
  }
}

/** Compile and cross-check every item; returns problems as "items.N: message". */
export function checkActivity(activity: AuthoredActivity): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  activity.items.forEach((item, i) => {
    if (seen.has(item.id)) problems.push(`items.${i}.id: Duplicate item id "${item.id}"`);
    seen.add(item.id);
    const compiled = compileItem(activity.slug, item);
    if (compiled.key) {
      for (const p of checkItem(compiled.type, compiled.data, compiled.key))
        problems.push(`items.${i}: ${p}`);
    }
    if (item.type === 'multipleChoice' && !item.options.some((o) => o.correct)) {
      problems.push(`items.${i}: mark at least one option as correct`);
    }
  });
  return problems;
}

/**
 * Sections refer to exercises of the same file by slug
 * (`{ type: activity, activity: family-possessives }`). Until the import
 * knows the real id, the block carries a stable placeholder id.
 */
export function activityPlaceholder(activitySlug: string): string {
  let h = 2166136261n;
  for (const ch of activitySlug) h = ((h ^ BigInt(ch.charCodeAt(0))) * 16777619n) & 0xffffffffffffn;
  return `00000000-0000-4000-8000-${h.toString(16).padStart(12, '0')}`;
}
