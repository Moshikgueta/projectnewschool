'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { zonedTimeToUtc } from '@/domain/learning/time';
import type { ManageState } from '@/server/actions/manage';
import { requireArea } from '@/server/auth/session';
import { formatCode } from '@/domain/auth/codes';
import { ATTENDANCE_STATUSES } from '@/domain/teaching/attendance';
import { getClassAttendance } from '@/server/queries/attendance';
import { issueCode, isStudentOnly } from '@/server/privileged/student-codes';
import { createSupabaseServerClient } from '@/server/supabase/server';

// A teacher running their own groups: active cycle, class times, homework.
// Every write uses the teacher's OWN session, so RLS (teaches_group) decides
// again in the database; the checks here give clear messages and keep data
// consistent (a cycle or activity must belong to the group's course).

const uuid = z.uuid();

async function message(
  key: 'saved' | 'invalid' | 'notAllowed' | 'failed' | 'past',
): Promise<ManageState> {
  const t = await getTranslations('teach.forms');
  return key === 'saved' ? { status: 'ok', message: t(key) } : { status: 'error', message: t(key) };
}

/** The group, if the caller teaches it (RLS hides any other). */
async function taughtGroup(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('groups')
    .select('id, course_id, group_teachers!inner ( teacher_id )')
    .eq('id', groupId)
    .maybeSingle();
  return { supabase, group: data };
}

function done(groupId: string) {
  revalidatePath(`/teach/groups/${groupId}` as Route);
  return message('saved');
}

export async function setActiveCycle(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('teach');
  const parsed = z
    .object({ groupId: uuid, cycleId: uuid })
    .safeParse({ groupId: formData.get('groupId'), cycleId: formData.get('cycleId') });
  if (!parsed.success) return message('invalid');

  const { supabase, group } = await taughtGroup(parsed.data.groupId);
  if (!group) return message('notAllowed');
  const { data: cycle } = await supabase
    .from('cycles')
    .select('id, position')
    .eq('id', parsed.data.cycleId)
    .eq('course_id', group.course_id)
    .maybeSingle();
  if (!cycle) return message('invalid');

  // The cycle that was active is now completed; the chosen one becomes active.
  const closed = await supabase
    .from('group_cycles')
    .update({ state: 'completed' })
    .eq('group_id', group.id)
    .eq('state', 'active')
    .neq('cycle_id', cycle.id);
  const opened = await supabase.from('group_cycles').upsert(
    {
      group_id: group.id,
      course_id: group.course_id,
      cycle_id: cycle.id,
      state: 'active',
      position: cycle.position,
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,cycle_id' },
  );
  if (closed.error || opened.error) return message('failed');
  return done(group.id);
}

export async function scheduleClass(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await requireArea('teach');
  const parsed = z
    .object({ groupId: uuid, startsAt: z.string() })
    .safeParse({ groupId: formData.get('groupId'), startsAt: formData.get('startsAt') });
  if (!parsed.success) return message('invalid');
  const startsAt = zonedTimeToUtc(parsed.data.startsAt, user.timezone);
  if (!startsAt) return message('invalid');
  if (startsAt.getTime() < Date.now()) return message('past');

  const { supabase, group } = await taughtGroup(parsed.data.groupId);
  if (!group) return message('notAllowed');
  const { data: active } = await supabase
    .from('group_cycles')
    .select('cycle_id')
    .eq('group_id', group.id)
    .eq('state', 'active')
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from('group_sessions').insert({
    group_id: group.id,
    starts_at: startsAt.toISOString(),
    cycle_id: active?.cycle_id ?? null,
  });
  if (error) return message('failed');
  return done(group.id);
}

export async function cancelClass(formData: FormData): Promise<void> {
  await requireArea('teach');
  const groupId = uuid.safeParse(formData.get('groupId'));
  const sessionId = uuid.safeParse(formData.get('sessionId'));
  if (!groupId.success || !sessionId.success) return;
  const supabase = await createSupabaseServerClient();
  // Only classes still to come: one that has started is part of the record
  // (and once attendance is taken, the database refuses to remove it).
  await supabase
    .from('group_sessions')
    .delete()
    .eq('id', sessionId.data)
    .eq('group_id', groupId.data)
    .gt('starts_at', new Date().toISOString());
  revalidatePath(`/teach/groups/${groupId.data}` as Route);
}

export async function assignActivity(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await requireArea('teach');
  const parsed = z
    .object({
      groupId: uuid,
      activityId: uuid,
      dueDate: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
      note: z.string().trim().max(1000),
    })
    .safeParse({
      groupId: formData.get('groupId'),
      activityId: formData.get('activityId'),
      dueDate: formData.get('dueDate') ?? '',
      note: formData.get('note') ?? '',
    });
  if (!parsed.success) return message('invalid');

  // Due at the end of that day, in the teacher's time zone.
  const dueAt = parsed.data.dueDate
    ? zonedTimeToUtc(`${parsed.data.dueDate}T23:59`, user.timezone)
    : null;
  if (parsed.data.dueDate && !dueAt) return message('invalid');
  if (dueAt && dueAt.getTime() < Date.now()) return message('past');

  const { supabase, group } = await taughtGroup(parsed.data.groupId);
  if (!group) return message('notAllowed');
  // Only published activities of this group's course (teachers cannot read drafts).
  const { data: activity } = await supabase
    .from('activities')
    .select('id, phase')
    .eq('id', parsed.data.activityId)
    .eq('course_id', group.course_id)
    .eq('status', 'published')
    .maybeSingle();
  if (!activity) return message('invalid');

  const { error } = await supabase.from('assignments').insert({
    group_id: group.id,
    course_id: group.course_id,
    activity_id: activity.id,
    phase: activity.phase,
    due_at: dueAt?.toISOString() ?? null,
    note: parsed.data.note,
    assigned_by: user.id,
  });
  if (error) return message(error.code === '42501' ? 'notAllowed' : 'failed');
  return done(group.id);
}

export async function removeAssignment(formData: FormData): Promise<void> {
  await requireArea('teach');
  const groupId = uuid.safeParse(formData.get('groupId'));
  const assignmentId = uuid.safeParse(formData.get('assignmentId'));
  if (!groupId.success || !assignmentId.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('assignments')
    .delete()
    .eq('id', assignmentId.data)
    .eq('group_id', groupId.data);
  revalidatePath(`/teach/groups/${groupId.data}` as Route);
}

export type CodeState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'ok'; code: string };

/**
 * A new entry code for a student in a group the caller teaches. The old code
 * stops working. The code is returned once, to be handed to the student, and
 * only its hash is kept.
 */
export async function issueStudentCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const user = await requireArea('teach');
  const t = await getTranslations('teach.forms');
  const parsed = z
    .object({ groupId: uuid, studentId: uuid })
    .safeParse({ groupId: formData.get('groupId'), studentId: formData.get('studentId') });
  if (!parsed.success) return { status: 'error', message: t('invalid') };

  // Checked with the teacher's own session: the group must be one they teach
  // themselves (not merely one a manager can see), and the student enrolled
  // in it (active or paused). Anything else gets the same answer.
  const supabase = await createSupabaseServerClient();
  const { data: enrolment } = await supabase
    .from('enrollments')
    .select('student_id, groups!inner ( group_teachers!inner ( teacher_id ) )')
    .eq('group_id', parsed.data.groupId)
    .eq('student_id', parsed.data.studentId)
    .in('status', ['active', 'paused'])
    .eq('groups.group_teachers.teacher_id', user.id)
    .maybeSingle();
  if (!enrolment || !(await isStudentOnly(parsed.data.studentId))) {
    return { status: 'error', message: t('notAllowed') };
  }

  const code = await issueCode(parsed.data.studentId, user.id);
  return { status: 'ok', code: formatCode(code) };
}

