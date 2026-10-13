import 'server-only';
import { inlineToPlainText } from '@/content/inline';
import { describeAnswer, feedbackSchema, parseKey, parsePublicItem } from '@/content/items';
import { parseBlocksForRender } from '@/content/schema';
import {
  assignmentProgress,
  DIFFICULTY_FROM,
  MAX_DIFFICULTIES,
  MIN_STUDENTS,
  studentSummaries,
  type StudentSummary,
} from '@/domain/teaching/insights';
import { solutionOf, type Solution } from '@/domain/grading/solution';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { getActivity, type ActivityDetail } from './activities';
import { readAll } from './paging';

type EventType = Database['public']['Enums']['learning_event_type'];
type CycleState = Database['public']['Enums']['group_cycle_state'];

export type GroupOverview = {
  id: string;
  name: string;
  courseId: string;
  courseTitle: string;
  courseLang: string;
  scheduleNote: string;
  students: (StudentSummary & {
    name: string;
    status: Database['public']['Enums']['enrollment_status'];
    /** Classes attended out of classes that count (excused left out); null before any mark. */
    attendance: { attended: number; counted: number } | null;
  })[];
  cycles: { id: string; title: string; state: CycleState | null }[];
  upcomingClasses: { id: string; startsAt: string }[];
  /** Classes that have started, latest first, with how many students are marked. */
  pastClasses: { id: string; startsAt: string; marked: number; students: number }[];
  activities: { id: string; title: string; cycleId: string; phase: string }[];
  /** Published activities of the course to assign: the curriculum's and exercises staff wrote. */
  assignable: { id: string; title: string; cycleId: string; byStaff: boolean }[];
  assignments: {
    id: string;
    title: string;
    kind: 'activity' | 'section' | 'vocabulary';
    activityId: string | null;
    dueAt: string | null;
    note: string;
    /** Names of the chosen students; null when given to the whole group. */
    recipients: string[] | null;
    done: number;
    total: number;
  }[];
  /** Students homework can be given to by name (active and paused). */
  choosable: { id: string; name: string }[];
  difficulties: {
    itemId: string;
    activityId: string;
    activityTitle: string;
    question: string;
    students: number;
    wrong: number;
    commonWrong: { text: string } | { truth: boolean } | null;
    commonWrongCount: number;
  }[];
  recent: { student: string; type: EventType; title: string; at: string }[];
};

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Latest learning events listed on the group page. */
const RECENT_EVENTS = 10;

/**
 * The group's common difficulties: computed by the database over every first
 * answer of the group's students (view group_item_first_tries, the rule of
 * commonDifficulties()), then the questions' text, read under RLS like any
 * question (a question the teacher cannot see is left out).
 */
async function groupDifficulties(
  supabase: Client,
  groupId: string,
): Promise<GroupOverview['difficulties']> {
  const { data: found, error } = await supabase
    .from('group_item_first_tries')
    .select('item_id, students, wrong, common_wrong_answer, common_wrong_count')
    .eq('group_id', groupId)
    .gte('students', MIN_STUDENTS)
    .gte('wrong_rate', DIFFICULTY_FROM)
    .order('wrong_rate', { ascending: false })
    .order('students', { ascending: false })
    .order('item_id')
    .limit(MAX_DIFFICULTIES);
  if (error) fail('common difficulties', error);
  if (!found.length) return [];
  const { data: items, error: itemsError } = await supabase
    .from('activity_items')
    .select('id, type, prompt, data, points, activity:activities ( id, title )')
    .in(
      'id',
      found.map((d) => d.item_id!),
    );
  if (itemsError) fail('questions', itemsError);
  const itemInfo = new Map(items.map((i) => [i.id, i]));
  return found.flatMap((d) => {
    const info = itemInfo.get(d.item_id!);
    if (!info?.activity) return [];
    const item = parsePublicItem({
      id: info.id,
      type: info.type,
      data: info.data,
      points: Number(info.points),
    });
    const first = parseBlocksForRender(info.prompt).find((b) => b?.type === 'text');
    const commonWrong = (d.common_wrong_count ?? 0) > 1 ? d.common_wrong_answer : null;
    return [
      {
        itemId: info.id,
        activityId: info.activity.id,
        activityTitle: info.activity.title,
        question: first && first.type === 'text' ? inlineToPlainText(first.text) : '',
        students: d.students ?? 0,
        wrong: d.wrong ?? 0,
        commonWrong: item && commonWrong !== null ? describeAnswer(item, commonWrong) : null,
        commonWrongCount: d.common_wrong_count ?? 0,
      },
    ];
  });
}

