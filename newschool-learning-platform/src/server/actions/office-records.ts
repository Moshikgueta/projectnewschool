'use server';

import { randomUUID } from 'node:crypto';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { formatCode } from '@/domain/auth/codes';
import { zonedTimeToUtc } from '@/domain/learning/time';
import {
  allowedStatuses,
  cancellationFor,
  LESSON_STATUSES,
  packageForLesson,
} from '@/domain/office/packages';
import { localDay } from '@/domain/teaching/attendance';
import type { ManageState } from '@/server/actions/manage';
import type { CodeState } from '@/server/actions/teach';
import { requireArea } from '@/server/auth/session';
import { createPrivilegedClient } from '@/server/privileged/admin-client';
import { issueCode, isStudentOnly } from '@/server/privileged/student-codes';
import { getOfficeStudent } from '@/server/queries/office';
import { createSupabaseServerClient } from '@/server/supabase/server';

// The office's student records, packages and private lessons (stage D).
// Every write except account creation uses the office user's own
// MFA-verified session, so RLS decides again; the database also refuses
// double bookings and lessons drawing on someone else's package.

const uuid = z.uuid();
type Key =
  | 'saved'
  | 'invalid'
  | 'notAllowed'
  | 'failed'
  | 'emailExists'
  | 'teacherBusy'
  | 'studentBusy'
  | 'noPackage'
  | 'notStarted';

async function say(key: Key): Promise<ManageState> {
  const t = await getTranslations('office.records');
  return key === 'saved' ? { status: 'ok', message: t(key) } : { status: 'error', message: t(key) };
}

function refresh(studentId?: string) {
  revalidatePath('/office');
  revalidatePath('/office/students');
  if (studentId) revalidatePath(`/office/students/${studentId}` as Route);
}

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+() -]{0,30}$/);
const optionalEmail = z.union([z.literal(''), z.email().max(254)]);

/**
 * Register a student. The account is created with the secret key (the office
 * may not create accounts through RLS), and only ever with the student role;
 * the contact details are then written with the office's own session. With
 * no email the account gets an unreachable placeholder address: the student
 * signs in with an entry code.
 */
export async function createStudent(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const office = await requireArea('office');
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      loginEmail: optionalEmail.transform((v) => v.toLowerCase()),
      phone,
      contactEmail: optionalEmail,
    })
    .safeParse({
      name: formData.get('name'),
      loginEmail: (formData.get('loginEmail') ?? '').toString().trim(),
      phone: formData.get('phone') ?? '',
      contactEmail: (formData.get('contactEmail') ?? '').toString().trim(),
    });
  if (!parsed.success) return say('invalid');
  const { name, loginEmail, contactEmail } = parsed.data;

  const privileged = createPrivilegedClient();
  const { data, error } = await privileged.auth.admin.createUser({
    email: loginEmail || `student-${randomUUID()}@students.newschool.invalid`,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error?.code === 'email_exists') return say('emailExists');
  if (error || !data.user) return say('failed');
  const id = data.user.id;
  const role = await privileged
    .from('user_roles')
    .insert({ user_id: id, role: 'student', granted_by: office.id });
  if (role.error) {
    await privileged.auth.admin.deleteUser(id);
    return say('failed');
  }

  const supabase = await createSupabaseServerClient();
  await supabase
    .from('student_records')
    .insert({ student_id: id, phone: parsed.data.phone, contact_email: contactEmail });
  refresh();
  redirect(`/office/students/${id}` as Route);
}

