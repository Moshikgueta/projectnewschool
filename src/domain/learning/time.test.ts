import { describe, expect, it } from 'vitest';
import { localDay, partOfDay, practiceDaysInLastWeek, zonedTimeToUtc } from './time';

const TZ = 'Asia/Jerusalem';

describe('partOfDay', () => {
  it('uses the student’s time zone, not the server’s', () => {
    // 18:30 UTC in October = 21:30 in Jerusalem (UTC+3)
    const instant = new Date('2026-10-03T18:30:00Z');
    expect(partOfDay(instant, TZ)).toBe('evening');
    expect(partOfDay(instant, 'America/Sao_Paulo')).toBe('afternoon'); // 15:30
  });

  it('covers the whole day', () => {
    const at = (h: number) => partOfDay(new Date(Date.UTC(2026, 0, 15, h, 0)), 'UTC');
    expect(at(4)).toBe('night');
    expect(at(5)).toBe('morning');
    expect(at(11)).toBe('morning');
    expect(at(12)).toBe('afternoon');
    expect(at(17)).toBe('evening');
    expect(at(22)).toBe('night');
  });
});

describe('practiceDaysInLastWeek', () => {
  const now = new Date('2026-10-03T10:00:00Z');

  it('counts distinct local days, not sessions', () => {
    const events = [
      '2026-10-03T07:00:00Z',
      '2026-10-03T09:00:00Z', // same day
      '2026-10-01T12:00:00Z',
      '2026-09-28T12:00:00Z',
    ];
    expect(practiceDaysInLastWeek(events, now, TZ)).toBe(3);
  });

  it('ignores study older than 7 days', () => {
    expect(practiceDaysInLastWeek(['2026-09-20T12:00:00Z'], now, TZ)).toBe(0);
  });

  it('assigns late-evening study to the local day', () => {
    // 22:30 UTC on Sep 26 is 01:30 on Sep 27 in Jerusalem: inside the window.
    expect(localDay(new Date('2026-09-26T22:30:00Z'), TZ)).toBe('2026-09-27');
    expect(practiceDaysInLastWeek(['2026-09-26T22:30:00Z'], now, TZ)).toBe(1);
  });
});

describe('zonedTimeToUtc', () => {
  it('turns a wall-clock time into the right instant, in summer and in winter', () => {
    // Israel: UTC+3 until the last Sunday of October 2026, then UTC+2.
    expect(zonedTimeToUtc('2026-10-08T18:00', 'Asia/Jerusalem')?.toISOString()).toBe(
      '2026-10-08T15:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-12-01T18:00', 'Asia/Jerusalem')?.toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-08T23:59', 'America/New_York')?.toISOString()).toBe(
      '2026-10-09T03:59:00.000Z',
    );
  });

  it('rejects malformed input', () => {
    expect(zonedTimeToUtc('8/10/2026 18:00', 'Asia/Jerusalem')).toBeNull();
    expect(zonedTimeToUtc('', 'Asia/Jerusalem')).toBeNull();
  });
});
