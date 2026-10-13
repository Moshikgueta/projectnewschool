// The group page's summaries come from the database (views
// group_item_first_tries and group_student_stats, migration
// 20261013002300_scale_reads), because PostgREST returns at most 1,000 rows
// per request and the page used to summarise only those (docs/PERFORMANCE.md
// §8). Here group X gets more than 1,000 first answers, and what the views
// return is compared with the same summary computed in the app over every
// row, read page by page. Also: who sees anything through the views.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchAllPages } from '@/domain/paging';
import { attendanceByStudent } from '@/domain/teaching/attendance';
import {
  commonDifficulties,
  DIFFICULTY_FROM,
  MAX_DIFFICULTIES,
  MIN_STUDENTS,
} from '@/domain/teaching/insights';
import type { Database } from '@/server/db.types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const secret = process.env.SUPABASE_SECRET_KEY ?? '';
const PASSWORD = 'Local-dev-password-1'; // seed.sql, local only

const GROUP_X = 'a0000000-0000-4000-8000-000000000001';
const COURSE = '30000000-0000-4000-8000-000000000001';
const ACTIVITY = '70000000-0000-4000-8000-000000000006'; // six questions
const ITEMS = [61, 62, 63, 64, 65, 66].map((n) => `80000000-0000-4000-8000-0000000000${n}`);
const STUDENTS = ['a1', 'a2', 'a4'].map((s) => `00000000-0000-4000-8000-0000000000${s}`);
const ATTEMPTS_EACH = 70; // 3 students × 70 attempts × 6 questions = 1,260 first tries

