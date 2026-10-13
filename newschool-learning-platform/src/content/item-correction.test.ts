import { describe, expect, it } from 'vitest';
import { compileItem, decompileItem, sameAnswers, type AuthoredItem } from './activities-file';
import { applyCorrection, correctedSource, currentAnswer } from './item-correction';

// Correcting an answered question's key (ADR-041): only the key changes, the
// ids students answered with stay, and the authored source follows.

const mcSource: AuthoredItem = {
  id: 'nombre',
  type: 'multipleChoice',
  prompt: '¿Cómo te llamas?',
  points: 1,
  feedback: {},
  options: [
    { text: 'Me llamo Ana.', correct: false, feedback: 'Not this one.' },
    { text: 'Tengo diez años.', correct: true },
    { text: 'Soy de Haifa.', correct: false },
  ],
};

function stored(item: AuthoredItem) {
  const c = compileItem('saludos', item);
  return { ...c, key: c.key, data: c.data };
}

describe('applyCorrection', () => {
  it('changes a multiple-choice key and keeps the options and their ids', () => {
    const s = stored(mcSource);
    const ana = (s.data.options as { id: string; text: string }[]).find(
      (o) => o.text === 'Me llamo Ana.',
    )!;
    const result = applyCorrection(s, { type: 'multipleChoice', optionIds: [ana.id] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.item.data).toEqual(s.data);
    expect(result.item.key).toEqual({ optionIds: [ana.id] });
  });

  it('marks several right options as "multiple", and nothing else in the data', () => {
    const s = stored(mcSource);
    const ids = (s.data.options as { id: string }[]).map((o) => o.id).slice(0, 2);
    const result = applyCorrection(s, { type: 'multipleChoice', optionIds: ids });
    if (!result.ok) throw new Error(result.problem);
    expect(result.item.data).toEqual({ ...s.data, multiple: true });
  });

  it('refuses unknown options, an unchanged key and another type', () => {
    const s = stored(mcSource);
    expect(applyCorrection(s, { type: 'multipleChoice', optionIds: ['o9'] })).toEqual({
      ok: false,
      problem: 'unknownOption',
    });
    expect(applyCorrection(s, currentAnswer(s)!)).toEqual({ ok: false, problem: 'unchanged' });
    expect(applyCorrection(s, { type: 'trueFalse', value: true })).toEqual({
      ok: false,
      problem: 'typeMismatch',
    });
  });

  it('needs answers for every blank, and keeps the other grading options', () => {
    const s = {
      type: 'fillBlank',
      data: { text: 'Me ___ Ana. ___, ¡hasta mañana!' },
      key: {
        blanks: [{ accept: ['llamo'] }, { accept: ['Adiós'] }],
        accents: 'lenient',
        caseSensitive: true,
      },
    };
    expect(
      applyCorrection(s, { type: 'fillBlank', blanks: [['llamo']], accents: 'lenient' }),
    ).toEqual({
      ok: false,
      problem: 'blankCount',
    });
    const result = applyCorrection(s, {
      type: 'fillBlank',
      blanks: [['llamo'], ['Adiós', 'Chao']],
      accents: 'strict',
    });
    if (!result.ok) throw new Error(result.problem);
    expect(result.item.key).toEqual({
      blanks: [{ accept: ['llamo'] }, { accept: ['Adiós', 'Chao'] }],
      accents: 'strict',
      caseSensitive: true,
    });
  });

  it('needs a match for every left item, among the right items', () => {
    const s = {
      type: 'matching',
      data: {
        left: [
          { id: 'l1', text: 'hola' },
          { id: 'l2', text: 'adiós' },
        ],
        right: [
          { id: 'r1', text: 'goodbye' },
          { id: 'r2', text: 'hello' },
        ],
      },
      key: { pairs: { l1: 'r1', l2: 'r2' } },
    };
    expect(applyCorrection(s, { type: 'matching', pairs: { l1: 'r2' } })).toEqual({
      ok: false,
      problem: 'pairs',
    });
    const result = applyCorrection(s, { type: 'matching', pairs: { l1: 'r2', l2: 'r1' } });
    expect(result).toMatchObject({ ok: true, item: { key: { pairs: { l1: 'r2', l2: 'r1' } } } });
  });

  it('accepts only sentences made of the question’s words', () => {
    const s = {
      type: 'reorderSentence',
      data: {
        tokens: [
          { id: 't1', text: 'Ana.' },
          { id: 't2', text: 'llamo' },
          { id: 't3', text: 'Me' },
        ],
      },
      key: { accept: ['Ana. Me llamo'] },
    };
    expect(applyCorrection(s, { type: 'reorderSentence', accept: ['Me llamo Juan.'] })).toEqual({
      ok: false,
      problem: 'sameWords',
    });
    expect(
      applyCorrection(s, { type: 'reorderSentence', accept: ['Me  llamo Ana.'] }),
    ).toMatchObject({ ok: true, item: { key: { accept: ['Me llamo Ana.'] } } });
  });
});

describe('correctedSource', () => {
  it('keeps the author’s wording, order and feedback, with the corrected answer', () => {
    const s = stored(mcSource);
    const ana = (s.data.options as { id: string; text: string }[]).find(
      (o) => o.text === 'Me llamo Ana.',
    )!;
    const result = applyCorrection(s, { type: 'multipleChoice', optionIds: [ana.id] });
    if (!result.ok) throw new Error(result.problem);
    const source = correctedSource(
      mcSource,
      { slug: 'nombre', prompt: s.prompt, points: 1, feedback: s.feedback },
      result.item,
    );
    expect(source).toEqual({
      ...mcSource,
      options: [
        { text: 'Me llamo Ana.', correct: true, feedback: 'Not this one.' },
        { text: 'Tengo diez años.', correct: false },
        { text: 'Soy de Haifa.', correct: false },
      ],
    });
    // The editor then sees the stored item and the source agree (no "changed" refusal).
    const back = decompileItem({
      ...s,
      data: result.item.data,
      key: result.item.key,
    });
    expect(sameAnswers(back!, source!)).toBe(true);
  });

  it('falls back to the stored question when there is no authored source', () => {
    const s = stored(mcSource);
    const result = applyCorrection(s, {
      type: 'multipleChoice',
      optionIds: [(s.data.options as { id: string }[])[0]!.id],
    });
    if (!result.ok) throw new Error(result.problem);
    const source = correctedSource(
      null,
      { slug: 'nombre', prompt: s.prompt, points: 1, feedback: s.feedback },
      result.item,
    );
    expect(source?.type).toBe('multipleChoice');
    expect(source?.id).toBe('nombre');
  });
});
