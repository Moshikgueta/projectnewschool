import { describe, expect, it } from 'vitest';
import { checkItem, parseAnswer, parsePublicItem, shuffledFor } from './items';

describe('exercise items', () => {
  it('parse public data and reject malformed items', () => {
    expect(parsePublicItem({ id: 'x', type: 'trueFalse', data: {}, points: 1 })).toMatchObject({
      type: 'trueFalse',
    });
    expect(parsePublicItem({ id: 'x', type: 'flashcards', data: {}, points: 1 })).toBeNull();
    expect(
      parsePublicItem({ id: 'x', type: 'multipleChoice', data: { options: [] }, points: 1 }),
    ).toBeNull();
  });

  it('validate answers by shape only', () => {
    expect(parseAnswer('trueFalse', { value: true })).toEqual({ value: true });
    expect(parseAnswer('trueFalse', { value: 'yes' })).toBeNull();
    expect(parseAnswer('fillBlank', { blanks: ['a'.repeat(201)] })).toBeNull();
  });

  it('cross-check data and key', () => {
    expect(
      checkItem(
        'multipleChoice',
        {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        { optionIds: ['c'] },
      ),
    ).toEqual(['key: unknown option "c"']);
    expect(checkItem('fillBlank', { text: 'Me ___ Ana.' }, { blanks: [] })).toContain(
      'key.blanks: Too small: expected array to have >=1 items',
    );
    expect(
      checkItem('fillBlank', { text: 'Me ___ Ana ___.' }, { blanks: [{ accept: ['llamo'] }] }),
    ).toEqual(['key: 1 answers for 2 blanks']);
  });

  it('refuse data that gives the answer away by its order', () => {
    const tokens = [
      { id: 't1', text: 'Me' },
      { id: 't2', text: 'llamo' },
      { id: 't3', text: 'Ana.' },
    ];
    expect(checkItem('reorderSentence', { tokens }, { accept: ['Me llamo Ana.'] })).toEqual([
      'data: the tokens are in answer order; shuffle them',
    ]);
    const left = [
      { id: 'l1', text: 'hola' },
      { id: 'l2', text: 'adiós' },
    ];
    const right = [
      { id: 'r1', text: 'hello' },
      { id: 'r2', text: 'goodbye' },
    ];
    expect(checkItem('matching', { left, right }, { pairs: { l1: 'r1', l2: 'r2' } })).toEqual([
      'data: the right column is in answer order; shuffle it',
    ]);
    // Shuffled, but the ids still pair up: the answer leaks through the ids.
    expect(
      checkItem(
        'matching',
        { left, right: [right[1], right[0]] },
        { pairs: { l1: 'r1', l2: 'r2' } },
      ),
    ).toEqual(['data: the ids pair up (l1–r1…); number the right column in display order']);
    expect(
      checkItem(
        'reorderSentence',
        { tokens: [tokens[2], tokens[0], tokens[1]] },
        { accept: ['Me llamo Ana.'] },
      ),
    ).toEqual(['data: the token ids follow the answer order; number them in display order']);
  });

  it('shuffle deterministically and never back into the original order', () => {
    const list = ['a', 'b', 'c', 'd'];
    const same = (out: string[]) => out.join() === list.join();
    const one = shuffledFor('item-1', list, same);
    expect(one).toEqual(shuffledFor('item-1', list, same));
    expect(same(one)).toBe(false);
    expect([...one].sort()).toEqual(list);
    expect(same(shuffledFor('x', ['a', 'b'], (out) => out.join() === 'a,b'))).toBe(false);
  });
});
