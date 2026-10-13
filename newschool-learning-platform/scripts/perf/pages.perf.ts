// Page-level timings: the app's real query functions (src/server/queries),
// run with a real user's token through PostgREST, exactly as a page load does
// (every query of the page in parallel, RLS as that user). Complements
// scripts/perf/bench.sql, which times each query inside the database.
//
// Needs the local stack loaded with scripts/perf/seed-scale.sql. Run with
//   pnpm perf:pages
// Users (override with env): PERF_STUDENT, PERF_TEACHER, PERF_OFFICE, PERF_MANAGER.
// The office and manager get an MFA (aal2) session: any authenticator they
// have is replaced by a fresh one (local database only).
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/server/supabase/server', () => ({
  createSupabaseServerClient: async () => current.client,
}));

import { getActivity, getPracticeList, listMyAttempts } from '@/server/queries/activities';
import { getStudentDashboard } from '@/server/queries/dashboard';
import { getMyLessons } from '@/server/queries/lessons';
import { getStudentNotebook, getStudentSection } from '@/server/queries/notebook';
import { listAccounts } from '@/server/queries/admin';
import { listGroupsForManager } from '@/server/queries/manage';
import { getOfficeDay, listOfficeStudents } from '@/server/queries/office';
import { getProgressPage } from '@/server/queries/progress';
import { listReports } from '@/server/queries/reports';
import { getStudentInGroup } from '@/server/queries/teaching-student';
import { getGroupOverview, getTeacherActivity } from '@/server/queries/teaching';
import { fetchAllPages } from '@/domain/paging';
import { commonDifficulties } from '@/domain/teaching/insights';
import { getTeacherDay } from '@/server/queries/attendance';
import { getTimetable } from '@/server/queries/timetable';
import { getVocabularySession } from '@/server/queries/vocabulary';

type Client = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const secret = process.env.SUPABASE_SECRET_KEY ?? '';
const PASSWORD = 'Local-dev-password-1'; // seed.sql and seed-scale.sql, local only
const TZ = 'Asia/Jerusalem';
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const OUT = process.env.PERF_OUT ?? 'perf-results/pages.json';

const EMAILS = {
  student: process.env.PERF_STUDENT ?? 'perf.student.2@example.com',
  teacher: process.env.PERF_TEACHER ?? 'perf.teacher.1@example.com',
  office: process.env.PERF_OFFICE ?? 'perf.office.1@example.com',
  manager: process.env.PERF_MANAGER ?? 'manager@example.com',
  admin: process.env.PERF_ADMIN ?? 'admin@example.com',
};

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = () => createClient<Database>(url, secret, opts);

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as in tests/e2e/helpers.ts. */
function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function signIn(email: string, mfa = false): Promise<{ client: Client; user: SessionUser }> {
  const client = createClient<Database>(url, publishable, opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`could not sign in ${email}: ${error?.message}`);
  if (mfa) {
    const admin = service();
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: data.user.id });
    for (const f of factors?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId: data.user.id, id: f.id });
    }
    const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `perf-${Date.now()}`,
    });
    if (enrollError || !enrolled) throw new Error(`MFA enrol failed: ${enrollError?.message}`);
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: totp(enrolled.totp.secret),
    });
    if (verifyError) throw new Error(`MFA verify failed: ${verifyError.message}`);
  }
  const { data: roles } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id);
  return {
    client,
    user: {
      id: data.user.id,
      email,
      aal: mfa ? 'aal2' : 'aal1',
      roles: (roles ?? []).map((r) => r.role) as SessionUser['roles'],
      displayName: '',
      uiLocale: 'he',
      timezone: TZ,
    },
  };
}

type Row = { page: string; user: string; median: number; min: number; max: number };
const results: Row[] = [];

async function time(page: string, who: string, client: Client, run: () => Promise<unknown>) {
  current.client = client;
  await run(); // warm (plans, caches)
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await run();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  results.push({
    page,
    user: who,
    median: round(ms[Math.floor(ms.length / 2)]!),
    min: round(ms[0]!),
    max: round(ms[ms.length - 1]!),
  });
}

