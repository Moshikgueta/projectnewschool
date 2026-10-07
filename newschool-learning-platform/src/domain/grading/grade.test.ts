import { describe, expect, it } from 'vitest';
import { grade } from './grade';
import { matchText, normalizeAnswer } from './normalize';

describe('normalizeAnswer', () => {
  it('ignores spacing, capitals, opening ¿ ¡ and final punctuation', () => {
    expect(normalizeAnswer('  ¿Cómo   te LLAMAS? ')).toBe('cómo te llamas');
    expect(normalizeAnswer('¡Hola!')).toBe('hola');
  });

  it('treats curly and straight apostrophes alike, and joined tokens before punctuation', () => {
    expect(normalizeAnswer('Mother’s')).toBe(normalizeAnswer("mother's"));
    expect(normalizeAnswer('Me llamo Ana .')).toBe('me llamo ana');
    expect(normalizeAnswer('Sí , gracias')).toBe('sí, gracias');
  });

  it('ignores Hebrew niqqud and Arabic harakat', () => {
    expect(normalizeAnswer('שָׁלוֹם')).toBe('שלום');
    expect(normalizeAnswer('مَرْحَبًا')).toBe('مرحبا');
  });

  it('keeps accents unless asked to strip them', () => {
    expect(normalizeAnswer('Adiós')).toBe('adiós');
    expect(normalizeAnswer('Adiós', { stripAccents: true })).toBe('adios');
    expect(normalizeAnswer('niño', { stripAccents: true })).toBe('nino');
  });
});

describe('matchText', () => {
  it('distinguishes exact, accent-only and wrong answers', () => {
    expect(matchText('adiós', ['Adiós'])).toBe('exact');
    expect(matchText('adios', ['Adiós'])).toBe('accent');
    expect(matchText('hola', ['Adiós'])).toBe('wrong');
    expect(matchText('   ', ['Adiós'])).toBe('wrong');
  });

  it('accepts any listed alternative', () => {
    expect(matchText("it's", ['it is', "it's"])).toBe('exact');
  });
});

const fb = { o2: 'That answers how old you are.', correct: '¡Muy bien!' };

describe('grade', () => {
  it('multiple choice: exact set, with feedback for the wrong choice', () => {
    const base = {
      type: 'multipleChoice' as const,
      data: {
        options: [
          { id: 'o1', text: 'a' },
          { id: 'o2', text: 'b' },
        ],
        multiple: false,
      },
      key: { optionIds: ['o1'] },
      points: 1,
      feedback: fb,
    };
    expect(grade({ ...base, answer: { optionIds: ['o1'] } })).toMatchObject({
      correct: true,
      score: 1,
      feedback: ['¡Muy bien!'],
    });
    expect(grade({ ...base, answer: { optionIds: ['o2'] } })).toMatchObject({
      correct: false,
      score: 0,
      code: 'chose:o2',
      feedback: ['That answers how old you are.'],
    });
    expect(grade({ ...base, answer: { optionIds: ['o1', 'o2'] } }).correct).toBe(false);
    expect(grade({ ...base, answer: { optionIds: [] } }).correct).toBe(false);
  });

  it('true/false', () => {
    const base = {
      type: 'trueFalse' as const,
      data: {},
      key: { value: true },
      points: 2,
      feedback: {},
    };
    expect(grade({ ...base, answer: { value: true } }).score).toBe(2);
    expect(grade({ ...base, answer: { value: false } }).correct).toBe(false);
  });

  it('fill in the blank: per-blank parts, partial credit, accent policy', () => {
    const base = {
      type: 'fillBlank' as const,
      data: { text: 'Me ___ Ana. ___, amigos.' },
      key: {
        blanks: [{ accept: ['llamo'] }, { accept: ['Adiós', 'Chao'] }],
        accents: 'lenient' as const,
        caseSensitive: false,
      },
      points: 2,
      feedback: {},
    };
    expect(grade({ ...base, answer: { blanks: ['llamo', 'adiós'] } })).toMatchObject({
      correct: true,
      score: 2,
      accentReminder: false,
    });
    expect(grade({ ...base, answer: { blanks: ['llamo', 'adios'] } })).toMatchObject({
      correct: true,
      accentReminder: true,
      code: 'correct:accent',
    });
    expect(grade({ ...base, answer: { blanks: ['llamas', 'chao'] } })).toMatchObject({
      correct: false,
      score: 1,
      parts: [false, true],
    });
    const strict = { ...base, key: { ...base.key, accents: 'strict' as const } };
    expect(grade({ ...strict, answer: { blanks: ['llamo', 'adios'] } })).toMatchObject({
      correct: false,
      accentReminder: true,
      code: 'accent',
    });
    expect(grade({ ...base, answer: { blanks: ['llamo'] } }).correct).toBe(false);
  });

  it('matching: every pair must match; partial credit per pair', () => {
    const base = {
      type: 'matching' as const,
      data: {
        left: [
          { id: 'l1', text: 'hola' },
          { id: 'l2', text: 'adiós' },
        ],
        right: [
          { id: 'r2', text: 'goodbye' },
          { id: 'r1', text: 'hello' },
        ],
      },
      key: { pairs: { l1: 'r1', l2: 'r2' } },
      points: 1,
      feedback: {},
    };
    expect(grade({ ...base, answer: { pairs: { l1: 'r1', l2: 'r2' } } }).correct).toBe(true);
    expect(grade({ ...base, answer: { pairs: { l1: 'r2', l2: 'r2' } } })).toMatchObject({
      correct: false,
      score: 0.5,
      parts: [false, true],
    });
  });

  it('reorder sentence: all tokens, once each, in an accepted order', () => {
    const base = {
      type: 'reorderSentence' as const,
      data: {
        tokens: [
          { id: 't3', text: 'Ana.' },
          { id: 't1', text: 'Me' },
          { id: 't2', text: 'llamo' },
        ],
      },
      key: { accept: ['Me llamo Ana.'] },
      points: 1,
      feedback: {},
    };
    expect(grade({ ...base, answer: { tokenIds: ['t1', 't2', 't3'] } }).correct).toBe(true);
    expect(grade({ ...base, answer: { tokenIds: ['t2', 't1', 't3'] } }).code).toBe('order');
    expect(grade({ ...base, answer: { tokenIds: ['t1', 't2'] } }).code).toBe('incomplete');
    expect(grade({ ...base, answer: { tokenIds: ['t1', 't1', 't2'] } }).correct).toBe(false);
  });

  it('short answers are saved, not graded', () => {
    expect(
      grade({
        type: 'shortAnswer',
        data: { maxLength: 500 },
        key: undefined,
        answer: { text: 'Hola profe' },
        points: 1,
        feedback: {},
      }),
    ).toMatchObject({ correct: null, score: 0, code: 'saved' });
  });
});
