// The attack described in docs/SECURITY.md §3, done for real: sign in as a
// student with the public (publishable) key — exactly what anyone can do from
// a browser console — and try to reach other people's data through the
// Supabase REST API directly, bypassing the app entirely.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/server/db.types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const PASSWORD = 'Local-dev-password-1'; // seed.sql, local only

const IDS = {
  studentA: '00000000-0000-4000-8000-0000000000a1',
  studentB: '00000000-0000-4000-8000-0000000000a2',
  attemptOfB: 'c0000000-0000-4000-8000-000000000002',
  attemptOfA: 'c0000000-0000-4000-8000-000000000001',
  groupX: 'a0000000-0000-4000-8000-000000000001',
  itemSpanish: '80000000-0000-4000-8000-000000000001',
  courseSpanish: '30000000-0000-4000-8000-000000000001',
};

function client(): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(email: string) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in ${email}: ${error.message}`);
  return c;
}

describe('a student holding their own token, calling the API directly', () => {
  let a: SupabaseClient<Database>;
  beforeAll(async () => {
    expect(key, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (see .env.example)').not.toBe('');
    a = await signedIn('student.a@example.com');
  });
  afterAll(async () => {
    await a.auth.signOut();
  });

  it('cannot read another student’s attempt by id', async () => {
    const { data, error } = await a.from('attempts').select('*').eq('id', IDS.attemptOfB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('cannot read another student’s rows by filtering on their user id', async () => {
    for (const table of ['attempts', 'responses', 'section_progress', 'learning_events'] as const) {
      const { data } = await a.from(table).select('user_id').eq('user_id', IDS.studentB);
      expect(data, table).toEqual([]);
    }
  });

  it('cannot read answer keys', async () => {
    const { data } = await a.from('activity_item_keys').select('*');
    expect(data).toEqual([]);
  });

  it('cannot see classmates through the group', async () => {
    const { data } = await a.from('enrollments').select('student_id').eq('group_id', IDS.groupX);
    expect(data?.map((r) => r.student_id)).toEqual([IDS.studentA]);
  });

  it('cannot write a graded answer or change a score', async () => {
    const insert = await a.from('responses').insert({
      attempt_id: IDS.attemptOfA,
      user_id: IDS.studentA,
      course_id: IDS.courseSpanish,
      item_id: IDS.itemSpanish,
      answer: {},
      is_correct: true,
      score: 100,
    });
    expect(insert.error?.code).toBe('42501');

    const update = await a.from('attempts').update({ score: 100 }).eq('id', IDS.attemptOfA);
    expect(update.error?.code).toBe('42501');
  });

  it('cannot give itself a role', async () => {
    const { error } = await a.from('user_roles').insert({ user_id: IDS.studentA, role: 'admin' });
    expect(error?.code).toBe('42501');
  });

  it('cannot call authorization helpers as RPCs', async () => {
    // `app` is not an API-exposed schema; `public` has no functions.
    const { error } = await a.rpc('has_role' as never, { p_role: 'admin' } as never);
    expect(error).not.toBeNull();
  });
});

describe('a teacher', () => {
  it('cannot read a group they do not teach', async () => {
    const y = await signedIn('teacher.y@example.com');
    const groups = await y.from('groups').select('id').eq('id', IDS.groupX);
    const enrollments = await y.from('enrollments').select('student_id').eq('group_id', IDS.groupX);
    expect(groups.data).toEqual([]);
    expect(enrollments.data).toEqual([]);
    await y.auth.signOut();
  });
});

describe('an anonymous visitor', () => {
  it('cannot read any course content', async () => {
    const { data, error } = await client().from('courses').select('*');
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('cannot create an account (invite-only)', async () => {
    const { error } = await client().auth.signUp({
      email: `intruder-${Date.now()}@example.com`,
      password: 'A-long-enough-password-1',
    });
    expect(error?.code).toBe('signup_disabled');
  });
});
