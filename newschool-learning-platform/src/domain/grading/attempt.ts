// The player state stored on an attempt (attempts.state) and the score of a
// finished attempt. Written only by the server; never contains keys.

export type ItemStatus = 'correct' | 'incorrect' | 'saved';

export type ItemProgress = {
  status: ItemStatus;
  tries: number;
  /** The student's own latest answer, to restore it on resume. */
  answer: unknown;
  /** Score of the first try (what the attempt's score counts). */
  firstScore: number;
  accent?: boolean;
};

export type AttemptState = { items: Record<string, ItemProgress> };

export function readState(raw: unknown): AttemptState {
  if (
    raw &&
    typeof raw === 'object' &&
    'items' in raw &&
    raw.items &&
    typeof raw.items === 'object'
  ) {
    return { items: raw.items as Record<string, ItemProgress> };
  }
  return { items: {} };
}

/**
 * Record one checked answer. The first try decides the score, so trying again
 * in practice mode helps learning without inflating results.
 */
export function withAnswer(
  state: AttemptState,
  itemId: string,
  result: { status: ItemStatus; score: number; answer: unknown; accent?: boolean },
): AttemptState {
  const previous = state.items[itemId];
  return {
    items: {
      ...state.items,
      [itemId]: {
        status: previous?.status === 'correct' ? 'correct' : result.status,
        tries: (previous?.tries ?? 0) + 1,
        answer: result.answer,
        firstScore: previous ? previous.firstScore : result.score,
        ...(result.accent ? { accent: true } : {}),
      },
    },
  };
}

/** Score and maximum of a finished attempt; ungraded items count for neither. */
export function scoreAttempt(
  items: { id: string; points: number; graded: boolean }[],
  state: AttemptState,
): { score: number; maxScore: number; answered: number } {
  let score = 0;
  let maxScore = 0;
  let answered = 0;
  for (const item of items) {
    const progress = state.items[item.id];
    if (progress) answered += 1;
    if (!item.graded) continue;
    maxScore += item.points;
    score += progress?.firstScore ?? 0;
  }
  return { score: Math.round(score * 100) / 100, maxScore, answered };
}
