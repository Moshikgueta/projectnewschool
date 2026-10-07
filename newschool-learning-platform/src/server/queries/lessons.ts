import 'server-only';
import {
  balance,
  packageAlerts,
  type LessonStatus,
  type PackageAlerts,
} from '@/domain/office/packages';
import { attendanceByStudent, localDay, type AttendanceStatus } from '@/domain/teaching/attendance';
import { createSupabaseServerClient } from '@/server/supabase/server';

// A student's own attendance, packages and private lessons ("My lessons").
// Everything is read with the student's session and filtered to their own id
// as well; RLS already returns nobody else's rows.

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export type MyLessons = {
  attendance: {
    rate: { attended: number; counted: number } | null;
    recent: { sessionId: string; startsAt: string; groupName: string; status: AttendanceStatus }[];
  };
  packages: {
    id: string;
    lessons: number;
    minutesPerLesson: number;
    expiresOn: string | null;
    paid: boolean;
    used: number;
    booked: number;
    left: number;
    alerts: PackageAlerts;
  }[];
  upcoming: {
    id: string;
    startsAt: string;
    endsAt: string;
    teacherName: string;
    status: LessonStatus;
  }[];
  past: {
    id: string;
    startsAt: string;
    endsAt: string;
    teacherName: string;
    status: LessonStatus;
  }[];
};

export async function getMyLessons(
  user: { id: string; timezone: string },
  now = new Date(),
): Promise<MyLessons> {
  const supabase = await createSupabaseServerClient();
  const [marks, packages, balances, lessons] = await Promise.all([
    supabase
      .from('attendance')
      .select('session_id, status, session:group_sessions ( starts_at, group:groups ( name ) )')
      .eq('student_id', user.id),
    supabase
      .from('lesson_packages')
      .select('id, lessons, minutes_per_lesson, starts_on, expires_on, paid_at')
      .eq('student_id', user.id)
      .order('starts_on', { ascending: false }),
    supabase.from('package_balances').select('package_id, used, booked').eq('student_id', user.id),
    supabase
      .from('private_lessons')
      .select(
        'id, starts_at, ends_at, status, teacher:profiles!private_lessons_teacher_id_fkey ( display_name )',
      )
      .eq('student_id', user.id)
      .order('starts_at', { ascending: false })
      .limit(100),
  ]);
  if (marks.error) fail('attendance', marks.error);
  if (packages.error) fail('packages', packages.error);
  if (balances.error) fail('package balances', balances.error);
  if (lessons.error) fail('private lessons', lessons.error);

  const rate = attendanceByStudent(
    marks.data.map((m) => ({ studentId: user.id, status: m.status })),
  ).get(user.id);
  const counts = new Map(balances.data.map((b) => [b.package_id, b]));
  const today = localDay(now, user.timezone);
  const lessonRows = lessons.data.map((l) => ({
    id: l.id,
    startsAt: l.starts_at,
    endsAt: l.ends_at,
    teacherName: l.teacher?.display_name ?? '',
    status: l.status,
  }));

  return {
    attendance: {
      rate: rate ?? null,
      recent: marks.data
        .flatMap((m) =>
          m.session
            ? [
                {
                  sessionId: m.session_id,
                  startsAt: m.session.starts_at,
                  groupName: m.session.group?.name ?? '',
                  status: m.status,
                },
              ]
            : [],
        )
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
        .slice(0, 10),
    },
    packages: packages.data.map((p) => {
      const used = counts.get(p.id)?.used ?? 0;
      const booked = counts.get(p.id)?.booked ?? 0;
      const row = {
        id: p.id,
        lessons: p.lessons,
        used,
        booked,
        startsOn: p.starts_on,
        expiresOn: p.expires_on,
        paid: p.paid_at !== null,
      };
      return {
        id: p.id,
        lessons: p.lessons,
        minutesPerLesson: p.minutes_per_lesson,
        expiresOn: p.expires_on,
        paid: row.paid,
        used,
        booked,
        left: balance(row).left,
        alerts: packageAlerts(row, today),
      };
    }),
    upcoming: lessonRows
      .filter((l) => new Date(l.startsAt) > now && l.status === 'scheduled')
      .reverse(),
    past: lessonRows.filter((l) => new Date(l.startsAt) <= now || l.status !== 'scheduled'),
  };
}