/**
 * Save the attendance of one class. The students come from the database (the
 * group's active and paused students), never from the form; a student left
 * unmarked stays unmarked. Written with the teacher's own session, so the
 * database checks again that they teach the group and that the class has
 * started (or starts within 30 minutes).
 */
export async function saveAttendance(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await requireArea('teach');
  const t = await getTranslations('teach.forms');
  const ids = z
    .object({ groupId: uuid, sessionId: uuid })
    .safeParse({ groupId: formData.get('groupId'), sessionId: formData.get('sessionId') });
  if (!ids.success) return message('invalid');

  const cls = await getClassAttendance(user.id, ids.data.groupId, ids.data.sessionId);
  if (!cls) return message('notAllowed');
  if (!cls.open) return { status: 'error', message: t('notStarted') };

  const status = z.enum(ATTENDANCE_STATUSES);
  const rows = [];
  for (const student of cls.students) {
    const raw = formData.get(`status-${student.id}`);
    if (raw === null || raw === '') continue;
    const parsed = status.safeParse(raw);
    const note = z
      .string()
      .trim()
      .max(300)
      .safeParse(formData.get(`note-${student.id}`) ?? '');
    if (!parsed.success || !note.success) return message('invalid');
    rows.push({
      session_id: cls.sessionId,
      student_id: student.id,
      status: parsed.data,
      note: note.data,
      marked_by: user.id,
    });
  }
  if (rows.length === 0) return { status: 'error', message: t('nobodyMarked') };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'session_id,student_id' });
  if (error) return message(error.code === '42501' ? 'notAllowed' : 'failed');
  revalidatePath(`/teach/groups/${cls.groupId}` as Route, 'layout');
  revalidatePath('/teach');
  return message('saved');
}
