// Re-checking past answers after an answer key is corrected (ADR-041). Pure:
// the same grader as live answers (`grade`) and the same attempt rules
// (`withAnswer`: every try is recorded, the first try decides the score), so a
// re-checked attempt is exactly what it would have been with the right key.
// Idempotent: re-checking again with the same key changes nothing.

import {
  parseAnswer,
  type Feedback,
  type ItemData,
  type ItemKey,
  type ItemType,
} from '@/content/items';
import { readState, withAnswer, type AttemptState, type ItemProgress } from './attempt';
import { grade, type GradeInput } from './grade';

/** An item as the grader needs it: its type, public data, key, points and feedback. */
export type GradableItem = {
  [T in ItemType]: {
    type: T;
    data: ItemData<T>;
    key: ItemKey<T>;
    points: number;
    feedback: Feedback;
  };
}[ItemType];

export type StoredResponse = {
  id: string;
  attemptId: string;
  userId: string;
  answer: unknown;
  isCorrect: boolean | null;
  score: number | null;
  feedbackCode: string | null;
  tryNo: number;
  createdAt: string;
};

export type ResponseGrade = { isCorrect: boolean | null; score: number; feedbackCode: string };

/** One answer graded against an item, or null if the stored answer is not readable as one. */
export function gradeStoredAnswer(item: GradableItem, answer: unknown): ResponseGrade | null {
  const parsed = parseAnswer(item.type, answer);
  if (!parsed) return null;
  const result = grade({ ...item, answer: parsed } as GradeInput);
  return { isCorrect: result.correct, score: result.score, feedbackCode: result.code };
}

export type RegradedResponse = StoredResponse & { next: ResponseGrade; changed: boolean };

/** Every response graded again; `changed` when what is stored differs from the new grade. */
export function regradeResponses(
  item: GradableItem,
  responses: StoredResponse[],
): RegradedResponse[] {
  return responses.flatMap((r) => {
    const next = gradeStoredAnswer(item, r.answer);
    if (!next) return [];
    const changed =
      r.isCorrect !== next.isCorrect ||
      Number(r.score ?? 0) !== next.score ||
      (r.feedbackCode ?? null) !== next.feedbackCode;
    return [{ ...r, next, changed }];
  });
}

const byTry = (a: StoredResponse, b: StoredResponse) =>
  a.tryNo - b.tryNo || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * An item's progress in an attempt, rebuilt from its (re-graded) tries in
 * order, the way the player recorded them in the first place.
 */
export function rebuildItemProgress(
  itemId: string,
  tries: { response: StoredResponse; grade: ResponseGrade }[],
): ItemProgress | undefined {
  let state: AttemptState = { items: {} };
  for (const { response, grade: g } of [...tries].sort((a, b) => byTry(a.response, b.response))) {
    state = withAnswer(state, itemId, {
      status: g.isCorrect === null ? 'saved' : g.isCorrect ? 'correct' : 'incorrect',
      score: g.score,
      answer: response.answer,
      accent: g.feedbackCode === 'correct:accent' || g.feedbackCode === 'accent',
    });
  }
  return state.items[itemId];
}

export type AttemptRow = {
  id: string;
  status: 'in_progress' | 'submitted';
  score: number | null;
  maxScore: number | null;
  state: unknown;
};

export type RegradedAttempt = {
  id: string;
  state: AttemptState;
  score: number | null;
  /** The item's first-try score before and after. */
  before: number;
  after: number;
  changed: boolean;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Same JSON value, whatever the order of object keys. The state comes back
 * from the database's jsonb with its keys in jsonb's own order, so comparing
 * JSON.stringify output would see every stored attempt as changed.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameJson(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = (r: Record<string, unknown>) => Object.keys(r).filter((k) => r[k] !== undefined);
  const ka = keys(ra);
  return ka.length === keys(rb).length && ka.every((k) => sameJson(ra[k], rb[k]));
}

/**
 * An attempt with one item's progress rebuilt from its re-graded tries. A
 * finished attempt's score moves by the change in that item's first-try
 * score (the maximum does not change: the item and its points are the same).
 */
export function regradeAttempt(
  attempt: AttemptRow,
  itemId: string,
  tries: { response: StoredResponse; grade: ResponseGrade }[],
): RegradedAttempt {
  const state = readState(attempt.state);
  const previous = state.items[itemId];
  const rebuilt = rebuildItemProgress(itemId, tries);
  const before = previous?.firstScore ?? 0;
  const after = rebuilt?.firstScore ?? before;
  const items = { ...state.items };
  if (rebuilt) {
    // The student's own latest answer stays what they last typed.
    items[itemId] = previous ? { ...rebuilt, answer: previous.answer } : rebuilt;
  }
  const next: AttemptState = { items };
  const score =
    attempt.status === 'submitted' && attempt.score !== null
      ? round(Math.max(0, Number(attempt.score) - before + after))
      : attempt.score;
  const changed = score !== attempt.score || !sameJson(previous ?? null, items[itemId] ?? null);
  return { id: attempt.id, state: next, score, before, after, changed };
}

export type CorrectionEffect = {
  /** Answers (every try) checked again. */
  responses: number;
  becameCorrect: number;
  becameIncorrect: number;
  /** Answers with several parts whose partial score moved without changing right/wrong. */
  partialChanged: number;
  /** Attempts whose result for this question changes (first try). */
  attempts: number;
  /** Students with at least one such attempt. */
  students: number;
};

/**
 * What a correction does to past answers: every answer graded with the old
 * key and with the new one. Used for the preview before confirming and for
 * the record afterwards; the same whatever has already been re-checked, so a
 * retried correction reports the same numbers.
 */
export function correctionEffect(
  before: GradableItem,
  after: GradableItem,
  responses: StoredResponse[],
): CorrectionEffect {
  const effect: CorrectionEffect = {
    responses: 0,
    becameCorrect: 0,
    becameIncorrect: 0,
    partialChanged: 0,
    attempts: 0,
    students: 0,
  };
  const firstTries = new Map<
    string,
    { response: StoredResponse; was: ResponseGrade; now: ResponseGrade }
  >();
  for (const r of responses) {
    const was = gradeStoredAnswer(before, r.answer);
    const now = gradeStoredAnswer(after, r.answer);
    if (!was || !now) continue;
    effect.responses += 1;
    if (was.isCorrect === false && now.isCorrect === true) effect.becameCorrect += 1;
    else if (was.isCorrect === true && now.isCorrect === false) effect.becameIncorrect += 1;
    else if (was.score !== now.score) effect.partialChanged += 1;
    const first = firstTries.get(r.attemptId);
    if (!first || byTry(r, first.response) < 0)
      firstTries.set(r.attemptId, { response: r, was, now });
  }
  const students = new Set<string>();
  for (const { response, was, now } of firstTries.values()) {
    if (was.score !== now.score || was.isCorrect !== now.isCorrect) {
      effect.attempts += 1;
      students.add(response.userId);
    }
  }
  effect.students = students.size;
  return effect;
}
