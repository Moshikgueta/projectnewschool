// What a teacher sees about one group (docs/PLANNING-REPORT.md §11). Pure:
// the server loads the group's records with the teacher's own session (RLS
// limits them to students the teacher teaches) and these functions summarise.

/** A question needs first tries from at least this many students to be judged. */
export const MIN_STUDENTS = 3;
/** Show at most this many common difficulties. */
export const MAX_DIFFICULTIES = 5;
/** Only questions most students got wrong at first are worth flagging. */
export const DIFFICULTY_FROM = 0.5;

export type FirstTry = {
  userId: string;
  itemId: string;
  correct: boolean;
  answer: unknown;
  at: string;
};

export type Difficulty = {
  itemId: string;
  students: number;
  wrong: number;
  rate: number;
  /** The most frequent wrong first answer, as stored (the page describes it). */
  commonWrongAnswer: unknown | null;
  commonWrongCount: number;
};

/**
 * Questions with the highest first-try error rate in the group. Each student
 * counts once per question: their earliest first try (their first encounter),
 * so practising again does not hide what was hard.
 */
export function commonDifficulties(tries: readonly FirstTry[]): Difficulty[] {
  const first = new Map<string, FirstTry>();
  for (const t of tries) {
    const key = `${t.itemId}|${t.userId}`;
    const seen = first.get(key);
    if (!seen || t.at < seen.at) first.set(key, t);
  }
  const byItem = new Map<string, FirstTry[]>();
  for (const t of first.values()) byItem.set(t.itemId, [...(byItem.get(t.itemId) ?? []), t]);

  return [...byItem.entries()]
    .filter(([, list]) => list.length >= MIN_STUDENTS)
    .map(([itemId, list]) => {
      const wrong = list.filter((t) => !t.correct);
      const counts = new Map<string, { answer: unknown; n: number }>();
      for (const t of wrong) {
        const key = JSON.stringify(t.answer);
        counts.set(key, { answer: t.answer, n: (counts.get(key)?.n ?? 0) + 1 });
      }
      const common = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      return {
        itemId,
        students: list.length,
        wrong: wrong.length,
        rate: wrong.length / list.length,
        commonWrongAnswer: common && common.n > 1 ? common.answer : null,
        commonWrongCount: common && common.n > 1 ? common.n : 0,
      };
    })
    .filter((d) => d.rate >= DIFFICULTY_FROM)
    .sort((a, b) => b.rate - a.rate || b.students - a.students)
    .slice(0, MAX_DIFFICULTIES);
}

export type AssignmentProgress = { assignmentId: string; done: number; total: number };

/**
 * How many of an assignment's students have done it. Done = an activity
 * attempt submitted for this assignment or after it was given, or the
 * assigned section finished. Vocabulary assignments have no completion yet.
 */
export function assignmentProgress(
  assignments: readonly {
    id: string;
    createdAt: string;
    activityId: string | null;
    sectionId: string | null;
    recipients: readonly string[];
  }[],
  records: {
    submitted: readonly {
      userId: string;
      activityId: string;
      assignmentId: string | null;
      at: string;
    }[];
    finishedSections: readonly { userId: string; sectionId: string }[];
  },
): AssignmentProgress[] {
  return assignments.map((a) => {
    const done = a.recipients.filter((student) => {
      if (a.activityId) {
        return records.submitted.some(
          (s) =>
            s.userId === student &&
            s.activityId === a.activityId &&
            (s.assignmentId === a.id || s.at >= a.createdAt),
        );
      }
      if (a.sectionId) {
        return records.finishedSections.some(
          (f) => f.userId === student && f.sectionId === a.sectionId,
        );
      }
      return false;
    }).length;
    return { assignmentId: a.id, done, total: a.recipients.length };
  });
}

export type StudentSummary = {
  id: string;
  lastActiveAt: string | null;
  /** Activities of the active cycle(s) completed, out of all of them. */
  cycleDone: number;
  cycleTotal: number;
  /** First-try accuracy over all their answers; null with fewer than 3. */
  accuracy: number | null;
  answers: number;
};

export function studentSummaries(
  students: readonly string[],
  data: {
    activeCycleActivityIds: ReadonlySet<string>;
    submitted: readonly { userId: string; activityId: string }[];
    tries: readonly { userId: string; correct: boolean }[];
    events: readonly { userId: string; at: string }[];
  },
): StudentSummary[] {
  return students.map((id) => {
    const done = new Set(
      data.submitted
        .filter((s) => s.userId === id && data.activeCycleActivityIds.has(s.activityId))
        .map((s) => s.activityId),
    );
    const mine = data.tries.filter((t) => t.userId === id);
    const last = data.events
      .filter((e) => e.userId === id)
      .reduce<string | null>((max, e) => (!max || e.at > max ? e.at : max), null);
    return {
      id,
      lastActiveAt: last,
      cycleDone: done.size,
      cycleTotal: data.activeCycleActivityIds.size,
      accuracy: mine.length >= 3 ? mine.filter((t) => t.correct).length / mine.length : null,
      answers: mine.length,
    };
  });
}
