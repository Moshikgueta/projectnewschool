// The re-check of past answers after a key correction (ADR-041), timed on the
// "hot" question of scripts/perf/seed-scale.sql (~6,000 answers). Runs the
// real code: the manager's preview read (RLS), the correction insert (the
// database trigger), and src/server/privileged/regrade.ts with the secret key.
// The key is then corrected back and re-checked again, so the data ends as it
// started (checked at the end).
//
//   pnpm perf:regrade        (timings also in perf-results/regrade.json)
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database, Json } from '@/server/db.types';

vi.mock('server-only', () => ({}));

import { loadItemResponses } from '@/server/content/item-answers';
import { regradeItemAnswers } from '@/server/privileged/regrade';

type Client = SupabaseClient<Database>;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const secret = process.env.SUPABASE_SECRET_KEY ?? '';
const PASSWORD = 'Local-dev-password-1'; // seed.sql, local only
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

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

async function managerClient(): Promise<Client> {
  const email = process.env.PERF_MANAGER ?? 'manager@example.com';
  const client = createClient<Database>(url, publishable, opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`could not sign in ${email}: ${error?.message}`);
  const admin = createClient<Database>(url, secret, opts);
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: data.user.id });
  for (const f of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId: data.user.id, id: f.id });
  }
  const { data: enrolled } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `perf-${Date.now()}`,
  });
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled!.id,
    code: totp(enrolled!.totp.secret),
  });
  if (verifyError) throw new Error(`MFA failed: ${verifyError.message}`);
  return client;
}

const ms = (t: number) => Math.round(performance.now() - t);

describe('re-checking ~6,000 past answers after a key correction', () => {
  it('times preview, correction and re-check, and leaves the data as it was', async () => {
    const admin = createClient<Database>(url, secret, opts);
    const manager = await managerClient();

    // The hot exercise is the one everyone in the first course practised six times.
    const { data: hot } = await admin
      .from('attempts')
      .select('activity_id')
      .eq('attempt_no', 6)
      .limit(1)
      .single();
    const { data: items } = await admin
      .from('activity_items')
      .select('id, course_id, data, position, activity_item_keys ( answer )')
      .eq('activity_id', hot!.activity_id)
      .eq('type', 'multipleChoice')
      .order('position');
    const item = items!.find((i) => {
      const options = (i.data as { options?: { id: string }[] }).options ?? [];
      const key = i.activity_item_keys[0]?.answer as { optionIds?: string[] } | undefined;
      return options.length >= 3 && key?.optionIds?.length === 1;
    })!;
    const key = item.activity_item_keys[0]!.answer as { optionIds: string[] };
    const optionX = ((item.data as { options: { id: string }[] }).options ?? [])
      .map((o) => o.id)
      .filter((id) => !key.optionIds.includes(id))
      .sort()[0]!;

    const correctCount = async () =>
      (
        await admin
          .from('responses')
          .select('id', { count: 'exact', head: true })
          .eq('item_id', item.id)
          .eq('is_correct', true)
      ).count;
    const { count: answers } = await admin
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id);
    const timings: Record<string, number | null> = { answers };
    // First make the stored grades agree with the current key (an earlier run
    // that was interrupted may have left them half re-checked).
    let t = performance.now();
    const aligned = await regradeItemAnswers(item.id);
    timings['re-check before starting (ms)'] = ms(t);
    timings['  answers / attempts changed then'] = aligned.responsesUpdated;
    timings['  attempts changed then'] = aligned.attemptsUpdated;
    const correctBefore = await correctCount();

    t = performance.now();
    const preview = await loadItemResponses(manager, item.id);
    timings['preview read (manager, RLS) (ms)'] = ms(t);
    expect(preview.length).toBe(answers);

    const correct = async (answer: Json, reason: string) => {
      const start = performance.now();
      const { error } = await manager.from('item_corrections').insert({
        item_id: item.id,
        course_id: item.course_id,
        reason,
        new_data: item.data as NonNullable<Json>,
        new_answer: answer as NonNullable<Json>,
      });
      if (error) throw new Error(`correction refused: ${error.message}`);
      return ms(start);
    };

    timings['correction insert (ms)'] = await correct(
      { ...key, optionIds: [optionX] },
      'Load test: key was wrong',
    );
    t = performance.now();
    const first = await regradeItemAnswers(item.id);
    timings['re-check, key changed (ms)'] = ms(t);
    timings['  answers it changed'] = first.responsesUpdated;
    timings['  attempts it changed'] = first.attemptsUpdated;

    t = performance.now();
    const again = await regradeItemAnswers(item.id);
    timings['re-check again, nothing to change (ms)'] = ms(t);
    timings['  answers/attempts it changed'] = again.responsesUpdated + again.attemptsUpdated;

    await correct(key as unknown as Json, 'Load test: back to the original key');
    t = performance.now();
    const back = await regradeItemAnswers(item.id);
    timings['re-check, key changed back (ms)'] = ms(t);
    timings['  answers it changed back'] = back.responsesUpdated;

    console.table(timings);
    const out = process.env.PERF_OUT ?? 'perf-results/regrade.json';
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(timings, null, 2));
    expect(again).toEqual({ responsesUpdated: 0, attemptsUpdated: 0 });
    expect(await correctCount()).toBe(correctBefore);
  });
});
