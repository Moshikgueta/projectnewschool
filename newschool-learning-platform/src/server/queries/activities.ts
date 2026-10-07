import 'server-only';
import { parsePublicItem, type PublicItem } from '@/content/items';
import { parseBlocksForRender, type Block } from '@/content/schema';
import { readState, type AttemptState } from '@/domain/grading/attempt';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { listMyCourses, type MyCourse } from './student';

type ScoringMode = Database['public']['Enums']['scoring_mode'];
type Phase = Database['public']['Enums']['learning_phase'];

export type ActivityItem = { item: PublicItem | null; rawId: string; prompt: (Block | null)[] };

export type ActivityDetail = {
  id: string;
  title: string;
  courseId: string;
  cycleId: string;
  cycleTitle: string;
  courseLang: string;
  phase: Phase;
  scoring: ScoringMode;
  minutes: number | null;
  instructions: (Block | null)[];
  items: ActivityItem[];
};

/**
 * An activity with its public items, if the caller may see it (RLS: published
 * and in a course they are enrolled in). Keys are never selected here.
 */
export async function getActivity(activityId: string): Promise<ActivityDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('activities')
    .select(
      `id, title, course_id, cycle_id, phase, scoring_mode, est_minutes, instructions,
       cycle:cycles ( title, course:courses ( level:levels ( language:languages ( code ) ) ) ),
       items:activity_items ( id, type, prompt, data, points, position )`,
    )
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the activity: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    courseId: data.course_id,
    cycleId: data.cycle_id,
    cycleTitle: data.cycle?.title ?? '',
    courseLang: data.cycle?.course?.level?.language?.code ?? 'en',
    phase: data.phase,
    scoring: data.scoring_mode,
    minutes: data.est_minutes,
    instructions: parseBlocksForRender(data.instructions),
    items: [...data.items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        rawId: i.id,
        item: parsePublicItem({ id: i.id, type: i.type, data: i.data, points: Number(i.points) }),
        prompt: parseBlocksForRender(i.prompt),
      })),
  };
}

export type MyAttempt = {
  id: string;
  status: 'in_progress' | 'submitted';
  score: number | null;
  maxScore: number | null;
  updatedAt: string;
  submittedAt: string | null;
};

/** The caller's own attempts at an activity, newest first. */
export async function listMyAttempts(user: SessionUser, activityId: string): Promise<MyAttempt[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('attempts')
    .select('id, status, score, max_score, updated_at, submitted_at')
    .eq('user_id', user.id)
    .eq('activity_id', activityId)
    .order('started_at', { ascending: false });
  if (error) throw new Error(`Could not load attempts: ${error.message}`);
  return data.map((a) => ({
    id: a.id,
    status: a.status,
    score: a.score === null ? null : Number(a.score),
    maxScore: a.max_score === null ? null : Number(a.max_score),
    updatedAt: a.updated_at,
    submittedAt: a.submitted_at,
  }));
}

export type AttemptView = {
  id: string;
  status: 'in_progress' | 'submitted';
  score: number | null;
  maxScore: number | null;
  state: AttemptState;
  activity: ActivityDetail;
};

/**
 * One of the caller's own attempts with its activity. Null for anyone else's
 * attempt (teachers can read their students' attempts under RLS, but this is
 * the student's player, so ownership is checked explicitly as well).
 */
export async function getMyAttempt(
  user: SessionUser,
  attemptId: string,
): Promise<AttemptView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('attempts')
    .select('id, status, score, max_score, state, activity_id')
    .eq('id', attemptId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the attempt: ${error.message}`);
  if (!data) return null;
  const activity = await getActivity(data.activity_id);
  if (!activity) return null;
  return {
    id: data.id,
    status: data.status,
    score: data.score === null ? null : Number(data.score),
    maxScore: data.max_score === null ? null : Number(data.max_score),
    state: readState(data.state),
    activity,
  };
}

export type PracticeActivity = {
  id: string;
  title: string;
  phase: Phase;
  minutes: number | null;
  status: 'not_started' | 'in_progress' | 'completed';
  openAttemptId: string | null;
  dueAt: string | null;
};

export type PracticeList = {
  courses: MyCourse[];
  course: MyCourse | null;
  homework: PracticeActivity[];
  cycles: { id: string; title: string; active: boolean; activities: PracticeActivity[] }[];
};

/** Activities of one course for the practice page: homework first, then by cycle. */
export async function getPracticeList(
  user: SessionUser,
  requestedCourseId: string | undefined,
): Promise<PracticeList> {
  const courses = await listMyCourses(user.id);
  const course = courses.find((c) => c.courseId === requestedCourseId) ?? courses[0] ?? null;
  if (!course) return { courses, course, homework: [], cycles: [] };

  const supabase = await createSupabaseServerClient();
  const [activities, cycles, groupCycles, attempts, assignments] = await Promise.all([
    supabase
      .from('activities')
      .select('id, title, cycle_id, phase, est_minutes, created_at')
      .eq('course_id', course.courseId)
      .order('created_at'),
    supabase.from('cycles').select('id, title, position').eq('course_id', course.courseId),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', course.groupId),
    supabase
      .from('attempts')
      .select('id, activity_id, status')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
    supabase
      .from('assignments')
      .select('activity_id, due_at')
      .eq('course_id', course.courseId)
      .not('activity_id', 'is', null),
  ]);
  for (const r of [activities, cycles, groupCycles, attempts, assignments]) {
    if (r.error) throw new Error(`Could not load practice: ${r.error.message}`);
  }

  const done = new Set(
    attempts.data!.filter((a) => a.status === 'submitted').map((a) => a.activity_id),
  );
  const open = new Map(
    attempts.data!.filter((a) => a.status === 'in_progress').map((a) => [a.activity_id, a.id]),
  );
  const due = new Map(assignments.data!.map((a) => [a.activity_id!, a.due_at]));
  const toItem = (a: NonNullable<typeof activities.data>[number]): PracticeActivity => ({
    id: a.id,
    title: a.title,
    phase: a.phase,
    minutes: a.est_minutes,
    status: open.has(a.id) ? 'in_progress' : done.has(a.id) ? 'completed' : 'not_started',
    openAttemptId: open.get(a.id) ?? null,
    dueAt: due.get(a.id) ?? null,
  });

  const all = activities.data!.map(toItem);
  const state = new Map(groupCycles.data!.map((g) => [g.cycle_id, g.state]));
  const homework = all.filter((a) => due.has(a.id) && a.status !== 'completed');
  return {
    courses,
    course,
    homework,
    cycles: [...cycles.data!]
      .sort(
        (a, b) =>
          Number(state.get(b.id) === 'active') - Number(state.get(a.id) === 'active') ||
          a.position - b.position,
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        active: state.get(c.id) === 'active',
        activities: activities
          .data!.filter((a) => a.cycle_id === c.id)
          .map((a) => all.find((x) => x.id === a.id)!),
      }))
      .filter((c) => c.activities.length > 0),
  };
}

/** Titles of activities referenced by `activity` blocks, for the section renderer. */
export async function getActivityTitles(
  ids: string[],
): Promise<Record<string, { title: string; minutes: number | null }>> {
  if (!ids.length) return {};
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('activities').select('id, title, est_minutes').in('id', ids);
  return Object.fromEntries(
    (data ?? []).map((a) => [a.id, { title: a.title, minutes: a.est_minutes }]),
  );
}