/**
 * Everything the teacher's group page shows. Null unless the caller teaches
 * the group (RLS returns no group otherwise). Learner records are read with
 * the teacher's own session, which RLS limits to students they teach; they
 * are further limited here to this group's students.
 */
export async function getGroupOverview(
  groupId: string,
  now = new Date(),
): Promise<GroupOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data: group, error } = await supabase
    .from('groups')
    .select(
      `id, name, course_id, schedule_note,
       course:courses ( title, level:levels ( language:languages ( code ) ) ),
       enrollments ( status, student:profiles ( id, display_name ) )`,
    )
    .eq('id', groupId)
    .maybeSingle();
  if (error) fail('the group', error);
  if (!group) return null;

  const enrolled = group.enrollments
    .flatMap((e) =>
      e.student ? [{ id: e.student.id, name: e.student.display_name, status: e.status }] : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const active = enrolled.filter((s) => s.status === 'active').map((s) => s.id);
  const everyone = enrolled.map((s) => s.id);
  const ids = everyone.length ? everyone : ['00000000-0000-0000-0000-000000000000'];
  const courseId = group.course_id;

  const [
    cycles,
    groupCycles,
    sessions,
    activities,
    assignments,
    attempts,
    sections,
    stats,
    difficulties,
    events,
    pastSessions,
  ] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, title, position')
      .eq('course_id', courseId)
      .order('position'),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', groupId),
    supabase
      .from('group_sessions')
      .select('id, starts_at')
      .eq('group_id', groupId)
      .gte('starts_at', now.toISOString())
      .order('starts_at')
      .limit(5),
    supabase
      .from('activities')
      .select('id, title, cycle_id, phase, created_at, created_by, status')
      .eq('course_id', courseId)
      .order('created_at')
      .order('id'),
    readAll('assignments', (from, to) =>
      supabase
        .from('assignments')
        .select(
          `id, activity_id, book_section_id, vocabulary_set_id, audience, due_at, note, created_at,
           activity:activities ( title ), section:book_sections ( title ), vocabulary:vocabulary_sets ( title ),
           assignment_recipients ( student_id )`,
        )
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    readAll('attempts', (from, to) =>
      supabase
        .from('attempts')
        .select('id, user_id, activity_id, assignment_id, submitted_at')
        .eq('course_id', courseId)
        .eq('status', 'submitted')
        .in('user_id', ids)
        .order('id')
        .range(from, to),
    ),
    readAll('finished sections', (from, to) =>
      supabase
        .from('section_progress')
        .select('user_id, book_section_id')
        .eq('course_id', courseId)
        .eq('status', 'completed')
        .in('user_id', ids)
        .order('user_id')
        .order('book_section_id')
        .range(from, to),
    ),
    // Counted by the database over every answer and mark (a few rows back).
    readAll('student totals', (from, to) =>
      supabase
        .from('group_student_stats')
        .select('student_id, answers, correct, last_active_at, attended, counted')
        .eq('group_id', groupId)
        .order('student_id')
        .range(from, to),
    ),
    groupDifficulties(supabase, groupId),
    supabase
      .from('learning_events')
      .select(
        'user_id, type, occurred_at, activity:activities ( title ), section:book_sections ( title )',
      )
      .eq('course_id', courseId)
      .neq('type', 'login')
      .in('user_id', ids)
      .order('occurred_at', { ascending: false })
      .limit(RECENT_EVENTS),
    supabase
      .from('group_sessions')
      .select('id, starts_at')
      .eq('group_id', groupId)
      .lt('starts_at', now.toISOString())
      .order('starts_at', { ascending: false })
      .limit(6),
  ]);
  for (const [what, r] of Object.entries({
    cycles,
    groupCycles,
    sessions,
    activities,
    events,
    pastSessions,
  })) {
    if (r.error) fail(what, r.error);
  }

  // Marks of the classes listed (by class id: primary-key lookups, not a
  // scan of the school's attendance).
  const pastIds = pastSessions.data!.map((s) => s.id);
  const marks = pastIds.length
    ? await readAll('attendance', (from, to) =>
        supabase
          .from('attendance')
          .select('session_id, student_id')
          .in('session_id', pastIds)
          .order('session_id')
          .order('student_id')
          .range(from, to),
      )
    : [];

  const state = new Map(groupCycles.data!.map((g) => [g.cycle_id, g.state]));
  // Exercises staff wrote (ADR-038) belong to this group only once assigned
  // to it; until then they are only offered in the "assign" list.
  // (A teacher also sees their own drafts; only published ones count here.)
  const assignedHere = new Set(assignments.map((a) => a.activity_id));
  const published = activities.data!.filter((a) => a.status === 'published');
  const groupActivities = published.filter((a) => a.created_by === null || assignedHere.has(a.id));
  const activeCycleIds = new Set(
    groupCycles.data!.filter((g) => g.state === 'active').map((g) => g.cycle_id),
  );
  const submitted = attempts.map((a) => ({
    userId: a.user_id,
    activityId: a.activity_id,
    assignmentId: a.assignment_id,
    at: a.submitted_at ?? '',
  }));
  const statsOf = new Map(stats.map((s) => [s.student_id!, s]));

  const summaries = studentSummaries(everyone, {
    activeCycleActivityIds: new Set(
      groupActivities.filter((a) => activeCycleIds.has(a.cycle_id)).map((a) => a.id),
    ),
    submitted,
    totals: new Map(
      stats.map((s) => [
        s.student_id!,
        { answers: s.answers ?? 0, correct: s.correct ?? 0, lastActiveAt: s.last_active_at },
      ]),
    ),
  });
  const nameOf = new Map(enrolled.map((s) => [s.id, s.name]));
  const markable = enrolled
    .filter((s) => s.status === 'active' || s.status === 'paused')
    .map((s) => s.id);
  const rateOf = (id: string) => {
    const s = statsOf.get(id);
    // Same as attendanceByStudent(): no rate before a mark that counts.
    return s && (s.counted ?? 0) > 0
      ? { attended: s.attended ?? 0, counted: s.counted ?? 0 }
      : null;
  };

  const progress = assignmentProgress(
    assignments.map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      activityId: a.activity_id,
      sectionId: a.book_section_id,
      recipients:
        a.audience === 'group' ? active : a.assignment_recipients.map((r) => r.student_id),
    })),
    {
      submitted,
      finishedSections: sections.map((s) => ({
        userId: s.user_id,
        sectionId: s.book_section_id,
      })),
    },
  );
  const progressOf = new Map(progress.map((p) => [p.assignmentId, p]));

  return {
    id: group.id,
    name: group.name,
    courseId,
    courseTitle: group.course?.title ?? '',
    courseLang: group.course?.level?.language?.code ?? 'en',
    scheduleNote: group.schedule_note,
    students: summaries.map((s) => ({
      ...s,
      name: nameOf.get(s.id) ?? '',
      status: enrolled.find((e) => e.id === s.id)?.status ?? 'active',
      attendance: rateOf(s.id),
    })),
    cycles: cycles.data!.map((c) => ({ id: c.id, title: c.title, state: state.get(c.id) ?? null })),
    upcomingClasses: sessions.data!.map((s) => ({ id: s.id, startsAt: s.starts_at })),
    pastClasses: pastSessions.data!.map((s) => ({
      id: s.id,
      startsAt: s.starts_at,
      marked: marks.filter((m) => m.session_id === s.id && markable.includes(m.student_id)).length,
      students: markable.length,
    })),
    activities: groupActivities.map((a) => ({
      id: a.id,
      title: a.title,
      cycleId: a.cycle_id,
      phase: a.phase,
    })),
    assignable: published.map((a) => ({
      id: a.id,
      title: a.title,
      cycleId: a.cycle_id,
      byStaff: a.created_by !== null,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.activity?.title ?? a.section?.title ?? a.vocabulary?.title ?? '',
      kind: a.activity_id ? 'activity' : a.book_section_id ? 'section' : 'vocabulary',
      activityId: a.activity_id,
      dueAt: a.due_at,
      note: a.note,
      recipients:
        a.audience === 'selected'
          ? a.assignment_recipients
              .map((r) => nameOf.get(r.student_id) ?? '')
              .sort((x, y) => x.localeCompare(y))
          : null,
      done: progressOf.get(a.id)?.done ?? 0,
      total: progressOf.get(a.id)?.total ?? 0,
    })),
    choosable: enrolled
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .map((s) => ({ id: s.id, name: s.name })),
    difficulties,
    recent: events.data!.map((e) => ({
      student: nameOf.get(e.user_id) ?? '',
      type: e.type,
      title: e.activity?.title ?? e.section?.title ?? '',
      at: e.occurred_at,
    })),
  };
}

