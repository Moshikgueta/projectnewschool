'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  feedbackSchema,
  isAutoGraded,
  parseAnswer,
  parseKey,
  type ItemType,
} from '@/content/items';
import type { CheckResult } from '@/content/player/types';
import { readState, scoreAttempt, withAnswer } from '@/domain/grading/attempt';
import { grade, type GradeInput } from '@/domain/grading/grade';
import { REVEAL_AFTER_TRIES, solutionOf } from '@/domain/grading/solution';
import { requireArea } from '@/server/auth/session';
import type { Json } from '@/server/db.types';
import { createPrivilegedClient } from '@/server/privileged/admin-client';
import { recordLearningEvent } from '@/server/privileged/events';
import { getActivity } from '@/server/queries/activities';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Exercises (ADR-006). Every action first proves access with the student's
// OWN session (RLS: the activity is published in a course they are enrolled
// in; the attempt is theirs). Only then does it use the privileged client, to
// read the answer key and write graded records. The user id always comes from
// the verified session, never from the request.

const uuid = z.uuid();
const ANSWERS_PER_MINUTE = 60;

async function myOpenAttempt(userId: string, attemptId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('attempts')
    .select('id, activity_id, course_id, assignment_id, status, state')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

/** Start an activity, or resume the attempt that is already open. */
export async function startActivity(formData: FormData): Promise<void> {
  const user = await requireArea('learn');
  const id = uuid.safeParse(formData.get('activityId'));
  if (!id.success) redirect('/learn/practice');

  const activity = await getActivity(id.data);
  if (!activity) redirect('/learn/practice');

  const supabase = await createSupabaseServerClient();
  const { data: mine } = await supabase
    .from('attempts')
    .select('id, status, attempt_no')
    .eq('user_id', user.id)
    .eq('activity_id', activity.id);
  const open = mine?.find((a) => a.status === 'in_progress');
  if (open) redirect(`/learn/attempts/${open.id}` as Route);

  // Homework: link the attempt to the student's assignment for it, if any.
  const { data: assignment } = await supabase
    .from('assignments')
    .select('id')
    .eq('activity_id', activity.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const privileged = createPrivilegedClient();
  const { data: created, error } = await privileged
    .from('attempts')
    .insert({
      user_id: user.id,
      activity_id: activity.id,
      course_id: activity.courseId,
      assignment_id: assignment?.id ?? null,
      attempt_no: Math.max(0, ...(mine ?? []).map((a) => a.attempt_no)) + 1,
    })
    .select('id')
    .single();

  if (error) {
    // Started twice at the same moment: the unique index kept one; use it.
    const { data: existing } = await supabase
      .from('attempts')
      .select('id')
      .eq('user_id', user.id)
      .eq('activity_id', activity.id)
      .eq('status', 'in_progress')
      .maybeSingle();
    if (!existing) throw new Error(`Could not start the activity: ${error.message}`);
    redirect(`/learn/attempts/${existing.id}` as Route);
  }

  await recordLearningEvent(user, 'activity_started', {
    courseId: activity.courseId,
    cycleId: activity.cycleId,
    activityId: activity.id,
  });
  revalidatePath('/learn', 'layout');
  redirect(`/learn/attempts/${created.id}` as Route);
}

/** Check one answer on the server and return feedback (never the key itself). */
export async function checkAnswer(
  attemptId: string,
  itemId: string,
  rawAnswer: unknown,
): Promise<CheckResult> {
  const user = await requireArea('learn');
  if (!uuid.safeParse(attemptId).success || !uuid.safeParse(itemId).success) {
    return { ok: false, reason: 'invalid' };
  }

  const attempt = await myOpenAttempt(user.id, attemptId);
  if (!attempt) return { ok: false, reason: 'invalid' };
  if (attempt.status !== 'in_progress') return { ok: false, reason: 'closed' };

  // The item must belong to this attempt's activity, and be visible to the student.
  const activity = await getActivity(attempt.activity_id);
  const entry = activity?.items.find((i) => i.rawId === itemId);
  if (!activity || !entry?.item) return { ok: false, reason: 'invalid' };
  const item = entry.item;
  const type: ItemType = item.type;

  const answer = parseAnswer(type, rawAnswer);
  if (!answer) return { ok: false, reason: 'invalid' };

  const state = readState(attempt.state);
  const scored = activity.scoring === 'scored';
  const previous = state.items[itemId];
  if (scored && previous) return { ok: false, reason: 'locked' };
  if (previous?.status === 'correct') return { ok: false, reason: 'locked' };

  const privileged = createPrivilegedClient();
  // Rate limit (docs/SECURITY.md): a person answers a few questions a minute;
  // a script trying every option does not get to.
  const { count: recent } = await privileged
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if ((recent ?? 0) >= ANSWERS_PER_MINUTE) return { ok: false, reason: 'tooFast' };

  const { data: keyRow } = await privileged
    .from('activity_item_keys')
    .select('answer, feedback')
    .eq('item_id', itemId)
    .maybeSingle();
  const key = parseKey(type, keyRow?.answer);
  if (isAutoGraded(type) && !key) return { ok: false, reason: 'error' };
  const feedback = feedbackSchema.safeParse(keyRow?.feedback ?? {});

  const result = grade({
    type,
    data: item.data,
    key,
    answer,
    points: item.points,
    feedback: feedback.success ? feedback.data : {},
  } as GradeInput);

  const status = result.correct === null ? 'saved' : result.correct ? 'correct' : 'incorrect';
  const next = withAnswer(state, itemId, {
    status,
    score: result.score,
    answer,
    accent: result.accentReminder,
  });
  const tries = next.items[itemId]!.tries;

  const [inserted, updated] = await Promise.all([
    privileged.from('responses').insert({
      attempt_id: attempt.id,
      user_id: user.id,
      course_id: attempt.course_id,
      item_id: itemId,
      answer,
      is_correct: result.correct,
      score: result.score,
      feedback_code: result.code,
      try_no: tries,
    }),
    privileged
      .from('attempts')
      .update({ state: next as unknown as NonNullable<Json> })
      .eq('id', attempt.id)
      .eq('user_id', user.id)
      .eq('status', 'in_progress'),
  ]);
  if (inserted.error || updated.error) return { ok: false, reason: 'error' };

  if (scored) {
    // Results are revealed when the activity is finished.
    return {
      ok: true,
      status: 'saved',
      correct: null,
      accentReminder: false,
      feedback: [],
      tries,
      solution: null,
    };
  }
  const reveal = result.correct === false && tries >= REVEAL_AFTER_TRIES && key !== null;
  return {
    ok: true,
    status,
    correct: result.correct,
    parts: result.parts,
    accentReminder: result.accentReminder,
    feedback: result.feedback,
    tries,
    solution: reveal
      ? solutionOf({ type, data: item.data, key } as Parameters<typeof solutionOf>[0])
      : null,
  };
}

/** Finish an attempt: score it from first tries, close it, record the events. */
export async function finishAttempt(formData: FormData): Promise<void> {
  const user = await requireArea('learn');
  const id = uuid.safeParse(formData.get('attemptId'));
  if (!id.success) redirect('/learn/practice');

  const attempt = await myOpenAttempt(user.id, id.data);
  if (!attempt) redirect('/learn/practice');
  if (attempt.status !== 'in_progress') redirect(`/learn/attempts/${attempt.id}` as Route);

  const activity = await getActivity(attempt.activity_id);
  if (!activity) redirect('/learn/practice');

  const { score, maxScore } = scoreAttempt(
    activity.items.flatMap((i) =>
      i.item ? [{ id: i.item.id, points: i.item.points, graded: isAutoGraded(i.item.type) }] : [],
    ),
    readState(attempt.state),
  );

  const privileged = createPrivilegedClient();
  const { data: closed } = await privileged
    .from('attempts')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      score,
      max_score: maxScore,
    })
    .eq('id', attempt.id)
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .select('id');

  if (closed?.length) {
    const refs = {
      courseId: activity.courseId,
      cycleId: activity.cycleId,
      activityId: activity.id,
    };
    await recordLearningEvent(user, 'activity_completed', refs);
    if (attempt.assignment_id) await recordLearningEvent(user, 'assignment_completed', refs);
  }
  revalidatePath('/learn', 'layout');
  redirect(`/learn/attempts/${attempt.id}` as Route);
}
