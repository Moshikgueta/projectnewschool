// Moving the staff room's D1 data into the platform (docs/STAFF-ROOM-MERGE.md).
// Pure: given what D1 holds and what the platform already has, decide what to
// create, what is already there, and what to leave for a person to look at.
// scripts/staff-room-import.ts reads both sides and carries the plan out.
//
// Rules, all conservative: disabled accounts and unknown roles are not
// imported; nothing is ever deleted or overwritten; a role is never added to
// an account on the other side of the student/staff line; codes go to
// students only; a booking that would clash is reported, not forced.

import type { Role } from '@/domain/auth/access';
import { checkSlot, findClash, formatTime } from '@/domain/scheduling/timetable';

export type D1User = {
  id: string;
  email: string;
  role: string;
  name: string;
  active: number;
};
export type D1Code = {
  userId: string;
  codeHash: string;
  issuedBy: string | null;
  createdAt: number;
};
export type D1Room = {
  id: string;
  name: string;
  capacity: number;
  kit: string;
  active: number;
  sortOrder: number;
};
export type D1Booking = {
  id: string;
  roomId: string;
  title: string;
  teacher: string;
  weekday: number;
  startMin: number;
  endMin: number;
  note: string;
  createdBy: string | null;
};
export type StaffRoomData = {
  users: D1User[];
  codes: D1Code[];
  rooms: D1Room[];
  bookings: D1Booking[];
};

export type Existing = {
  users: { id: string; email: string; displayName: string; roles: Role[] }[];
  rooms: { id: string; name: string }[];
  bookings: {
    id: string;
    roomId: string;
    weekday: number;
    start: number;
    end: number;
    title: string;
  }[];
  codes: { userId: string; codeHash: string }[];
};

/** A person on the platform: an account that exists, or one this import creates. */
export type PersonRef = { existingId: string } | { d1Id: string };
export type RoomRef = { existingId: string } | { d1Id: string };

export type AccountStep = {
  d1Id: string;
  email: string;
  name: string;
  role: Role;
  /** create: new account · addRole: existing account gains the role · present: nothing to do */
  action: 'create' | 'addRole' | 'present';
  existingId: string | null;
};
export type CodeStep = {
  student: PersonRef;
  email: string;
  codeHash: string;
  issuedBy: PersonRef | null;
  createdAt: string;
};
export type RoomStep = {
  d1Id: string;
  name: string;
  action: 'create' | 'present';
  existingId: string | null;
  capacity: number;
  kit: string;
  active: boolean;
  sortOrder: number;
};
export type BookingStep = {
  d1Id: string;
  room: RoomRef;
  roomName: string;
  title: string;
  weekday: number;
  start: number;
  end: number;
  note: string;
  teacher: PersonRef | null;
  createdBy: PersonRef | null;
};
export type Notice = { what: string; reason: string };

export type ImportPlan = {
  accounts: AccountStep[];
  codes: CodeStep[];
  rooms: RoomStep[];
  bookings: BookingStep[];
  /** Already on the platform exactly as in D1. */
  unchanged: { codes: number; bookings: number };
  /** Left out, each with the reason: for a person to review. */
  notices: Notice[];
};

