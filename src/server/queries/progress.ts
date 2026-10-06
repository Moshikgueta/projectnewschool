import 'server-only';
import { studentProgress, type StudentProgress } from '@/domain/learning/progress';
import type { SessionUser } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { listMyCourses, type MyCourse } from './student';

export type ProgressPage = {
  courses: MyCourse[];
  course: MyCourse | null;
  progress: StudentProgress | null;
  words: { total: number; strong: number };
};

/**
 * Everything the progress page shows for one course. Every query runs with
 * the student's own session: RLS limits records to their own and content to
 * published material of courses they are enrolled in.
 */
export async function getProgressPage(
  user: SessionUser,
  requestedCourseId: string | undefined,
  now = new Date(),
): Promise<ProgressPage> {
  const courses = await listMyCourses(user.id);
  const course = courses.find((c) => c.courseId === requestedCourseId) ?? courses[0] ?? null;
  if (!course) return { courses, course, progress: null, words: { total: 0, strong: 0 } };

  const supabase = await createSupabaseServerClient();
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const [
    cycles,
    groupCycles,
    activities,
    skills,
    sections,
    attempts,
    sectionProgress,
    firstTries,
    events,
    words,
    reviews,
  ] = await Promise.all([
    supabase.from('cycles').select('id, title, position').eq('course_id', course.courseId),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', course.groupId),
    supabase
      .from('activities')
      .select('id, title, cycle_id, activity_skills ( skill_id )')
      .eq('course_id', course.courseId),
    supabase.from('skills').select('id, label'),
    supabase.from('book_sections').select('id, cycle_id').eq('course_id', course.courseId),
    supabase
      .from('attempts')
      .select('activity_id, status')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
    supabase
      .from('section_progress')
      .select('book_section_id, status')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
    supabase
      .from('responses')
      .select('attempt_id, is_correct, created_at, item:activity_items ( activity_id )')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId)
      .eq('try_no', 1)
      .not('is_correct', 'is', null),
    supabase
      .from('learning_events')
      .select('occurred_at')
      .eq('user_id', user.id)
      .gte('occurred_at', since),
    supabase
      .from('vocabulary_items')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', course.courseId),
    supabase
      .from('vocab_review_state')
      .select('box')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
  ]);
  for (const r of [
    cycles,
    groupCycles,
    activities,
    skills,
    sections,
    attempts,
    sectionProgress,
    firstTries,
    events,
    reviews,
  ]) {
    if (r.error) throw new Error(`Could not load progress: ${r.error.message}`);
  }

  const state = new Map(groupCycles.data!.map((g) => [g.cycle_id, g.state]));
  const progress = studentProgress({
    now,
    timeZone: user.timezone,
    cycles: cycles.data!.map((c) => ({
      id: c.id,
      title: c.title,
      position: c.position,
      active: state.get(c.id) === 'active',
    })),
    activities: activities.data!.map((a) => ({
      id: a.id,
      cycleId: a.cycle_id,
      title: a.title,
      skillIds: a.activity_skills.map((s) => s.skill_id),
    })),
    sections: sections.data!.map((s) => ({ id: s.id, cycleId: s.cycle_id })),
    completedActivityIds: new Set(
      attempts.data!.filter((a) => a.status === 'submitted').map((a) => a.activity_id),
    ),
    completedSectionIds: new Set(
      sectionProgress.data!.filter((p) => p.status === 'completed').map((p) => p.book_section_id),
    ),
    firstTries: firstTries.data!.flatMap((r) =>
      r.item
        ? [
            {
              attemptId: r.attempt_id,
              activityId: r.item.activity_id,
              correct: !!r.is_correct,
              at: r.created_at,
            },
          ]
        : [],
    ),
    skills: skills.data!,
    practisedAt: events.data!.map((e) => e.occurred_at),
  });

  return {
    courses,
    course,
    progress,
    words: { total: words.count ?? 0, strong: reviews.data!.filter((r) => r.box >= 4).length },
  };
}
