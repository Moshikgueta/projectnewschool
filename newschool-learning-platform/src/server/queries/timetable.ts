import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { readAll } from './paging';

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
 * and the timetable view's own filter return nothing to anyone else. The week
 * has more bookings than one request returns (1,603 at school scale), so the
 * grid is read page by page: every booking of the week, always.
 */
export async function getTimetable(): Promise<{ rooms: Room[]; bookings: Booking[] }> {
  const supabase = await createSupabaseServerClient();
  const [rooms, entries] = await Promise.all([
    readAll('rooms', (from, to) =>
      supabase
        .from('rooms')
        .select('id, name, capacity, kit, active, sort_order')
        .order('sort_order')
        .order('name')
        .order('id')
        .range(from, to),
    ),
    readAll('the timetable', (from, to) =>
      supabase
        .from('timetable_entries')
        .select(
          'id, room_id, room_name, title, weekday, start_min, end_min, note, teacher_id, teacher_name, group_id, group_name',
        )
        .order('weekday')
        .order('start_min')
        .order('id')
        .range(from, to),
    ),
  ]);
  return {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      kit: r.kit,
      active: r.active,
      sortOrder: r.sort_order,
    })),
    bookings: entries.map((b) => ({
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
  // 800 groups at school scale: close to one request's limit, so read in pages.
  const [teachers, groups] = await Promise.all([
    readAll('teachers', (from, to) =>
      supabase
        .from('teacher_choices')
        .select('id, display_name')
        .order('display_name')
        .order('id')
        .range(from, to),
    ),
    readAll('groups', (from, to) =>
      supabase
        .from('groups')
        .select('id, name')
        .in('status', ['planned', 'active'])
        .order('name')
        .order('id')
        .range(from, to),
    ),
  ]);
  return {
    teachers: teachers.map((t) => ({ id: t.id!, name: t.display_name ?? '' })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
  };
}
