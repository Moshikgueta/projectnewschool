import { describe, expect, it } from 'vitest';
import { scoreAttempt, withAnswer, type AttemptState } from './attempt';
import { grade, type GradeInput } from './grade';
import {
  correctionEffect,
  regradeAttempt,
  regradeResponses,
  type GradableItem,
  type StoredResponse,
} from './regrade';

// Re-checking past answers after an answer key is corrected (ADR-041).

const options = [
  { id: 'o1', text: 'Me llamo Ana.' },
  { id: 'o2', text: 'Tengo diez años.' },
];
const mc = (right: string): GradableItem => ({
  type: 'multipleChoice',
  data: { options, multiple: false },
  key: { optionIds: [right] },
  points: 1,
  feedback: {},
});
const blanks = (accept: string[][]): GradableItem => ({
  type: 'fillBlank',
  data: { text: 'Me ___ Ana. ___, ¡hasta mañana!' },
  key: { blanks: accept.map((a) => ({ accept: a })), accents: 'lenient', caseSensitive: false },
  points: 2,
  feedback: {},
});

let n = 0;
function response(
  attemptId: string,
  answer: unknown,
  graded: { isCorrect: boolean | null; score: number },
  tryNo = 1,
  userId = `user-${attemptId}`,
): StoredResponse {
  n += 1;
  return {
    id: `r${String(n).padStart(3, '0')}`,
    attemptId,
    userId,
    answer,
    isCorrect: graded.isCorrect,
    score: graded.score,
    feedbackCode: graded.isCorrect ? 'correct' : 'incorrect',
    tryNo,
    createdAt: `2026-10-13T10:00:0${tryNo}Z`,
  };
}

/** What the live player stores: grade every try with `item`, as checkAnswer does. */
function played(item: GradableItem, attemptId: string, answers: unknown[]) {
  let state: AttemptState = { items: {} };
  const responses = answers.map((answer, i) => {
    const g = grade({ ...item, answer } as GradeInput);
    state = withAnswer(state, 'item', {
      status: g.correct === null ? 'saved' : g.correct ? 'correct' : 'incorrect',
      score: g.score,
      answer,
      accent: g.accentReminder,
    });
    return {
      ...response(attemptId, answer, { isCorrect: g.correct, score: g.score }, i + 1),
      feedbackCode: g.code,
    };
  });
  return { state, responses };
}

describe('regradeResponses', () => {
  it('turns a wrong answer right, and a right one wrong, when the key is corrected', () => {
    const wrongKey = mc('o2');
    const a = played(wrongKey, 'a', [{ optionIds: ['o1'] }]);
    const b = played(wrongKey, 'b', [{ optionIds: ['o2'] }]);
    const out = regradeResponses(mc('o1'), [...a.responses, ...b.responses]);
    expect(out.map((r) => [r.next.isCorrect, r.next.score, r.changed])).toEqual([
      [true, 1, true],
      [false, 0, true],
    ]);
  });

  it('changes nothing when graded again with the same key (idempotent)', () => {
    const key = mc('o1');
    const a = played(key, 'a', [{ optionIds: ['o2'] }, { optionIds: ['o1'] }]);
    expect(regradeResponses(key, a.responses).some((r) => r.changed)).toBe(false);
  });

  it('gives partial credit per blank, like the live grader', () => {
    const before = blanks([['llamo'], ['Adiós']]);
    const answer = { blanks: ['llamo', 'Chao'] };
    const [r] = played(before, 'a', [answer]).responses;
    expect(r!.score).toBe(1); // one blank of two
    const [after] = regradeResponses(blanks([['llamo'], ['Adiós', 'Chao']]), [r!]);
    expect(after!.next).toMatchObject({ isCorrect: true, score: 2 });
  });

  it('skips answers that are not readable for the item', () => {
    const r = response('a', { nonsense: true }, { isCorrect: false, score: 0 });
    expect(regradeResponses(mc('o1'), [r])).toEqual([]);
  });
});

