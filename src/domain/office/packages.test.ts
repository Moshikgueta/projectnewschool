import { describe, expect, it } from 'vitest';
import {
  allowedStatuses,
  balance,
  cancellationFor,
  packageAlerts,
  packageForLesson,
  type PackageRow,
} from './packages';

const pkg = (over: Partial<PackageRow>): PackageRow => ({
  id: 'p',
  lessons: 10,
  used: 0,
  booked: 0,
  startsOn: '2026-09-01',
  expiresOn: null,
  paid: true,
  ...over,
});

describe('private lessons', () => {
  it('a cancellation less than 24 hours ahead is late', () => {
    const start = new Date('2026-10-08T17:00:00Z');
    expect(cancellationFor(start, new Date('2026-10-07T16:59:00Z'))).toBe('cancelled_early');
    expect(cancellationFor(start, new Date('2026-10-07T17:01:00Z'))).toBe('cancelled_late');
    expect(cancellationFor(start, new Date('2026-10-09T09:00:00Z'))).toBe('cancelled_late');
  });

  it('only a lesson that has started can be marked held or missed', () => {
    const start = new Date('2026-10-08T17:00:00Z');
    expect(allowedStatuses(start, new Date('2026-10-08T16:00:00Z'))).toEqual(['scheduled']);
    expect(allowedStatuses(start, new Date('2026-10-08T17:00:00Z'))).toEqual([
      'scheduled',
      'done',
      'no_show',
    ]);
  });
});

describe('packages', () => {
  it('counts what is left, and what is left to book', () => {
    expect(balance({ lessons: 10, used: 2, booked: 1 })).toEqual({ left: 8, unbooked: 7 });
  });

  it('flags packages running low, expiring, expired, finished and unpaid', () => {
    const today = '2026-10-06';
    expect(
      packageAlerts(pkg({ used: 4, lessons: 5, expiresOn: '2026-10-16', paid: false }), today),
    ).toEqual({
      finished: false,
      expired: false,
      low: true,
      expiring: true,
      unpaid: true,
    });
    expect(packageAlerts(pkg({ used: 2, booked: 1, expiresOn: '2027-02-03' }), today)).toEqual({
      finished: false,
      expired: false,
      low: false,
      expiring: false,
      unpaid: false,
    });
    // A finished or expired package is not "low" or "expiring" any more.
    const done = packageAlerts(pkg({ used: 10, expiresOn: '2026-10-10' }), today);
    expect([done.finished, done.low, done.expiring]).toEqual([true, false, false]);
    const old = packageAlerts(pkg({ expiresOn: '2026-10-05' }), today);
    expect([old.expired, old.low, old.expiring]).toEqual([true, false, false]);
  });

  it('a lesson draws on the package expiring first that still has a lesson to book', () => {
    const packages = [
      pkg({ id: 'open-ended', startsOn: '2026-08-01' }),
      pkg({ id: 'soon', expiresOn: '2026-10-20' }),
      pkg({ id: 'full', expiresOn: '2026-10-10', used: 5, booked: 5 }),
      pkg({ id: 'not-yet', startsOn: '2026-11-01', expiresOn: '2026-11-15' }),
    ];
    expect(packageForLesson(packages, '2026-10-08')?.id).toBe('soon');
    expect(packageForLesson(packages, '2026-10-25')?.id).toBe('open-ended');
    expect(packageForLesson([packages[2]!], '2026-10-08')).toBeNull();
  });
});
