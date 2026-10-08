import { describe, expect, it } from 'vitest';
import {
  assignmentProgress,
  commonDifficulties,
  studentSummaries,
  type FirstTry,
} from './insights';

const t = (
  userId: string,
  itemId: string,
  correct: boolean,
  answer: unknown,
  day: number,
): FirstTry => ({
  userId,
  itemId,
  correct,
  answer,
  at: `2026-10-0${day}T10:00:00Z`,
});

describe('common difficulties', () => {
  it('ranks questions by first-try error rate, one first encounter per student, minimum 3 students', () => {
    const tries = [
      // q1: 3 of 4 students wrong at first; two gave the same wrong answer.
      t('a', 'q1', false, { optionIds: ['o2'] }, 1),
      t('a', 'q1', true, { optionIds: ['o1'] }, 3), // a later attempt: ignored
      t('b', 'q1', false, { optionIds: ['o2'] }, 1),
      t('c', 'q1', false, { optionIds: ['o3'] }, 2),
      t('d', 'q1', true, { optionIds: ['o1'] }, 2),
      // q2: 2 of 3 wrong, all different answers.
      t('a', 'q2', false, { value: false }, 1),
      t('b', 'q2', true, { value: true }, 1),
      t('c', 'q2', false, { value: true }, 1),
      // q3: only 2 students: too few to judge.
      t('a', 'q3', false, 'x', 1),
      t('b', 'q3', false, 'x', 1),
      // q4: 1 of 3 wrong: not a difficulty.
      t('a', 'q4', false, 'x', 1),
      t('b', 'q4', true, 'y', 1),
      t('c', 'q4', true, 'y', 1),
    ];
    expect(commonDifficulties(tries)).toEqual([
      {
        itemId: 'q1',
        students: 4,
        wrong: 3,
        rate: 0.75,
        commonWrongAnswer: { optionIds: ['o2'] },
        commonWrongCount: 2,
      },
      {
        itemId: 'q2',
        students: 3,
        wrong: 2,
        rate: 2 / 3,
        commonWrongAnswer: null,
        commonWrongCount: 0,
      },
    ]);
  });
});

describe('assignment progress', () => {
  it('counts work submitted for the assignment or after it was given, and finished sections', () => {
    const progress = assignmentProgress(
      [
        {
          id: 'h1',
          createdAt: '2026-10-02',
          activityId: 'act',
          sectionId: null,
          recipients: ['a', 'b', 'c'],
        },
        {
          id: 'h2',
          createdAt: '2026-10-02',
          activityId: null,
          sectionId: 'sec',
          recipients: ['a', 'b'],
        },
        { id: 'h3', createdAt: '2026-10-02', activityId: null, sectionId: null, recipients: ['a'] },
      ],
      {
        submitted: [
          { userId: 'a', activityId: 'act', assignmentId: 'h1', at: '2026-10-01' }, // linked: counts
          { userId: 'b', activityId: 'act', assignmentId: null, at: '2026-10-01' }, // before it was given
          { userId: 'c', activityId: 'act', assignmentId: null, at: '2026-10-03' }, // after: counts
          { userId: 'x', activityId: 'act', assignmentId: 'h1', at: '2026-10-03' }, // not a recipient
        ],
        finishedSections: [{ userId: 'b', sectionId: 'sec' }],
      },
    );
    expect(progress).toEqual([
      { assignmentId: 'h1', done: 2, total: 3 },
      { assignmentId: 'h2', done: 1, total: 2 },
      { assignmentId: 'h3', done: 0, total: 1 },
    ]);
  });
});

describe('student summaries', () => {
  it('active-cycle completion, first-try accuracy (3+ answers) and last activity', () => {
    const [a, b] = studentSummaries(['a', 'b'], {
      activeCycleActivityIds: new Set(['x', 'y']),
      submitted: [
        { userId: 'a', activityId: 'x' },
        { userId: 'a', activityId: 'x' },
        { userId: 'a', activityId: 'old-cycle' },
      ],
      tries: [
        { userId: 'a', correct: true },
        { userId: 'a', correct: false },
        { userId: 'a', correct: true },
        { userId: 'a', correct: true },
        { userId: 'b', correct: false },
      ],
      events: [
        { userId: 'a', at: '2026-10-01T10:00:00Z' },
        { userId: 'a', at: '2026-10-04T10:00:00Z' },
      ],
    });
    expect(a).toEqual({
      id: 'a',
      lastActiveAt: '2026-10-04T10:00:00Z',
      cycleDone: 1,
      cycleTotal: 2,
      accuracy: 0.75,
      answers: 4,
    });
    expect(b).toMatchObject({ lastActiveAt: null, cycleDone: 0, accuracy: null, answers: 1 });
  });
});
