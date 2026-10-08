import { describe, expect, it } from 'vitest';
import { checkSlot, findClash, formatTime, parseTime, weekGrid } from './timetable';

describe('times', () => {
  it('parses and formats times of day', () => {
    expect(parseTime('18:30')).toBe(1110);
    expect(parseTime('9:05')).toBe(545);
    expect(parseTime(' 07:00 ')).toBe(420);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('18.30')).toBeNull();
    expect(formatTime(1110)).toBe('18:30');
    expect(formatTime(545)).toBe('09:05');
  });

  it('accepts lessons within school hours only', () => {
    expect(checkSlot(2, 600, 690)).toBeNull();
    expect(checkSlot(7, 600, 690)).toBe('weekday');
    expect(checkSlot(2, null, 690)).toBe('time');
    expect(checkSlot(2, 690, 600)).toBe('order');
    expect(checkSlot(2, 360, 420)).toBe('hours'); // 06:00
    expect(checkSlot(2, 600, 610)).toBe('tooShort');
    expect(checkSlot(2, 480, 900)).toBe('tooLong');
  });
});

describe('clashes', () => {
  const booked = [
    { id: 'b1', roomId: 'r1', weekday: 2, start: 600, end: 690, title: 'English' },
    { id: 'b2', roomId: 'r2', weekday: 2, start: 600, end: 690, title: 'Spanish' },
  ];

  it('the same room, day and overlapping times clash; touching ends do not', () => {
    expect(findClash({ roomId: 'r1', weekday: 2, start: 660, end: 720 }, booked)?.id).toBe('b1');
    expect(findClash({ roomId: 'r1', weekday: 2, start: 690, end: 750 }, booked)).toBeNull();
    expect(findClash({ roomId: 'r1', weekday: 3, start: 600, end: 690 }, booked)).toBeNull();
    expect(findClash({ roomId: 'r3', weekday: 2, start: 600, end: 690 }, booked)).toBeNull();
  });

  it('a booking being moved does not clash with itself', () => {
    expect(
      findClash({ id: 'b1', roomId: 'r1', weekday: 2, start: 610, end: 700 }, booked),
    ).toBeNull();
  });
});

describe('week grid', () => {
  it('lays out school days × rooms in order, hiding empty inactive rooms', () => {
    const rooms = [
      { id: 'r2', name: 'Room 2', sortOrder: 2, active: true },
      { id: 'r1', name: 'Room 1', sortOrder: 1, active: true },
      { id: 'old', name: 'Old room', sortOrder: 0, active: false },
    ];
    const bookings = [
      { id: 'b2', roomId: 'r1', weekday: 0, start: 700, end: 760 },
      { id: 'b1', roomId: 'r1', weekday: 0, start: 600, end: 660 },
    ];
    const grid = weekGrid(rooms, bookings);
    expect(grid).toHaveLength(6);
    expect(grid[0]?.rooms.map((r) => r.room.id)).toEqual(['r1', 'r2']);
    expect(grid[0]?.rooms[0]?.bookings.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(grid[1]?.rooms[0]?.bookings).toEqual([]);
  });
});
