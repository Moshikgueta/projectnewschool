import { describe, expect, it } from 'vitest';
import { planImport, type Existing, type StaffRoomData } from './staff-room';

const H = (c: string) => c.repeat(64);

const d1: StaffRoomData = {
  users: [
    { id: 'u-teach', email: 'Yael@School.example', role: 'מורה', name: 'Yael Cohen', active: 1 },
    { id: 'u-admin', email: 'boss@school.example', role: 'אדמין', name: 'Boss', active: 1 },
    { id: 'u-office', email: 'rina@school.example', role: 'מנהלת קבלה', name: 'Rina', active: 1 },
    { id: 'u-stu', email: 'noa@school.example', role: 'תלמיד', name: 'Noa', active: 1 },
    { id: 'u-stu2', email: 'dan@school.example', role: 'תלמיד', name: 'Dan', active: 1 },
    { id: 'u-off', email: 'gone@school.example', role: 'מורה', name: 'Gone', active: 0 },
    { id: 'u-odd', email: 'odd@school.example', role: 'מתנדב', name: 'Odd', active: 1 },
    // Already on the platform as a student; the staff room says teacher.
    {
      id: 'u-cross',
      email: 'existing.student@school.example',
      role: 'מורה',
      name: 'Cross',
      active: 1,
    },
    // Already on the platform as a teacher; gains pedagogical manager.
    {
      id: 'u-pm',
      email: 'existing.teacher@school.example',
      role: 'מנהל פדגוגי',
      name: 'Avi',
      active: 1,
    },
  ],
  codes: [
    { userId: 'u-stu', codeHash: H('a'), issuedBy: 'u-teach', createdAt: Date.UTC(2026, 8, 1) },
    { userId: 'u-teach', codeHash: H('b'), issuedBy: null, createdAt: 0 },
    { userId: 'u-off', codeHash: H('c'), issuedBy: null, createdAt: 0 },
    { userId: 'u-stu2', codeHash: 'NOT-A-HASH', issuedBy: null, createdAt: 0 },
  ],
  rooms: [
    { id: 'r1', name: ' כיתה 1 ', capacity: 12, kit: 'projector', active: 1, sortOrder: 1 },
    { id: 'r2', name: 'כיתה 2', capacity: 9000, kit: '', active: 0, sortOrder: 2 },
  ],
  bookings: [
    {
      id: 'b1',
      roomId: 'r1',
      title: 'English A1',
      teacher: 'yael  cohen',
      weekday: 2,
      startMin: 600,
      endMin: 690,
      note: '',
      createdBy: 'u-office',
    },
    {
      id: 'b2',
      roomId: 'r1',
      title: 'Overlap',
      teacher: '',
      weekday: 2,
      startMin: 660,
      endMin: 720,
      note: '',
      createdBy: null,
    },
    {
      id: 'b3',
      roomId: 'r2',
      title: 'Spanish',
      teacher: 'Someone Else',
      weekday: 3,
      startMin: 1080,
      endMin: 1170,
      note: 'bring books',
      createdBy: null,
    },
    {
      id: 'b4',
      roomId: 'r2',
      title: 'Already there',
      teacher: '',
      weekday: 4,
      startMin: 600,
      endMin: 660,
      note: '',
      createdBy: null,
    },
    {
      id: 'b5',
      roomId: 'r2',
      title: 'Hits existing',
      teacher: '',
      weekday: 4,
      startMin: 630,
      endMin: 700,
      note: '',
      createdBy: null,
    },
    {
      id: 'b6',
      roomId: 'r9',
      title: 'No room',
      teacher: '',
      weekday: 1,
      startMin: 600,
      endMin: 660,
      note: '',
      createdBy: null,
    },
    {
      id: 'b7',
      roomId: 'r1',
      title: 'Too late',
      teacher: '',
      weekday: 1,
      startMin: 1380,
      endMin: 1430,
      note: '',
      createdBy: null,
    },
  ],
};

const existing: Existing = {
  users: [
    {
      id: 'p-stu',
      email: 'existing.student@school.example',
      displayName: 'Cross',
      roles: ['student'],
    },
    {
      id: 'p-teach',
      email: 'existing.teacher@school.example',
      displayName: 'Avi',
      roles: ['teacher'],
    },
  ],
  rooms: [{ id: 'room-2', name: 'כיתה 2' }],
  bookings: [
    { id: 'eb', roomId: 'room-2', weekday: 4, start: 600, end: 660, title: 'already there' },
  ],
  codes: [],
};

