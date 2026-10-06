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

  const admin = createClient(url, secret, { auth: { persistSession: false } });
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

  // Rooms and lessons added by the office tests (the seed's ids start e0…/e1…).
  await admin.from('room_bookings').delete().not('id', 'like', 'e1000000-%');
  await admin.from('rooms').delete().not('id', 'like', 'e0000000-%');

  // Student A's "Not now" choices, back to the seed (only vocabulary snoozed).
  await admin.from('recommendation_feedback').delete().eq('user_id', A);
  await admin.from('recommendation_feedback').insert({
    user_id: A,
    rec_key: 'vocab-review:30000000-0000-4000-8000-000000000001',
    action: 'dismissed',
  });
}
