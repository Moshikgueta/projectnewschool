import 'server-only';
import { localDay } from '@/domain/teaching/attendance';
import {
  balance,
  packageAlerts,
  type LessonStatus,
  type PackageAlerts,
} from '@/domain/office/packages';
import { createSupabaseServerClient } from '@/server/supabase/server';

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

async function packagesFor(
  studentIds: string[] | null,
  today: string,
): Promise<(OfficePackage & { studentId: string })[]> {
  const supabase = await createSupabaseServerClient();
  let packages = supabase
    .from('lesson_packages')
    .select(
      'id, student_id, lessons, minutes_per_lesson, starts_on, expires_on, price, paid_at, note',
    )
    .order('starts_on', { ascending: false });
  let balances = supabase.from('package_balances').select('package_id, used, booked');
  if (studentIds) {
    packages = packages.in('student_id', studentIds);
    balances = balances.in('student_id', studentIds);
  }
  const [p, b] = await Promise.all([packages, balances]);
  if (p.error) fail('packages', p.error);
  if (b.error) fail('package balances', b.error);
  const counts = new Map(b.data.map((r) => [r.package_id, r]));
  return p.data.map((row) => {
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

export async function listOfficeStudents(
  timeZone: string,
  query = '',
): Promise<OfficeStudentRow[]> {
  const supabase = await createSupabaseServerClient();
  const today = localDay(new Date(), timeZone);
  let students = supabase.from('office_students').select('id, display_name').order('display_name');
  const q = query
    .trim()
    .replace(/[%_,()]/g, ' ')
    .trim();
  if (q) students = students.ilike('display_name', `%${q}%`);
  const [s, r] = await Promise.all([
    students.limit(200),
    supabase.from('student_records').select('student_id, phone'),
  ]);
  if (s.error) fail('students', s.error);
  if (r.error) fail('student records', r.error);
  const ids = s.data.map((x) => x.id!);
  const packages = ids.length ? await packagesFor(ids, today) : [];
  const phoneOf = new Map(r.data.map((x) => [x.student_id, x.phone]));
  return s.data.map((x) => {
    const own = packages.filter((p) => p.studentId === x.id);
    const live = own.filter((p) => !p.alerts.finished && !p.alerts.expired);
    return {
      id: x.id!,
      name: x.display_name ?? '',
      phone: phoneOf.get(x.id!) ?? '',
      left: live.reduce((n, p) => n + p.left, 0),
      needsAttention: own.some(
        (p) => p.alerts.low || p.alerts.expiring || (p.alerts.unpaid && !p.alerts.finished),
      ),
    };
  });
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

async function lessons(filter: {
  studentId?: string;
  from?: string;
  to?: string;
}): Promise<OfficeLesson[]> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('private_lessons')
    .select(
      `id, student_id, teacher_id, package_id, starts_at, ends_at, status, note,
       student:profiles!private_lessons_student_id_fkey ( display_name ),
       teacher:profiles!private_lessons_teacher_id_fkey ( display_name )`,
    )
    .order('starts_at', { ascending: false });
  if (filter.studentId) q = q.eq('student_id', filter.studentId);
  if (filter.from) q = q.gte('starts_at', filter.from);
  if (filter.to) q = q.lt('starts_at', filter.to);
  const { data, error } = await q.limit(200);
  if (error) fail('private lessons', error);
  return data.map((l) => ({
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
  }));
}

export type OfficeStudent = {
  id: string;
  name: string;
  phone: string;
  contactEmail: string;
  officeNote: string;
  packages: OfficePackage[];
  lessons: OfficeLesson[];
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
    lessons({ studentId }),
  ]);
  return {
    id: studentId,
    name: student.display_name ?? '',
    phone: record.data?.phone ?? '',
    contactEmail: record.data?.contact_email ?? '',
    officeNote: record.data?.office_note ?? '',
    packages,
    lessons: own,
  };
}

export type OfficeDay = {
  lessons: OfficeLesson[];
  followUp: (OfficePackage & { studentId: string; studentName: string })[];
};

/** The office's day: today's private lessons, and packages that need a call. */
export async function getOfficeDay(timeZone: string, now = new Date()): Promise<OfficeDay> {
  const today = localDay(now, timeZone);
  const [all, students, packages] = await Promise.all([
    lessons({
      from: new Date(now.getTime() - 86_400_000).toISOString(),
      to: new Date(now.getTime() + 86_400_000).toISOString(),
    }),
    (async () => {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.from('office_students').select('id, display_name');
      if (error) fail('students', error);
      return new Map(data.map((s) => [s.id!, s.display_name ?? '']));
    })(),
    packagesFor(null, today),
  ]);
  return {
    lessons: all
      .filter((l) => localDay(new Date(l.startsAt), timeZone) === today)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    followUp: packages
      .filter((p) => p.alerts.low || p.alerts.expiring || (p.alerts.unpaid && !p.alerts.finished))
      .map((p) => ({ ...p, studentName: students.get(p.studentId) ?? '' }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName)),
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
