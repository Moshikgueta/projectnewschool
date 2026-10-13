import 'server-only';
import { studentProgress, type StudentProgress } from '@/domain/learning/progress';
import { attendanceByStudent, type AttendanceStatus } from '@/domain/teaching/attendance';
import { assignmentProgress } from '@/domain/teaching/insights';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { readAll } from './paging';

type EnrollmentStatus = Database['public']['Enums']['enrollment_status'];
type AttemptStatus = Database['public']['Enums']['attempt_status'];

export type HomeworkStatus = 'done' | 'open' | 'overdue' | 'untracked';

export type StudentInGroup = {
  group: { id: string; name: string; courseId: string; courseTitle: string; courseLang: string };
  student: { id: string; name: string; status: EnrollmentStatus; startedOn: string };
  lastActiveAt: string | null;
  progress: StudentProgress;
  attempts: {
    id: string;
    activityId: string;
    title: string;
    status: AttemptStatus;
    score: number | null;
    maxScore: number | null;
    at: string;
  }[];
  homework: {
    id: string;
    title: string;
    activityId: string | null;
    /** Given to this student by name (with others, perhaps), not to the whole group. */
    personal: boolean;
    dueAt: string | null;
    note: string;
    status: HomeworkStatus;
  }[];
  attendance: {
    counts: Record<AttendanceStatus, number>;
    rate: { attended: number; counted: number } | null;
    recent: { startsAt: string; status: AttendanceStatus }[];
  };
  /** Notebook pages of the course this student has written in. */
  notebook: { id: string; title: string }[];
  /** Published activities of the course to give this student. */
  assignable: { id: string; title: string; cycleTitle: string; byStaff: boolean }[];
};

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

/**
 * One student as a teacher of their group sees them. Null unless the caller
 * themselves teaches the group (a manager or the office sees nothing here) and
 * the student is enrolled in it; both cases look like a page that does not
 * exist. Learner records are read with the teacher's own session, which RLS
 * limits to students they teach in this course.
 */
