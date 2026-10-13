import { describe, expect, it } from 'vitest';
import { nextDue, review, sessionCards } from './leitner';

const now = new Date('2026-10-03T10:00:00Z');
const days = (d: Date) => (d.getTime() - now.getTime()) / 86_400_000;

describe('Leitner review', () => {
  it('a new word known at first sight goes to box 2, due tomorrow', () => {
    const s = review(null, true, now);
    expect(s).toMatchObject({ box: 2, correctStreak: 1, lapses: 0 });
    expect(days(s.dueAt)).toBe(1);
  });

  it('knowing a word moves it up one box and waits longer, up to box 5', () => {
    let s = review(null, true, now);
    s = review(s, true, now);
    expect(s.box).toBe(3);
    expect(days(s.dueAt)).toBe(3);
    s = review(review(review(s, true, now), true, now), true, now);
    expect(s.box).toBe(5);
    expect(days(s.dueAt)).toBe(14);
  });

  it('not knowing it sends it back to box 1, again in 10 minutes, and counts a lapse', () => {
    const known = review(review(null, true, now), true, now);
    const s = review(known, false, now);
    expect(s).toMatchObject({ box: 1, correctStreak: 0, lapses: 1 });
    expect((s.dueAt.getTime() - now.getTime()) / 60_000).toBe(10);
    expect(review(null, false, now).lapses).toBe(0);
  });
});

describe('session cards', () => {
  const words = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, position: i + 1 }));

  it('due words first (most overdue first), then new words in course order', () => {
    const states = new Map([
      ['c', { dueAt: new Date('2026-10-02T00:00:00Z') }],
      ['a', { dueAt: new Date('2026-10-01T00:00:00Z') }],
      ['b', { dueAt: new Date('2026-10-05T00:00:00Z') }],
    ]);
    expect(sessionCards(words, states, now).map((w) => w.id)).toEqual(['a', 'c', 'd']);
    expect(sessionCards(words, states, now, 2).map((w) => w.id)).toEqual(['a', 'c']);
    expect(nextDue(states.values(), now)?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});
