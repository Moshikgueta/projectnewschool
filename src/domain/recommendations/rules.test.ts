import { describe, expect, it } from 'vitest';
import {
  assignmentRule,
  beforeClassRule,
  comeBackRule,
  MAX_RECOMMENDATIONS,
  recommend,
  rulesV1,
  spacedReviewRule,
  unfinishedRule,
  vocabularyRule,
  weakSkillRule,
  type LearnerSnapshot,
} from './rules';

const now = new Date('2026-10-06T10:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const inDays = (d: number) => daysAgo(-d);

const base: LearnerSnapshot = {
  now,
  courseId: 'course',
  openAssignments: [],
  unfinishedAttempts: [],
  dismissedKeys: new Set(),
  nextClassAt: null,
  activities: [],
  completedAt: new Map(),
  firstTries: [],
  skills: [],
  wordsDue: 0,
  lastPracticeAt: daysAgo(0),
};

const activity = (
  id: string,
  extra: Partial<LearnerSnapshot['activities'][number]> = {},
): LearnerSnapshot['activities'][number] => ({
  id,
  title: id,
  phase: 'after_class',
  activeCycle: true,
  skillIds: [],
  ...extra,
});

describe('rule 1: teacher assignments', () => {
  it('nearest deadline first; an assignment with no deadline still ranks high', () => {
    const recs = assignmentRule({
      ...base,
      openAssignments: [
        { assignmentId: 'a1', activityId: 'x1', section: null, title: 'Later', dueAt: inDays(7) },
        { assignmentId: 'a2', activityId: 'x2', section: null, title: 'Soon', dueAt: inDays(1) },
        { assignmentId: 'a3', activityId: null, section: null, title: 'Words', dueAt: null },
      ],
    });
    expect(recs.map((r) => [r.title, r.priority])).toEqual([
      ['Later', 93],
      ['Soon', 99],
      ['Words', 86],
    ]);
    expect(recs[2]?.target).toEqual({ type: 'vocabulary' });
  });

  it('goes straight to the open attempt of an assigned activity', () => {
    const [rec] = assignmentRule({
      ...base,
      openAssignments: [
        { assignmentId: 'a1', activityId: 'x1', section: null, title: 'G', dueAt: null },
      ],
      unfinishedAttempts: [
        { attemptId: 't1', activityId: 'x1', title: 'G', updatedAt: daysAgo(1) },
      ],
    });
    expect(rec?.target).toEqual({ type: 'attempt', id: 't1' });
  });
});

describe('rule 2: before class', () => {
  const snapshot = {
    ...base,
    activities: [
      activity('prep', { phase: 'before_class' }),
      activity('done-prep', { phase: 'before_class' }),
      activity('other-cycle', { phase: 'before_class', activeCycle: false }),
      activity('after', { phase: 'after_class' }),
    ],
    completedAt: new Map([['done-prep', daysAgo(1)]]),
  };

  it('suggests unfinished preparation of the active cycle when class is within 3 days', () => {
    const recs = beforeClassRule({ ...snapshot, nextClassAt: inDays(2) });
    expect(recs.map((r) => r.title)).toEqual(['prep']);
    expect(recs[0]).toMatchObject({
      priority: 78,
      dueAt: inDays(2),
      key: `before-class:prep:${inDays(2).slice(0, 10)}`,
    });
  });

  it('stays quiet when the class is further away or not scheduled', () => {
    expect(beforeClassRule({ ...snapshot, nextClassAt: inDays(4) })).toEqual([]);
    expect(beforeClassRule({ ...snapshot, nextClassAt: null })).toEqual([]);
  });
});

describe('rule 3: unfinished work', () => {
  it('fresher first', () => {
    const recs = unfinishedRule({
      ...base,
      unfinishedAttempts: [
        { attemptId: 'old', activityId: 'x1', title: 'Old', updatedAt: daysAgo(10) },
        { attemptId: 'new', activityId: 'x2', title: 'New', updatedAt: daysAgo(1) },
      ],
    });
    expect(recs.map((r) => r.priority)).toEqual([50, 59]);
  });
});

describe('rule 4: weak skill', () => {
  const tries = (activityId: string, results: boolean[], from = 1) =>
    results.map((correct, i) => ({ activityId, correct, at: daysAgo(from + i) }));
  const skills = [{ id: 'num', label: 'Numbers' }];

  it('below 70% over the last 10 first tries: another activity with the skill, not done yet', () => {
    const [rec] = weakSkillRule({
      ...base,
      skills,
      activities: [
        activity('done', { skillIds: ['num'] }),
        activity('next', { skillIds: ['num'] }),
        activity('unrelated'),
      ],
      completedAt: new Map([['done', daysAgo(1)]]),
      firstTries: tries('done', [true, false, false]),
    });
    expect(rec).toMatchObject({
      kind: 'weakSkill',
      title: 'next',
      detail: { skill: 'Numbers' },
      priority: 47, // 50 - round(0.33 × 10)
    });
  });

  it('only the last 10 count, so recent improvement removes the suggestion', () => {
    const old = tries('a', Array(10).fill(false), 20); // 20–29 days ago, all wrong
    const recent = tries('a', [true, true, true, true, true, true, true, false, false, false]); // 70%
    const snapshot = {
      ...base,
      skills,
      activities: [activity('a', { skillIds: ['num'] })],
      completedAt: new Map([['a', daysAgo(1)]]),
    };
    expect(weakSkillRule({ ...snapshot, firstTries: [...old, ...recent] })).toEqual([]);
    expect(weakSkillRule({ ...snapshot, firstTries: old })).toHaveLength(1);
  });

  it('needs at least 3 answers, and redoes the activity done longest ago when nothing is new', () => {
    const snapshot = {
      ...base,
      skills,
      activities: [activity('a', { skillIds: ['num'] }), activity('b', { skillIds: ['num'] })],
      completedAt: new Map([
        ['a', daysAgo(2)],
        ['b', daysAgo(9)],
      ]),
    };
    expect(weakSkillRule({ ...snapshot, firstTries: tries('a', [false, false]) })).toEqual([]);
    const [rec] = weakSkillRule({ ...snapshot, firstTries: tries('a', [false, false, false]) });
    expect(rec?.title).toBe('b');
  });
});

describe('rule 5: vocabulary', () => {
  it('suggests reviewing the words that are due', () => {
    expect(vocabularyRule(base)).toEqual([]);
    expect(vocabularyRule({ ...base, wordsDue: 12 })).toEqual([
      {
        key: 'vocab-review:course',
        kind: 'vocabulary',
        title: '',
        target: { type: 'vocabulary' },
        dueAt: null,
        detail: { words: 12 },
        priority: 46,
      },
    ]);
  });
});

describe('rule 6: coming back after a break', () => {
  it('after 4+ days without practice, the latest completed activity as a warm-up', () => {
    const snapshot = {
      ...base,
      activities: [activity('older'), activity('latest')],
      completedAt: new Map([
        ['older', daysAgo(20)],
        ['latest', daysAgo(6)],
      ]),
    };
    expect(comeBackRule({ ...snapshot, lastPracticeAt: daysAgo(3) })).toEqual([]);
    expect(comeBackRule({ ...snapshot, lastPracticeAt: daysAgo(5) })).toMatchObject([
      { kind: 'comeBack', title: 'latest', detail: { days: 5 } },
    ]);
    // Never practised: other rules (assignments, the notebook) lead the way.
    expect(comeBackRule({ ...snapshot, lastPracticeAt: null })).toEqual([]);
  });

  it('falls back to vocabulary when nothing was completed yet', () => {
    expect(comeBackRule({ ...base, lastPracticeAt: daysAgo(8), wordsDue: 3 })).toMatchObject([
      { target: { type: 'vocabulary' }, detail: { days: 8 } },
    ]);
  });
});

describe('rule 7: spaced review', () => {
  it('after-class work done 3–7 days ago, oldest first, one at a time', () => {
    const recs = spacedReviewRule({
      ...base,
      activities: [
        activity('two-days'),
        activity('four-days'),
        activity('six-days'),
        activity('ten-days'),
        activity('in-class', { phase: 'during_class' }),
      ],
      completedAt: new Map([
        ['two-days', daysAgo(2)],
        ['four-days', daysAgo(4)],
        ['six-days', daysAgo(6)],
        ['ten-days', daysAgo(10)],
        ['in-class', daysAgo(5)],
      ]),
    });
    expect(recs).toMatchObject([{ kind: 'spacedReview', title: 'six-days', detail: { days: 6 } }]);
  });
});

describe('the engine', () => {
  it('ranks by priority, keeps one suggestion per place, and respects "not now"', () => {
    const snapshot: LearnerSnapshot = {
      ...base,
      openAssignments: [
        {
          assignmentId: 'a1',
          activityId: 'x1',
          section: null,
          title: 'Greetings',
          dueAt: inDays(2),
        },
      ],
      unfinishedAttempts: [
        { attemptId: 't1', activityId: 'x1', title: 'Greetings', updatedAt: daysAgo(1) },
      ],
      wordsDue: 4,
      nextClassAt: inDays(1),
      activities: [activity('x1'), activity('prep', { phase: 'before_class' })],
    };
    const recs = recommend(snapshot);
    // The unfinished attempt is the assignment itself: listed once, as the assignment.
    expect(recs.map((r) => r.kind)).toEqual(['assignment', 'beforeClass', 'vocabulary']);
    expect(recs[0]?.target).toEqual({ type: 'attempt', id: 't1' });

    const snoozed = recommend({ ...snapshot, dismissedKeys: new Set(['vocab-review:course']) });
    expect(snoozed.map((r) => r.kind)).toEqual(['assignment', 'beforeClass']);
  });

  it(`never lists more than ${MAX_RECOMMENDATIONS}`, () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      assignmentId: `a${i}`,
      activityId: `x${i}`,
      section: null,
      title: `Task ${i}`,
      dueAt: null,
    }));
    expect(recommend({ ...base, openAssignments: many })).toHaveLength(MAX_RECOMMENDATIONS);
  });

  it('is available behind the provider interface', () => {
    expect(rulesV1.name).toBe('rules-v1');
    expect(rulesV1.recommend(base)).toEqual([]);
  });
});
