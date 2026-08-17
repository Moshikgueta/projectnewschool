/* /api/staff/bookings/:id — one slot on the timetable.
     PATCH  → move it (room · day · time) or retitle it
     DELETE → free the slot

   Office only. A move re-runs the same double-booking check a new booking
   gets, ignoring the row being moved — otherwise shifting a lesson by ten
   minutes would collide with the version of itself still in the table. */

import { json } from '../../_shared.js';
import { readJson } from '../../_staff.js';
import {
  requireBooker, publicBooking, parseTime, checkSlot, findClash, clashMessage
} from '../../_rooms.js';

function load(env, id) {
  return env.DB.prepare(
    `SELECT b.*, r.name AS room_name FROM room_bookings b
       JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`
  ).bind(id).first();
}

export async function onRequestPatch({ request, env, params }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'השיבוץ לא נמצא.' }, 404);

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  /* Start from what is stored and overlay only what was sent, so a request
     that moves the day alone still gets validated against the real times
     rather than against undefined. */
  let roomId = target.room_id, weekday = target.weekday;
  let start = target.start_min, end = target.end_min;

  if (b.roomId !== undefined) {
    roomId = String(b.roomId).trim();
    const room = await env.DB.prepare('SELECT id FROM rooms WHERE id=?').bind(roomId).first();
    if (!room) return json({ ok: false, error: 'החדר לא נמצא.' }, 404);
  }
  if (b.day !== undefined) weekday = parseInt(b.day, 10);
  if (b.from !== undefined) start = parseTime(b.from);
  if (b.to !== undefined) end = parseTime(b.to);

  const moving = b.roomId !== undefined || b.day !== undefined ||
    b.from !== undefined || b.to !== undefined;

  if (moving) {
    const bad = checkSlot(weekday, start, end);
    if (bad) return json({ ok: false, error: bad }, 400);
    const clash = await findClash(env, { roomId, weekday, start, end, exceptId: target.id });
    if (clash) return json({ ok: false, error: clashMessage(clash), clash: publicBooking(clash) }, 409);
  }

  const sets = ['room_id=?', 'weekday=?', 'start_min=?', 'end_min=?'];
  const vals = [roomId, weekday, start, end];
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return json({ ok: false, error: 'צריך שם לשיעור' }, 400);
    sets.push('title=?'); vals.push(title);
  }
  if (b.teacher !== undefined) { sets.push('teacher=?'); vals.push(String(b.teacher).trim()); }
  if (b.note !== undefined) { sets.push('note=?'); vals.push(String(b.note).trim()); }

  await env.DB.prepare(`UPDATE room_bookings SET ${sets.join(', ')} WHERE id=?`)
    .bind(...vals, target.id).run();

  return json({ ok: true, booking: publicBooking(await load(env, target.id)) });
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'השיבוץ לא נמצא.' }, 404);

  await env.DB.prepare('DELETE FROM room_bookings WHERE id=?').bind(target.id).run();
  return json({ ok: true });
}
