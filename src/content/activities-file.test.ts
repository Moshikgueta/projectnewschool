import { describe, expect, it } from 'vitest';
import {
  activityPlaceholder,
  authoredActivitySchema,
  checkActivity,
  compileItem,
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
