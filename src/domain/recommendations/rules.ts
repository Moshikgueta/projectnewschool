// Recommendation engine, version 0 (ADR-010). Pure rules over a snapshot of
// the learner; the dashboard asks for a ranked, de-duplicated short list.
// Phase 6 adds the remaining rules (low accuracy, vocabulary due, inactivity,
// spaced review) behind this same interface.

export type LearnerSnapshot = {
  now: Date;
  openAssignments: {
    assignmentId: string;
    activityId: string | null;
    title: string;
    dueAt: string | null;
  }[];
  unfinishedAttempts: {
    attemptId: string;
    activityId: string;
    title: string;
    updatedAt: string;
  }[];
  dismissedKeys: ReadonlySet<string>;
};

export type Recommendation = {
  key: string;
  kind: 'assignment' | 'unfinished';
  title: string;
  dueAt: string | null;
  attemptId: string | null;
  priority: number;
};

const DAY = 86_400_000;
export const MAX_RECOMMENDATIONS = 5;

/** Teacher assignments: always high priority, sooner deadlines first. */
function assignmentRule(s: LearnerSnapshot): Recommendation[] {
  return s.openAssignments.map((a) => {
    const due = a.dueAt ? new Date(a.dueAt).getTime() : null;
    const daysLeft = due === null ? 14 : Math.max(0, (due - s.now.getTime()) / DAY);
    return {
      key: `assignment:${a.assignmentId}`,
      kind: 'assignment',
      title: a.title,
      dueAt: a.dueAt,
      attemptId: null,
      priority: 100 - Math.min(daysLeft, 14),
    };
  });
}

/** Something started and not finished: worth finishing while it is fresh. */
function unfinishedRule(s: LearnerSnapshot): Recommendation[] {
  return s.unfinishedAttempts.map((a) => {
    const ageDays = (s.now.getTime() - new Date(a.updatedAt).getTime()) / DAY;
    return {
      key: `unfinished:${a.attemptId}`,
      kind: 'unfinished',
      title: a.title,
      dueAt: null,
      attemptId: a.attemptId,
      priority: 60 - Math.min(ageDays, 30),
    };
  });
}

export function recommend(snapshot: LearnerSnapshot): Recommendation[] {
  // An unfinished attempt of an assigned activity is the same task: keep the
  // assignment (it carries the deadline) and drop the duplicate.
  const assigned = new Set(snapshot.openAssignments.map((a) => a.activityId).filter(Boolean));
  const unfinished = unfinishedRule({
    ...snapshot,
    unfinishedAttempts: snapshot.unfinishedAttempts.filter((a) => !assigned.has(a.activityId)),
  });

  return [...assignmentRule(snapshot), ...unfinished]
    .filter((r) => !snapshot.dismissedKeys.has(r.key))
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    .slice(0, MAX_RECOMMENDATIONS);
}
