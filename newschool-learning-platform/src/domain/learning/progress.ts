// Progress read model (Phase 5). Pure: the server loads a snapshot of one
// student in one course with their own session, and these functions turn it
// into what the student sees. Calm and consistency-first (ROADMAP.md,
// "Gamification stance"): a weekly goal, cycle bars, and skills to revisit,
// never a streak that punishes a busy week.

import { localDay, WEEKLY_PRACTICE_GOAL } from './time';

const DAY = 86_400_000;

/** Below this first-try accuracy a skill is suggested for revisiting. */
export const REVISIT_BELOW = 0.6;
/** At or above this accuracy (with enough answers) a skill counts as strong. */
export const STRONG_FROM = 0.85;
/** Fewer first-try answers than this are too few to judge a skill. */
export const MIN_ANSWERS = 3;
/** At most this many topics to revisit, weakest first. */
export const MAX_REVISIT = 3;

export type ProgressSnapshot = {
  now: Date;
  timeZone: string;
  /** Published cycles of the course, with whether the student's group has them active. */
  cycles: { id: string; title: string; position: number; active: boolean }[];
  activities: { id: string; cycleId: string; title: string; skillIds: string[] }[];
  sections: { id: string; cycleId: string }[];
  completedActivityIds: ReadonlySet<string>;
  completedSectionIds: ReadonlySet<string>;
  /**
   * First-try results of auto-graded items (responses with try_no = 1 and a
   * correctness). Only the latest attempt per activity counts, so practising
   * again updates the picture.
   */
  firstTries: { attemptId: string; activityId: string; correct: boolean; at: string }[];
  skills: { id: string; label: string }[];
  /** When the student studied (learning events). */
  practisedAt: readonly (string | Date)[];
};

export type CycleProgress = {
  id: string;
  title: string;
  active: boolean;
  activitiesDone: number;
  activitiesTotal: number;
  sectionsDone: number;
  sectionsTotal: number;
  /** Activities completed and sections finished, out of all of them. */
  percent: number;
  complete: boolean;
};

export type SkillProgress = {
  id: string;
  label: string;
  answers: number;
  correct: number;
  /** null while there are fewer than MIN_ANSWERS answers. */
  accuracy: number | null;
};

export type StudentProgress = {
  week: { days: { date: string; practised: boolean }[]; practisedDays: number; goal: number };
  cycles: CycleProgress[];
  totals: { activitiesCompleted: number; sectionsFinished: number };
  skills: SkillProgress[];
  revisit: (SkillProgress & { activities: { id: string; title: string }[] })[];
  strong: SkillProgress[];
};

/** The last 7 calendar days in the student's time zone, oldest first, and which had study. */
export function practiceWeek(practisedAt: readonly (string | Date)[], now: Date, timeZone: string) {
  const days = Array.from({ length: 7 }, (_, i) =>
    localDay(new Date(now.getTime() - (6 - i) * DAY), timeZone),
  );
  const practised = new Set(practisedAt.map((t) => localDay(new Date(t), timeZone)));
  const strip = days.map((date) => ({ date, practised: practised.has(date) }));
  return {
    days: strip,
    practisedDays: strip.filter((d) => d.practised).length,
    goal: WEEKLY_PRACTICE_GOAL,
  };
}

export function cycleProgress(
  s: Pick<
    ProgressSnapshot,
    'cycles' | 'activities' | 'sections' | 'completedActivityIds' | 'completedSectionIds'
  >,
): CycleProgress[] {
  return [...s.cycles]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.position - b.position)
    .map((c) => {
      const activities = s.activities.filter((a) => a.cycleId === c.id);
      const sections = s.sections.filter((x) => x.cycleId === c.id);
      const activitiesDone = activities.filter((a) => s.completedActivityIds.has(a.id)).length;
      const sectionsDone = sections.filter((x) => s.completedSectionIds.has(x.id)).length;
      const total = activities.length + sections.length;
      const done = activitiesDone + sectionsDone;
      return {
        id: c.id,
        title: c.title,
        active: c.active,
        activitiesDone,
        activitiesTotal: activities.length,
        sectionsDone,
        sectionsTotal: sections.length,
        percent: total ? Math.round((done / total) * 100) : 0,
        complete: total > 0 && done === total,
      };
    })
    .filter((c) => c.activitiesTotal + c.sectionsTotal > 0);
}

export function skillProgress(s: ProgressSnapshot): SkillProgress[] {
  // Latest attempt per activity.
  const latest = new Map<string, { attemptId: string; at: string }>();
  for (const t of s.firstTries) {
    const seen = latest.get(t.activityId);
    if (!seen || t.at > seen.at) latest.set(t.activityId, { attemptId: t.attemptId, at: t.at });
  }
  const counted = s.firstTries.filter((t) => latest.get(t.activityId)?.attemptId === t.attemptId);

  const skillsOf = new Map(s.activities.map((a) => [a.id, a.skillIds]));
  const tally = new Map<string, { answers: number; correct: number }>();
  for (const t of counted) {
    for (const skill of skillsOf.get(t.activityId) ?? []) {
      const row = tally.get(skill) ?? { answers: 0, correct: 0 };
      row.answers += 1;
      if (t.correct) row.correct += 1;
      tally.set(skill, row);
    }
  }
  return s.skills
    .filter((k) => tally.has(k.id))
    .map((k) => {
      const { answers, correct } = tally.get(k.id)!;
      return {
        id: k.id,
        label: k.label,
        answers,
        correct,
        accuracy: answers >= MIN_ANSWERS ? correct / answers : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function studentProgress(s: ProgressSnapshot): StudentProgress {
  const skills = skillProgress(s);
  const judged = skills.filter((k) => k.accuracy !== null);
  return {
    week: practiceWeek(s.practisedAt, s.now, s.timeZone),
    cycles: cycleProgress(s),
    totals: {
      activitiesCompleted: s.activities.filter((a) => s.completedActivityIds.has(a.id)).length,
      sectionsFinished: s.sections.filter((x) => s.completedSectionIds.has(x.id)).length,
    },
    skills,
    revisit: judged
      .filter((k) => k.accuracy! < REVISIT_BELOW)
      .sort((a, b) => a.accuracy! - b.accuracy! || b.answers - a.answers)
      .slice(0, MAX_REVISIT)
      .map((k) => ({
        ...k,
        activities: s.activities
          .filter((a) => a.skillIds.includes(k.id))
          .map((a) => ({ id: a.id, title: a.title })),
      })),
    strong: judged.filter((k) => k.accuracy! >= STRONG_FROM),
  };
}
