// Phase 5 exit criterion: the metrics match a fixture computed by hand. The
// expected numbers below were worked out on paper from this snapshot; the
// working is in the comments next to each assertion.
import { describe, expect, it } from 'vitest';
import { practiceWeek, studentProgress, type ProgressSnapshot } from './progress';

const now = new Date('2026-10-06T20:00:00Z'); // 23:00 on Tuesday 6 October in Jerusalem

const snapshot: ProgressSnapshot = {
  now,
  timeZone: 'Asia/Jerusalem',
  cycles: [
    { id: 'c1', title: 'Introducing yourself', position: 1, active: false },
    { id: 'c2', title: 'Family', position: 2, active: true },
    { id: 'c3', title: 'Food', position: 3, active: false }, // nothing published in it yet
  ],
  activities: [
    { id: 'a1', cycleId: 'c1', title: 'Greetings', skillIds: ['greet'] },
    { id: 'a2', cycleId: 'c1', title: 'Numbers', skillIds: ['num'] },
    { id: 'a3', cycleId: 'c2', title: 'Possessives', skillIds: ['poss'] },
    { id: 'a4', cycleId: 'c2', title: 'Possessives 2', skillIds: ['poss'] },
    { id: 'a5', cycleId: 'c2', title: 'Dates', skillIds: ['num', 'dates'] },
  ],
  sections: [
    { id: 's1', cycleId: 'c1' },
    { id: 's2', cycleId: 'c2' },
    { id: 's3', cycleId: 'c2' },
  ],
  completedActivityIds: new Set(['a1', 'a2', 'a3']),
  completedSectionIds: new Set(['s1', 's2']),
  firstTries: [
    // a1, one attempt: 3 of 3 right.
    { attemptId: 't1', activityId: 'a1', correct: true, at: '2026-10-01T10:00:00Z' },
    { attemptId: 't1', activityId: 'a1', correct: true, at: '2026-10-01T10:01:00Z' },
    { attemptId: 't1', activityId: 'a1', correct: true, at: '2026-10-01T10:02:00Z' },
    // a2, two attempts: the older one (0 of 2) is replaced by the newer (1 of 2).
    { attemptId: 't2', activityId: 'a2', correct: false, at: '2026-10-02T10:00:00Z' },
    { attemptId: 't2', activityId: 'a2', correct: false, at: '2026-10-02T10:01:00Z' },
    { attemptId: 't3', activityId: 'a2', correct: true, at: '2026-10-05T10:00:00Z' },
    { attemptId: 't3', activityId: 'a2', correct: false, at: '2026-10-05T10:01:00Z' },
    // a3: 1 of 4 right. a4 never tried.
    { attemptId: 't4', activityId: 'a3', correct: true, at: '2026-10-06T09:00:00Z' },
    { attemptId: 't4', activityId: 'a3', correct: false, at: '2026-10-06T09:01:00Z' },
    { attemptId: 't4', activityId: 'a3', correct: false, at: '2026-10-06T09:02:00Z' },
    { attemptId: 't4', activityId: 'a3', correct: false, at: '2026-10-06T09:03:00Z' },
    // a5 (numbers and dates): 1 of 1 right.
    { attemptId: 't5', activityId: 'a5', correct: true, at: '2026-10-06T09:30:00Z' },
  ],
  skills: [
    { id: 'greet', label: 'Greetings' },
    { id: 'num', label: 'Numbers' },
    { id: 'poss', label: 'Possessives' },
    { id: 'dates', label: 'Dates' },
    { id: 'colours', label: 'Colours' }, // never practised
  ],
  practisedAt: [
    '2026-10-06T19:30:00Z', // Tue 6, 22:30 local
    '2026-10-06T21:30:00Z', // Wed 7, 00:30 local: tomorrow, outside the window
    '2026-10-05T22:30:00Z', // Tue 6, 01:30 local (same local day as the first)
    '2026-10-03T08:00:00Z', // Sat 3
    '2026-09-30T08:00:00Z', // Wed 30 Sept: today minus 6 days, the first day of the window
    '2026-09-29T08:00:00Z', // Tue 29 Sept: 7 days ago, outside the window
  ],
};