export async function saveStudentRecord(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireArea('office');
  const parsed = z
    .object({
      studentId: uuid,
      phone,
      contactEmail: optionalEmail,
      officeNote: z.string().trim().max(2000),
    })
    .safeParse({
      studentId: formData.get('studentId'),
      phone: formData.get('phone') ?? '',
      contactEmail: (formData.get('contactEmail') ?? '').toString().trim(),
      officeNote: formData.get('officeNote') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  // Only students: office_students lists nobody else.
  const { data: student } = await supabase
    .from('office_students')
    .select('id')
    .eq('id', parsed.data.studentId)
    .maybeSingle();
  if (!student) return say('notAllowed');
  const { error } = await supabase.from('student_records').upsert(
    {
      student_id: parsed.data.studentId,
      phone: parsed.data.phone,
      contact_email: parsed.data.contactEmail,
      office_note: parsed.data.officeNote,
    },
    { onConflict: 'student_id' },
  );
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh(parsed.data.studentId);
  return say('saved');
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function addPackage(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const office = await requireArea('office');
  const parsed = z
    .object({
      studentId: uuid,
      lessons: z.coerce.number().int().min(1).max(200),
      minutes: z.coerce.number().int().min(15).max(240),
      startsOn: day,
      expiresOn: z.union([z.literal(''), day]),
      price: z.union([z.literal(''), z.coerce.number().min(0).max(1_000_000)]),
      paid: z.boolean(),
      note: z.string().trim().max(500),
    })
    .refine((v) => !v.expiresOn || v.expiresOn >= v.startsOn)
    .safeParse({
      studentId: formData.get('studentId'),
      lessons: formData.get('lessons'),
      minutes: formData.get('minutes') || 60,
      startsOn: formData.get('startsOn'),
      expiresOn: formData.get('expiresOn') ?? '',
      price: formData.get('price') ?? '',
      paid: formData.get('paid') === 'on',
      note: formData.get('note') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: student } = await supabase
    .from('office_students')
    .select('id')
    .eq('id', v.studentId)
    .maybeSingle();
  if (!student) return say('notAllowed');
  const { error } = await supabase.from('lesson_packages').insert({
    student_id: v.studentId,
    lessons: v.lessons,
    minutes_per_lesson: v.minutes,
    starts_on: v.startsOn,
    expires_on: v.expiresOn || null,
    price: v.price === '' ? null : v.price,
    paid_at: v.paid ? new Date().toISOString() : null,
    note: v.note,
    created_by: office.id,
  });
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh(v.studentId);
  return say('saved');
}

export async function markPackagePaid(formData: FormData): Promise<void> {
  await requireArea('office');
  const id = uuid.safeParse(formData.get('packageId'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('lesson_packages')
    .update({ paid_at: new Date().toISOString() })
    .eq('id', id.data)
    .is('paid_at', null)
    .select('student_id')
    .maybeSingle();
  refresh(data?.student_id);
}

/**
 * Book a private lesson. Times are in the office user's time zone. The
 * package is the one expiring first with a lesson left (or none, if chosen);
 * the database refuses a teacher or student who is already busy.
 */
export async function bookLesson(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const office = await requireArea('office');
  const parsed = z
    .object({
      studentId: uuid,
      teacherId: uuid,
      startsAt: z.string(),
      minutes: z.coerce.number().int().min(15).max(240),
      usePackage: z.enum(['auto', 'none']),
      note: z.string().trim().max(500),
    })
    .safeParse({
      studentId: formData.get('studentId'),
      teacherId: formData.get('teacherId'),
      startsAt: formData.get('startsAt'),
      minutes: formData.get('minutes') || 60,
      usePackage: formData.get('usePackage') ?? 'auto',
      note: formData.get('note') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const start = zonedTimeToUtc(v.startsAt, office.timezone);
  if (!start) return say('invalid');

  const student = await getOfficeStudent(v.studentId, office.timezone);
  if (!student) return say('notAllowed');
  let packageId: string | null = null;
  if (v.usePackage === 'auto') {
    const chosen = packageForLesson(
      student.packages.map((p) => ({ ...p, paid: p.paidAt !== null })),
      localDay(start, office.timezone),
    );
    if (!chosen) return say('noPackage');
    packageId = chosen.id;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('private_lessons').insert({
    student_id: v.studentId,
    teacher_id: v.teacherId,
    package_id: packageId,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + v.minutes * 60_000).toISOString(),
    note: v.note,
    created_by: office.id,
  });
  if (error?.code === '23P01')
    return say(error.message.includes('teacher') ? 'teacherBusy' : 'studentBusy');
  if (error?.code === '23514') return say('invalid');
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh(v.studentId);
  return say('saved');
}

/** Cancel a lesson still to come: late (charged) within 24 hours of the start. */
export async function cancelLesson(formData: FormData): Promise<void> {
  await requireArea('office');
  const id = uuid.safeParse(formData.get('lessonId'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { data: lesson } = await supabase
    .from('private_lessons')
    .select('id, student_id, starts_at, status')
    .eq('id', id.data)
    .maybeSingle();
  if (!lesson || lesson.status !== 'scheduled') return;
  const now = new Date();
  await supabase
    .from('private_lessons')
    .update({
      status: cancellationFor(new Date(lesson.starts_at), now),
      cancelled_at: now.toISOString(),
    })
    .eq('id', lesson.id)
    .eq('status', 'scheduled');
  refresh(lesson.student_id);
}

/** Held or missed, once the lesson has started (or back to scheduled). */
export async function setLessonStatus(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireArea('office');
  const parsed = z
    .object({ lessonId: uuid, status: z.enum(LESSON_STATUSES) })
    .safeParse({ lessonId: formData.get('lessonId'), status: formData.get('status') });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: lesson } = await supabase
    .from('private_lessons')
    .select('id, student_id, starts_at, status')
    .eq('id', parsed.data.lessonId)
    .maybeSingle();
  if (!lesson) return say('notAllowed');
  if (lesson.status === 'cancelled_early' || lesson.status === 'cancelled_late')
    return say('invalid');
  if (!allowedStatuses(new Date(lesson.starts_at), new Date()).includes(parsed.data.status)) {
    return say('notStarted');
  }
  const { error } = await supabase
    .from('private_lessons')
    .update({ status: parsed.data.status })
    .eq('id', lesson.id);
  if (error) return say('failed');
  refresh(lesson.student_id);
  return say('saved');
}

/** A new entry code for a student (the office can do this for any student). */
export async function issueCodeAsOffice(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const office = await requireArea('office');
  const t = await getTranslations('office.records');
  const id = uuid.safeParse(formData.get('studentId'));
  if (!id.success) return { status: 'error', message: t('invalid') };
  const supabase = await createSupabaseServerClient();
  const { data: student } = await supabase
    .from('office_students')
    .select('id')
    .eq('id', id.data)
    .maybeSingle();
  if (!student || !(await isStudentOnly(id.data)))
    return { status: 'error', message: t('notAllowed') };
  return { status: 'ok', code: formatCode(await issueCode(id.data, office.id)) };
}
