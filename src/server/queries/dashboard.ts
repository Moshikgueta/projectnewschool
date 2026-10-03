import 'server-only';
import { practiceDaysInLastWeek, WEEKLY_PRACTICE_GOAL } from '@/domain/learning/time';
import { recommend, type Recommendation } from '@/domain/recommendations/rules';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { listMyCourses, type MyCourse } from './student';

export type ContinueItem =
  | { kind: 'activity'; title: string; attemptId: string }
  | { kind: 'section'; title: string; sectionId: string };

export type RecentItem = {
  type: Database['public']['Enums']['learning_event_type'];
  title: string;
  occurredAt: string;
};

export type StudentDashboard = {
  courses: MyCourse[];
  course: MyCourse | null;
  continueItem: ContinueItem | null;
  counts: {
    notebookSections: number;
    workbookSections: number;
    activities: number;
    reviewActivities: number;
    words: number;
    homework: number;
  };
  recommendations: Recommendation[];
  recent: RecentItem[];
  progress: {
    activitiesCompleted: number;
    practiceDays: number;
    practiceGoal: number;
    cycle: { title: string; percent: number } | null;
  };
};

const EMPTY_COUNTS: StudentDashboard['counts'] = {
  notebookSections: 0,
  workbookSections: 0,
  activities: 0,
  reviewActivities: 0,
  words: 0,
  homework: 0,
};

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? 'unknown error'}`);
}

/**
 * Everything the student home page shows for one course. Every query runs
 * with the student's own session, so Row Level Security limits it to their
 * own records and published content of courses they are enrolled in.
 */
export async function getStudentDashboard(
  user: SessionUser,
  requestedCourseId: string | undefined,
  now = new Date(),
): Promise<StudentDashboard> {
  const courses = await listMyCourses(user.id);
  const course = courses.find((c) => c.courseId === requestedCourseId) ?? courses[0] ?? null;
  const empty: StudentDashboard = {
    courses,
    course,
    continueItem: null,
    counts: EMPTY_COUNTS,
    recommendations: [],
    recent: [],
    progress: {
      activitiesCompleted: 0,
      practiceDays: 0,
      practiceGoal: WEEKLY_PRACTICE_GOAL,
      cycle: null,
    },
  };
  if (!course) return empty;

  const supabase = await createSupabaseServerClient();
  const courseId = course.courseId;
  const weekAgo = new Date(now.getTime() - 8 * 86_400_000).toISOString();

  const [
    sections,
    activities,
    words,
    assignments,
    attempts,
    sectionProgress,
    events,
    activeCycles,
    feedback,
  ] = await Promise.all([
    supabase.from('book_sections').select('id, book:books ( kind )').eq('course_id', courseId),
    supabase.from('activities').select('id, title, phase, cycle_id').eq('course_id', courseId),
    supabase
      .from('vocabulary_items')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId),
    supabase
      .from('assignments')
      .select(
        'id, activity_id, due_at, activity:activities ( title ), section:book_sections ( title ), vocabulary:vocabulary_sets ( title )',
      )
      .eq('course_id', courseId)
      .lte('available_from', now.toISOString()),
    supabase
      .from('attempts')
      .select('id, activity_id, status, updated_at, activity:activities ( title )')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('section_progress')
      .select('book_section_id, status, updated_at, section:book_sections ( title )')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .eq('status', 'in_progress')
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('learning_events')
      .select('type, occurred_at, activity:activities ( title ), section:book_sections ( title )')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .neq('type', 'login')
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('group_cycles')
      .select('cycle_id, cycle:cycles ( title )')
      .eq('group_id', course.groupId)
      .eq('state', 'active')
      .order('position')
      .limit(1),
    supabase
      .from('recommendation_feedback')
      .select('rec_key')
      .eq('user_id', user.id)
      .eq('action', 'dismissed'),
  ]);

  if (sections.error) fail('notebook', sections.error);
  if (activities.error) fail('activities', activities.error);
  if (words.error) fail('vocabulary', words.error);
  if (assignments.error) fail('assignments', assignments.error);
  if (attempts.error) fail('attempts', attempts.error);
  if (sectionProgress.error) fail('reading progress', sectionProgress.error);
  if (events.error) fail('recent activity', events.error);
  if (activeCycles.error) fail('active cycle', activeCycles.error);
  if (feedback.error) fail('recommendation feedback', feedback.error);

  const completedActivityIds = new Set(
    attempts.data.filter((a) => a.status === 'submitted').map((a) => a.activity_id),
  );

  const openAssignments = assignments.data
    .filter((a) => !a.activity_id || !completedActivityIds.has(a.activity_id))
    .map((a) => ({
      assignmentId: a.id,
      activityId: a.activity_id,
      title: a.activity?.title ?? a.section?.title ?? a.vocabulary?.title ?? '',
      dueAt: a.due_at,
    }));

  const unfinished = attempts.data
    .filter((a) => a.status === 'in_progress' && !completedActivityIds.has(a.activity_id))
    .map((a) => ({
      attemptId: a.id,
      activityId: a.activity_id,
      title: a.activity?.title ?? '',
      updatedAt: a.updated_at,
    }));

  const latestAttempt = unfinished[0];
  const latestSection = sectionProgress.data[0];
  let continueItem: ContinueItem | null = null;
  if (latestAttempt && (!latestSection || latestAttempt.updatedAt >= latestSection.updated_at)) {
    continueItem = {
      kind: 'activity',
      title: latestAttempt.title,
      attemptId: latestAttempt.attemptId,
    };
  } else if (latestSection) {
    continueItem = {
      kind: 'section',
      title: latestSection.section?.title ?? '',
      sectionId: latestSection.book_section_id,
    };
  }

  const activeCycle = activeCycles.data[0];
  let cycle: StudentDashboard['progress']['cycle'] = null;
  if (activeCycle) {
    const inCycle = activities.data.filter((a) => a.cycle_id === activeCycle.cycle_id);
    const done = inCycle.filter((a) => completedActivityIds.has(a.id)).length;
    cycle = {
      title: activeCycle.cycle?.title ?? '',
      percent: inCycle.length ? Math.round((done / inCycle.length) * 100) : 0,
    };
  }

  return {
    courses,
    course,
    continueItem,
    counts: {
      notebookSections: sections.data.filter((s) => s.book?.kind === 'notebook').length,
      workbookSections: sections.data.filter((s) => s.book?.kind === 'workbook').length,
      activities: activities.data.length,
      reviewActivities: activities.data.filter((a) => a.phase === 'review').length,
      words: words.count ?? 0,
      homework: openAssignments.length,
    },
    recommendations: recommend({
      now,
      openAssignments,
      unfinishedAttempts: unfinished,
      dismissedKeys: new Set(feedback.data.map((f) => f.rec_key)),
    }),
    recent: events.data.slice(0, 5).map((e) => ({
      type: e.type,
      title: e.activity?.title ?? e.section?.title ?? '',
      occurredAt: e.occurred_at,
    })),
    progress: {
      activitiesCompleted: completedActivityIds.size,
      practiceDays: practiceDaysInLastWeek(
        events.data.filter((e) => e.occurred_at >= weekAgo).map((e) => e.occurred_at),
        now,
        user.timezone,
      ),
      practiceGoal: WEEKLY_PRACTICE_GOAL,
      cycle,
    },
  };
}