describe('regradeAttempt', () => {
  const rows = (item: GradableItem, responses: StoredResponse[]) =>
    regradeResponses(item, responses).map((r) => ({ response: r, grade: r.next }));

  it('raises a finished attempt’s score when the first try becomes right', () => {
    const { state, responses } = played(mc('o2'), 'a', [{ optionIds: ['o1'] }]);
    const items = [
      { id: 'item', points: 1, graded: true },
      { id: 'other', points: 1, graded: true },
    ];
    const other = withAnswer(state, 'other', {
      status: 'correct',
      score: 1,
      answer: { value: true },
    });
    const { score, maxScore } = scoreAttempt(items, other);
    expect([score, maxScore]).toEqual([1, 2]);

    const next = regradeAttempt(
      { id: 'a', status: 'submitted', score, maxScore, state: other },
      'item',
      rows(mc('o1'), responses),
    );
    expect(next.changed).toBe(true);
    expect(next.score).toBe(2);
    expect(next.state.items.item).toMatchObject({ status: 'correct', firstScore: 1, tries: 1 });
    // The total is what scoring the corrected state from scratch gives.
    expect(scoreAttempt(items, next.state).score).toBe(next.score);
    expect(next.state.items.other).toEqual(other.items.other);
  });

  it('lowers it when a right first try becomes wrong', () => {
    const { state, responses } = played(mc('o1'), 'a', [{ optionIds: ['o1'] }]);
    const next = regradeAttempt(
      { id: 'a', status: 'submitted', score: 1, maxScore: 1, state },
      'item',
      rows(mc('o2'), responses),
    );
    expect(next.score).toBe(0);
    expect(next.state.items.item).toMatchObject({ status: 'incorrect', firstScore: 0 });
  });

  it('keeps the first try as what counts (practice: wrong, then right)', () => {
    // With the wrong key: o1 (wrong), then o2 (right). Corrected: o1 is right.
    const { state, responses } = played(mc('o2'), 'a', [
      { optionIds: ['o1'] },
      { optionIds: ['o2'] },
    ]);
    expect(state.items.item).toMatchObject({ status: 'correct', firstScore: 0, tries: 2 });
    const next = regradeAttempt(
      { id: 'a', status: 'submitted', score: 0, maxScore: 1, state },
      'item',
      rows(mc('o1'), responses),
    );
    expect(next.state.items.item).toMatchObject({ status: 'correct', firstScore: 1, tries: 2 });
    expect(next.score).toBe(1);
    // The student's own latest answer is kept for "resume".
    expect(next.state.items.item!.answer).toEqual({ optionIds: ['o2'] });
  });

  it('moves a partial multi-blank score by the difference only', () => {
    const before = blanks([['llamo'], ['Adiós']]);
    const { state, responses } = played(before, 'a', [{ blanks: ['llamo', 'Chao'] }]);
    const next = regradeAttempt(
      { id: 'a', status: 'submitted', score: 3, maxScore: 4, state },
      'item',
      rows(blanks([['llamo'], ['Adiós', 'Chao']]), responses),
    );
    expect(next.before).toBe(1);
    expect(next.after).toBe(2);
    expect(next.score).toBe(4);
  });

  it('leaves an open attempt’s score empty (it is scored when finished)', () => {
    const { state, responses } = played(mc('o2'), 'a', [{ optionIds: ['o1'] }]);
    const next = regradeAttempt(
      { id: 'a', status: 'in_progress', score: null, maxScore: null, state },
      'item',
      rows(mc('o1'), responses),
    );
    expect(next.score).toBeNull();
    expect(next.state.items.item!.status).toBe('correct');
  });

  it('is idempotent: re-checking a re-checked attempt changes nothing', () => {
    const { state, responses } = played(mc('o2'), 'a', [{ optionIds: ['o1'] }]);
    const corrected = mc('o1');
    const once = regradeAttempt(
      { id: 'a', status: 'submitted', score: 0, maxScore: 1, state },
      'item',
      rows(corrected, responses),
    );
    const stored = responses.map((r, i) => ({
      ...r,
      isCorrect: rows(corrected, responses)[i]!.grade.isCorrect,
      score: rows(corrected, responses)[i]!.grade.score,
      feedbackCode: rows(corrected, responses)[i]!.grade.feedbackCode,
    }));
    const twice = regradeAttempt(
      { id: 'a', status: 'submitted', score: once.score, maxScore: 1, state: once.state },
      'item',
      rows(corrected, stored),
    );
    expect(twice.changed).toBe(false);
    expect(twice.score).toBe(1);
  });
});

describe('correctionEffect', () => {
  it('counts answers that change, and the students whose result changes', () => {
    const wrongKey = mc('o2');
    const a = played(wrongKey, 'a', [{ optionIds: ['o1'] }]); // becomes right
    const b = played(wrongKey, 'b', [{ optionIds: ['o2'] }]); // becomes wrong
    const c = played(wrongKey, 'c', [{ optionIds: ['o1'] }, { optionIds: ['o2'] }]); // first try now right
    const effect = correctionEffect(wrongKey, mc('o1'), [
      ...a.responses,
      ...b.responses,
      ...c.responses,
    ]);
    expect(effect).toEqual({
      responses: 4,
      becameCorrect: 2,
      becameIncorrect: 2,
      partialChanged: 0,
      attempts: 3,
      students: 3,
    });
  });

  it('counts a partial change on items with several parts', () => {
    const before = blanks([['llamo'], ['Adiós']]);
    const { responses } = played(before, 'a', [{ blanks: ['lamo', 'Chao'] }]);
    const effect = correctionEffect(before, blanks([['llamo', 'lamo'], ['Adiós']]), responses);
    expect(effect).toMatchObject({ becameCorrect: 0, becameIncorrect: 0, partialChanged: 1 });
    expect(effect.attempts).toBe(1);
  });
});
