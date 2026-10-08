import 'server-only';
import { practiceDaysInLastWeek, WEEKLY_PRACTICE_GOAL } from '@/domain/learning/time';
import { cycleProgress } from '@/domain/learning/progress';
import { rulesV1, type Recommendation } from '@/domain/recommendations/rules';
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

/** Days a suggestion stays hidden after "Not now". */
export const SNOOZE_DAYS = 7;

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
    finishedSections,
    nextClass,
    skills,
    firstTries,
    wordsDue,
  ] = await Promise.all([
    supabase
      .from('book_sections')
      .select('id, cycle_id, book:books ( kind )')
      .eq('course_id', courseId),
    supabase
      .from('activities')
      .select('id, title, phase, cycle_id, activity_skills ( skill_id )')
      .eq('course_id', courseId),
    supabase
      .from('vocabulary_items')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId),
    supabase
      .from('assignments')
      .select(
        'id, activity_id, due_at, activity:activities ( title ), section:book_sections ( id, title, book:books ( kind ) ), vocabulary:vocabulary_sets ( title )',
      )
      .eq('course_id', courseId)
      .lte('available_from', now.toISOString()),
    supabase
      .from('attempts')
      .select('id, activity_id, status, updated_at, submitted_at, activity:activities ( title )')
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
      .order('position'),
    // "Not now" snoozes a suggestion for a week.
    supabase
      .from('recommendation_feedback')
      .select('rec_key')
      .eq('user_id', user.id)
      .eq('action', 'dismissed')
      .gte('at', new Date(now.getTime() - SNOOZE_DAYS * 86_400_000).toISOString()),
    supabase
      .from('section_progress')
      .select('book_section_id')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .eq('status', 'completed'),
    supabase
      .from('group_sessions')
      .select('starts_at')
      .eq('group_id', course.groupId)
      .gt('starts_at', now.toISOString())
      .order('starts_at')
      .limit(1),
    supabase.from('skills').select('id, label'),
    supabase
      .from('responses')
      .select('is_correct, created_at, item:activity_items ( activity_id )')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .eq('try_no', 1)
      .not('is_correct', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('vocab_review_state')
      .select('vocabulary_item_id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .lte('due_at', now.toISOString()),
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
  for (const r of [nextClass, skills, firstTries, wordsDue]) {
    if (r.error) fail('recommendations', r.error);
  }

  const completedActivityIds = new Set(
    attempts.data.filter((a) => a.status === 'submitted').map((a) => a.activity_id),
  );

  const openAssignments = assignments.data
    .filter((a) => !a.activity_id || !completedActivityIds.has(a.activity_id))
    .map((a) => ({
      assignmentId: a.id,
      activityId: a.activity_id,
      section: a.section?.book ? { id: a.section.id, book: a.section.book.kind } : null,
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
  const activeCycleIds = new Set(activeCycles.data.map((c) => c.cycle_id));
  // When each activity was last completed.
  const completedAt = new Map<string, string>();
  for (const a of attempts.data) {
    if (a.status !== 'submitted' || !a.submitted_at) continue;
    const seen = completedAt.get(a.activity_id);
    if (!seen || a.submitted_at > seen) completedAt.set(a.activity_id, a.submitted_at);
  }
  // Same rule as the progress page (domain/learning/progress.ts).
  const cycle: StudentDashboard['progress']['cycle'] = activeCycle
    ? (cycleProgress({
        cycles: [
          {
            id: activeCycle.cycle_id,
            title: activeCycle.cycle?.title ?? '',
            position: 0,
            active: true,
          },
        ],
        activities: activities.data.map((a) => ({
          id: a.id,
          cycleId: a.cycle_id,
          title: a.title,
          skillIds: [],
        })),
        sections: sections.data.map((x) => ({ id: x.id, cycleId: x.cycle_id })),
        completedActivityIds,
        completedSectionIds: new Set((finishedSections.data ?? []).map((f) => f.book_section_id)),
      }).map((c) => ({ title: c.title, percent: c.percent }))[0] ?? null)
    : null;

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
    recommendations: rulesV1.recommend({
      now,
      courseId,
      openAssignments,
      unfinishedAttempts: unfinished,
      dismissedKeys: new Set(feedback.data.map((f) => f.rec_key)),
      nextClassAt: nextClass.data?.[0]?.starts_at ?? null,
      activities: activities.data.map((a) => ({
        id: a.id,
        title: a.title,
        phase: a.phase,
        activeCycle: activeCycleIds.has(a.cycle_id),
        skillIds: a.activity_skills.map((k) => k.skill_id),
      })),
      completedAt,
      firstTries: (firstTries.data ?? []).flatMap((r) =>
        r.item
          ? [{ activityId: r.item.activity_id, correct: !!r.is_correct, at: r.created_at }]
          : [],
      ),
      skills: skills.data ?? [],
      wordsDue: wordsDue.count ?? 0,
      lastPracticeAt: events.data[0]?.occurred_at ?? null,
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