/** The staff room's role names (Hebrew, as stored in D1) → platform roles. */
export const ROLE_MAP: Record<string, Role> = {
  מורה: 'teacher',
  'מנהל פדגוגי': 'pedagogical_manager',
  אדמין: 'admin',
  'מנהלת קבלה': 'office',
  תלמיד: 'student',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASH = /^[0-9a-f]{64}$/;
const isStaff = (role: Role) => role !== 'student';
const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

function refKey(ref: PersonRef | RoomRef): string {
  return 'existingId' in ref ? `e:${ref.existingId}` : `d:${ref.d1Id}`;
}

export function planImport(d1: StaffRoomData, existing: Existing): ImportPlan {
  const notices: Notice[] = [];
  const accounts: AccountStep[] = [];
  const byEmail = new Map(existing.users.map((u) => [u.email.trim().toLowerCase(), u]));

  // ── accounts ─────────────────────────────────────────────────────────────
  for (const u of d1.users) {
    const who = `${u.name} <${u.email}>`;
    const role = ROLE_MAP[u.role.trim()];
    const email = u.email.trim().toLowerCase();
    if (!u.active) {
      notices.push({
        what: who,
        reason: 'disabled or awaiting approval in the staff room: not imported',
      });
      continue;
    }
    if (!role) {
      notices.push({ what: who, reason: `unknown role "${u.role}": not imported` });
      continue;
    }
    if (!EMAIL.test(email) || email.length > 254) {
      notices.push({ what: who, reason: 'no usable email address: not imported' });
      continue;
    }
    const name = u.name.trim().slice(0, 120) || email.split('@')[0]!;
    const found = byEmail.get(email);
    if (!found) {
      accounts.push({ d1Id: u.id, email, name, role, action: 'create', existingId: null });
      continue;
    }
    if (found.roles.includes(role)) {
      accounts.push({ d1Id: u.id, email, name, role, action: 'present', existingId: found.id });
      continue;
    }
    // Never move an account across the student/staff line automatically: a
    // student account gaining staff powers (or the reverse) is for an admin.
    if (found.roles.some((r) => isStaff(r) !== isStaff(role))) {
      notices.push({
        what: who,
        reason: `the platform account with this email is ${found.roles.join(', ')}; the staff room says ${role}. Not changed: an admin decides in /admin`,
      });
      continue;
    }
    accounts.push({ d1Id: u.id, email, name, role, action: 'addRole', existingId: found.id });
  }

  const accountByD1 = new Map(accounts.map((a) => [a.d1Id, a]));
  const person = (d1Id: string | null): PersonRef | null => {
    const a = d1Id ? accountByD1.get(d1Id) : undefined;
    if (!a) return null;
    return a.existingId ? { existingId: a.existingId } : { d1Id: a.d1Id };
  };

  // ── student codes ────────────────────────────────────────────────────────
  const codes: CodeStep[] = [];
  let codesUnchanged = 0;
  const hashOwner = new Map(existing.codes.map((c) => [c.codeHash, c.userId]));
  const hasCode = new Set(existing.codes.map((c) => c.userId));
  for (const c of d1.codes) {
    const a = accountByD1.get(c.userId);
    const label = a
      ? `entry code of ${a.name} <${a.email}>`
      : `entry code of staff-room user ${c.userId}`;
    if (!a) {
      notices.push({ what: label, reason: 'the account is not imported (see above)' });
      continue;
    }
    if (a.role !== 'student') {
      notices.push({ what: label, reason: 'codes are for students only: not imported' });
      continue;
    }
    if (!HASH.test(c.codeHash)) {
      notices.push({ what: label, reason: 'stored value is not a SHA-256 hash: not imported' });
      continue;
    }
    const owner = hashOwner.get(c.codeHash);
    if (a.existingId && owner === a.existingId) {
      codesUnchanged++;
      continue;
    }
    if (owner) {
      notices.push({
        what: label,
        reason: 'the same code belongs to another platform account: not imported',
      });
      continue;
    }
    if (a.existingId && hasCode.has(a.existingId)) {
      notices.push({
        what: label,
        reason: 'the student already has a newer code on the platform: kept that one',
      });
      continue;
    }
    codes.push({
      student: person(a.d1Id)!,
      email: a.email,
      codeHash: c.codeHash,
      issuedBy: person(c.issuedBy),
      createdAt: new Date(c.createdAt).toISOString(),
    });
  }

  // ── rooms ────────────────────────────────────────────────────────────────
  const rooms: RoomStep[] = [];
  const roomByName = new Map(existing.rooms.map((r) => [r.name.trim(), r]));
  for (const r of d1.rooms) {
    const name = r.name.trim();
    if (!name || name.length > 80) {
      notices.push({
        what: `room "${r.name}"`,
        reason: 'name is empty or longer than 80 characters: not imported',
      });
      continue;
    }
    const found = roomByName.get(name);
    const capacity =
      Number.isInteger(r.capacity) && r.capacity >= 0 && r.capacity <= 500 ? r.capacity : 0;
    if (capacity !== r.capacity) {
      notices.push({
        what: `room "${name}"`,
        reason: `capacity ${r.capacity} is not 0–500: imported as "not stated"`,
      });
    }
    let kit = r.kit.trim();
    if (kit.length > 300) {
      notices.push({ what: `room "${name}"`, reason: 'equipment note cut to 300 characters' });
      kit = kit.slice(0, 300);
    }
    rooms.push({
      d1Id: r.id,
      name,
      action: found ? 'present' : 'create',
      existingId: found?.id ?? null,
      capacity,
      kit,
      active: Boolean(r.active),
      sortOrder: Math.max(0, Math.trunc(r.sortOrder) || 0),
    });
  }
  const roomByD1 = new Map(rooms.map((r) => [r.d1Id, r]));

  // ── bookings ─────────────────────────────────────────────────────────────
  // Teachers a booking's free-text name can match: platform teachers by
  // display name, and teachers this import creates by their staff-room name.
  const teacherPool: { ref: PersonRef; name: string }[] = [
    ...existing.users
      .filter((u) => u.roles.includes('teacher'))
      .map((u) => ({ ref: { existingId: u.id } as PersonRef, name: u.displayName })),
    ...accounts
      .filter((a) => a.role === 'teacher')
      .map((a) => ({ ref: person(a.d1Id)!, name: a.name })),
  ];

  const bookings: BookingStep[] = [];
  let bookingsUnchanged = 0;
  const placed = existing.bookings.map((b) => ({ ...b, key: `e:${b.roomId}` }));
  for (const b of d1.bookings) {
    const room = roomByD1.get(b.roomId);
    const label = `booking "${b.title}" ${room ? `in ${room.name} ` : ''}on day ${b.weekday}, ${formatTime(b.startMin)}–${formatTime(b.endMin)}`;
    if (!room) {
      notices.push({ what: label, reason: 'its room is not imported: not imported' });
      continue;
    }
    const roomRef: RoomRef = room.existingId
      ? { existingId: room.existingId }
      : { d1Id: room.d1Id };
    const key = refKey(roomRef);
    const title = b.title.trim().slice(0, 160);
    const problem = checkSlot(b.weekday, b.startMin, b.endMin);
    if (!title || problem) {
      notices.push({
        what: label,
        reason: `not a valid lesson slot (${problem ?? 'no title'}): not imported`,
      });
      continue;
    }
    const same = placed.find(
      (p) =>
        p.key === key && p.weekday === b.weekday && p.start === b.startMin && p.end === b.endMin,
    );
    if (same && sameName(same.title, title)) {
      bookingsUnchanged++;
      continue;
    }
    const clash = findClash(
      { roomId: key, weekday: b.weekday, start: b.startMin, end: b.endMin },
      placed.map((p) => ({ ...p, roomId: p.key })),
    );
    if (clash) {
      notices.push({
        what: label,
        reason: `clashes with "${clash.title}" ${formatTime(clash.start)}–${formatTime(clash.end)} in the same room: not imported`,
      });
      continue;
    }

    let teacher: PersonRef | null = null;
    let note = b.note.trim();
    const teacherText = b.teacher.trim();
    if (teacherText) {
      const matches = new Map(
        teacherPool.filter((t) => sameName(t.name, teacherText)).map((t) => [refKey(t.ref), t.ref]),
      );
      if (matches.size === 1) {
        teacher = [...matches.values()][0]!;
      } else {
        // Keep the name where the office will see it, and say why.
        note = [`Teacher: ${teacherText}`, note].filter(Boolean).join(' · ');
        notices.push({
          what: label,
          reason:
            matches.size === 0
              ? `no platform teacher is called "${teacherText}": name kept in the note`
              : `several teachers are called "${teacherText}": name kept in the note`,
        });
      }
    }
    if (note.length > 500) note = note.slice(0, 500);

    bookings.push({
      d1Id: b.id,
      room: roomRef,
      roomName: room.name,
      title,
      weekday: b.weekday,
      start: b.startMin,
      end: b.endMin,
      note,
      teacher,
      createdBy: person(b.createdBy),
    });
    placed.push({
      id: `d1:${b.id}`,
      roomId: '',
      key,
      weekday: b.weekday,
      start: b.startMin,
      end: b.endMin,
      title,
    });
  }

  return {
    accounts,
    codes,
    rooms,
    bookings,
    unchanged: { codes: codesUnchanged, bookings: bookingsUnchanged },
    notices,
  };
}
