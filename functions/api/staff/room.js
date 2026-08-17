/* /api/staff/rooms/:id — one room.
     PATCH  → name · capacity · kit · active · order
     DELETE → remove it, but only once its timetable is empty

   Office only. Reading a room happens through the collection endpoint. */

import { json } from '../../_shared.js';
import { readJson } from '../../_staff.js';
import { requireBooker, publicRoom } from '../../_rooms.js';

function load(env, id) {
  return env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
}

export async function onRequestPatch({ request, env, params }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החדר לא נמצא.' }, 404);

  const b = await readJson(request);
  if (!b) return json({ ok: false, error: 'בקשה לא תקינה.' }, 400);

  const sets = [], vals = [];
  const set = (col, val) => { sets.push(col + '=?'); vals.push(val); };

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return json({ ok: false, error: 'צריך שם לחדר' }, 400);
    set('name', name);
  }
  if (b.capacity !== undefined) {
    set('capacity', Math.max(0, Math.min(500, parseInt(b.capacity, 10) || 0)));
  }
  if (b.kit !== undefined) set('kit', String(b.kit).trim());
  if (b.order !== undefined) set('sort_order', parseInt(b.order, 10) || 0);

  /* Taking a room out of service keeps its bookings. They stay visible on the
     board as history rather than disappearing mid-term, and the office can
     move them deliberately — which is the whole point of closing a room. */
  if (b.active !== undefined) set('active', b.active ? 1 : 0);

  if (!sets.length) return json({ ok: true, room: publicRoom(target) });

  try {
    await env.DB.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id=?`)
      .bind(...vals, target.id).run();
  } catch (e) {
    return json({ ok: false, error: 'כבר קיים חדר בשם הזה' }, 409);
  }
  return json({ ok: true, room: publicRoom(await load(env, target.id)) });
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireBooker(request, env);
  if (guard.res) return guard.res;

  const target = await load(env, params.id);
  if (!target) return json({ ok: false, error: 'החדר לא נמצא.' }, 404);

  /* Refusing rather than cascading. Deleting a room that still has lessons in
     it would erase a term's timetable on one click, and the recovery is
     retyping it from memory. Emptying it first is a deliberate act; closing
     the room instead (active=0) is usually what was actually meant. */
  const held = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM room_bookings WHERE room_id = ?'
  ).bind(target.id).first();
  const n = held ? held.n : 0;
  if (n) {
    return json({
      ok: false,
      error: `בחדר הזה יש ${n} שיבוצים. אפשר להשבית אותו, או להסיר קודם את השיבוצים.`
    }, 409);
  }

  await env.DB.prepare('DELETE FROM rooms WHERE id=?').bind(target.id).run();
  return json({ ok: true });
}
