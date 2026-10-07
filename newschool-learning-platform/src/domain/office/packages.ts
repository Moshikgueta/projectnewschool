// Lesson packages and private lessons (staff room merge, stage D: the Tazman
// replacement). Pure rules: which lessons count against a package, when a
// cancellation is late, what a package has left, which packages need the
// office's attention, and which package a new lesson draws on.

export const LESSON_STATUSES = [
  'scheduled',
  'done',
  'cancelled_early',
  'cancelled_late',
  'no_show',
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** Lessons that use up a package: held, cancelled late, or missed. */
export const CHARGED: readonly LessonStatus[] = ['done', 'cancelled_late', 'no_show'];

/** Cancelling less than this long before the start counts as late (and is charged). */
export const LATE_CANCEL_HOURS = 24;
/** "Running low": this many lessons or fewer left to book. */
export const LOW_BALANCE = 1;
/** "Expiring soon": within this many days. */
export const EXPIRING_DAYS = 14;

export function cancellationFor(startsAt: Date, now: Date): 'cancelled_early' | 'cancelled_late' {
  return startsAt.getTime() - now.getTime() < LATE_CANCEL_HOURS * 3_600_000
    ? 'cancelled_late'
    : 'cancelled_early';
}

/** What the office may set a lesson to, given when it is. */
export function allowedStatuses(startsAt: Date, now: Date): LessonStatus[] {
  return startsAt.getTime() <= now.getTime() ? ['scheduled', 'done', 'no_show'] : ['scheduled'];
}

export type PackageRow = {
  id: string;
  lessons: number;
  used: number;
  booked: number;
  startsOn: string; // YYYY-MM-DD
  expiresOn: string | null;
  paid: boolean;
};

export function balance(p: Pick<PackageRow, 'lessons' | 'used' | 'booked'>) {
  return { left: p.lessons - p.used, unbooked: p.lessons - p.used - p.booked };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type PackageAlerts = {
  finished: boolean;
  low: boolean;
  expired: boolean;
  expiring: boolean;
  unpaid: boolean;
};

/** What the office should notice about a package on a given day. */
export function packageAlerts(p: PackageRow, today: string): PackageAlerts {
  const { left, unbooked } = balance(p);
  const expired = p.expiresOn !== null && p.expiresOn < today;
  const finished = left <= 0;
  const live = !expired && !finished;
  return {
    finished,
    expired,
    low: live && unbooked <= LOW_BALANCE,
    expiring: live && p.expiresOn !== null && p.expiresOn <= addDays(today, EXPIRING_DAYS),
    unpaid: !p.paid,
  };
}

/**
 * The package a lesson on this day draws on: one that has started, has not
 * expired by then and has a lesson left to book; the one expiring first
 * (then the oldest), so nothing is wasted. Null if none fits.
 */
export function packageForLesson<T extends PackageRow>(
  packages: readonly T[],
  lessonDay: string,
): T | null {
  const fits = packages.filter(
    (p) =>
      p.startsOn <= lessonDay &&
      (p.expiresOn === null || p.expiresOn >= lessonDay) &&
      balance(p).unbooked > 0,
  );
  fits.sort(
    (a, b) =>
      (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') ||
      a.startsOn.localeCompare(b.startsOn),
  );
  return fits[0] ?? null;
}
