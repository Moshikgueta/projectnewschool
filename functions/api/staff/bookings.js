/* /api/staff/bookings — the weekly timetable.
     GET  → every slot, ordered as the grid reads it (anyone signed in)
     POST → book a room, refusing a double booking (office only)

   One row per recurring weekly slot: the same class, the same room, every
   Tuesday. That is the shape a language school's week actually has, and it is
   what makes "which rooms are free on Tuesday" a query rather than a survey. */

import { json } from '../../_shared.js';
import { readJson } from '../../_staff.js';
import {
  requireViewer, requireBooker, publicBooking, parseTime, checkSlot,
  findClash, clashMessage, randomId
} from '../../_rooms.js';

export async function onRequestGet({ request, env }) {
  const guard = await requireViewer(request, env);
  if (guard.res) return guard.res;

  const { results } = await env.DB.prepare(
    `SELECT b.*, r.name AS room_name
       FROM room_bookings b JOIN rooms r ON r.id = b.room_id
      ORDER BY b.weekday, b.start_min, r.sort_order, r.name`
  ).all();
  return json({ ok: true, bookings: (results || []).map(publicBooking) });
}

export async function onRequestPost({ request, env }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const roomId = String(b.roomId || '').trim();
  const title = String(b.title || '').trim();
  if (!roomId) return json({ ok: false, error: 'צריך לבחור חדר' }, 400);
  if (!title) return json({ ok: false, error: 'צריך שם לשיעור' }, 400);

  const room = await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first();
  if (!room) return json({ ok: false, error: 'החדר לא נמצא.' }, 404);

  const weekday = parseInt(b.day, 10);
  const start = parseTime(b.from);
  const end = parseTime(b.to);
  const bad = checkSlot(weekday, start, end);
  if (bad) return json({ ok: false, error: bad }, 400);

  /* The check the whole feature exists for. 409 rather than 400: the request
     is well formed, the room is simply taken — and the message names what is
     in the way, because "conflict" alone leaves the office hunting for it. */
  const clash = await findClash(env, { roomId, weekday, start, end });
  if (clash) return json({ ok: false, error: clashMessage(clash), clash: publicBooking(clash) }, 409);

  const id = randomId('b');
  await env.DB.prepare(
    `INSERT INTO room_bookings
       (id, room_id, title, teacher, weekday, start_min, end_min, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, roomId, title, String(b.teacher || '').trim(), weekday, start, end,
    String(b.note || '').trim(), guard.user.id, Date.now()).run();

  const row = await env.DB.prepare(
    `SELECT b.*, r.name AS room_name FROM room_bookings b
       JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`
  ).bind(id).first();
  return json({ ok: true, booking: publicBooking(row) }, 201);
}
