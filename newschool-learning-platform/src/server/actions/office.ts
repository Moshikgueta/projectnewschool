'use server';

import { revalidatePath } from 'next/cache';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { checkSlot, formatTime, parseTime } from '@/domain/scheduling/timetable';
import type { ManageState } from '@/server/actions/manage';
import { requireArea } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

// The school office: rooms and the weekly timetable (moved from the staff
// room, docs/STAFF-ROOM-MERGE.md). Writes use the office user's own
// MFA-verified session, so RLS decides again; the database itself refuses
// overlapping bookings (exclusion constraint), and the message below names
// what is in the way.

const uuid = z.uuid();
type ErrorKey =
  | 'invalid'
  | 'weekday'
  | 'time'
  | 'order'
  | 'hours'
  | 'tooShort'
  | 'tooLong'
  | 'duplicate'
  | 'roomInUse'
  | 'notAllowed'
  | 'failed';

async function fail(key: ErrorKey): Promise<ManageState> {
  return { status: 'error', message: (await getTranslations('office.errors'))(key) };
}

async function ok(): Promise<ManageState> {
  revalidatePath('/office', 'layout');
  revalidatePath('/teach/timetable');
  return { status: 'ok', message: (await getTranslations('office.errors'))('saved') };
}

const optionalUuid = z.union([z.literal(''), uuid]).transform((v) => v || null);

export async function saveRoom(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('office');
  const parsed = z
    .object({
      id: optionalUuid,
      name: z.string().trim().min(1).max(80),
      capacity: z.coerce.number().int().min(0).max(500),
      kit: z.string().trim().max(300),
      active: z.boolean(),
      sortOrder: z.coerce.number().int().min(0).max(1000),
    })
    .safeParse({
      id: formData.get('id') ?? '',
      name: formData.get('name'),
      capacity: formData.get('capacity') || 0,
      kit: formData.get('kit') ?? '',
      active: formData.get('active') !== 'false',
      sortOrder: formData.get('sortOrder') || 0,
    });
  if (!parsed.success) return fail('invalid');
  const { id, sortOrder, ...room } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = id
    ? await supabase
        .from('rooms')
        .update({ ...room, sort_order: sortOrder })
        .eq('id', id)
    : await supabase.from('rooms').insert({ ...room, sort_order: sortOrder });
  if (error?.code === '23505') return fail('duplicate');
  if (error?.code === '42501') return fail('notAllowed');
  if (error) return fail('failed');
  return ok();
}

export async function deleteRoom(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('office');
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  // As in the staff room: a room with lessons is not removed with them.
  const { count } = await supabase
    .from('room_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', id.data);
  if (count) return fail('roomInUse');
  const { error } = await supabase.from('rooms').delete().eq('id', id.data);
  if (error) return fail(error.code === '42501' ? 'notAllowed' : 'failed');
  return ok();
}

export async function addBooking(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await requireArea('office');
  const parsed = z
    .object({
      roomId: uuid,
      title: z.string().trim().min(1).max(160),
      groupId: optionalUuid,
      teacherId: optionalUuid,
      weekday: z.coerce.number().int(),
      from: z.string(),
      to: z.string(),
      note: z.string().trim().max(500),
    })
    .safeParse({
      roomId: formData.get('roomId'),
      title: formData.get('title'),
      groupId: formData.get('groupId') ?? '',
      teacherId: formData.get('teacherId') ?? '',
      weekday: formData.get('weekday'),
      from: formData.get('from'),
      to: formData.get('to'),
      note: formData.get('note') ?? '',
    });
  if (!parsed.success) return fail('invalid');
  const start = parseTime(parsed.data.from);
  const end = parseTime(parsed.data.to);
  const problem = checkSlot(parsed.data.weekday, start, end);
  if (problem) return fail(problem);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('room_bookings').insert({
    room_id: parsed.data.roomId,
    title: parsed.data.title,
    group_id: parsed.data.groupId,
    teacher_id: parsed.data.teacherId,
    weekday: parsed.data.weekday,
    start_min: start!,
    end_min: end!,
    note: parsed.data.note,
    created_by: user.id,
  });

  if (error?.code === '23P01') {
    // The database refused an overlap: say what is in the way.
    const { data: clash } = await supabase
      .from('timetable_entries')
      .select('room_name, title, weekday, start_min, end_min')
      .eq('room_id', parsed.data.roomId)
      .eq('weekday', parsed.data.weekday)
      .lt('start_min', end!)
      .gt('end_min', start!)
      .limit(1)
      .maybeSingle();
    const [t, format] = await Promise.all([getTranslations('office.errors'), getFormatter()]);
    // 2026-10-04 is a Sunday: weekday n is that date plus n days.
    const day = format.dateTime(new Date(Date.UTC(2026, 9, 4 + parsed.data.weekday, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return {
      status: 'error',
      message: t('clash', {
        room: clash?.room_name ?? '',
        day,
        from: formatTime(clash?.start_min ?? start!),
        to: formatTime(clash?.end_min ?? end!),
        title: clash?.title ?? '',
      }),
    };
  }
  if (error?.code === '42501') return fail('notAllowed');
  if (error) return fail('failed');
  return ok();
}

export async function deleteBooking(formData: FormData): Promise<void> {
  await requireArea('office');
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from('room_bookings').delete().eq('id', id.data);
  revalidatePath('/office', 'layout');
  revalidatePath('/teach/timetable');
}
