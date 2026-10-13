// Attendance per class (staff room merge, stage C). Pure helpers for the
// teacher's "today" page, the attendance form and the group's students table.
// The database decides who may mark what; these only shape what is shown.

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Attendance opens this long before a class starts (as in the database policy). */
export const OPENS_BEFORE_MS = 30 * 60_000;
/** Classes this far back still nag the teacher if attendance is missing. */
export const TO_TAKE_WINDOW_MS = 14 * 86_400_000;

export function isAttendanceOpen(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() <= OPENS_BEFORE_MS;
}

/**
 * Classes attended out of classes that count: present and late count as
 * attended, absent counts against, excused is left out of both.
 */
export function attendanceByStudent(
  marks: readonly { studentId: string; status: AttendanceStatus }[],
): Map<string, { attended: number; counted: number }> {
  const out = new Map<string, { attended: number; counted: number }>();
  for (const m of marks) {
    if (m.status === 'excused') continue;
    const row = out.get(m.studentId) ?? { attended: 0, counted: 0 };
    row.counted++;
    if (m.status !== 'absent') row.attended++;
    out.set(m.studentId, row);
  }
  return out;
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export type ClassForToday = {
  id: string;
  groupId: string;
  startsAt: string;
  /** Students who can be marked (enrolled, active or paused). */
  students: number;
  marked: number;
};

/**
 * The teacher's day: today's classes in time order, and earlier classes from
 * the last two weeks whose attendance is still incomplete (oldest first).
 */
export function teacherDay<T extends ClassForToday>(
  classes: readonly T[],
  now: Date,
  timeZone: string,
): { today: T[]; toTake: T[] } {
  const today = localDay(now, timeZone);
  const byTime = [...classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    today: byTime.filter((c) => localDay(new Date(c.startsAt), timeZone) === today),
    toTake: byTime.filter((c) => {
      const start = new Date(c.startsAt);
      return (
        localDay(start, timeZone) !== today &&
        start.getTime() < now.getTime() &&
        now.getTime() - start.getTime() <= TO_TAKE_WINDOW_MS &&
        c.marked < c.students
      );
    }),
  };
}
