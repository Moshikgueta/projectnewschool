import { describe, expect, it } from 'vitest';
import { answerSlots, blockSchema, parseBlocksForRender, sectionDocumentSchema } from './schema';

describe('block schemas', () => {
  it('accept the notebook patterns found in the content audit', () => {
    const doc = [
      {
        id: 'overview',
        type: 'cycleOverview',
        skills: [{ name: 'Possessives' }, { name: 'Dates and numbers' }],
      },
      {
        id: 'intro',
        type: 'sentenceFrame',
        prompt: 'Introduce yourself.',
        frame: 'I am ____. I spend ____ time with my family.',
      },
      {
        id: 'warmup',
        type: 'discussionQuestions',
        items: [{ question: 'Who do you live with?', frame: 'I live with my ____.' }],
      },
      {
        id: 'act1',
        type: 'classActivity',
        title: 'Before and after',
        skills: ['Dates'],
        minutes: 20,
        steps: ['Say a family birthday.', 'Compare with a classmate.'],
      },
      {
        id: 'rules',
        type: 'ruleSummary',
        skill: 'Possessives',
        rules: [{ text: 'The possessive comes first: **my** mother.' }],
      },
      { id: 'mori', type: 'aiTutorPrompt', message: 'Hi Mori! Ask me about my family.' },
      {
        id: 'vocab',
        type: 'vocabulary',
        glossLang: 'he',
        items: [{ term: 'mother', gloss: 'אמא' }],
        link: 'https://quizlet.com/x',
      },
    ];
    expect(sectionDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('reject links outside the allow-list', () => {
    const res = blockSchema.safeParse({
      id: 'l',
      type: 'externalLink',
      label: 'x',
      url: 'https://evil.example/',
    });
    expect(res.success).toBe(false);
  });

  it('reject duplicate block ids and malformed ids', () => {
    expect(
      sectionDocumentSchema.safeParse([
        { id: 'a', type: 'text', text: 'one' },
        { id: 'a', type: 'text', text: 'two' },
      ]).success,
    ).toBe(false);
    expect(blockSchema.safeParse({ id: 'bad id!', type: 'text', text: 'x' }).success).toBe(false);
  });

  it('keep valid blocks and replace broken ones when rendering', () => {
    const out = parseBlocksForRender([
      { id: 'ok', type: 'text', text: 'Fine' },
      { id: 'broken', type: 'text' },
      { id: 'unknown', type: 'marquee', text: 'no' },
    ]);
    expect(out[0]?.type).toBe('text');
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(parseBlocksForRender('not a list')).toEqual([]);
  });

  it('count answer inputs only where students may answer', () => {
    const frame = blockSchema.parse({ id: 'f', type: 'sentenceFrame', frame: 'I am ____.' });
    const off = blockSchema.parse({
      id: 'g',
      type: 'sentenceFrame',
      frame: 'x',
      answerable: false,
    });
    const qs = blockSchema.parse({
      id: 'q',
      type: 'discussionQuestions',
      items: [{ question: 'a' }, { question: 'b' }],
    });
    const text = blockSchema.parse({ id: 't', type: 'text', text: 'x' });
    expect([answerSlots(frame), answerSlots(off), answerSlots(qs), answerSlots(text)]).toEqual([
      1, 0, 2, 0,
    ]);
  });
});
