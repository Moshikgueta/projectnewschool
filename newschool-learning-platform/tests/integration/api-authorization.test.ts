// The attack described in docs/SECURITY.md §3, done for real: sign in as a
// student with the public (publishable) key — exactly what anyone can do from
// a browser console — and try to reach other people's data through the
// Supabase REST API directly, bypassing the app entirely.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkItem, ITEM_TYPES, type ItemType } from '@/content/items';
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

describe('exercises, as a student reads them through the API', () => {
  it('carry no answers: no keys, and data that does not give the answer away by order or ids', async () => {
    const a = await signedIn('student.a@example.com');
    const { data: items, error } = await a
      .from('activity_items')
      .select('id, type, data, keys:activity_item_keys ( answer )');
    expect(error).toBeNull();
    expect(items?.length).toBeGreaterThan(5);
    await a.auth.signOut();

    // The keys, read with the service role only to check against.
    const secret = process.env.SUPABASE_SECRET_KEY ?? '';
    expect(secret, 'SUPABASE_SECRET_KEY must be set').not.toBe('');
    const admin = createClient<Database>(url, secret, { auth: { persistSession: false } });
    const { data: keys } = await admin
      .from('activity_item_keys')
      .select('item_id, answer')
      .in(
        'item_id',
        items!.map((i) => i.id),
      );
    const keyOf = new Map(keys!.map((k) => [k.item_id, k.answer]));

    for (const item of items!) {
      // The embedded key table comes back empty for a student.
      expect(item.keys, item.id).toEqual([]);
      const keyText = JSON.stringify(keyOf.get(item.id) ?? null);
      expect(JSON.stringify(item.data)).not.toContain(keyText);
      if (ITEM_TYPES.includes(item.type as ItemType) && keyOf.has(item.id)) {
        expect(checkItem(item.type as ItemType, item.data, keyOf.get(item.id)), item.id).toEqual(
          [],
        );
      }
    }
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

describe('student entry codes, through the API', () => {
  it('cannot be read, planted or reset by a visitor, a student or a teacher', async () => {
    const callers = [
      ['visitor', client()],
      ['student', await signedIn('student.a@example.com')],
      ['teacher', await signedIn('teacher.x@example.com')],
    ] as const;
    for (const [who, c] of callers) {
      const codes = await c.from('student_codes').select('*');
      expect(codes.data, who).toBeNull();
      expect(codes.error?.code, who).toBe('42501');
      const planted = await c
        .from('student_codes')
        .insert({ user_id: IDS.studentB, code_hash: 'ab'.repeat(32) });
      expect(planted.error?.code, who).toBe('42501');
      const reset = await c.from('code_attempts').delete().neq('scope', '');
      expect(reset.error?.code, who).toBe('42501');
      await c.auth.signOut();
    }
  });
});

describe('the office’s records, through the API', () => {
  it('a student gets only their own contact details, packages and lessons', async () => {
    const a = await signedIn('student.a@example.com');
    for (const [table, column] of [
      ['student_records', 'student_id'],
      ['lesson_packages', 'student_id'],
      ['private_lessons', 'student_id'],
    ] as const) {
      const mine = await a.from(table).select(column);
      expect(mine.error, table).toBeNull();
      expect(
        (mine.data as Record<string, string>[]).every((r) => r[column] === IDS.studentA),
        table,
      ).toBe(true);
      const theirs = await a.from(table).select(column).eq(column, IDS.studentB);
      expect(theirs.data, table).toEqual([]);
    }
    const balances = await a.from('package_balances').select('student_id');
    expect(balances.data!.map((r) => r.student_id)).toEqual([IDS.studentA]);
    expect(
      (await a.from('package_balances').select('student_id').eq('student_id', IDS.studentB)).data,
    ).toEqual([]);
    const write = await a.from('lesson_packages').insert({ student_id: IDS.studentA, lessons: 50 });
    expect(write.error?.code).toBe('42501');
    const list = await a.from('office_students').select('id');
    expect(list.data).toEqual([]);
    await a.auth.signOut();
  });

  it('a teacher gets no contact details, packages or prices, and only their own lessons', async () => {
    const x = await signedIn('teacher.x@example.com');
    expect((await x.from('student_records').select('phone')).data).toEqual([]);
    expect((await x.from('lesson_packages').select('price')).data).toEqual([]);
    expect((await x.from('package_balances').select('used')).data).toEqual([]);
    const lessons = await x.from('private_lessons').select('teacher_id');
    expect(lessons.data!.length).toBeGreaterThan(0);
    expect(
      lessons.data!.every((l) => l.teacher_id === '00000000-0000-4000-8000-0000000000b1'),
    ).toBe(true);
    await x.auth.signOut();
  });
});

describe('staff tools, through the API', () => {
  it('a student reads no staff feedback, training links or tasks, and cannot write them', async () => {
    const a = await signedIn('student.a@example.com');
    expect((await a.from('staff_feedback').select('id')).data).toEqual([]);
    expect((await a.from('staff_resources').select('id')).data).toEqual([]);
    expect((await a.from('staff_tasks').select('id')).data).toEqual([]);
    expect((await a.from('task_assignees').select('id')).data).toEqual([]);
    const write = await a
      .from('staff_feedback')
      .insert({ kind: 'material', subject: 'x', verdict: 'problematic', body: 'x' });
    expect(write.error?.code).toBe('42501');
    await a.auth.signOut();
  });

  it('a teacher reads only their own feedback and tasks', async () => {
    const y = await signedIn('teacher.y@example.com');
    const feedback = await y.from('staff_feedback').select('author_id');
    expect(
      feedback.data!.every((f) => f.author_id === '00000000-0000-4000-8000-0000000000b2'),
    ).toBe(true);
    expect((await y.from('staff_tasks').select('id')).data).toEqual([]);
    expect((await y.from('staff_resources').select('id')).data!.length).toBeGreaterThan(0);
    await y.auth.signOut();
  });
});

describe('exercise editing, through the API', () => {
  const NUMBERS = '70000000-0000-4000-8000-000000000007';
  const ANSWERED = '80000000-0000-4000-8000-000000000071';

  for (const email of ['student.a@example.com', 'teacher.x@example.com']) {
    it(`${email.split('@')[0]} reads no exercise sources and cannot write items or keys`, async () => {
      const c = await signedIn(email);
      expect((await c.from('activity_sources').select('activity_id')).data).toEqual([]);
      const source = await c
        .from('activity_sources')
        .insert({ activity_id: NUMBERS, course_id: IDS.courseSpanish, source: {} });
      expect(source.error?.code).toBe('42501');
      const item = await c.from('activity_items').insert({
        activity_id: NUMBERS,
        course_id: IDS.courseSpanish,
        position: 9,
        slug: 'planted',
        type: 'trueFalse',
        prompt: [],
        data: {},
      });
      expect(item.error?.code).toBe('42501');
      const changed = await c
        .from('activity_items')
        .update({ data: { options: [] } })
        .eq('id', ANSWERED)
        .select('id');
      expect(changed.data ?? []).toEqual([]);
      const key = await c
        .from('activity_item_keys')
        .update({ answer: { optionIds: ['o1'] } })
        .eq('item_id', ANSWERED)
        .select('item_id');
      expect(key.data ?? []).toEqual([]);
      await c.auth.signOut();
    });
  }
});
