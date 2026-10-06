import { rmSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { MFA_SECRETS_FILE } from './helpers';

// Remove MFA factors left on seed staff accounts by an earlier run, so the MFA
// enrollment test always starts from "not set up". Local/CI databases only.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error(`Refusing to run E2E setup against a non-local database: ${url}`);
  }

  // Every database request here must succeed: a reset that fails quietly
  // leaves data from an earlier run behind, and some later test breaks in a
  // way that has nothing to do with it.
  const admin = createClient(url, secret, {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        if (!res.ok && String(input).includes('/rest/v1/')) {
          throw new Error(
            `E2E setup: ${init?.method ?? 'GET'} ${String(input)} → ${res.status} ${await res.clone().text()}`,
          );
        }
        return res;
      },
    },
  });
  const seedIds = (prefix: string, n: number) =>
    `(${Array.from({ length: n }, (_, i) => `${prefix}-0000-4000-8000-${String(i + 1).padStart(12, '0')}`).join(',')})`;
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    // Accounts left by an interrupted staff-room import test.
    if (user.email?.endsWith('@staffroom.example.com')) {
      await admin.auth.admin.deleteUser(user.id);
      continue;
    }
    if (!user.email?.endsWith('@example.com')) continue;
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    for (const factor of factors?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
    }
    // Fixture accounts browse in English; tests that need Hebrew switch to it.
    await admin.from('profiles').update({ ui_locale: 'en' }).eq('id', user.id);
  }
  rmSync(MFA_SECRETS_FILE, { force: true });

  // Entry codes and wrong-code counts from earlier runs (seed has none).
  await admin.from('code_attempts').delete().neq('scope', '');
  await admin.from('student_codes').delete().neq('code_hash', '');

  // Groups created by earlier runs of the management tests.
  const { data: groups } = await admin.from('groups').select('id').like('name', 'E2E %');
  const ids = (groups ?? []).map((g) => g.id);
  if (ids.length) {
    await admin.from('enrollments').delete().in('group_id', ids);
    await admin.from('groups').delete().in('id', ids);
  }

  // Notebook state written by earlier runs: student A's answers, and student
  // C's reading of the French section (seed has none of either).
  const A = '00000000-0000-4000-8000-0000000000a1';
  const C = '00000000-0000-4000-8000-0000000000a3';
  await admin.from('block_responses').delete().eq('user_id', A);
  await admin.from('section_progress').delete().eq('user_id', C);
  await admin
    .from('learning_events')
    .delete()
    .eq('user_id', C)
    .in('type', ['section_opened', 'section_completed']);

  // Exercise attempts made by earlier runs on the every-type fixture (responses cascade).
  const ACTIVITY = '70000000-0000-4000-8000-000000000006';
  await admin.from('attempts').delete().eq('activity_id', ACTIVITY);
  await admin.from('learning_events').delete().eq('activity_id', ACTIVITY);
  // Student A's visit to the workbook section that embeds it.
  const PRACTICA = '60000000-0000-4000-8000-000000000005';
  await admin.from('section_progress').delete().eq('user_id', A).eq('book_section_id', PRACTICA);
  await admin.from('learning_events').delete().eq('user_id', A).eq('section_id', PRACTICA);

  // Student A's flashcards, back to the seed: "hola" due now, "adiós" never seen.
  await admin.from('vocab_review_state').delete().eq('user_id', A);
  await admin.from('vocab_review_state').insert({
    user_id: A,
    vocabulary_item_id: '92000000-0000-4000-8000-000000000001',
    course_id: '30000000-0000-4000-8000-000000000001',
    box: 2,
  });
  await admin.from('learning_events').delete().eq('user_id', A).eq('type', 'vocab_reviewed');

  // Group X as seeded: one homework, one class in two days, cycle 1 active.
  const GX = 'a0000000-0000-4000-8000-000000000001';
  await admin
    .from('assignments')
    .delete()
    .eq('group_id', GX)
    .neq('id', 'b0000000-0000-4000-8000-000000000001');
  // Classes as seeded: in two days; two days ago (attendance: A present,
  // B late, D absent); nine days ago (attendance not taken).
  const { data: classes } = await admin.from('group_sessions').select('id').eq('group_id', GX);
  const classIds = (classes ?? []).map((c) => c.id);
  if (classIds.length) await admin.from('attendance').delete().in('session_id', classIds);
  await admin.from('group_sessions').delete().eq('group_id', GX);
  const day = 86_400_000;
  const cycle1 = '40000000-0000-4000-8000-000000000001';
  await admin.from('group_sessions').insert([
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      group_id: GX,
      cycle_id: cycle1,
      starts_at: new Date(Date.now() + 2 * day).toISOString(),
    },
    {
      id: 'f0000000-0000-4000-8000-000000000002',
      group_id: GX,
      cycle_id: cycle1,
      starts_at: new Date(Date.now() - 2 * day).toISOString(),
    },
    {
      id: 'f0000000-0000-4000-8000-000000000003',
      group_id: GX,
      cycle_id: cycle1,
      starts_at: new Date(Date.now() - 9 * day).toISOString(),
    },
  ]);
  const TX = '00000000-0000-4000-8000-0000000000b1';
  await admin.from('attendance').insert(
    (
      [
        ['00000000-0000-4000-8000-0000000000a1', 'present'],
        ['00000000-0000-4000-8000-0000000000a2', 'late'],
        ['00000000-0000-4000-8000-0000000000a4', 'absent'],
      ] as const
    ).map(([student, status]) => ({
      session_id: 'f0000000-0000-4000-8000-000000000002',
      student_id: student,
      status,
      marked_by: TX,
    })),
  );
  await admin
    .from('group_cycles')
    .update({ state: 'active' })
    .eq('group_id', GX)
    .eq('cycle_id', '40000000-0000-4000-8000-000000000001');

  // The office's records as seeded (stage D): students added by the tests
  // are removed, the seed's contact details, packages and lessons restored.
  for (const user of data?.users ?? []) {
    if (user.email?.endsWith('@students.newschool.invalid') || user.email?.startsWith('e2e.')) {
      await admin.from('private_lessons').delete().eq('student_id', user.id);
      await admin.from('lesson_packages').delete().eq('student_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
  }
  await admin.from('private_lessons').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('lesson_packages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('student_records').upsert([
    { student_id: A, phone: '050-1234567', contact_email: '', office_note: 'Prefers evenings' },
    {
      student_id: '00000000-0000-4000-8000-0000000000a2',
      phone: '052-7654321',
      contact_email: 'maya.family@example.com',
      office_note: '',
    },
  ]);
  const OFFICE = '00000000-0000-4000-8000-0000000000e1';
  const dayMs = 86_400_000;
  const at = (days: number) => new Date(Date.now() + days * dayMs);
  const dateOnly = (days: number) => at(days).toISOString().slice(0, 10);
  await admin.from('lesson_packages').insert([
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      student_id: A,
      lessons: 10,
      minutes_per_lesson: 60,
      starts_on: dateOnly(-30),
      expires_on: dateOnly(120),
      price: 1800,
      paid_at: at(-30).toISOString(),
      created_by: OFFICE,
    },
    {
      id: 'd0000000-0000-4000-8000-000000000002',
      student_id: '00000000-0000-4000-8000-0000000000a2',
      lessons: 5,
      minutes_per_lesson: 45,
      starts_on: dateOnly(-60),
      expires_on: dateOnly(10),
      price: 950,
      paid_at: null,
      created_by: OFFICE,
    },
  ]);
  const lesson = (
    n: number,
    student: string,
    teacher: string,
    pkg: string,
    days: number,
    minutes: number,
    status: 'done' | 'scheduled' | 'cancelled_late',
  ) => ({
    id: `d1000000-0000-4000-8000-00000000000${n}`,
    student_id: student,
    teacher_id: teacher,
    package_id: pkg,
    starts_at: at(days).toISOString(),
    ends_at: new Date(at(days).getTime() + minutes * 60_000).toISOString(),
    status,
    cancelled_at:
      status === 'cancelled_late'
        ? new Date(at(days).getTime() - 2 * 3_600_000).toISOString()
        : null,
    created_by: OFFICE,
  });
  const B = '00000000-0000-4000-8000-0000000000a2';
  const TXID = '00000000-0000-4000-8000-0000000000b1';
  const TYID = '00000000-0000-4000-8000-0000000000b2';
  const P1 = 'd0000000-0000-4000-8000-000000000001';
  const P2 = 'd0000000-0000-4000-8000-000000000002';
  await admin
    .from('private_lessons')
    .insert([
      lesson(1, A, TXID, P1, -7, 60, 'done'),
      lesson(2, A, TXID, P1, -3, 60, 'cancelled_late'),
      lesson(3, A, TXID, P1, 3, 60, 'scheduled'),
      lesson(4, B, TYID, P2, -28, 45, 'done'),
      lesson(5, B, TYID, P2, -21, 45, 'done'),
      lesson(6, B, TYID, P2, -14, 45, 'done'),
      lesson(7, B, TYID, P2, -7, 45, 'done'),
    ]);

  // Staff tools (stage E) as seeded: added feedback, links and tasks removed,
  // the seed's feedback unhandled and its task open again.
  await admin.from('staff_feedback').delete().not('id', 'in', seedIds('d3000000', 2));
  await admin
    .from('staff_feedback')
    .update({ handled_at: null, handled_by: null })
    .not('handled_at', 'is', null);
  await admin.from('staff_resources').delete().not('id', 'in', seedIds('d2000000', 3));
  await admin.from('staff_tasks').delete().not('id', 'in', seedIds('d4000000', 1));
  await admin.from('staff_tasks').update({ status: 'open', done_at: null }).eq('status', 'done');

  // Rooms and lessons added by the office tests (the seed's ids start e0…/e1…).
  await admin.from('room_bookings').delete().not('id', 'in', seedIds('e1000000', 3));
  await admin.from('rooms').delete().not('id', 'in', seedIds('e0000000', 3));

  // Student A's "Not now" choices, back to the seed (only vocabulary snoozed).
  await admin.from('recommendation_feedback').delete().eq('user_id', A);
  await admin.from('recommendation_feedback').insert({
    user_id: A,
    rec_key: 'vocab-review:30000000-0000-4000-8000-000000000001',
    action: 'dismissed',
  });
}
