// Recommendation engine v1 (ADR-010, docs/ROADMAP.md "Recommendation rules
// v1"). Pure rules over a snapshot of one learner in one course: each rule
// proposes candidates with a priority; the engine removes duplicates and
// snoozed suggestions, ranks them and keeps a short list. A smarter provider
// can replace or blend with these rules behind `RecommendationProvider`
// without touching the UI.

const DAY = 86_400_000;

export const MAX_RECOMMENDATIONS = 5;
/** "Before class" applies when the next class is at most this many days away. */
export const BEFORE_CLASS_DAYS = 3;
/** A skill is weak below this first-try accuracy… */
export const WEAK_BELOW = 0.7;
/** …measured over at most this many recent first tries… */
export const WEAK_WINDOW = 10;
/** …and only with at least this many of them. */
export const WEAK_MIN_ANSWERS = 3;
/** No practice for this many days or more: suggest a short review. */
export const INACTIVE_DAYS = 4;
/** Spaced review of work completed this many days ago (inclusive range). */
export const SPACED_REVIEW_DAYS = [3, 7] as const;

export type Target =
  | { type: 'attempt'; id: string }
  | { type: 'activity'; id: string }
  | { type: 'section'; id: string; book: 'notebook' | 'workbook' }
  | { type: 'vocabulary' };

export type LearnerSnapshot = {
  now: Date;
  courseId: string;
  openAssignments: {
    assignmentId: string;
    activityId: string | null;
    section: { id: string; book: 'notebook' | 'workbook' } | null;
    title: string;
    dueAt: string | null;
  }[];
  unfinishedAttempts: { attemptId: string; activityId: string; title: string; updatedAt: string }[];
  /** Suggestions the student snoozed with "Not now" recently. */
  dismissedKeys: ReadonlySet<string>;
  /** Next scheduled class of the student's group. */
  nextClassAt: string | null;
  /** Published activities of the course. */
  activities: {
    id: string;
    title: string;
    phase: 'before_class' | 'during_class' | 'after_class' | 'review' | 'optional';
    activeCycle: boolean;
    skillIds: string[];
  }[];
  /** When each activity was last completed. */
  completedAt: ReadonlyMap<string, string>;
  /** First-try results of auto-graded items. */
  firstTries: { activityId: string; correct: boolean; at: string }[];
  skills: { id: string; label: string }[];
  /** Vocabulary words due for review now. */
  wordsDue: number;
  /** The student's latest study, if any. */
  lastPracticeAt: string | null;
};

export type Recommendation = {
  key: string;
  kind:
    | 'assignment'
    | 'beforeClass'
    | 'unfinished'
    | 'weakSkill'
    | 'vocabulary'
    | 'comeBack'
    | 'spacedReview';
  /** What to do, usually an activity title (empty for vocabulary). */
  title: string;
  target: Target;
  dueAt: string | null;
  /** Values the message needs: a skill name, a number of words or days, a class time. */
  detail: { skill?: string; words?: number; days?: number; classAt?: string };
  priority: number;
};

export interface RecommendationProvider {
  readonly name: string;
  recommend(snapshot: LearnerSnapshot): Recommendation[];
}

const daysBetween = (from: Date | string, to: Date) =>
  (to.getTime() - new Date(from).getTime()) / DAY;

/** The place to go for an activity: the open attempt if there is one. */
function activityTarget(s: LearnerSnapshot, activityId: string): Target {
  const open = s.unfinishedAttempts.find((a) => a.activityId === activityId);
  return open ? { type: 'attempt', id: open.attemptId } : { type: 'activity', id: activityId };
}

/** 1. Teacher assignments: always first, the nearest deadline first. */
export function assignmentRule(s: LearnerSnapshot): Recommendation[] {
  return s.openAssignments.map((a) => {
    const daysLeft = a.dueAt === null ? 14 : Math.max(0, -daysBetween(a.dueAt, s.now));
    return {
      key: `assignment:${a.assignmentId}`,
      kind: 'assignment',
      title: a.title,
      target: a.activityId
        ? activityTarget(s, a.activityId)
        : a.section
          ? { type: 'section', id: a.section.id, book: a.section.book }
          : { type: 'vocabulary' },
      dueAt: a.dueAt,
      detail: {},
      priority: 100 - Math.min(daysLeft, 14),
    };
  });
}

/** 2. Preparation for the next class, when it is close. */
export function beforeClassRule(s: LearnerSnapshot): Recommendation[] {
  if (!s.nextClassAt) return [];
  const daysToClass = -daysBetween(s.nextClassAt, s.now);
  if (daysToClass <= 0 || daysToClass > BEFORE_CLASS_DAYS) return [];
  const classDay = s.nextClassAt.slice(0, 10);
  return s.activities
    .filter((a) => a.phase === 'before_class' && a.activeCycle && !s.completedAt.has(a.id))
    .slice(0, 2)
    .map((a) => ({
      key: `before-class:${a.id}:${classDay}`,
      kind: 'beforeClass',
      title: a.title,
      target: activityTarget(s, a.id),
      dueAt: s.nextClassAt,
      detail: { classAt: s.nextClassAt! },
      priority: 80 - daysToClass,
    }));
}

