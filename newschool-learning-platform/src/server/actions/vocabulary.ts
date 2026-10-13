'use server';

import { z } from 'zod';
import { review } from '@/domain/learning/leitner';
import { requireArea } from '@/server/auth/session';
import { createPrivilegedClient } from '@/server/privileged/admin-client';
import { recordLearningEvent } from '@/server/privileged/events';
import { createSupabaseServerClient } from '@/server/supabase/server';

const HOUR = 3_600_000;

/**
 * Record one flashcard self-rating. The word must be visible to the student
 * under RLS (published, their course); the new Leitner state is computed on
 * the server and written for the session's user only.
 */
export async function reviewWord(itemId: string, knew: boolean): Promise<{ ok: boolean }> {
  const user = await requireArea('learn');
  if (!z.uuid().safeParse(itemId).success || typeof knew !== 'boolean') return { ok: false };

  const supabase = await createSupabaseServerClient();
  const [{ data: word }, { data: previous }] = await Promise.all([
    supabase.from('vocabulary_items').select('id, course_id').eq('id', itemId).maybeSingle(),
    supabase
      .from('vocab_review_state')
      .select('box, due_at, correct_streak, lapses')
      .eq('user_id', user.id)
      .eq('vocabulary_item_id', itemId)
      .maybeSingle(),
  ]);
  if (!word) return { ok: false };

  const now = new Date();
  const next = review(
    previous
      ? {
          box: previous.box,
          dueAt: new Date(previous.due_at),
          correctStreak: previous.correct_streak,
          lapses: previous.lapses,
        }
      : null,
    knew,
    now,
  );

  const { error } = await createPrivilegedClient().from('vocab_review_state').upsert(
    {
      user_id: user.id,
      vocabulary_item_id: word.id,
      course_id: word.course_id,
      box: next.box,
      due_at: next.dueAt.toISOString(),
      last_reviewed_at: now.toISOString(),
      correct_streak: next.correctStreak,
      lapses: next.lapses,
    },
    { onConflict: 'user_id,vocabulary_item_id' },
  );
  if (error) return { ok: false };

  // One "reviewed vocabulary" entry per hour of practice, not one per card.
  const { data: recent } = await supabase
    .from('learning_events')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'vocab_reviewed')
    .gte('occurred_at', new Date(now.getTime() - HOUR).toISOString())
    .limit(1);
  if (!recent?.length) {
    await recordLearningEvent(user, 'vocab_reviewed', { courseId: word.course_id });
  }
  return { ok: true };
}
