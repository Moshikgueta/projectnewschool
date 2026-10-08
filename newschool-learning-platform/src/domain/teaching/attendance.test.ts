import { describe, expect, it } from 'vitest';
import { attendanceByStudent, isAttendanceOpen, localDay, teacherDay } from './attendance';

describe('attendance', () => {
  it('opens 30 minutes before the class', () => {
    const start = new Date('2026-10-06T18:00:00Z');
    expect(isAttendanceOpen(start, new Date('2026-10-06T17:29:00Z'))).toBe(false);
    expect(isAttendanceOpen(start, new Date('2026-10-06T17:30:00Z'))).toBe(true);
    expect(isAttendanceOpen(start, new Date('2026-10-07T09:00:00Z'))).toBe(true);
  });

  it('counts present and late as attended, and leaves excused out', () => {
    const rates = attendanceByStudent([
      { studentId: 'a', status: 'present' },
      { studentId: 'a', status: 'late' },
      { studentId: 'a', status: 'absent' },
      { studentId: 'a', status: 'excused' },
      { studentId: 'b', status: 'excused' },
    ]);
    expect(rates.get('a')).toEqual({ attended: 2, counted: 3 });
    expect(rates.has('b')).toBe(false);
  });

  it('finds the calendar day in the teacher’s time zone', () => {
    // 22:30 UTC on the 6th is already the 7th in Israel (UTC+3 in October).
    expect(localDay(new Date('2026-10-06T22:30:00Z'), 'Asia/Jerusalem')).toBe('2026-10-07');
    expect(localDay(new Date('2026-10-06T22:30:00Z'), 'UTC')).toBe('2026-10-06');
  });

  it('lists today’s classes, and earlier ones still missing attendance', () => {
    const now = new Date('2026-10-06T12:00:00Z'); // 15:00 in Israel
    const c = (id: string, startsAt: string, marked: number) => ({
      id,
      groupId: 'g',
      startsAt,
      students: 3,
      marked,
    });
    const day = teacherDay(
      [
        c('tonight', '2026-10-06T15:00:00Z', 0),
        c('morning', '2026-10-06T06:00:00Z', 3),
        c('yesterday-done', '2026-10-05T15:00:00Z', 3),
        c('yesterday-open', '2026-10-05T16:00:00Z', 2),
        c('last-month', '2026-09-01T15:00:00Z', 0),
        c('tomorrow', '2026-10-07T15:00:00Z', 0),
        // 23:30 UTC on the 5th is 02:30 on the 6th in Israel: today.
        c('after-midnight', '2026-10-05T23:30:00Z', 0),
      ],
      now,
      'Asia/Jerusalem',
    );
    expect(day.today.map((x) => x.id)).toEqual(['after-midnight', 'morning', 'tonight']);
    expect(day.toTake.map((x) => x.id)).toEqual(['yesterday-open']);
  });
});
