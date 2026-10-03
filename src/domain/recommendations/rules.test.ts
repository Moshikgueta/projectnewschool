import { describe, expect, it } from 'vitest';
import { MAX_RECOMMENDATIONS, recommend, type LearnerSnapshot } from './rules';

const now = new Date('2026-10-03T10:00:00Z');
const base: LearnerSnapshot = {
  now,
  openAssignments: [],
  unfinishedAttempts: [],
  dismissedKeys: new Set(),
};

describe('recommend', () => {
  it('puts teacher assignments first, nearest deadline first', () => {
    const recs = recommend({
      ...base,
      openAssignments: [
        { assignmentId: 'a1', activityId: 'x1', title: 'Later', dueAt: '2026-10-10T10:00:00Z' },
        { assignmentId: 'a2', activityId: 'x2', title: 'Soon', dueAt: '2026-10-04T10:00:00Z' },
      ],
      unfinishedAttempts: [
        { attemptId: 't1', activityId: 'x3', title: 'Started', updatedAt: '2026-10-03T09:00:00Z' },
      ],
    });
    expect(recs.map((r) => r.title)).toEqual(['Soon', 'Later', 'Started']);
    expect(recs[0]?.kind).toBe('assignment');
  });

  it('does not list an assigned activity twice', () => {
    const recs = recommend({
      ...base,
      openAssignments: [{ assignmentId: 'a1', activityId: 'x1', title: 'Greetings', dueAt: null }],
      unfinishedAttempts: [
        {
          attemptId: 't1',
          activityId: 'x1',
          title: 'Greetings',
          updatedAt: '2026-10-02T09:00:00Z',
        },
      ],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]?.kind).toBe('assignment');
  });

  it('respects dismissals', () => {
    const recs = recommend({
      ...base,
      unfinishedAttempts: [
        { attemptId: 't1', activityId: 'x1', title: 'A', updatedAt: '2026-10-02T09:00:00Z' },
      ],
      dismissedKeys: new Set(['unfinished:t1']),
    });
    expect(recs).toEqual([]);
  });

  it('keeps the list short', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      assignmentId: `a${i}`,
      activityId: `x${i}`,
      title: `Task ${i}`,
      dueAt: null,
    }));
    expect(recommend({ ...base, openAssignments: many })).toHaveLength(MAX_RECOMMENDATIONS);
  });
});
