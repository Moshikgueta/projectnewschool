import { describe, expect, it } from 'vitest';
import {
  activityPlaceholder,
  authoredItemSchema,
  authoredActivitySchema,
  checkActivity,
  compileItem,
  feedbackForStored,
  sameAnswers,
  type AuthoredItem,
} from './activities-file';
import { cycleFileSchema } from './files';

const activity = (items: unknown[]) =>
  authoredActivitySchema.parse({ slug: 'ex', title: 'Ex', items });

describe('authored exercises', () => {
  it('compile multiple choice into public options, a key and per-option feedback', () => {
    const a = activity([
      {
        id: 'q',
        type: 'multipleChoice',
        prompt: 'Sam is a great cook. ___ father is too.',
        options: [
          { text: 'His', correct: true },
          { text: 'Her', feedback: 'Sam is a boy.' },
        ],
      },
    ]);
    const item = compileItem(a.slug, a.items[0]!);
    const options = item.data.options as { id: string; text: string }[];
    expect(options.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(options.map((o) => o.text).sort()).toEqual(['Her', 'His']);
    const his = options.find((o) => o.text === 'His')!.id;
    const her = options.find((o) => o.text === 'Her')!.id;
    expect(item.key).toEqual({ optionIds: [his] });
    expect(item.feedback).toEqual({ [her]: 'Sam is a boy.' });
    expect(JSON.stringify(item.data)).not.toContain('correct');
  });

  it('store matches and sentence words shuffled, never in answer order', () => {
    const a = activity([
      {
        id: 'm',
        type: 'matching',
        prompt: 'Match',
        pairs: [
          ['I', 'my'],
          ['he', 'his'],
          ['she', 'her'],
        ],
      },
      { id: 'r', type: 'reorderSentence', prompt: 'Order', sentence: 'My brother is Tom.' },
    ]);
    const matching = compileItem(a.slug, a.items[0]!);
    const right = matching.data.right as { id: string; text: string }[];
    // Ids follow display order, so neither order nor ids pair up with the left column.
    expect(right.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(right.map((r) => r.text)).not.toEqual(['my', 'his', 'her']);
    const pairs = (matching.key as { pairs: Record<string, string> }).pairs;
    const textOf = (id: string) => right.find((r) => r.id === id)!.text;
    expect([textOf(pairs.l1!), textOf(pairs.l2!), textOf(pairs.l3!)]).toEqual(['my', 'his', 'her']);
    expect(pairs).not.toEqual({ l1: 'r1', l2: 'r2', l3: 'r3' });

    const reorder = compileItem(a.slug, a.items[1]!);
    const tokens = reorder.data.tokens as { id: string; text: string }[];
    expect(tokens.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(tokens.map((t) => t.text).join(' ')).not.toBe('My brother is Tom.');
    expect(reorder.key).toEqual({ accept: ['My brother is Tom.'] });
    expect(checkActivity(a)).toEqual([]);
  });

  it('report blanks without answers and questions without a right option', () => {
    const a = activity([
      { id: 'f', type: 'fillBlank', prompt: 'Fill', text: 'My ___ is ___.', blanks: [['name']] },
      { id: 'q', type: 'multipleChoice', prompt: 'Pick', options: [{ text: 'a' }, { text: 'b' }] },
    ]);
    expect(checkActivity(a)).toEqual([
      'items.0: key: 1 answers for 2 blanks',
      'items.1: key.optionIds: Too small: expected array to have >=1 items',
      'items.1: mark at least one option as correct',
    ]);
  });

  it('resolve activity blocks by slug, and reject unknown slugs', () => {
    const cycle = (ref: string) => ({
      course: 'en-1',
      slug: 'family',
      title: 'Family',
      position: 1,
      sections: [
        {
          slug: 'practice',
          book: 'workbook',
          title: 'Practice',
          phase: 'after_class',
          blocks: [{ id: 'ex', type: 'activity', activity: ref }],
        },
      ],
      activities: [
        {
          slug: 'poss',
          title: 'Possessives',
          items: [{ id: 't', type: 'trueFalse', prompt: 'x', answer: true }],
        },
      ],
    });
    const ok = cycleFileSchema.safeParse(cycle('poss'));
    expect(ok.success).toBe(true);
    expect(ok.data?.sections[0]?.blocks[0]).toMatchObject({
      activityId: activityPlaceholder('poss'),
    });
    const bad = cycleFileSchema.safeParse(cycle('nope'));
    expect(bad.error?.issues[0]?.path).toEqual(['sections', 0, 'blocks', 0]);
  });
});

describe('decompiling stored items', () => {
  it('gives back an item that compiles to exactly what is stored, for every type', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseDocument } = await import('yaml');
    const { canonical, decompileItem } = await import('./activities-file');
    const raw = parseDocument(
      readFileSync('content/en-foundations-1/02-family.yaml', 'utf8'),
    ).toJS() as {
      activities: unknown[];
    };
    const activities = raw.activities.map((a) => authoredActivitySchema.parse(a));
    let types = new Set<string>();
    for (const activity of activities) {
      for (const item of activity.items) {
        const stored = compileItem(activity.slug, item);
        const back = decompileItem({ ...stored, key: stored.key, feedback: stored.feedback });
        expect(back, `${activity.slug}/${item.id}`).not.toBeNull();
        // Stored again from the decompiled form: the same prompt and the same right
        // answers. Shuffled types get new option ids (which is why the editor never
        // rewrites an unchanged item), so for those the answers are compared by text.
        const again = compileItem(activity.slug, back!);
        expect(canonical(again.prompt), item.id).toBe(canonical(stored.prompt));
        expect(canonical(rightAnswers(again)), item.id).toBe(canonical(rightAnswers(stored)));
        types = new Set([...types, item.type]);
      }
    }
    expect(types.size).toBeGreaterThanOrEqual(4);
  });

  it('compares values the way jsonb stores them (key order does not matter)', async () => {
    const { canonical } = await import('./activities-file');
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

/** The right answers of a compiled item, by text (independent of option ids). */
function rightAnswers(item: ReturnType<typeof compileItem>): unknown {
  const data = item.data as Record<string, { id: string; text: string }[]>;
  const key = (item.key ?? {}) as Record<string, unknown>;
  switch (item.type) {
    case 'multipleChoice':
      return data
        .options!.filter((o) => (key.optionIds as string[]).includes(o.id))
        .map((o) => o.text)
        .sort();
    case 'matching': {
      const right = new Map(data.right!.map((r) => [r.id, r.text]));
      return data.left!.map((l) => [
        l.text,
        right.get((key.pairs as Record<string, string>)[l.id]!),
      ]);
    }
    case 'reorderSentence':
      return [key.accept, data.tokens!.map((t) => t.text).sort()];
    default:
      return [item.data, item.key];
  }
}

describe('answered items', () => {
  type Mc = Extract<AuthoredItem, { type: 'multipleChoice' }>;
  const mc = authoredItemSchema.parse({
    id: 'q',
    type: 'multipleChoice',
    prompt: 'Dos más tres son…',
    options: [{ text: 'seis' }, { text: 'cinco', correct: true }, { text: 'cuatro' }],
  }) as Mc;

  it('count as the same when only wording, order, points or feedback change', () => {
    const reworded = {
      ...mc,
      prompt: '¿Cuánto es dos más tres?',
      points: 2,
      feedback: { correct: '¡Muy bien!' },
      options: [...mc.options].reverse(),
    };
    expect(sameAnswers(mc, reworded)).toBe(true);
  });

  it('count as different when an option or the right answer changes', () => {
    const otherOption = {
      ...mc,
      options: mc.options.map((o, i) => (i === 0 ? { ...o, text: 'siete' } : o)),
    };
    const otherAnswer = {
      ...mc,
      options: mc.options.map((o) => ({ ...o, correct: o.text === 'seis' })),
    };
    expect(sameAnswers(mc, otherOption)).toBe(false);
    expect(sameAnswers(mc, otherAnswer)).toBe(false);
    expect(sameAnswers(mc, { ...mc, type: 'trueFalse', answer: true } as never)).toBe(false);
  });

  it('keep option feedback on the stored option ids, matched by text', () => {
    const withFeedback = {
      ...mc,
      feedback: { incorrect: 'Cuenta otra vez.' },
      options: mc.options.map((o) => (o.text === 'seis' ? { ...o, feedback: 'Uno de más.' } : o)),
    };
    const stored = {
      options: [
        { id: 'o1', text: 'cuatro' },
        { id: 'o2', text: 'seis' },
        { id: 'o3', text: 'cinco' },
      ],
    };
    expect(feedbackForStored(withFeedback, stored)).toEqual({
      incorrect: 'Cuenta otra vez.',
      o2: 'Uno de más.',
    });
  });
});