describe('page load times at school scale (through PostgREST, RLS as the user)', () => {
  beforeAll(() => {
    expect(publishable, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set').not.toBe('');
    expect(secret, 'SUPABASE_SECRET_KEY must be set (local .env.local)').not.toBe('');
  });

  afterAll(() => {
    console.table(results);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
  });

  it('student with two groups', async () => {
    const { client, user } = await signIn(EMAILS.student);
    const admin = service();
    // Their first group's course (the one the dashboard opens on).
    const { data: enrolments } = await admin
      .from('enrollments')
      .select('group_id, group:groups ( course_id )')
      .eq('student_id', user.id)
      .eq('status', 'active')
      .order('created_at')
      .order('group_id');
    const courseId = enrolments?.[0]?.group?.course_id;
    expect(courseId).toBeTruthy();
    const { data: lastAttempt } = await admin
      .from('attempts')
      .select('activity_id')
      .eq('user_id', user.id)
      .eq('course_id', courseId!)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
    const { data: lastSection } = await admin
      .from('section_progress')
      .select('book_section_id')
      .eq('user_id', user.id)
      .eq('course_id', courseId!)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    await time('student dashboard', 'student', client, () => getStudentDashboard(user, courseId));
    await time('practice list', 'student', client, () => getPracticeList(user, courseId));
    await time('progress', 'student', client, () => getProgressPage(user, courseId));
    await time('activity page', 'student', client, () =>
      Promise.all([
        getActivity(lastAttempt!.activity_id),
        listMyAttempts(user, lastAttempt!.activity_id),
      ]),
    );
    await time('notebook list', 'student', client, () => getStudentNotebook(user, courseId));
    await time('notebook section', 'student', client, () =>
      getStudentSection(user, lastSection!.book_section_id),
    );
    await time('vocabulary', 'student', client, () => getVocabularySession(user, courseId));
    await time('my lessons', 'student', client, () => getMyLessons(user));
  });

  it('teacher with six groups', async () => {
    const { client, user } = await signIn(EMAILS.teacher);
    const admin = service();
    const { data: taught } = await admin
      .from('group_teachers')
      .select('group_id, group:groups ( course_id, enrollments ( student_id, status ) )')
      .eq('teacher_id', user.id);
    // The largest group they teach (ties: lowest id).
    const group = [...(taught ?? [])].sort(
      (a, b) =>
        (b.group?.enrollments.length ?? 0) - (a.group?.enrollments.length ?? 0) ||
        a.group_id.localeCompare(b.group_id),
    )[0]!;
    const studentId = group
      .group!.enrollments.filter((e) => e.status === 'active')
      .map((e) => e.student_id)
      .sort()[0]!;
    const { data: hw } = await admin
      .from('assignments')
      .select('activity_id')
      .eq('group_id', group.group_id)
      .not('activity_id', 'is', null)
      .lt('due_at', new Date().toISOString())
      .order('due_at', { ascending: false })
      .limit(1)
      .single();

    await time('group overview', 'teacher', client, () => getGroupOverview(group.group_id));
    await time('student in group', 'teacher', client, () =>
      getStudentInGroup(user.id, group.group_id, studentId),
    );
    await time('group stats (activity)', 'teacher', client, () =>
      getTeacherActivity(group.group_id, hw!.activity_id!),
    );
    await time('teacher day', 'teacher', client, () => getTeacherDay(user.id, TZ));
    await time('reports list', 'teacher', client, () => listReports('all'));

    // Every group they teach: the common difficulties the page shows (from
    // the database) are those of every first answer, read here page by page
    // and summarised by the app's own rule.
    current.client = client;
    let rows = 0;
    for (const { group_id: groupId, group: g } of taught ?? []) {
      const ids = g!.enrollments.map((e) => e.student_id);
      const all = await fetchAllPages((from, to) =>
        client
          .from('responses')
          .select('id, user_id, item_id, is_correct, answer, created_at')
          .eq('course_id', g!.course_id)
          .eq('try_no', 1)
          .not('is_correct', 'is', null)
          .in('user_id', ids)
          .order('id')
          .range(from, to),
      );
      rows += all.length;
      const expected = commonDifficulties(
        all.map((r) => ({
          userId: r.user_id,
          itemId: r.item_id,
          correct: !!r.is_correct,
          answer: r.answer,
          at: r.created_at,
        })),
      );
      const overview = await getGroupOverview(groupId);
      expect(
        overview!.difficulties.map((d) => [d.itemId, d.students, d.wrong, d.commonWrongCount]),
        groupId,
      ).toEqual(expected.map((d) => [d.itemId, d.students, d.wrong, d.commonWrongCount]));
      // Accuracy per student: every first answer counted.
      for (const st of overview!.students) {
        expect(st.answers, st.id).toBe(all.filter((r) => r.user_id === st.id).length);
      }
    }
    console.log(`teacher: difficulties of ${taught?.length} groups match ${rows} first answers`);
  });

  it('office with MFA', async () => {
    const { client } = await signIn(EMAILS.office, true);
    const admin = service();
    const first = { page: 1, size: 50 };
    await time('office students', 'office', client, () => listOfficeStudents(TZ, '', first));
    await time('office students (page 101)', 'office', client, () =>
      listOfficeStudents(TZ, '', { page: 101, size: 50 }),
    );
    await time('office students (search name)', 'office', client, () =>
      listOfficeStudents(TZ, 'Rossi', first),
    );
    await time('office students (search phone)', 'office', client, () =>
      listOfficeStudents(TZ, '0503888', first),
    );
    await time('timetable', 'office', client, () => getTimetable());
    await time('office day', 'office', client, () => getOfficeDay(TZ));

    // Nothing cut at 1,000 rows: every student is counted, every booking shown.
    current.client = client;
    const students = await listOfficeStudents(TZ, '', first);
    const { count: studentCount } = await admin
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'student');
    expect(students.info.total).toBe(studentCount);
    expect(students.rows).toHaveLength(50);
    const { bookings } = await getTimetable();
    const { count: bookingCount } = await admin
      .from('room_bookings')
      .select('id', { count: 'exact', head: true });
    expect(bookings).toHaveLength(bookingCount!);
    expect(new Set(bookings.map((b) => b.id)).size).toBe(bookingCount);
    console.log(`office: ${students.info.total} students; ${bookings.length} bookings`);
  });

  it('manager with MFA', async () => {
    const { client } = await signIn(EMAILS.manager, true);
    await time('reports (all)', 'manager', client, () => listReports('all'));
    await time('reports (open)', 'manager', client, () => listReports('open'));
    await time('groups', 'manager', client, () => listGroupsForManager());
    current.client = client;
    const { count: groupCount } = await service()
      .from('groups')
      .select('id', { count: 'exact', head: true });
    expect(await listGroupsForManager()).toHaveLength(groupCount!);
  });

  it('admin with MFA', async () => {
    const { client } = await signIn(EMAILS.admin, true);
    await time('accounts', 'admin', client, () => listAccounts('', { page: 1, size: 50 }));
    await time('accounts (search)', 'admin', client, () =>
      listAccounts('teacher', { page: 1, size: 50 }),
    );
  });
});
