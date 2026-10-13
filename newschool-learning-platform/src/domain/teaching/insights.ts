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

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Questions with the highest first-try error rate in the group. Each student
 * counts once per question: their earliest first try (their first encounter),
 * so practising again does not hide what was hard. Ties: more students first,
 * then by question id; the most common wrong answer is the one most students
 * gave, then the one given first.
 *
 * The group page reads this from the database (view
 * public.group_item_first_tries, which applies the same rule to every answer,
 * not to the 1,000 rows a request returns); this is the reference the tests
 * compare the view with.
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
      const counts = new Map<
        string,
        { answer: unknown; n: number; firstAt: string; key: string }
      >();
      for (const t of wrong) {
        const key = JSON.stringify(t.answer);
        const seen = counts.get(key);
        counts.set(key, {
          answer: t.answer,
          key,
          n: (seen?.n ?? 0) + 1,
          firstAt: seen && seen.firstAt < t.at ? seen.firstAt : t.at,
        });
      }
      const common = [...counts.values()].sort(
        (a, b) => b.n - a.n || byText(a.firstAt, b.firstAt) || byText(a.key, b.key),
      )[0];
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
    .sort((a, b) => b.rate - a.rate || b.students - a.students || byText(a.itemId, b.itemId))
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

/** Per student, counted by the database (view public.group_student_stats). */
export type StudentTotals = {
  /** First-try answers (every attempt) and how many were right. */
  answers: number;
  correct: number;
  lastActiveAt: string | null;
};

export function studentSummaries(
  students: readonly string[],
  data: {
    activeCycleActivityIds: ReadonlySet<string>;
    submitted: readonly { userId: string; activityId: string }[];
    totals: ReadonlyMap<string, StudentTotals>;
  },
): StudentSummary[] {
  return students.map((id) => {
    const done = new Set(
      data.submitted
        .filter((s) => s.userId === id && data.activeCycleActivityIds.has(s.activityId))
        .map((s) => s.activityId),
    );
    const totals = data.totals.get(id);
    const answers = totals?.answers ?? 0;
    return {
      id,
      lastActiveAt: totals?.lastActiveAt ?? null,
      cycleDone: done.size,
      cycleTotal: data.activeCycleActivityIds.size,
      accuracy: answers >= 3 ? (totals?.correct ?? 0) / answers : null,
      answers,
    };
  });
}
