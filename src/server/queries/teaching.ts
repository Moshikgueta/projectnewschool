import 'server-only';
import { inlineToPlainText } from '@/content/inline';
import { describeAnswer, feedbackSchema, parseKey, parsePublicItem } from '@/content/items';
import { parseBlocksForRender } from '@/content/schema';
import {
  assignmentProgress,
  commonDifficulties,
  studentSummaries,
  type StudentSummary,
} from '@/domain/teaching/insights';
import { solutionOf, type Solution } from '@/domain/grading/solution';
import { attendanceByStudent } from '@/domain/teaching/attendance';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { getActivity, type ActivityDetail } from './activities';

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
  assignments: {
    id: string;
    title: string;
    kind: 'activity' | 'section' | 'vocabulary';
    activityId: string | null;
    dueAt: string | null;
    note: string;
    done: number;
    total: number;
  }[];
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
    tries,
    events,
    pastSessions,
    marks,
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
      .select('id, title, cycle_id, phase, created_at')
      .eq('course_id', courseId)
      .order('created_at'),
    supabase
      .from('assignments')
      .select(
        `id, activity_id, book_section_id, vocabulary_set_id, audience, due_at, note, created_at,
           activity:activities ( title ), section:book_sections ( title ), vocabulary:vocabulary_sets ( title ),
           assignment_recipients ( student_id )`,
      )
      .eq('group_id', groupId)
      .order('created_at', { ascending: false }),
    supabase
      .from('attempts')
      .select('user_id, activity_id, assignment_id, submitted_at')
      .eq('course_id', courseId)
      .eq('status', 'submitted')
      .in('user_id', ids),
    supabase
      .from('section_progress')
      .select('user_id, book_section_id')
      .eq('course_id', courseId)
      .eq('status', 'completed')
      .in('user_id', ids),
    supabase
      .from('responses')
      .select(
        `user_id, item_id, is_correct, answer, created_at,
           item:activity_items ( type, prompt, data, points, activity:activities ( id, title ) )`,
      )
      .eq('course_id', courseId)
      .eq('try_no', 1)
      .not('is_correct', 'is', null)
      .in('user_id', ids),
    supabase
      .from('learning_events')
      .select(
        'user_id, type, occurred_at, activity:activities ( title ), section:book_sections ( title )',
      )
      .eq('course_id', courseId)
      .neq('type', 'login')
      .in('user_id', ids)
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabase
      .from('group_sessions')
      .select('id, starts_at')
      .eq('group_id', groupId)
      .lt('starts_at', now.toISOString())
      .order('starts_at', { ascending: false })
      .limit(6),
    supabase
      .from('attendance')
      .select('session_id, student_id, status, session:group_sessions!inner ( group_id )')
      .eq('session.group_id', groupId),
  ]);
  for (const [what, r] of Object.entries({
    cycles,
    groupCycles,
    sessions,
    activities,
    assignments,
    attempts,
    sections,
    tries,
    events,
    pastSessions,
    marks,
  })) {
    if (r.error) fail(what, r.error);
  }

  const state = new Map(groupCycles.data!.map((g) => [g.cycle_id, g.state]));
  const activeCycleIds = new Set(
    groupCycles.data!.filter((g) => g.state === 'active').map((g) => g.cycle_id),
  );
  const submitted = attempts.data!.map((a) => ({
    userId: a.user_id,
    activityId: a.activity_id,
    assignmentId: a.assignment_id,
    at: a.submitted_at ?? '',
  }));
  const firstTries = tries.data!.map((r) => ({
    userId: r.user_id,
    itemId: r.item_id,
    correct: !!r.is_correct,
    answer: r.answer,
    at: r.created_at,
  }));

  const summaries = studentSummaries(everyone, {
    activeCycleActivityIds: new Set(
      activities.data!.filter((a) => activeCycleIds.has(a.cycle_id)).map((a) => a.id),
    ),
    submitted,
    tries: firstTries,
    events: events.data!.map((e) => ({ userId: e.user_id, at: e.occurred_at })),
  });
  const nameOf = new Map(enrolled.map((s) => [s.id, s.name]));
  const markable = enrolled
    .filter((s) => s.status === 'active' || s.status === 'paused')
    .map((s) => s.id);
  const rates = attendanceByStudent(
    marks.data!.map((m) => ({ studentId: m.student_id, status: m.status })),
  );

  const progress = assignmentProgress(
    assignments.data!.map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      activityId: a.activity_id,
      sectionId: a.book_section_id,
      recipients:
        a.audience === 'group' ? active : a.assignment_recipients.map((r) => r.student_id),
    })),
    {
      submitted,
      finishedSections: sections.data!.map((s) => ({
        userId: s.user_id,
        sectionId: s.book_section_id,
      })),
    },
  );
  const progressOf = new Map(progress.map((p) => [p.assignmentId, p]));

  const itemInfo = new Map(tries.data!.map((r) => [r.item_id, r.item]));

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
      attendance: rates.get(s.id) ?? null,
    })),
    cycles: cycles.data!.map((c) => ({ id: c.id, title: c.title, state: state.get(c.id) ?? null })),
    upcomingClasses: sessions.data!.map((s) => ({ id: s.id, startsAt: s.starts_at })),
    pastClasses: pastSessions.data!.map((s) => ({
      id: s.id,
      startsAt: s.starts_at,
      marked: marks.data!.filter((m) => m.session_id === s.id && markable.includes(m.student_id))
        .length,
      students: markable.length,
    })),
    activities: activities.data!.map((a) => ({
      id: a.id,
      title: a.title,
      cycleId: a.cycle_id,
      phase: a.phase,
    })),
    assignments: assignments.data!.map((a) => ({
      id: a.id,
      title: a.activity?.title ?? a.section?.title ?? a.vocabulary?.title ?? '',
      kind: a.activity_id ? 'activity' : a.book_section_id ? 'section' : 'vocabulary',
      activityId: a.activity_id,
      dueAt: a.due_at,
      note: a.note,
      done: progressOf.get(a.id)?.done ?? 0,
      total: progressOf.get(a.id)?.total ?? 0,
    })),
    difficulties: commonDifficulties(firstTries).flatMap((d) => {
      const info = itemInfo.get(d.itemId);
      if (!info?.activity) return [];
      const item = parsePublicItem({
        id: d.itemId,
        type: info.type,
        data: info.data,
        points: Number(info.points),
      });
      const first = parseBlocksForRender(info.prompt).find((b) => b?.type === 'text');
      return [
        {
          itemId: d.itemId,
          activityId: info.activity.id,
          activityTitle: info.activity.title,
          question: first && first.type === 'text' ? inlineToPlainText(first.text) : '',
          students: d.students,
          wrong: d.wrong,
          commonWrong:
            item && d.commonWrongAnswer !== null ? describeAnswer(item, d.commonWrongAnswer) : null,
          commonWrongCount: d.commonWrongCount,
        },
      ];
    }),
    recent: events.data!.slice(0, 10).map((e) => ({
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
    .select('id, name, course_id, group_teachers!inner ( teacher_id ), enrollments ( student_id )')
    .eq('id', groupId)
    .maybeSingle();
  if (!group) return null;
  const activity = await getActivity(activityId);
  if (!activity || activity.courseId !== group.course_id) return null;

  const itemIds = activity.items.map((i) => i.rawId);
  const students = group.enrollments.map((e) => e.student_id);
  const [keys, tries] = await Promise.all([
    supabase.from('activity_item_keys').select('item_id, answer, feedback').in('item_id', itemIds),
    supabase
      .from('responses')
      .select('user_id, item_id, is_correct, answer, created_at')
      .in('item_id', itemIds)
      .eq('try_no', 1)
      .not('is_correct', 'is', null)
      .in('user_id', students.length ? students : ['00000000-0000-0000-0000-000000000000']),
  ]);
  if (keys.error) fail('answer keys', keys.error);
  if (tries.error) fail('answers', tries.error);
  const keyOf = new Map(keys.data.map((k) => [k.item_id, k]));

  return {
    groupId: group.id,
    groupName: group.name,
    activity,
    items: activity.items.map(({ rawId, item }) => {
      const key = keyOf.get(rawId);
      const parsedKey = item ? parseKey(item.type, key?.answer) : null;
      const feedback = feedbackSchema.safeParse(key?.feedback ?? {});
      // Earliest first try per student.
      const first = new Map<string, { correct: boolean; at: string }>();
      for (const r of tries.data.filter((t) => t.item_id === rawId)) {
        const seen = first.get(r.user_id);
        if (!seen || r.created_at < seen.at)
          first.set(r.user_id, { correct: !!r.is_correct, at: r.created_at });
      }
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
          students: first.size,
          correct: [...first.values()].filter((f) => f.correct).length,
        },
      };
    }),
  };
}