export async function getStudentInGroup(
  teacherId: string,
  groupId: string,
  studentId: string,
  now = new Date(),
): Promise<StudentInGroup | null> {
  const supabase = await createSupabaseServerClient();
  const [groupRes, enrolmentRes] = await Promise.all([
    supabase
      .from('groups')
      .select(
        `id, name, course_id,
         course:courses ( title, level:levels ( language:languages ( code ) ) ),
         group_teachers!inner ( teacher_id )`,
      )
      .eq('id', groupId)
      .eq('group_teachers.teacher_id', teacherId)
      .maybeSingle(),
    supabase
      .from('enrollments')
      .select('status, started_on, student:profiles ( id, display_name, timezone )')
      .eq('group_id', groupId)
      .eq('student_id', studentId)
      .maybeSingle(),
  ]);
  if (groupRes.error) fail('the group', groupRes.error);
  if (enrolmentRes.error) fail('the enrolment', enrolmentRes.error);
  const group = groupRes.data;
  const enrolment = enrolmentRes.data;
  if (!group || !enrolment?.student) return null;
  const courseId = group.course_id;
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
    lastEvent,
    assignments,
    marks,
    written,
  ] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, title, position')
      .eq('course_id', courseId)
      .order('position'),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', groupId),
    supabase
      .from('activities')
      .select('id, title, cycle_id, status, created_by, activity_skills ( skill_id )')
      .eq('course_id', courseId)
      .order('created_at'),
    supabase.from('skills').select('id, label'),
    supabase
      .from('book_sections')
      .select('id, title, cycle_id, book:books ( kind )')
      .eq('course_id', courseId)
      .order('position'),
    supabase
      .from('attempts')
      .select('id, activity_id, assignment_id, status, score, max_score, started_at, submitted_at')
      .eq('user_id', studentId)
      .eq('course_id', courseId)
      .order('started_at', { ascending: false }),
    supabase
      .from('section_progress')
      .select('book_section_id, status')
      .eq('user_id', studentId)
      .eq('course_id', courseId),
    // Every first try (a student who practises a lot passes 1,000).
    readAll('first tries', (from, to) =>
      supabase
        .from('responses')
        .select('id, attempt_id, is_correct, created_at, item:activity_items ( activity_id )')
        .eq('user_id', studentId)
        .eq('course_id', courseId)
        .eq('try_no', 1)
        .not('is_correct', 'is', null)
        .order('id')
        .range(from, to),
    ),
    readAll('activity', (from, to) =>
      supabase
        .from('learning_events')
        .select('id, occurred_at')
        .eq('user_id', studentId)
        .eq('course_id', courseId)
        .gte('occurred_at', since)
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('learning_events')
      .select('occurred_at')
      .eq('user_id', studentId)
      .eq('course_id', courseId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
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
      .from('attendance')
      .select('status, session:group_sessions!inner ( group_id, starts_at )')
      .eq('student_id', studentId)
      .eq('session.group_id', groupId),
    supabase
      .from('block_responses')
      .select('section_id')
      .eq('user_id', studentId)
      .eq('course_id', courseId),
  ]);
  for (const [what, r] of Object.entries({
    cycles,
    groupCycles,
    activities,
    skills,
    sections,
    attempts,
    sectionProgress,
    lastEvent,
    assignments,
    marks,
    written,
  })) {
    if (r.error) fail(what, r.error);
  }

  // The homework this student has: the group's, and what was given to them
  // by name. Homework chosen for other students is not theirs.
  const theirs = assignments.data!.filter(
    (a) =>
      a.audience === 'group' || a.assignment_recipients.some((r) => r.student_id === studentId),
  );
  // Exercises staff wrote count only once given to this student (ADR-038),
  // as the student's own progress page counts them.
  const givenToThem = new Set(theirs.map((a) => a.activity_id));
  const published = activities.data!.filter((a) => a.status === 'published');
  const theirActivities = published.filter((a) => a.created_by === null || givenToThem.has(a.id));
  const titleOf = new Map(activities.data!.map((a) => [a.id, a.title]));
  const state = new Map(groupCycles.data!.map((g) => [g.cycle_id, g.state]));
  const cycleTitle = new Map(cycles.data!.map((c) => [c.id, c.title]));

  const progress = studentProgress({
    now,
    timeZone: enrolment.student.timezone,
    cycles: cycles.data!.map((c) => ({
      id: c.id,
      title: c.title,
      position: c.position,
      active: state.get(c.id) === 'active',
    })),
    activities: theirActivities.map((a) => ({
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
    firstTries: firstTries.flatMap((r) =>
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
    practisedAt: events.map((e) => e.occurred_at),
  });

  const done = new Map(
    assignmentProgress(
      theirs.map((a) => ({
        id: a.id,
        createdAt: a.created_at,
        activityId: a.activity_id,
        sectionId: a.book_section_id,
        recipients: [studentId],
      })),
      {
        submitted: attempts.data!.flatMap((a) =>
          a.status === 'submitted'
            ? [
                {
                  userId: studentId,
                  activityId: a.activity_id,
                  assignmentId: a.assignment_id,
                  at: a.submitted_at ?? '',
                },
              ]
            : [],
        ),
        finishedSections: sectionProgress.data!.flatMap((p) =>
          p.status === 'completed' ? [{ userId: studentId, sectionId: p.book_section_id }] : [],
        ),
      },
    ).map((p) => [p.assignmentId, p.done > 0]),
  );

  const statuses = marks.data!.map((m) => ({ studentId, status: m.status }));
  const counts: Record<AttendanceStatus, number> = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const m of marks.data!) counts[m.status] += 1;
  const writtenIds = new Set(written.data!.map((w) => w.section_id));

  return {
    group: {
      id: group.id,
      name: group.name,
      courseId,
      courseTitle: group.course?.title ?? '',
      courseLang: group.course?.level?.language?.code ?? 'en',
    },
    student: {
      id: enrolment.student.id,
      name: enrolment.student.display_name,
      status: enrolment.status,
      startedOn: enrolment.started_on,
    },
    lastActiveAt: lastEvent.data?.occurred_at ?? null,
    progress,
    attempts: attempts.data!.slice(0, 10).map((a) => ({
      id: a.id,
      activityId: a.activity_id,
      title: titleOf.get(a.activity_id) ?? '',
      status: a.status,
      score: a.score === null ? null : Number(a.score),
      maxScore: a.max_score === null ? null : Number(a.max_score),
      at: a.submitted_at ?? a.started_at,
    })),
    homework: theirs.map((a) => {
      const isDone = done.get(a.id) ?? false;
      const status: HomeworkStatus = a.vocabulary_set_id
        ? 'untracked'
        : isDone
          ? 'done'
          : a.due_at && a.due_at < now.toISOString()
            ? 'overdue'
            : 'open';
      return {
        id: a.id,
        title: a.activity?.title ?? a.section?.title ?? a.vocabulary?.title ?? '',
        activityId: a.activity_id,
        personal: a.audience === 'selected',
        dueAt: a.due_at,
        note: a.note,
        status,
      };
    }),
    attendance: {
      counts,
      rate: attendanceByStudent(statuses).get(studentId) ?? null,
      recent: marks
        .data!.flatMap((m) =>
          m.session ? [{ startsAt: m.session.starts_at, status: m.status }] : [],
        )
        .sort((x, y) => y.startsAt.localeCompare(x.startsAt))
        .slice(0, 6),
    },
    notebook: sections
      .data!.filter((s) => s.book?.kind === 'notebook' && writtenIds.has(s.id))
      .map((s) => ({ id: s.id, title: s.title })),
    assignable: published.map((a) => ({
      id: a.id,
      title: a.title,
      cycleTitle: cycleTitle.get(a.cycle_id) ?? '',
      byStaff: a.created_by !== null,
    })),
  };
}
