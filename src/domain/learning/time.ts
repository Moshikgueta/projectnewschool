// Time helpers that respect the student's own time zone: "this evening" and
// "practised on 3 days" must mean the student's evening and days, not the server's.

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function partOfDay(date: Date, timeZone: string): PartOfDay {
  const { hour } = localParts(date, timeZone);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(date: Date, timeZone: string): string {
  return localParts(date, timeZone).day;
}

/**
 * Number of distinct days, in the student's time zone, with any study in the
 * last 7 days (today included). Consistency, not volume: three short sessions
 * on three days count more than one long one.
 */
export function practiceDaysInLastWeek(
  occurredAt: readonly (string | Date)[],
  now: Date,
  timeZone: string,
): number {
  const windowDays = new Set<string>();
  for (let i = 0; i < 7; i += 1) {
    windowDays.add(localDay(new Date(now.getTime() - i * 86_400_000), timeZone));
  }
  const practised = new Set<string>();
  for (const value of occurredAt) {
    const day = localDay(new Date(value), timeZone);
    if (windowDays.has(day)) practised.add(day);
  }
  return practised.size;
}

/** Default weekly practice goal (ROADMAP.md, "Gamification stance"). */
export const WEEKLY_PRACTICE_GOAL = 3;
