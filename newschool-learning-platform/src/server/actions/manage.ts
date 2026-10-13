'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Group and enrollment management. Each action checks the area (manager with
// two-step verification), validates its input, and writes with the manager's
// own session — so the database's RLS policies enforce the same rule again.

export type ManageState =
  { status: 'idle' } | { status: 'ok'; message: string } | { status: 'error'; message: string };

const uuid = z.uuid();

type DbError = { code?: string } | null;

async function failure(error: DbError): Promise<ManageState> {
  const t = await getTranslations('manage.errors');
  if (error?.code === '23505') return { status: 'error', message: t('duplicate') };
  if (error?.code === '23514') return { status: 'error', message: t('wrongRole') };
  if (error?.code === '42501') return { status: 'error', message: t('notAllowed') };
  return { status: 'error', message: t('failed') };
}

async function invalid(): Promise<ManageState> {
  return { status: 'error', message: (await getTranslations('manage.errors'))('invalid') };
}

async function saved(groupId?: string): Promise<ManageState> {
  revalidatePath('/manage', 'layout');
  if (groupId) revalidatePath(`/manage/groups/${groupId}`);
  return { status: 'ok', message: (await getTranslations('manage.group'))('saved') };
}

export async function createGroup(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      courseId: uuid,
      name: z.string().trim().min(1).max(160),
      scheduleNote: z.string().trim().max(300),
      startsOn: z.iso.date().optional(),
    })
    .safeParse({
      courseId: formData.get('courseId'),
      name: formData.get('name'),
      scheduleNote: formData.get('scheduleNote') ?? '',
      startsOn: formData.get('startsOn') || undefined,
    });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('groups')
    .insert({
      course_id: parsed.data.courseId,
      name: parsed.data.name,
      schedule_note: parsed.data.scheduleNote,
      starts_on: parsed.data.startsOn ?? null,
      status: 'planned',
    })
    .select('id')
    .single();
  if (error) return failure(error);

  revalidatePath('/manage', 'layout');
  redirect(`/manage/groups/${data.id}` as Route);
}

export async function updateGroup(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      groupId: uuid,
      name: z.string().trim().min(1).max(160),
      status: z.enum(['planned', 'active', 'finished', 'archived']),
      scheduleNote: z.string().trim().max(300),
    })
    .safeParse({
      groupId: formData.get('groupId'),
      name: formData.get('name'),
      status: formData.get('status'),
      scheduleNote: formData.get('scheduleNote') ?? '',
    });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('groups')
    .update({
      name: parsed.data.name,
      status: parsed.data.status,
      schedule_note: parsed.data.scheduleNote,
    })
    .eq('id', parsed.data.groupId);
  return error ? failure(error) : saved(parsed.data.groupId);
}

export async function addTeacher(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({ groupId: uuid, teacherId: uuid })
    .safeParse({ groupId: formData.get('groupId'), teacherId: formData.get('teacherId') });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('group_teachers')
    .insert({ group_id: parsed.data.groupId, teacher_id: parsed.data.teacherId });
  return error ? failure(error) : saved(parsed.data.groupId);
}

export async function removeTeacher(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({ groupId: uuid, teacherId: uuid })
    .safeParse({ groupId: formData.get('groupId'), teacherId: formData.get('teacherId') });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('group_teachers')
    .delete()
    .eq('group_id', parsed.data.groupId)
    .eq('teacher_id', parsed.data.teacherId);
  return error ? failure(error) : saved(parsed.data.groupId);
}

/** Enroll a student, or re-activate an earlier enrollment in the same group. */
export async function enrollStudent(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({ groupId: uuid, studentId: uuid })
    .safeParse({ groupId: formData.get('groupId'), studentId: formData.get('studentId') });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('enrollments').upsert(
    {
      group_id: parsed.data.groupId,
      student_id: parsed.data.studentId,
      status: 'active',
      ended_on: null,
    },
    { onConflict: 'group_id,student_id' },
  );
  return error ? failure(error) : saved(parsed.data.groupId);
}

export async function setEnrollmentStatus(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      groupId: uuid,
      enrollmentId: uuid,
      status: z.enum(['active', 'paused', 'completed', 'withdrawn']),
    })
    .safeParse({
      groupId: formData.get('groupId'),
      enrollmentId: formData.get('enrollmentId'),
      status: formData.get('status'),
    });
  if (!parsed.success) return invalid();

  const ended = parsed.data.status === 'completed' || parsed.data.status === 'withdrawn';
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('enrollments')
    .update({
      status: parsed.data.status,
      ended_on: ended ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq('id', parsed.data.enrollmentId)
    .eq('group_id', parsed.data.groupId);
  return error ? failure(error) : saved(parsed.data.groupId);
}

export async function setCycleState(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      groupId: uuid,
      courseId: uuid,
      cycleId: uuid,
      state: z.enum(['upcoming', 'active', 'completed']),
      position: z.coerce.number().int().min(0).max(10_000),
    })
    .safeParse({
      groupId: formData.get('groupId'),
      courseId: formData.get('courseId'),
      cycleId: formData.get('cycleId'),
      state: formData.get('state'),
      position: formData.get('position') ?? 0,
    });
  if (!parsed.success) return invalid();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('group_cycles').upsert(
    {
      group_id: parsed.data.groupId,
      course_id: parsed.data.courseId,
      cycle_id: parsed.data.cycleId,
      state: parsed.data.state,
      position: parsed.data.position,
      activated_at: parsed.data.state === 'active' ? new Date().toISOString() : null,
    },
    { onConflict: 'group_id,cycle_id' },
  );
  return error ? failure(error) : saved(parsed.data.groupId);
}
