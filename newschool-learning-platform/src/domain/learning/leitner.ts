// Spaced review of vocabulary with Leitner boxes (docs/CONTENT-MODEL.md §4).
// Each word sits in a box 1–5. "Knew it" moves it up one box and waits
// longer before showing it again; "Not yet" sends it back to box 1, to come
// back in a few minutes. Self-rated and ungraded: the goal is learning.

export const MAX_BOX = 5;
/** Days to wait after a word reaches each box (index 0 = box 1). */
export const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14] as const;
/** A word you did not know comes back within the same session. */
export const RETRY_MINUTES = 10;
/** Cards per session, so a session stays short. */
export const SESSION_SIZE = 20;

const MINUTE = 60_000;
const DAY = 86_400_000;

export type ReviewState = {
  box: number;
  dueAt: Date;
  correctStreak: number;
  lapses: number;
};

export function review(previous: ReviewState | null, knew: boolean, now: Date): ReviewState {
  const box = previous?.box ?? 1;
  if (!knew) {
    return {
      box: 1,
      dueAt: new Date(now.getTime() + RETRY_MINUTES * MINUTE),
      correctStreak: 0,
      lapses: (previous?.lapses ?? 0) + (previous ? 1 : 0),
    };
  }
  // A new word known at first sight still starts low: one success is not mastery.
  const next = previous ? Math.min(MAX_BOX, box + 1) : 2;
  return {
    box: next,
    dueAt: new Date(now.getTime() + BOX_INTERVAL_DAYS[next - 1]! * DAY),
    correctStreak: (previous?.correctStreak ?? 0) + 1,
    lapses: previous?.lapses ?? 0,
  };
}

/**
 * The cards for one session: words that are due (most overdue first), then
 * words never seen (in course order), up to SESSION_SIZE.
 */
export function sessionCards<T extends { id: string; position: number }>(
  words: readonly T[],
  states: ReadonlyMap<string, { dueAt: Date }>,
  now: Date,
  size = SESSION_SIZE,
): T[] {
  const due = words
    .filter((w) => {
      const s = states.get(w.id);
      return s && s.dueAt.getTime() <= now.getTime();
    })
    .sort((a, b) => states.get(a.id)!.dueAt.getTime() - states.get(b.id)!.dueAt.getTime());
  const fresh = words.filter((w) => !states.has(w.id)).sort((a, b) => a.position - b.position);
  return [...due, ...fresh].slice(0, size);
}

/** When the next word becomes due, if none is due now. */
export function nextDue(states: Iterable<{ dueAt: Date }>, now: Date): Date | null {
  let next: Date | null = null;
  for (const s of states) {
    if (s.dueAt.getTime() > now.getTime() && (!next || s.dueAt < next)) next = s.dueAt;
  }
  return next;
}
