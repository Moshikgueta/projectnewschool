'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { authoredItemSchema } from '@/content/activities-file';
import {
  applyCorrection,
  correctedSource,
  correctionSchema,
  type CorrectedItem,
  type CorrectionProblem,
} from '@/content/item-correction';
import { correctionEffect, type CorrectionEffect } from '@/domain/grading/regrade';
import { requireArea } from '@/server/auth/session';
import {
  gradableItem,
  loadItemForCorrection,
  loadItemResponses,
  type ItemForCorrection,
} from '@/server/content/item-answers';
import type { Json } from '@/server/db.types';
import { createPrivilegedClient } from '@/server/privileged/admin-client';
import { regradeItemAnswers } from '@/server/privileged/regrade';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Correcting the answer key of an answered question (ADR-041), for the
// pedagogical manager with MFA only:
//
//   1. requireArea('manage') here; everything is read with the manager's own
//      session (RLS: the manager reads every item, key and answer).
//   2. The correction is one insert into item_corrections with that session:
//      the database checks app.is_manager() again and changes the item, its
//      key and its source in one transaction (app.correct_answered_item).
//   3. Only then are past answers re-checked, with the privileged module and
//      the same grader as live answers (ADR-006). The re-check is idempotent;
//      if it is interrupted the correction shows "re-check now" to finish it.

const previewInput = z.object({ itemId: z.uuid(), correction: correctionSchema });
const correctInput = previewInput.extend({
  reason: z.string().trim().min(3).max(500),
  reportId: z.uuid().nullable().optional(),
});

export type CorrectionInput = z.input<typeof correctInput>;

export type CorrectionResult =
  | { ok: true; effect: CorrectionEffect; message: string; pending?: boolean }
  | { ok: false; message: string };

type MessageKey =
  CorrectionProblem | 'invalid' | 'notAllowed' | 'failed' | 'notAnswered' | 'reasonMissing';

async function fail(key: MessageKey): Promise<CorrectionResult> {
  const t = await getTranslations('cms.correction.problems');
  return { ok: false, message: t(key) };
}

type Prepared =
  | { ok: false; key: MessageKey }
  | {
      ok: true;
      stored: ItemForCorrection;
      corrected: CorrectedItem;
      effect: CorrectionEffect;
    };

/** Read the question and its answers with the manager's session, and work out the correction. */
async function prepare(value: z.infer<typeof previewInput>): Promise<Prepared> {
  const supabase = await createSupabaseServerClient();
  const stored = await loadItemForCorrection(supabase, value.itemId);
  if (!stored) return { ok: false, key: 'notAllowed' };
  const result = applyCorrection(stored, value.correction);
  if (!result.ok) return { ok: false, key: result.problem };

  const before = gradableItem(stored);
  const after = gradableItem({ ...stored, data: result.item.data, key: result.item.key });
  if (!before || !after) return { ok: false, key: 'unreadable' };
  const responses = await loadItemResponses(supabase, stored.id);
  if (!responses.length) return { ok: false, key: 'notAnswered' };
  return {
    ok: true,
    stored,
    corrected: result.item,
    effect: correctionEffect(before, after, responses),
  };
}

/** What the correction would change, before it is confirmed. Writes nothing. */
export async function previewAnswerCorrection(raw: unknown): Promise<CorrectionResult> {
  await requireArea('manage');
  const parsed = previewInput.safeParse(raw);
  if (!parsed.success) return fail('invalid');
  const prepared = await prepare(parsed.data);
  if (!prepared.ok) return fail(prepared.key);
  return { ok: true, effect: prepared.effect, message: '' };
}

async function recordRecheck(correctionId: string, itemId: string, effect: CorrectionEffect) {
  await regradeItemAnswers(itemId);
  const privileged = createPrivilegedClient();
  const { error } = await privileged
    .from('item_corrections')
    .update({
      responses_rechecked: effect.responses,
      became_correct: effect.becameCorrect,
      became_incorrect: effect.becameIncorrect,
      attempts_rescored: effect.attempts,
      regraded_at: new Date().toISOString(),
    })
    .eq('id', correctionId);
  if (error) throw new Error(error.message);
}

function refresh(activityId: string) {
  revalidatePath(`/manage/content/activities/${activityId}` as Route);
  revalidatePath('/manage/reports');
  revalidatePath('/learn', 'layout');
  revalidatePath('/teach', 'layout');
}

/** Correct the answer, then re-check every past answer of the question. */
export async function correctAnswer(raw: unknown): Promise<CorrectionResult> {
  await requireArea('manage');
  const parsed = correctInput.safeParse(raw);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.every((i) => i.path[0] === 'reason') ? 'reasonMissing' : 'invalid',
    );
  }
  const prepared = await prepare(parsed.data);
  if (!prepared.ok) return fail(prepared.key);
  const { reason, reportId } = parsed.data;
  const { stored, corrected, effect } = prepared;

  const authored = authoredItemSchema.safeParse(stored.source);
  const source = stored.hasSource
    ? correctedSource(authored.success ? authored.data : null, stored, corrected)
    : null;

  // 1. The correction itself: one insert, checked and applied by the database.
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from('item_corrections')
    .insert({
      item_id: stored.id,
      course_id: stored.courseId,
      reason,
      report_id: reportId ?? null,
      new_data: corrected.data as NonNullable<Json>,
      new_answer: corrected.key as NonNullable<Json>,
      new_source: (source as unknown as Json) ?? null,
    })
    .select('id')
    .single();
  if (error || !row) {
    if (error?.code === '42501') return fail('notAllowed');
    if (error?.code === '22023') return fail('unchanged');
    if (error?.code === '23001') return fail('unreadable');
    return fail('failed');
  }

  // 2. The report it answers is resolved, in the manager's own name.
  if (reportId) {
    await supabase.from('content_reports').update({ status: 'resolved' }).eq('id', reportId);
  }

  // 3. Past answers, re-checked with the corrected key.
  const t = await getTranslations('cms.correction');
  refresh(stored.activityId);
  try {
    await recordRecheck(row.id, stored.id, effect);
  } catch {
    return { ok: true, effect, pending: true, message: t('pending') };
  }
  return {
    ok: true,
    effect,
    message: t('done', {
      responses: effect.responses,
      right: effect.becameCorrect,
      wrong: effect.becameIncorrect,
    }),
  };
}

/** Finish (or repeat) the re-check of a correction's past answers. Safe to run again. */
export async function recheckCorrection(raw: unknown): Promise<CorrectionResult> {
  await requireArea('manage');
  const id = z.uuid().safeParse(raw);
  if (!id.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  // Read with the manager's session: RLS shows corrections to the manager only.
  const { data: correction } = await supabase
    .from('item_corrections')
    .select('id, item_id, activity_id, old_data, old_answer, new_data, new_answer')
    .eq('id', id.data)
    .maybeSingle();
  if (!correction) return fail('notAllowed');
  const stored = await loadItemForCorrection(supabase, correction.item_id);
  if (!stored) return fail('notAllowed');
  const before = gradableItem({ ...stored, data: correction.old_data, key: correction.old_answer });
  const after = gradableItem({ ...stored, data: correction.new_data, key: correction.new_answer });
  if (!before || !after) return fail('unreadable');
  const effect = correctionEffect(before, after, await loadItemResponses(supabase, stored.id));
  const t = await getTranslations('cms.correction');
  refresh(stored.activityId);
  try {
    await recordRecheck(correction.id, stored.id, effect);
  } catch {
    return { ok: true, effect, pending: true, message: t('pending') };
  }
  return { ok: true, effect, message: t('rechecked') };
}
