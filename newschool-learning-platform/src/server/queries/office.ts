import 'server-only';
import { localDay } from '@/domain/teaching/attendance';
import {
  balance,
  EXPIRING_DAYS,
  LOW_BALANCE,
  packageAlerts,
  type LessonStatus,
  type PackageAlerts,
} from '@/domain/office/packages';
import { searchTerm, type PageInfo, type PageRequest } from '@/domain/paging';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { readAll, readCountedPage } from './paging';

// The office's students, packages and private lessons (stage D). Read with
// the office user's own MFA-verified session: RLS returns nothing to anyone
// else, so these pages show nothing even if a guard were missed.

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export type OfficePackage = {
  id: string;
  lessons: number;
  minutesPerLesson: number;
  startsOn: string;
  expiresOn: string | null;
  price: number | null;
  paidAt: string | null;
  note: string;
  used: number;
  booked: number;
  left: number;
  unbooked: number;
  alerts: PackageAlerts;
};

/** The packages of some students (a page of the list, or one student), newest first. */
async function packagesFor(
  studentIds: string[],
  today: string,
): Promise<(OfficePackage & { studentId: string })[]> {
  const supabase = await createSupabaseServerClient();
  const [p, b] = await Promise.all([
    readAll('packages', (from, to) =>
      supabase
        .from('lesson_packages')
        .select(
          'id, student_id, lessons, minutes_per_lesson, starts_on, expires_on, price, paid_at, note',
        )
        .in('student_id', studentIds)
        .order('starts_on', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    readAll('package balances', (from, to) =>
      supabase
        .from('package_balances')
        .select('package_id, used, booked')
        .in('student_id', studentIds)
        .order('package_id')
        .range(from, to),
    ),
  ]);
  const counts = new Map(b.map((r) => [r.package_id, r]));
  return p.map((row) => {
    const used = counts.get(row.id)?.used ?? 0;
    const booked = counts.get(row.id)?.booked ?? 0;
    const base = {
      id: row.id,
      lessons: row.lessons,
      used,
      booked,
      startsOn: row.starts_on,
      expiresOn: row.expires_on,
      paid: row.paid_at !== null,
    };
    return {
      id: row.id,
      studentId: row.student_id,
      lessons: row.lessons,
      minutesPerLesson: row.minutes_per_lesson,
      startsOn: row.starts_on,
      expiresOn: row.expires_on,
      price: row.price,
      paidAt: row.paid_at,
      note: row.note,
      used,
      booked,
      ...balance(base),
      alerts: packageAlerts(base, today),
    };
  });
}

export type OfficeStudentRow = {
  id: string;
  name: string;
  phone: string;
  /** Lessons left across live packages (not finished, not expired). */
  left: number;
  needsAttention: boolean;
};

export type OfficeStudentPage = { rows: OfficeStudentRow[]; info: PageInfo };

/**
 * A page of the office's students, by name, searched by name, phone (digits
 * are matched without spaces or dashes) or contact email. The database pages
 * and counts (view office_students); packages are read for the page's
 * students only.
 */
export async function listOfficeStudents(
  timeZone: string,
  query: string,
  request: PageRequest,
): Promise<OfficeStudentPage> {
  const supabase = await createSupabaseServerClient();
  const today = localDay(new Date(), timeZone);
  const q = searchTerm(query).toLowerCase();
  // Typed with spaces or dashes ("050 123"), a phone is also looked for as digits.
  const digits = /\d/.test(q) ? q.replace(/[^0-9]/g, '') : '';
  const { rows, info } = await readCountedPage('students', request, (from, to) => {
    let students = supabase
      .from('office_students')
      .select('id, display_name, phone', { count: 'exact' })
      .order('display_name')
      .order('id');
    // One lower-case text per student (name, phone, phone digits, contact email).
    if (digits.length >= 3 && digits !== q) {
      students = students.or(`search_text.like."*${q}*",search_text.like."*${digits}*"`);
    } else if (q) {
      students = students.like('search_text', `%${q}%`);
    }
    return students.range(from, to);
  });
  const ids = rows.map((x) => x.id!);
  const packages = ids.length ? await packagesFor(ids, today) : [];
  return {
    info,
    rows: rows.map((x) => {
      const own = packages.filter((p) => p.studentId === x.id);
      const live = own.filter((p) => !p.alerts.finished && !p.alerts.expired);
      return {
        id: x.id!,
        name: x.display_name ?? '',
        phone: x.phone ?? '',
        left: live.reduce((n, p) => n + p.left, 0),
        needsAttention: own.some(
          (p) => p.alerts.low || p.alerts.expiring || (p.alerts.unpaid && !p.alerts.finished),
        ),
      };
    }),
  };
}

export type OfficeLesson = {
  id: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  packageId: string | null;
  startsAt: string;
  endsAt: string;
  status: LessonStatus;
  note: string;
};

const LESSON_COLUMNS = `id, student_id, teacher_id, package_id, starts_at, ends_at, status, note,
  student:profiles!private_lessons_student_id_fkey ( display_name ),
  teacher:profiles!private_lessons_teacher_id_fkey ( display_name )`;

type LessonRow = {
  id: string;
  student_id: string;
  teacher_id: string;
  package_id: string | null;
  starts_at: string;
  ends_at: string;
  status: LessonStatus;
  note: string;
  student: { display_name: string } | null;
  teacher: { display_name: string } | null;
};

/** A student's page lists this many lessons, the latest first, and says how many there are. */
export const STUDENT_LESSONS_SHOWN = 200;

function toLesson(l: LessonRow): OfficeLesson {
  return {
    id: l.id,
    studentId: l.student_id,
    studentName: l.student?.display_name ?? '',
    teacherId: l.teacher_id,
    teacherName: l.teacher?.display_name ?? '',
    packageId: l.package_id,
    startsAt: l.starts_at,
    endsAt: l.ends_at,
    status: l.status,
    note: l.note,
  };
}

/** A student's latest lessons (at most STUDENT_LESSONS_SHOWN) and how many they have. */
async function studentLessons(
  studentId: string,
): Promise<{ lessons: OfficeLesson[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const { data, error, count } = await supabase
    .from('private_lessons')
    .select(LESSON_COLUMNS, { count: 'exact' })
    .eq('student_id', studentId)
    .order('starts_at', { ascending: false })
    .order('id')
    .limit(STUDENT_LESSONS_SHOWN);
  if (error) fail('private lessons', error);
  return { lessons: (data as LessonRow[]).map(toLesson), total: count ?? data.length };
}

/** Every lesson in a time window (all pages). */
async function lessonsBetween(from: string, to: string): Promise<OfficeLesson[]> {
  const supabase = await createSupabaseServerClient();
  const rows = await readAll('private lessons', (start, end) =>
    supabase
      .from('private_lessons')
      .select(LESSON_COLUMNS)
      .gte('starts_at', from)
      .lt('starts_at', to)
      .order('starts_at')
      .order('id')
      .range(start, end),
  );
  return (rows as LessonRow[]).map(toLesson);
}

export type OfficeStudent = {
  id: string;
  name: string;
  phone: string;
  contactEmail: string;
  officeNote: string;
  packages: OfficePackage[];
  /** The latest STUDENT_LESSONS_SHOWN lessons. */
  lessons: OfficeLesson[];
  lessonsTotal: number;
};

/** One student's page; null if the id is not a student (or the caller is not the office). */
export async function getOfficeStudent(
  studentId: string,
  timeZone: string,
): Promise<OfficeStudent | null> {
  const supabase = await createSupabaseServerClient();
  const { data: student } = await supabase
    .from('office_students')
    .select('id, display_name')
    .eq('id', studentId)
    .maybeSingle();
  if (!student) return null;
  const today = localDay(new Date(), timeZone);
  const [record, packages, own] = await Promise.all([
    supabase
      .from('student_records')
      .select('phone, contact_email, office_note')
      .eq('student_id', studentId)
      .maybeSingle(),
    packagesFor([studentId], today),
    studentLessons(studentId),
  ]);
  return {
    id: studentId,
    name: student.display_name ?? '',
    phone: record.data?.phone ?? '',
    contactEmail: record.data?.contact_email ?? '',
    officeNote: record.data?.office_note ?? '',
    packages,
    lessons: own.lessons,
    lessonsTotal: own.total,
  };
}

export type FollowUp = {
  id: string;
  studentId: string;
  studentName: string;
  used: number;
  booked: number;
  left: number;
  alerts: PackageAlerts;
};

export type OfficeDay = {
  lessons: OfficeLesson[];
  followUp: FollowUp[];
};

/**
 * The packages that need a call, chosen by the database (view
 * package_balances): not finished, and unpaid, or running low or expiring
 * while live. The same rule as packageAlerts(), which is applied again below.
 */
function followUpFilter(today: string): string {
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + EXPIRING_DAYS);
  const until = soon.toISOString().slice(0, 10);
  return `paid_at.is.null,and(or(expires_on.is.null,expires_on.gte.${today}),or(unbooked.lte.${LOW_BALANCE},expires_on.lte.${until}))`;
}

/** The office's day: today's private lessons, and packages that need a call. */
export async function getOfficeDay(timeZone: string, now = new Date()): Promise<OfficeDay> {
  const today = localDay(now, timeZone);
  const supabase = await createSupabaseServerClient();
  const [all, balances] = await Promise.all([
    lessonsBetween(
      new Date(now.getTime() - 86_400_000).toISOString(),
      new Date(now.getTime() + 86_400_000).toISOString(),
    ),
    readAll('packages to follow up', (from, to) =>
      supabase
        .from('package_balances')
        .select(
          'package_id, student_id, lessons, used, booked, expires_on, paid_at, student:profiles ( display_name )',
        )
        .gt('lessons_left', 0)
        .or(followUpFilter(today))
        .order('package_id')
        .range(from, to),
    ),
  ]);
  const followUp = balances.flatMap((b) => {
    const row = {
      id: b.package_id!,
      lessons: b.lessons ?? 0,
      used: b.used ?? 0,
      booked: b.booked ?? 0,
      startsOn: '',
      expiresOn: b.expires_on,
      paid: b.paid_at !== null,
    };
    const alerts = packageAlerts(row, today);
    return alerts.low || alerts.expiring || (alerts.unpaid && !alerts.finished)
      ? [
          {
            id: row.id,
            studentId: b.student_id!,
            // The office reads students' names (profiles_select_office).
            studentName: b.student?.display_name ?? '',
            used: row.used,
            booked: row.booked,
            left: balance(row).left,
            alerts,
          },
        ]
      : [];
  });
  return {
    lessons: all
      .filter((l) => localDay(new Date(l.startsAt), timeZone) === today)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    followUp: followUp.sort(
      (a, b) => a.studentName.localeCompare(b.studentName) || a.id.localeCompare(b.id),
    ),
  };
}

/** Teachers to book a private lesson with. */
export async function getTeacherOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('teacher_choices')
    .select('id, display_name')
    .order('display_name');
  return (data ?? []).map((t) => ({ id: t.id!, name: t.display_name ?? '' }));
}
