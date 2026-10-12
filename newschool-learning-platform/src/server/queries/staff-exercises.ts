import 'server-only';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { getActivityForEdit, type ActivityForEdit } from './cms';

// Exercises written by teachers and the office (ADR-038), read with the
// caller's own session: RLS shows a teacher their courses and their own
// exercises, the office the published catalogue and office exercises.

type Status = Database['public']['Enums']['content_status'];
export type StaffArea = 'teach' | 'office';

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export type StaffExerciseSummary = {
  id: string;
  title: string;
  status: Status;
  updatedAt: string;
  courseTitle: string;
  cycleTitle: string;
  mine: boolean;
};

/** Ids of the exercises the caller may edit (the database decides). */
async function editableIds(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('editable_activities').select('activity_id');
  if (error) fail('exercises', error);
  return data.flatMap((r) => (r.activity_id ? [r.activity_id] : []));
}

/**
 * The exercises listed in an area: in /teach the teacher's own; in /office
 * every exercise written by the office (any office user may edit them).
 */
export async function listStaffExercises(
  area: StaffArea,
  user: SessionUser,
): Promise<StaffExerciseSummary[]> {
  const supabase = await createSupabaseServerClient();
  const ids = await editableIds();
  if (!ids.length) return [];
  let query = supabase
    .from('activities')
    .select(
      'id, title, status, updated_at, created_by, cycle:cycles ( title, course:courses ( title ) )',
    )
    .in('id', ids)
    .not('created_by', 'is', null)
    .order('updated_at', { ascending: false });
  if (area === 'teach') query = query.eq('created_by', user.id);
  const { data, error } = await query;
  if (error) fail('exercises', error);
  return data.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    updatedAt: a.updated_at,
    courseTitle: a.cycle?.course?.title ?? '',
    cycleTitle: a.cycle?.title ?? '',
    mine: a.created_by === user.id,
  }));
}

export type AuthoringOptions = {
  cycles: { value: string; label: string }[];
  defaultCycleId: string | null;
};

/**
 * Where the caller may write a new exercise: the published cycles of the
 * courses they teach (default: the active cycle of their first group), or,
 * for the office, of every published course.
 */
export async function getAuthoringOptions(
  area: StaffArea,
  user: SessionUser,
): Promise<AuthoringOptions> {
  const supabase = await createSupabaseServerClient();
  let courseIds: string[];
  let defaultCycleId: string | null = null;
  if (area === 'teach') {
    const { data: groups, error } = await supabase
      .from('groups')
      .select(
        'id, name, course_id, group_teachers!inner ( teacher_id ), group_cycles ( cycle_id, state )',
      )
      .eq('group_teachers.teacher_id', user.id)
      .order('name');
    if (error) fail('groups', error);
    courseIds = [...new Set(groups.map((g) => g.course_id))];
    defaultCycleId =
      groups.flatMap((g) => g.group_cycles.filter((c) => c.state === 'active'))[0]?.cycle_id ??
      null;
  } else {
    const { data: courses, error } = await supabase.from('courses').select('id');
    if (error) fail('courses', error);
    courseIds = courses.map((c) => c.id);
  }
  if (!courseIds.length) return { cycles: [], defaultCycleId: null };

  const { data: cycles, error } = await supabase
    .from('cycles')
    .select('id, title, position, course:courses ( title )')
    .in('course_id', courseIds)
    .eq('status', 'published');
  if (error) fail('cycles', error);
  const options = cycles
    .filter((c) => c.course)
    .sort(
      (a, b) =>
        (a.course?.title ?? '').localeCompare(b.course?.title ?? '') || a.position - b.position,
    )
    .map((c) => ({ value: c.id, label: `${c.course?.title ?? ''} · ${c.title}` }));
  const known = options.some((o) => o.value === defaultCycleId);
  return {
    cycles: options,
    defaultCycleId: known ? defaultCycleId : (options[0]?.value ?? null),
  };
}

export type StaffExerciseForEdit = ActivityForEdit & {
  courseId: string;
  groups: { id: string; name: string }[];
  assignments: {
    id: string;
    groupId: string;
    groupName: string;
    dueAt: string | null;
    note: string;
    canRemove: boolean;
  }[];
};

/**
 * One exercise for its editor page, or null if the caller may not edit it
 * here (reported as "not found", like anything else they may not see).
 */
export async function getStaffExerciseForEdit(
  area: StaffArea,
  user: SessionUser,
  activityId: string,
): Promise<StaffExerciseForEdit | null> {
  const supabase = await createSupabaseServerClient();
  const [{ data: row }, { data: allowed }] = await Promise.all([
    supabase
      .from('activities')
      .select('id, course_id, created_by')
      .eq('id', activityId)
      .maybeSingle(),
    supabase
      .from('editable_activities')
      .select('activity_id')
      .eq('activity_id', activityId)
      .maybeSingle(),
  ]);
  if (!row || !allowed || !row.created_by) return null;
  if (area === 'teach' && row.created_by !== user.id) return null;

  let groupsQuery = supabase
    .from('groups')
    .select('id, name, status, group_teachers ( teacher_id )')
    .eq('course_id', row.course_id)
    .in('status', ['planned', 'active'])
    .order('name');
  if (area === 'teach') {
    groupsQuery = supabase
      .from('groups')
      .select('id, name, status, group_teachers!inner ( teacher_id )')
      .eq('course_id', row.course_id)
      .eq('group_teachers.teacher_id', user.id)
      .in('status', ['planned', 'active'])
      .order('name');
  }
  const [activity, groups, assignments] = await Promise.all([
    getActivityForEdit(activityId),
    groupsQuery,
    supabase
      .from('assignments')
      .select('id, group_id, due_at, note, assigned_by, created_at, group:groups ( name )')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: false }),
  ]);
  if (!activity) return null;
  if (groups.error) fail('groups', groups.error);
  if (assignments.error) fail('assignments', assignments.error);
  const taught = new Set(groups.data.map((g) => g.id));
  return {
    ...activity,
    courseId: row.course_id,
    groups: groups.data.map((g) => ({ id: g.id, name: g.name })),
    assignments: assignments.data.map((a) => ({
      id: a.id,
      groupId: a.group_id,
      groupName: a.group?.name ?? '',
      dueAt: a.due_at,
      note: a.note,
      // Teachers remove homework of their own groups; the office its own.
      canRemove: area === 'teach' ? taught.has(a.group_id) : a.assigned_by === user.id,
    })),
  };
}