export type TeacherActivity = {
  groupId: string;
  groupName: string;
  activity: ActivityDetail;
  items: {
    id: string;
    solution: Solution | null;
    feedback: string[];
    /** First encounter per student of this group. */
    result: { students: number; correct: number };
  }[];
};

/**
 * The teacher version of an activity: answers, feedback and how this group
 * did. Null unless the caller teaches the group and the activity belongs to
 * its course. Keys come through RLS (teachers of the course may read them).
 */
export async function getTeacherActivity(
  groupId: string,
  activityId: string,
): Promise<TeacherActivity | null> {
  const supabase = await createSupabaseServerClient();
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, course_id, group_teachers!inner ( teacher_id )')
    .eq('id', groupId)
    .maybeSingle();
  if (!group) return null;
  const activity = await getActivity(activityId);
  if (!activity || activity.courseId !== group.course_id) return null;

  const itemIds = activity.items.map((i) => i.rawId);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const [keys, results] = await Promise.all([
    supabase.from('activity_item_keys').select('item_id, answer, feedback').in('item_id', itemIds),
    // First encounter per student of this group, counted by the database
    // over every answer (view group_item_first_tries).
    supabase
      .from('group_item_first_tries')
      .select('item_id, students, wrong')
      .eq('group_id', group.id)
      .in('item_id', itemIds.length ? itemIds : none),
  ]);
  if (keys.error) fail('answer keys', keys.error);
  if (results.error) fail('answers', results.error);
  const keyOf = new Map(keys.data.map((k) => [k.item_id, k]));
  const resultOf = new Map(results.data.map((r) => [r.item_id!, r]));

  return {
    groupId: group.id,
    groupName: group.name,
    activity,
    items: activity.items.map(({ rawId, item }) => {
      const key = keyOf.get(rawId);
      const parsedKey = item ? parseKey(item.type, key?.answer) : null;
      const feedback = feedbackSchema.safeParse(key?.feedback ?? {});
      const result = resultOf.get(rawId);
      return {
        id: rawId,
        solution:
          item && parsedKey
            ? solutionOf({ type: item.type, data: item.data, key: parsedKey } as Parameters<
                typeof solutionOf
              >[0])
            : null,
        feedback: feedback.success ? Object.values(feedback.data) : [],
        result: {
          students: result?.students ?? 0,
          correct: (result?.students ?? 0) - (result?.wrong ?? 0),
        },
      };
    }),
  };
}