describe('student progress (hand-computed fixture)', () => {
  const p = studentProgress(snapshot);

  it('weekly practice: distinct local days among the last 7, today included', () => {
    // Window, local dates: Sep 30, Oct 1, 2, 3, 4, 5, 6.
    // Practised: Sep 30, Oct 3, Oct 6 (two events, one day) → 3 days; goal 3.
    expect(p.week.days.map((d) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(p.week.days.filter((d) => d.practised).map((d) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-03',
      '2026-10-06',
    ]);
    expect(p.week.practisedDays).toBe(3);
    expect(p.week.goal).toBe(3);
  });

  it('cycles: activities completed plus sections finished, active cycle first, empty ones hidden', () => {
    // c2 (active): activities a3 done of a3,a4,a5 → 1/3; sections s2 of s2,s3 → 1/2;
    //   (1 + 1) / (3 + 2) = 40%.
    // c1: a1,a2 done 2/2; s1 1/1 → 3/3 = 100%, complete.
    // c3: nothing published → not shown.
    expect(p.cycles).toEqual([
      {
        id: 'c2',
        title: 'Family',
        active: true,
        activitiesDone: 1,
        activitiesTotal: 3,
        sectionsDone: 1,
        sectionsTotal: 2,
        percent: 40,
        complete: false,
      },
      {
        id: 'c1',
        title: 'Introducing yourself',
        active: false,
        activitiesDone: 2,
        activitiesTotal: 2,
        sectionsDone: 1,
        sectionsTotal: 1,
        percent: 100,
        complete: true,
      },
    ]);
    expect(p.totals).toEqual({ activitiesCompleted: 3, sectionsFinished: 2 });
  });

  it('skills: first tries of the latest attempt per activity', () => {
    // Dates:       a5 → 1 of 1 → too few answers to judge.
    // Greetings:   a1 → 3 of 3 = 100%.
    // Numbers:     a2 latest (t3) 1 of 2, plus a5 1 of 1 → 2 of 3 ≈ 67%.
    // Possessives: a3 → 1 of 4 = 25%.
    expect(p.skills).toEqual([
      { id: 'dates', label: 'Dates', answers: 1, correct: 1, accuracy: null },
      { id: 'greet', label: 'Greetings', answers: 3, correct: 3, accuracy: 1 },
      { id: 'num', label: 'Numbers', answers: 3, correct: 2, accuracy: 2 / 3 },
      { id: 'poss', label: 'Possessives', answers: 4, correct: 1, accuracy: 0.25 },
    ]);
    // Revisit: below 60% with at least 3 answers → Possessives only, with its activities.
    expect(p.revisit).toEqual([
      {
        id: 'poss',
        label: 'Possessives',
        answers: 4,
        correct: 1,
        accuracy: 0.25,
        activities: [
          { id: 'a3', title: 'Possessives' },
          { id: 'a4', title: 'Possessives 2' },
        ],
      },
    ]);
    // Strong: at least 85% → Greetings.
    expect(p.strong.map((k) => k.id)).toEqual(['greet']);
  });
});

describe('practice week', () => {
  it('counts days in the student’s time zone, not the server’s', () => {
    // 23:30 UTC on Oct 5 is already Oct 6 in Jerusalem but still Oct 5 in New York.
    const at = ['2026-10-05T23:30:00Z'];
    expect(practiceWeek(at, now, 'Asia/Jerusalem').days.at(-1)).toEqual({
      date: '2026-10-06',
      practised: true,
    });
    expect(practiceWeek(at, now, 'America/New_York').days.at(-2)).toEqual({
      date: '2026-10-05',
      practised: true,
    });
  });
});