type Client = SupabaseClient<Database>;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function signedIn(email: string): Promise<Client> {
  const c = createClient<Database>(url, key, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in ${email}: ${error.message}`);
  return c;
}

/** A small deterministic hash, so the data is the same on every run. */
const h = (...parts: (string | number)[]) =>
  [...parts.join('|')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);

const inserted: string[] = [];

beforeAll(async () => {
  expect(key, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set').not.toBe('');
  expect(secret, 'SUPABASE_SECRET_KEY must be set (local .env.local)').not.toBe('');
  const admin = createClient<Database>(url, secret, opts);
  const base = Date.parse('2026-01-01T08:00:00Z');
  const attempts = STUDENTS.flatMap((student, s) =>
    Array.from({ length: ATTEMPTS_EACH }, (_, k) => ({
      id: crypto.randomUUID(),
      user_id: student,
      activity_id: ACTIVITY,
      course_id: COURSE,
      attempt_no: 1000 + k,
      status: 'submitted' as const,
      // Attempts are inserted in an order unrelated to time.
      started_at: new Date(base + (h(s, k) % 100_000) * 60_000).toISOString(),
    })),
  );
  const { error } = await admin.from('attempts').insert(attempts);
  if (error) throw new Error(error.message);
  inserted.push(...attempts.map((a) => a.id));

  const responses = attempts.flatMap((a, n) =>
    ITEMS.flatMap((item, i) => {
      const r = h(a.id.slice(0, 4), n, i);
      const at = new Date(Date.parse(a.started_at) + i * 1000).toISOString();
      const wrongChoice = `o${2 + (r % 3)}`; // a few different wrong answers
      const first = {
        attempt_id: a.id,
        user_id: a.user_id,
        course_id: COURSE,
        item_id: item,
        // Questions 61–63 are mostly answered wrong; 64–66 mostly right.
        is_correct: i < 3 ? r % 4 === 0 : r % 4 !== 0,
        answer: { optionIds: [r % 4 === 0 ? 'o1' : wrongChoice] },
        try_no: 1,
        created_at: at,
      };
      // A second try (left out of every summary) and an ungraded answer.
      return [
        first,
        { ...first, try_no: 2, is_correct: true, answer: { optionIds: ['o1'] } },
        ...(i === 0 ? [{ ...first, is_correct: null, answer: { text: 'ungraded' } }] : []),
      ];
    }),
  );
  for (let i = 0; i < responses.length; i += 500) {
    const { error: e } = await admin.from('responses').insert(responses.slice(i, i + 500));
    if (e) throw new Error(e.message);
  }
});

afterAll(async () => {
  const admin = createClient<Database>(url, secret, opts);
  for (let i = 0; i < inserted.length; i += 100) {
    await admin
      .from('attempts')
      .delete()
      .in('id', inserted.slice(i, i + 100)); // responses go with them
  }
});

describe('group summaries computed by the database (teacher X, group X)', () => {
  let tx: Client;
  beforeAll(async () => {
    tx = await signedIn('teacher.x@example.com');
  });

  /** Every first try of the group's students, as the page used to read them, but all pages. */
  async function allFirstTries() {
    const { data: enrolled } = await tx
      .from('enrollments')
      .select('student_id')
      .eq('group_id', GROUP_X);
    const ids = (enrolled ?? []).map((e) => e.student_id);
    return fetchAllPages((from, to) =>
      tx
        .from('responses')
        .select('id, user_id, item_id, is_correct, answer, created_at')
        .eq('course_id', COURSE)
        .eq('try_no', 1)
        .not('is_correct', 'is', null)
        .in('user_id', ids)
        .order('id')
        .range(from, to),
    );
  }

  it('the old single read stops at 1,000 rows: it summarised part of the answers', async () => {
    const all = await allFirstTries();
    expect(all.length).toBeGreaterThan(1000);
    const { data } = await tx
      .from('responses')
      .select('id')
      .eq('course_id', COURSE)
      .eq('try_no', 1)
      .not('is_correct', 'is', null)
      .in('user_id', STUDENTS);
    expect(data).toHaveLength(1000);
  });

  it('common difficulties are exactly those of every answer', async () => {
    const all = await allFirstTries();
    const expected = commonDifficulties(
      all.map((r) => ({
        userId: r.user_id,
        itemId: r.item_id,
        correct: !!r.is_correct,
        answer: r.answer,
        at: r.created_at,
      })),
    );
    expect(expected.length).toBeGreaterThan(0);
    // As the group page asks for them.
    const { data, error } = await tx
      .from('group_item_first_tries')
      .select('item_id, students, wrong, common_wrong_answer, common_wrong_count')
      .eq('group_id', GROUP_X)
      .gte('students', MIN_STUDENTS)
      .gte('wrong_rate', DIFFICULTY_FROM)
      .order('wrong_rate', { ascending: false })
      .order('students', { ascending: false })
      .order('item_id')
      .limit(MAX_DIFFICULTIES);
    expect(error).toBeNull();
    expect(
      data!.map((d) => ({
        itemId: d.item_id,
        students: d.students,
        wrong: d.wrong,
        commonWrongAnswer: d.common_wrong_answer,
        commonWrongCount: d.common_wrong_count,
      })),
    ).toEqual(
      expected.map((d) => ({
        itemId: d.itemId,
        students: d.students,
        wrong: d.wrong,
        commonWrongAnswer: d.commonWrongAnswer,
        commonWrongCount: d.commonWrongCount,
      })),
    );
  });

  it('every question’s first-encounter result matches (as the teacher’s exercise page shows it)', async () => {
    const all = await allFirstTries();
    // Earliest first try per student and question.
    const first = new Map<string, (typeof all)[number]>();
    for (const r of all) {
      const k = `${r.item_id}|${r.user_id}`;
      const seen = first.get(k);
      if (!seen || r.created_at < seen.created_at) first.set(k, r);
    }
    const expected = new Map<string, { students: number; wrong: number }>();
    for (const r of first.values()) {
      const e = expected.get(r.item_id) ?? { students: 0, wrong: 0 };
      e.students++;
      if (!r.is_correct) e.wrong++;
      expected.set(r.item_id, e);
    }
    const { data } = await tx
      .from('group_item_first_tries')
      .select('item_id, students, wrong')
      .eq('group_id', GROUP_X);
    expect(
      new Map(data!.map((d) => [d.item_id, { students: d.students, wrong: d.wrong }])),
    ).toEqual(expected);
  });

  it('per-student answers, accuracy and attendance count every row', async () => {
    const all = await allFirstTries();
    const marks = await fetchAllPages((from, to) =>
      tx
        .from('attendance')
        .select('session_id, student_id, status, session:group_sessions!inner ( group_id )')
        .eq('session.group_id', GROUP_X)
        .order('session_id')
        .order('student_id')
        .range(from, to),
    );
    const rates = attendanceByStudent(
      marks.map((m) => ({ studentId: m.student_id, status: m.status })),
    );
    const { data } = await tx
      .from('group_student_stats')
      .select('student_id, answers, correct, attended, counted')
      .eq('group_id', GROUP_X)
      .order('student_id');
    expect(data!.length).toBe(STUDENTS.length);
    for (const row of data!) {
      const mine = all.filter((r) => r.user_id === row.student_id);
      expect(row.answers, row.student_id!).toBe(mine.length);
      expect(row.correct).toBe(mine.filter((r) => r.is_correct).length);
      const rate = rates.get(row.student_id!);
      expect(row.counted).toBe(rate?.counted ?? 0);
      expect(row.attended).toBe(rate?.attended ?? 0);
    }
    expect(data!.reduce((n, r) => n + (r.answers ?? 0), 0)).toBe(all.length);
  });
});

describe('who sees anything through the group views', () => {
  it('a teacher of another group, a student of the group and the office (no MFA) see nothing', async () => {
    for (const email of ['teacher.y@example.com', 'student.a@example.com', 'office@example.com']) {
      const c = await signedIn(email);
      for (const view of ['group_item_first_tries', 'group_student_stats'] as const) {
        const { data, error } = await c.from(view).select('group_id').eq('group_id', GROUP_X);
        expect(error, `${email} ${view}`).toBeNull();
        expect(data, `${email} ${view}`).toEqual([]);
      }
      await c.auth.signOut();
    }
  });

  it('the anonymous key gets an error, not rows', async () => {
    const anon = createClient<Database>(url, key, opts);
    for (const view of ['group_item_first_tries', 'group_student_stats'] as const) {
      const { data, error } = await anon.from(view).select('group_id');
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe('42501');
    }
  });
});
