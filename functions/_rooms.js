/* Rooms and the weekly timetable — shared helpers.

   Kept apart from _staff.js because that file is about who you are, and this
   one is about where the school is teaching. They meet only at the guards. */

import { json } from './_shared.js';
import { currentStaff, randomId } from './_staff.js';

/* Sunday first, matching JS getDay() and the Israeli school week. Saturday is
   present so a one-off Saturday intensive can be recorded; it just sits at the
   end of the grid. */
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* The school day. Bookings outside it are refused rather than silently drawn
   off the edge of the grid. */
const DAY_START = 6 * 60;        /* 06:00 */
const DAY_END = 23 * 60;         /* 23:00 */
const MIN_SLOT = 15;             /* a lesson shorter than this is a typo */

/* Booking is the office's job — reception schedules, the admin oversees.
   Teachers read the timetable; they do not move each other's rooms, which is
   how two people quietly end up in one room. */
const BOOKING_ROLES = ['אדמין', 'מנהלת קבלה'];

/* ── time ──────────────────────────────────────────────────────────────── */

/* '10:00' and '10.00' and '1000' all mean the same thing to someone typing
   quickly. Returns minutes from midnight, or null if it is not a time. */
export function parseTime(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  const m = /^(\d{1,2})[:.\s]?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/* ── validation ────────────────────────────────────────────────────────── */

/* Returns an error string, or null when the slot is sane on its own terms.
   Says nothing about whether the room is free — that is the caller's next
   question, and it needs the database. */
export function checkSlot(weekday, start, end) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return 'צריך לבחור יום בשבוע';
  if (start == null) return 'שעת ההתחלה לא תקינה — לדוגמה 10:00';
  if (end == null) return 'שעת הסיום לא תקינה — לדוגמה 11:30';
  if (end <= start) return 'שעת הסיום צריכה להיות אחרי שעת ההתחלה';
  if (end - start < MIN_SLOT) return `שיעור קצר מ-${MIN_SLOT} דקות — כנראה טעות הקלדה`;
  if (start < DAY_START || end > DAY_END) {
    return `השיבוץ צריך להיות בין ${formatTime(DAY_START)} ל-${formatTime(DAY_END)}`;
  }
  return null;
}

/* ── the double-booking guard ──────────────────────────────────────────── */

/* Two slots collide when they share a room and a weekday and their minute
   ranges overlap: start < other.end AND end > other.start. Touching ends do
   not collide — a lesson ending at 11:00 and one starting at 11:00 are back
   to back, which is normal and must stay allowed.

   `exceptId` lets an edit ignore the row being edited; without it, moving a
   booking by ten minutes would collide with itself. */
export function findClash(env, { roomId, weekday, start, end, exceptId }) {
  return env.DB.prepare(
    `SELECT b.*, r.name AS room_name
       FROM room_bookings b JOIN rooms r ON r.id = b.room_id
      WHERE b.room_id = ? AND b.weekday = ?
        AND b.start_min < ? AND b.end_min > ?
        AND (? IS NULL OR b.id <> ?)
      LIMIT 1`
  ).bind(roomId, weekday, end, start, exceptId || null, exceptId || '').first();
}

export function clashMessage(row) {
  return `החדר תפוס ביום ${DAYS[row.weekday]} בין ${formatTime(row.start_min)} ל-${formatTime(row.end_min)}` +
    ` — ${row.title}` + (row.teacher ? ` (${row.teacher})` : '');
}

/* ── shapes ────────────────────────────────────────────────────────────── */

export function publicRoom(r) {
  return {
    id: r.id, name: r.name,
    capacity: r.capacity || 0,
    kit: r.kit || '',
    active: !!r.active,
    order: r.sort_order || 0
  };
}

/* Times go out both ways: the numbers for arithmetic in the grid, and the
   strings so no screen has to reimplement the formatting. */
export function publicBooking(b) {
  return {
    id: b.id, roomId: b.room_id, room: b.room_name || '',
    title: b.title, teacher: b.teacher || '', note: b.note || '',
    day: b.weekday, dayName: DAYS[b.weekday] || '',
    start: b.start_min, end: b.end_min,
    from: formatTime(b.start_min), to: formatTime(b.end_min),
    mins: b.end_min - b.start_min
  };
}

/* ── guards ────────────────────────────────────────────────────────────── */

/* Anyone signed in may read the timetable — a teacher who cannot see which
   room they are in is the problem this screen exists to solve. */
export async function requireViewer(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: json({ ok: false, error: 'נדרשת התחברות.' }, 401) };
  return { user };
}

export async function requireBooker(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: json({ ok: false, error: 'נדרשת התחברות.' }, 401) };
  if (BOOKING_ROLES.indexOf(user.role) < 0) {
    return { res: json({ ok: false, error: 'שיבוץ חדרים נעשה במשרד בית הספר.' }, 403) };
  }
  return { user };
}

export { randomId };
