import 'server-only';
import {
  isAttendanceOpen,
  teacherDay,
  TO_TAKE_WINDOW_MS,
  type AttendanceStatus,
} from '@/domain/teaching/attendance';
import { assignmentProgress } from '@/domain/teaching/insights';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Attendance and the teacher's day (staff room merge, stage C). Everything is
// read with the teacher's own session, so RLS limits it to their groups, and
// the queries below also name the teacher explicitly: a pedagogical manager
// who happens to teach sees only the groups they teach here.

const NONE = ['00000000-0000-0000-0000-000000000000'];
const nonEmpty = (ids: string[]) => (ids.length ? ids : NONE);

export type ClassAttendance = {
  groupId: string;
  groupName: string;
  sessionId: string;
  startsAt: string;
  open: boolean;
  students: {
    id: string;
    name: string;
    enrolment: 'active' | 'paused';
    status: AttendanceStatus | null;
    note: string;
  }[];
};

/** One class of a group the teacher teaches, with its students and marks; null otherwise. */
export async function getClassAttendance(
  teacherId: string,
  groupId: string,
  sessionId: string,
  now = new Date(),
): Promise<ClassAttendance | null> {
  const supabase = await createSupabaseServerClient();
  const { data: group } = await supabase
    .from('groups')
    .select(
      `id, name, group_teachers!inner ( teacher_id ),
       enrollments ( status, student:profiles ( id, display_name ) ),
       group_sessions ( id, starts_at )`,
    )
    .eq('id', groupId)
    .eq('group_teachers.teacher_id', teacherId)
    .eq('group_sessions.id', sessionId)
    .maybeSingle();
  const session = group?.group_sessions[0];
  if (!group || !session) return null;

  const { data: marks, error } = await supabase
    .from('attendance')
    .select('student_id, status, note')
    .eq('session_id', session.id);
  if (error) throw new Error(`Could not load attendance: ${error.message}`);
  const markOf = new Map(marks.map((m) => [m.student_id, m]));

  return {
    groupId: group.id,
    groupName: group.name,
    sessionId: session.id,
    startsAt: session.starts_at,
    open: isAttendanceOpen(new Date(session.starts_at), now),
    students: group.enrollments
      .flatMap((e) =>
        e.student && (e.status === 'active' || e.status === 'paused')
          ? [
              {
                id: e.student.id,
                name: e.student.display_name,
                enrolment: e.status,
                status: markOf.get(e.student.id)?.status ?? null,
                note: markOf.get(e.student.id)?.note ?? '',
              },
            ]
          : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type DayClass = {
  id: string;
  groupId: string;
  groupName: string;
  startsAt: string;
  room: string | null;
  students: number;
  marked: number;
};

export type TeacherDay = {
  today: DayClass[];
  toTake: DayClass[];
  homework: {
    id: string;
    groupId: string;
    groupName: string;
    title: string;
    dueAt: string;
    done: number;
    total: number;
  }[];
};

const HOMEWORK_AHEAD_MS = 7 * 86_400_000;

/**
 * The teacher's day: today's classes (with the room from the weekly
 * timetable), earlier classes still missing attendance, and homework due in
 * the coming week with how many have done it.
 */
export async function getTeacherDay(
  teacherId: string,
  timeZone: string,
  now = new Date(),
): Promise<TeacherDay> {
  const supabase = await createSupabaseServerClient();
  const { data: taught, error } = await supabase
    .from('group_teachers')
    .select('group:groups ( id, name, course_id )')
    .eq('teacher_id', teacherId);
  if (error) throw new Error(`Could not load groups: ${error.message}`);
  const groups = taught.flatMap((t) => (t.group ? [t.group] : []));
  const groupIds = nonEmpty(groups.map((g) => g.id));
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));

  const from = new Date(now.getTime() - TO_TAKE_WINDOW_MS - 86_400_000).toISOString();
  const to = new Date(now.getTime() + 2 * 86_400_000).toISOString();
  const [sessions, enrolments, rooms, assignments] = await Promise.all([
    supabase
      .from('group_sessions')
      .select('id, group_id, starts_at')
      .in('group_id', groupIds)
      .gte('starts_at', from)
      .lte('starts_at', to),
    supabase.from('enrollments').select('group_id, student_id, status').in('group_id', groupIds),
    supabase
      .from('timetable_entries')
      .select('group_id, room_name, weekday, start_min')
      .in('group_id', groupIds),
    supabase
      .from('assignments')
      .select(
        `id, group_id, activity_id, book_section_id, audience, due_at, created_at,
         activity:activities ( title ), section:book_sections ( title ),
         assignment_recipients ( student_id )`,
      )
      .in('group_id', groupIds)
      .gte('due_at', now.toISOString())
      .lte('due_at', new Date(now.getTime() + HOMEWORK_AHEAD_MS).toISOString())
      .is('vocabulary_set_id', null)
      .order('due_at'),
  ]);
  for (const r of [sessions, enrolments, rooms, assignments]) {
    if (r.error) throw new Error(`Could not load the teacher's day: ${r.error.message}`);
  }

  const markable = (groupId: string) =>
    enrolments
      .data!.filter(
        (e) => e.group_id === groupId && (e.status === 'active' || e.status === 'paused'),
      )
      .map((e) => e.student_id);
  const sessionIds = nonEmpty(sessions.data!.map((s) => s.id));
  const { data: marks } = await supabase
    .from('attendance')
    .select('session_id, student_id')
    .in('session_id', sessionIds);
  const markedIn = (sessionId: string, students: string[]) =>
    (marks ?? []).filter((m) => m.session_id === sessionId && students.includes(m.student_id))
      .length;

  // The room comes from the weekly timetable: the group's booking on that
  // weekday, the one nearest the class's start if there are several.
  const weekdayAndMinute = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { weekday, minute: Number(get('hour')) * 60 + Number(get('minute')) };
  };
  const roomFor = (groupId: string, iso: string) => {
    const { weekday, minute } = weekdayAndMinute(iso);
    const options = rooms
      .data!.filter((r) => r.group_id === groupId && r.weekday === weekday)
      .sort(
        (a, b) => Math.abs((a.start_min ?? 0) - minute) - Math.abs((b.start_min ?? 0) - minute),
      );
    return options[0]?.room_name ?? null;
  };

  const classes: DayClass[] = sessions.data!.map((s) => {
    const students = markable(s.group_id);
    return {
      id: s.id,
      groupId: s.group_id,
      groupName: nameOf.get(s.group_id) ?? '',
      startsAt: s.starts_at,
      room: roomFor(s.group_id, s.starts_at),
      students: students.length,
      marked: markedIn(s.id, students),
    };
  });
  const day = teacherDay(classes, now, timeZone);

  // Homework due soon: who has done it, as on the group page.
  const due = assignments.data!;
  const recipientsOf = (a: (typeof due)[number]) =>
    a.audience === 'group'
      ? enrolments
          .data!.filter((e) => e.group_id === a.group_id && e.status === 'active')
          .map((e) => e.student_id)
      : a.assignment_recipients.map((r) => r.student_id);
  const students = nonEmpty([...new Set(due.flatMap(recipientsOf))]);
  const [attempts, sections] = await Promise.all([
    supabase
      .from('attempts')
      .select('user_id, activity_id, assignment_id, submitted_at')
      .eq('status', 'submitted')
      .in('activity_id', nonEmpty(due.flatMap((a) => (a.activity_id ? [a.activity_id] : []))))
      .in('user_id', students),
    supabase
      .from('section_progress')
      .select('user_id, book_section_id')
      .eq('status', 'completed')
      .in(
        'book_section_id',
        nonEmpty(due.flatMap((a) => (a.book_section_id ? [a.book_section_id] : []))),
      )
      .in('user_id', students),
  ]);
  const progress = assignmentProgress(
    due.map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      activityId: a.activity_id,
      sectionId: a.book_section_id,
      recipients: recipientsOf(a),
    })),
    {
      submitted: (attempts.data ?? []).map((a) => ({
        userId: a.user_id,
        activityId: a.activity_id,
        assignmentId: a.assignment_id,
        at: a.submitted_at ?? '',
      })),
      finishedSections: (sections.data ?? []).map((s) => ({
        userId: s.user_id,
        sectionId: s.book_section_id,
      })),
    },
  );

  return {
    ...day,
    homework: due.map((a, i) => ({
      id: a.id,
      groupId: a.group_id,
      groupName: nameOf.get(a.group_id) ?? '',
      title: a.activity?.title ?? a.section?.title ?? '',
      dueAt: a.due_at!,
      done: progress[i]?.done ?? 0,
      total: progress[i]?.total ?? 0,
    })),
  };
}
