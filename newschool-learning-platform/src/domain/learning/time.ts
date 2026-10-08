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

/** Minutes the zone is ahead of UTC at an instant (Jerusalem in summer: 180). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant at which a wall-clock time ("2026-10-08T18:00", as typed into a
 * date/time field) happens in a time zone, across daylight-saving changes.
 * Null for malformed input.
 */
export function zonedTimeToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  let result = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Re-check at the result: the offset can differ when a DST change falls in between.
  result = guess - zoneOffsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}
