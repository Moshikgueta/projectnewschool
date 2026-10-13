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

describe('exercises written by a teacher (ADR-038), through the API', () => {
  const EXERCISE = 'e1000000-0000-4000-8000-0000000000a1';
  const ITEM = 'e2000000-0000-4000-8000-0000000000a1';
  const CYCLE = '40000000-0000-4000-8000-000000000001';
  const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';
  const secret = process.env.SUPABASE_SECRET_KEY ?? '';
  const cleanup = () =>
    createClient<Database>(url, secret, { auth: { persistSession: false } })
      .from('activities')
      .delete()
      .eq('id', EXERCISE);

  beforeAll(async () => {
    expect(secret, 'SUPABASE_SECRET_KEY must be set for this test’s clean-up').not.toBe('');
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it('reach only the students of the group they are assigned to', async () => {
    const tx = await signedIn('teacher.x@example.com');
    const created = await tx.from('activities').insert({
      id: EXERCISE,
      course_id: IDS.courseSpanish,
      cycle_id: CYCLE,
      slug: 'api-staff-exercise',
      title: 'API: staff exercise',
      created_by: TEACHER_X,
      status: 'published',
    });
    expect(created.error).toBeNull();
    const item = await tx.from('activity_items').insert({
      id: ITEM,
      activity_id: EXERCISE,
      course_id: IDS.courseSpanish,
      position: 1,
      slug: 'q1',
      type: 'trueFalse',
      prompt: [{ id: 'prompt', type: 'text', text: '¿Verdadero?' }],
      data: {},
    });
    expect(item.error).toBeNull();
    const key = await tx
      .from('activity_item_keys')
      .insert({ item_id: ITEM, course_id: IDS.courseSpanish, answer: { value: true } });
    expect(key.error).toBeNull();

    // Published but not assigned: no student sees it.
    const a = await signedIn('student.a@example.com');
    const c = await signedIn('student.c@example.com');
    expect((await a.from('activities').select('id').eq('id', EXERCISE)).data).toEqual([]);

    const assigned = await tx.from('assignments').insert({
      group_id: IDS.groupX,
      course_id: IDS.courseSpanish,
      activity_id: EXERCISE,
      assigned_by: TEACHER_X,
    });
    expect(assigned.error).toBeNull();

    // Student A (group X) now sees it and its question, never the answer.
    expect((await a.from('activities').select('id').eq('id', EXERCISE)).data).toHaveLength(1);
    expect((await a.from('activity_items').select('id').eq('id', ITEM)).data).toHaveLength(1);
    expect((await a.from('activity_item_keys').select('item_id').eq('item_id', ITEM)).data).toEqual(
      [],
    );

    // Student C (not in group X) gets nothing by id, and cannot plant
    // homework for themselves to get it.
    expect((await c.from('activities').select('id').eq('id', EXERCISE)).data).toEqual([]);
    expect((await c.from('activity_items').select('id').eq('id', ITEM)).data).toEqual([]);
    expect((await c.from('assignments').select('id').eq('activity_id', EXERCISE)).data).toEqual([]);
    const planted = await c.from('assignments').insert({
      group_id: 'a0000000-0000-4000-8000-000000000002',
      course_id: '30000000-0000-4000-8000-000000000002',
      activity_id: '70000000-0000-4000-8000-000000000003',
      assigned_by: '00000000-0000-4000-8000-0000000000a3',
    });
    expect(planted.error?.code).toBe('42501');
    expect((await c.from('editable_activities').select('activity_id')).data).toEqual([]);
    expect((await c.from('activity_answered_items').select('item_id')).data).toEqual([]);

    // Teacher Y cannot change it.
    const ty = await signedIn('teacher.y@example.com');
    const changed = await ty
      .from('activities')
      .update({ title: 'Taken over' })
      .eq('id', EXERCISE)
      .select('id');
    expect(changed.data ?? []).toEqual([]);

    for (const s of [tx, a, c, ty]) await s.auth.signOut();
  });
});

describe('homework for selected students (ADR-039), through the API', () => {
  const ASSIGNMENT = 'e3000000-0000-4000-8000-0000000000a9';
  const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';
  const STUDENT_C = '00000000-0000-4000-8000-0000000000a3';
  const secret = process.env.SUPABASE_SECRET_KEY ?? '';
  const cleanup = () =>
    createClient<Database>(url, secret, { auth: { persistSession: false } })
      .from('assignments')
      .delete()
      .eq('id', ASSIGNMENT);

  beforeAll(async () => {
    expect(secret, 'SUPABASE_SECRET_KEY must be set for this test’s clean-up').not.toBe('');
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it('reaches only the chosen student; classmates cannot see it, join it or learn who has it', async () => {
    const tx = await signedIn('teacher.x@example.com');
    const given = await tx.from('assignments').insert({
      id: ASSIGNMENT,
      group_id: IDS.groupX,
      course_id: IDS.courseSpanish,
      activity_id: '70000000-0000-4000-8000-000000000002',
      audience: 'selected',
      assigned_by: TEACHER_X,
    });
    expect(given.error).toBeNull();
    const chosen = await tx
      .from('assignment_recipients')
      .insert({ assignment_id: ASSIGNMENT, student_id: IDS.studentB });
    expect(chosen.error).toBeNull();
    // Not even a teacher of the group can add a student from another group.
    const outsider = await tx
      .from('assignment_recipients')
      .insert({ assignment_id: ASSIGNMENT, student_id: STUDENT_C });
    expect(outsider.error?.code).toBe('23514');

    const a = await signedIn('student.a@example.com');
    const b = await signedIn('student.b@example.com');
    expect((await b.from('assignments').select('id').eq('id', ASSIGNMENT)).data).toHaveLength(1);

    // Student A, same group, not chosen: nothing by id, nothing by filtering
    // on B, and cannot add themselves or remove B.
    expect((await a.from('assignments').select('id').eq('id', ASSIGNMENT)).data).toEqual([]);
    expect(
      (await a.from('assignment_recipients').select('student_id').eq('assignment_id', ASSIGNMENT))
        .data,
    ).toEqual([]);
    expect(
      (await a.from('assignment_recipients').select('assignment_id').eq('student_id', IDS.studentB))
        .data,
    ).toEqual([]);
    const joined = await a
      .from('assignment_recipients')
      .insert({ assignment_id: ASSIGNMENT, student_id: IDS.studentA });
    expect(joined.error?.code).toBe('42501');
    const removed = await a
      .from('assignment_recipients')
      .delete()
      .eq('assignment_id', ASSIGNMENT)
      .select('student_id');
    expect(removed.data ?? []).toEqual([]);
    // Nor can A turn it into homework for the whole group.
    const widened = await a
      .from('assignments')
      .update({ audience: 'group' })
      .eq('id', ASSIGNMENT)
      .select('id');
    expect(widened.data ?? []).toEqual([]);
    expect((await a.from('assignments').select('id').eq('id', ASSIGNMENT)).data).toEqual([]);

    for (const s of [tx, a, b]) await s.auth.signOut();
  });
});

describe('mistake reports (ADR-040), through the API', () => {
  const secret = process.env.SUPABASE_SECRET_KEY ?? '';
  const MARK = 'API test report';
  const cleanup = () =>
    createClient<Database>(url, secret, { auth: { persistSession: false } })
      .from('content_reports')
      .delete()
      .like('message', `${MARK}%`);

  beforeAll(async () => {
    expect(secret, 'SUPABASE_SECRET_KEY must be set for this test’s clean-up').not.toBe('');
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it('a student reports in their own name; a classmate cannot read it or rewrite it', async () => {
    const a = await signedIn('student.a@example.com');
    const b = await signedIn('student.b@example.com');
    const sent = await b
      .from('content_reports')
      .insert({
        course_id: IDS.courseSpanish,
        activity_id: '70000000-0000-4000-8000-000000000001',
        item_id: IDS.itemSpanish,
        message: `${MARK}: two answers fit`,
      })
      .select('id, reporter_id, status')
      .single();
    expect(sent.error).toBeNull();
    expect(sent.data).toMatchObject({ reporter_id: IDS.studentB, status: 'open' });
    const id = sent.data!.id;

    // Student A, same group: nothing by id, nothing by filtering on B.
    expect((await a.from('content_reports').select('id').eq('id', id)).data).toEqual([]);
    expect(
      (await a.from('content_reports').select('id').eq('reporter_id', IDS.studentB)).data,
    ).toEqual([]);
    // Neither student can resolve it or change what it says.
    const resolved = await b
      .from('content_reports')
      .update({ status: 'resolved' })
      .eq('id', id)
      .select('id');
    expect(resolved.data ?? []).toEqual([]);
    const rewritten = await b.from('content_reports').update({ message: 'changed' }).eq('id', id);
    expect(rewritten.error?.code).toBe('42501');
    // Nor send one in someone else's name.
    const forged = await a.from('content_reports').insert({
      reporter_id: IDS.studentB,
      course_id: IDS.courseSpanish,
      activity_id: '70000000-0000-4000-8000-000000000001',
      message: `${MARK}: forged`,
    });
    expect(forged.error?.code).toBe('42501');

    // Teacher X (teaches the course) reads and resolves it.
    const tx = await signedIn('teacher.x@example.com');
    const done = await tx
      .from('content_reports')
      .update({ status: 'resolved' })
      .eq('id', id)
      .select('status, resolved_by')
      .single();
    expect(done.data).toMatchObject({
      status: 'resolved',
      resolved_by: '00000000-0000-4000-8000-0000000000b1',
    });
    for (const s of [a, b, tx]) await s.auth.signOut();
  });

  it('refuses the eleventh report in an hour with HTTP 429', async () => {
    const d = await signedIn('student.d@example.com');
    const report = (n: number) => ({
      course_id: IDS.courseSpanish,
      activity_id: '70000000-0000-4000-8000-000000000001',
      message: `${MARK}: ${n}`,
    });
    const ten = await d
      .from('content_reports')
      .insert(Array.from({ length: 10 }, (_, i) => report(i)));
    expect(ten.error).toBeNull();
    const eleventh = await d.from('content_reports').insert(report(11));
    expect(eleventh.error?.code).toBe('PT429');
    expect(eleventh.status).toBe(429);
    await d.auth.signOut();
  });
});

describe('answer corrections (ADR-041), through the API', () => {
  const correction = {
    item_id: IDS.itemSpanish,
    course_id: IDS.courseSpanish,
    reason: 'Trying to change the key myself.',
    new_data: {
      options: [
        { id: 'o1', text: 'Me llamo Ana.' },
        { id: 'o2', text: 'Tengo diez años.' },
      ],
    },
    new_answer: { optionIds: ['o2'] },
  };

  it('a student or a teacher cannot correct an answer, read corrections or call the function', async () => {
    for (const email of ['student.a@example.com', 'teacher.x@example.com']) {
      const s = await signedIn(email);
      const insert = await s.from('item_corrections').insert(correction);
      expect(insert.error?.code, email).toBe('42501');
      const { data } = await s.from('item_corrections').select('*');
      expect(data, email).toEqual([]);
      const rpc = await s.rpc('correct_answered_item' as never);
      expect(rpc.error, email).not.toBeNull();
      await s.auth.signOut();
    }
    // The key is as it was, and still unreadable for the student.
    const a = await signedIn('student.a@example.com');
    const { data: keys } = await a.from('activity_item_keys').select('answer');
    expect(keys).toEqual([]);
    await a.auth.signOut();
  });

  it('a manager session without MFA cannot correct either', async () => {
    const pm = await signedIn('manager@example.com');
    const insert = await pm.from('item_corrections').insert(correction);
    expect(insert.error?.code).toBe('42501');
    await pm.auth.signOut();
  });
});