describe('planning the staff-room import', () => {
  const plan = planImport(d1, existing);
  const reasonFor = (what: string) => plan.notices.find((n) => n.what.includes(what))?.reason;

  it('imports active accounts with mapped roles, and never crosses the student/staff line', () => {
    expect(plan.accounts.map((a) => [a.email, a.role, a.action])).toEqual([
      ['yael@school.example', 'teacher', 'create'],
      ['boss@school.example', 'admin', 'create'],
      ['rina@school.example', 'office', 'create'],
      ['noa@school.example', 'student', 'create'],
      ['dan@school.example', 'student', 'create'],
      ['existing.teacher@school.example', 'pedagogical_manager', 'addRole'],
    ]);
    expect(reasonFor('Gone')).toMatch(/disabled/);
    expect(reasonFor('Odd')).toMatch(/unknown role/);
    expect(reasonFor('Cross')).toMatch(/is student; the staff room says teacher/);
  });

  it('copies code hashes for students only', () => {
    expect(plan.codes).toEqual([
      {
        student: { d1Id: 'u-stu' },
        email: 'noa@school.example',
        codeHash: H('a'),
        issuedBy: { d1Id: 'u-teach' },
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(reasonFor('entry code of Yael')).toMatch(/students only/);
    expect(reasonFor('entry code of staff-room user u-off')).toMatch(/not imported/);
    expect(reasonFor('entry code of Dan')).toMatch(/not a SHA-256/);
  });

  it('matches rooms by name and keeps the values the platform accepts', () => {
    expect(plan.rooms.map((r) => [r.name, r.action, r.existingId, r.capacity, r.active])).toEqual([
      ['כיתה 1', 'create', null, 12, true],
      ['כיתה 2', 'present', 'room-2', 0, false],
    ]);
    expect(reasonFor('room "כיתה 2"')).toMatch(/capacity 9000/);
  });

  it('places bookings without clashes, matching teachers by name or keeping the name in the note', () => {
    expect(plan.bookings.map((b) => [b.d1Id, b.teacher, b.note, b.createdBy])).toEqual([
      ['b1', { d1Id: 'u-teach' }, '', { d1Id: 'u-office' }],
      ['b3', null, 'Teacher: Someone Else · bring books', null],
    ]);
    expect(plan.bookings[1]?.room).toEqual({ existingId: 'room-2' });
    expect(plan.unchanged).toEqual({ codes: 0, bookings: 1 });
    expect(reasonFor('"Overlap"')).toMatch(/clashes with "English A1" 10:00–11:30/);
    expect(reasonFor('"Hits existing"')).toMatch(/clashes with "already there"/);
    expect(reasonFor('"No room"')).toMatch(/room is not imported/);
    expect(reasonFor('"Too late"')).toMatch(/hours/);
    expect(reasonFor('"Spanish"')).toMatch(/no platform teacher is called "Someone Else"/);
  });

  it('a second run over its own result changes nothing', () => {
    const after: Existing = {
      users: [
        ...existing.users.map((u) =>
          u.id === 'p-teach' ? { ...u, roles: [...u.roles, 'pedagogical_manager' as const] } : u,
        ),
        ...plan.accounts
          .filter((a) => a.action === 'create')
          .map((a) => ({
            id: `p-${a.d1Id}`,
            email: a.email,
            displayName: a.name,
            roles: [a.role],
          })),
      ],
      rooms: [...existing.rooms, { id: 'room-1', name: 'כיתה 1' }],
      bookings: [
        ...existing.bookings,
        { id: 'n1', roomId: 'room-1', weekday: 2, start: 600, end: 690, title: 'English A1' },
        { id: 'n3', roomId: 'room-2', weekday: 3, start: 1080, end: 1170, title: 'Spanish' },
      ],
      codes: [{ userId: 'p-u-stu', codeHash: H('a') }],
    };
    const again = planImport(d1, after);
    expect(again.accounts.every((a) => a.action === 'present')).toBe(true);
    expect(again.codes).toEqual([]);
    expect(again.rooms.every((r) => r.action === 'present')).toBe(true);
    expect(again.bookings).toEqual([]);
    expect(again.unchanged).toEqual({ codes: 1, bookings: 3 });
  });

  it('keeps a newer platform code and refuses a hash that belongs to someone else', () => {
    const withCodes: Existing = {
      ...existing,
      users: [
        ...existing.users,
        { id: 'p-noa', email: 'noa@school.example', displayName: 'Noa', roles: ['student'] },
      ],
      codes: [{ userId: 'p-noa', codeHash: H('f') }],
    };
    expect(planImport(d1, withCodes).codes).toEqual([]);
    const taken: Existing = { ...existing, codes: [{ userId: 'p-other', codeHash: H('a') }] };
    const plan2 = planImport(d1, taken);
    expect(plan2.codes).toEqual([]);
    expect(plan2.notices.find((n) => n.what.includes('entry code of Noa'))?.reason).toMatch(
      /another platform account/,
    );
  });
});
