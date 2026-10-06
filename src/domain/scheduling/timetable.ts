// The weekly timetable (moved from the staff room, docs/STAFF-ROOM-MERGE.md).
// One booking = one recurring weekly slot. Times are minutes from midnight and
// weekdays run 0 = Sunday … 6 = Saturday, the Israeli week, as in the staff room.
// The database refuses overlaps itself; these helpers validate input early,
// describe clashes and lay the week out.

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** The school's teaching days (Sunday to Friday). */
export const SCHOOL_DAYS = [0, 1, 2, 3, 4, 5] as const;
/** Bookable hours: 07:00 to 23:00. */
export const DAY_START = 7 * 60;
export const DAY_END = 23 * 60;
/** Shortest and longest lesson. */
export const MIN_LENGTH = 15;
export const MAX_LENGTH = 6 * 60;

/** "18:30" or "9:05" → minutes from midnight; null if not a time. */
export function parseTime(input: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 1110 → "18:30". */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type SlotProblem = 'weekday' | 'time' | 'order' | 'hours' | 'tooShort' | 'tooLong';

/** Why a slot cannot be booked, or null if it is fine. */
export function checkSlot(
  weekday: number,
  start: number | null,
  end: number | null,
): SlotProblem | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return 'weekday';
  if (start === null || end === null) return 'time';
  if (end <= start) return 'order';
  if (start < DAY_START || end > DAY_END) return 'hours';
  if (end - start < MIN_LENGTH) return 'tooShort';
  if (end - start > MAX_LENGTH) return 'tooLong';
  return null;
}

export type Slot = { id: string; roomId: string; weekday: number; start: number; end: number };

/** The booking a new slot would collide with (same room, same day, overlapping times). */
export function findClash<T extends Slot>(
  slot: Omit<Slot, 'id'> & { id?: string },
  existing: readonly T[],
): T | null {
  return (
    existing.find(
      (b) =>
        b.id !== slot.id &&
        b.roomId === slot.roomId &&
        b.weekday === slot.weekday &&
        slot.start < b.end &&
        slot.end > b.start,
    ) ?? null
  );
}

/**
 * The week as the grid reads it: for each school day, each room's bookings in
 * time order. Rooms in their sort order; inactive rooms only if they still
 * have bookings.
 */
export function weekGrid<
  R extends { id: string; active: boolean; sortOrder: number; name: string },
  B extends Slot,
>(rooms: readonly R[], bookings: readonly B[], days: readonly number[] = SCHOOL_DAYS) {
  const shown = rooms
    .filter((r) => r.active || bookings.some((b) => b.roomId === r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return days.map((weekday) => ({
    weekday,
    rooms: shown.map((room) => ({
      room,
      bookings: bookings
        .filter((b) => b.roomId === room.id && b.weekday === weekday)
        .sort((a, b) => a.start - b.start),
    })),
  }));
}
