import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type Room = {
  id: string;
  name: string;
  capacity: number;
  kit: string;
  active: boolean;
  sortOrder: number;
};

export type Booking = {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  weekday: number;
  start: number;
  end: number;
  note: string;
  teacherId: string | null;
  teacherName: string | null;
  groupId: string | null;
  groupName: string | null;
};

/**
 * The rooms and the weekly timetable, for any member of staff. RLS (rooms)
 * and the timetable view's own filter return nothing to anyone else.
 */
export async function getTimetable(): Promise<{ rooms: Room[]; bookings: Booking[] }> {
  const supabase = await createSupabaseServerClient();
  const [rooms, entries] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, name, capacity, kit, active, sort_order')
      .order('sort_order')
      .order('name'),
    supabase
      .from('timetable_entries')
      .select(
        'id, room_id, room_name, title, weekday, start_min, end_min, note, teacher_id, teacher_name, group_id, group_name',
      ),
  ]);
  if (rooms.error) throw new Error(`Could not load rooms: ${rooms.error.message}`);
  if (entries.error) throw new Error(`Could not load the timetable: ${entries.error.message}`);
  return {
    rooms: rooms.data.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      kit: r.kit,
      active: r.active,
      sortOrder: r.sort_order,
    })),
    bookings: entries.data.map((b) => ({
      id: b.id!,
      roomId: b.room_id!,
      roomName: b.room_name ?? '',
      title: b.title ?? '',
      weekday: b.weekday ?? 0,
      start: b.start_min ?? 0,
      end: b.end_min ?? 0,
      note: b.note ?? '',
      teacherId: b.teacher_id,
      teacherName: b.teacher_name,
      groupId: b.group_id,
      groupName: b.group_name,
    })),
  };
}

/** Teachers and groups to choose from when booking (office). */
export async function getBookingChoices(): Promise<{
  teachers: { id: string; name: string }[];
  groups: { id: string; name: string }[];
}> {
  const supabase = await createSupabaseServerClient();
  const [teachers, groups] = await Promise.all([
    supabase.from('teacher_choices').select('id, display_name').order('display_name'),
    supabase.from('groups').select('id, name').in('status', ['planned', 'active']).order('name'),
  ]);
  return {
    teachers: (teachers.data ?? []).map((t) => ({ id: t.id!, name: t.display_name ?? '' })),
    groups: (groups.data ?? []).map((g) => ({ id: g.id, name: g.name })),
  };
}
