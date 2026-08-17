/* /api/staff/rooms — the school's physical rooms.
     GET  → every room, in display order (anyone signed in)
     POST → create one (office only)

   Deleting a room lives in room.js, because a room with a timetable behind it
   cannot simply vanish. */

import { json } from '../../_shared.js';
import { readJson } from '../../_staff.js';
import { requireViewer, requireBooker, publicRoom, randomId } from '../../_rooms.js';

export async function onRequestGet({ request, env }) {
  const guard = await requireViewer(request, env);
  if (guard.res) return guard.res;

  const { results } = await env.DB.prepare(
    'SELECT * FROM rooms ORDER BY active DESC, sort_order, name'
  ).all();
  return json({ ok: true, rooms: (results || []).map(publicRoom) });
}

export async function onRequestPost({ request, env }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const name = String(b.name || '').trim();
  if (!name) return json({ ok: false, error: 'צריך שם לחדר' }, 400);

  /* Capacity is optional — a school that has never counted the chairs should
     still be able to put the room on the board. 0 means "unstated", and the
     grid simply does not warn about size for that room. */
  const capacity = Math.max(0, Math.min(500, parseInt(b.capacity, 10) || 0));

  const clash = await env.DB.prepare('SELECT id FROM rooms WHERE name = ?').bind(name).first();
  if (clash) return json({ ok: false, error: 'כבר קיים חדר בשם הזה' }, 409);

  /* New rooms land at the end of the board rather than jumping to the top:
     the order of the rows is how the office reads the building. */
  const last = await env.DB.prepare('SELECT MAX(sort_order) AS n FROM rooms').first();

  const id = randomId('r');
  await env.DB.prepare(
    `INSERT INTO rooms (id, name, capacity, kit, active, sort_order, created_at)
     VALUES (?,?,?,?,1,?,?)`
  ).bind(id, name, capacity, String(b.kit || '').trim(),
    ((last && last.n) || 0) + 1, Date.now()).run();

  const row = await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  return json({ ok: true, room: publicRoom(row) }, 201);
}