/** 3. Something started and not finished: worth finishing while it is fresh. */
export function unfinishedRule(s: LearnerSnapshot): Recommendation[] {
  return s.unfinishedAttempts.map((a) => ({
    key: `unfinished:${a.attemptId}`,
    kind: 'unfinished',
    title: a.title,
    target: { type: 'attempt', id: a.attemptId },
    dueAt: null,
    detail: {},
    priority: 60 - Math.min(daysBetween(a.updatedAt, s.now), 30),
  }));
}

/** 4. A skill below 70% over its last 10 first tries: practise it again. */
export function weakSkillRule(s: LearnerSnapshot): Recommendation[] {
  const skillsOf = new Map(s.activities.map((a) => [a.id, a.skillIds]));
  const bySkill = new Map<string, { correct: boolean; at: string }[]>();
  for (const t of s.firstTries) {
    for (const skill of skillsOf.get(t.activityId) ?? []) {
      bySkill.set(skill, [...(bySkill.get(skill) ?? []), t]);
    }
  }
  return s.skills.flatMap((skill) => {
    const recent = (bySkill.get(skill.id) ?? [])
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, WEAK_WINDOW);
    if (recent.length < WEAK_MIN_ANSWERS) return [];
    const accuracy = recent.filter((t) => t.correct).length / recent.length;
    if (accuracy >= WEAK_BELOW) return [];

    // Another activity with this skill: one not done yet (active cycle first),
    // otherwise the one done longest ago.
    const tagged = s.activities.filter((a) => a.skillIds.includes(skill.id));
    const fresh = tagged
      .filter((a) => !s.completedAt.has(a.id))
      .sort((a, b) => Number(b.activeCycle) - Number(a.activeCycle));
    const redo = tagged
      .filter((a) => s.completedAt.has(a.id))
      .sort((a, b) => s.completedAt.get(a.id)!.localeCompare(s.completedAt.get(b.id)!));
    const pick = fresh[0] ?? redo[0];
    if (!pick) return [];
    return [
      {
        key: `weak-skill:${skill.id}`,
        kind: 'weakSkill' as const,
        title: pick.title,
        target: activityTarget(s, pick.id),
        dueAt: null,
        detail: { skill: skill.label },
        priority: 50 - Math.round(accuracy * 10),
      },
    ];
  });
}

/** 5. Vocabulary due for review. */
export function vocabularyRule(s: LearnerSnapshot): Recommendation[] {
  if (s.wordsDue < 1) return [];
  return [
    {
      key: `vocab-review:${s.courseId}`,
      kind: 'vocabulary',
      title: '',
      target: { type: 'vocabulary' },
      dueAt: null,
      detail: { words: s.wordsDue },
      priority: 40 + Math.min(s.wordsDue, 20) / 2,
    },
  ];
}

/** 6. No practice for 4+ days: a short review of the latest work to restart gently. */
export function comeBackRule(s: LearnerSnapshot): Recommendation[] {
  if (!s.lastPracticeAt) return [];
  const days = Math.floor(daysBetween(s.lastPracticeAt, s.now));
  if (days < INACTIVE_DAYS) return [];
  const latest = [...s.completedAt.entries()].sort((a, b) => b[1].localeCompare(a[1]))[0];
  const activity = latest && s.activities.find((a) => a.id === latest[0]);
  if (activity) {
    return [
      {
        key: `come-back:${activity.id}`,
        kind: 'comeBack',
        title: activity.title,
        target: activityTarget(s, activity.id),
        dueAt: null,
        detail: { days },
        priority: 35,
      },
    ];
  }
  return s.wordsDue > 0
    ? [
        {
          key: 'come-back:vocabulary',
          kind: 'comeBack',
          title: '',
          target: { type: 'vocabulary' },
          dueAt: null,
          detail: { days },
          priority: 35,
        },
      ]
    : [];
}

/** 7. Spaced review: after-class work completed 3 to 7 days ago, oldest first. */
export function spacedReviewRule(s: LearnerSnapshot): Recommendation[] {
  const [from, to] = SPACED_REVIEW_DAYS;
  const due = s.activities
    .filter((a) => a.phase === 'after_class' && s.completedAt.has(a.id))
    .map((a) => ({ a, days: Math.floor(daysBetween(s.completedAt.get(a.id)!, s.now)) }))
    .filter(({ days }) => days >= from && days <= to)
    .sort((x, y) => y.days - x.days);
  return due.slice(0, 1).map(({ a, days }) => ({
    key: `spaced:${a.id}`,
    kind: 'spacedReview',
    title: a.title,
    target: activityTarget(s, a.id),
    dueAt: null,
    detail: { days },
    priority: 30,
  }));
}

const targetKey = (t: Target) => (t.type === 'vocabulary' ? 'vocabulary' : `${t.type}:${t.id}`);

export function recommend(s: LearnerSnapshot): Recommendation[] {
  const candidates = [
    ...assignmentRule(s),
    ...beforeClassRule(s),
    ...unfinishedRule(s),
    ...weakSkillRule(s),
    ...vocabularyRule(s),
    ...comeBackRule(s),
    ...spacedReviewRule(s),
  ]
    .filter((r) => !s.dismissedKeys.has(r.key))
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  // One suggestion per place to go: the highest-priority reason wins (an
  // assignment that is also unfinished stays the assignment, with its deadline).
  const seen = new Set<string>();
  const unique = candidates.filter((r) => {
    const key = targetKey(r.target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, MAX_RECOMMENDATIONS);
}

export const rulesV1: RecommendationProvider = { name: 'rules-v1', recommend };
