'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { AnswerState } from '@/content/render/AnswerBox';
import { answerSlots, parseBlocksForRender } from '@/content/schema';
import { requireArea } from '@/server/auth/session';
import { ensureProgress, readableSection } from '@/server/learner/progress';
import { recordLearningEvent } from '@/server/privileged/events';

// Students' own notebook writes: optional in-class answers and finishing a
// section (ADR-023). Writes use the student's own session, so RLS limits
// them to the student's own rows on sections they can read. The user id
// always comes from the verified session, never from the form.

const sectionId = z.uuid();

export async function saveAnswer(_prev: AnswerState, formData: FormData): Promise<AnswerState> {
  const user = await requireArea('learn');
  const parsed = z
    .object({
      sectionId,
      blockId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      itemIndex: z.coerce.number().int().min(0).max(50),
      answer: z.string().max(2000),
    })
    .safeParse({
      sectionId: formData.get('sectionId'),
      blockId: formData.get('blockId'),
      itemIndex: formData.get('itemIndex'),
      answer: String(formData.get('answer') ?? '').trim(),
    });
  if (!parsed.success) return { status: 'error' };

  const { supabase, section } = await readableSection(parsed.data.sectionId);
  if (!section) return { status: 'error' };

  // Only blocks that accept answers, and only their real inputs.
  const block = parseBlocksForRender(section.blocks).find((b) => b?.id === parsed.data.blockId);
  if (!block || parsed.data.itemIndex >= answerSlots(block)) return { status: 'error' };

  const key = {
    user_id: user.id,
    section_id: section.id,
    block_id: parsed.data.blockId,
    item_index: parsed.data.itemIndex,
  };
  // Update, then insert if there was nothing to update. Students may change
  // only the answer text of a saved row, so an upsert (which rewrites every
  // column) is not allowed by the column grants.
  const error = parsed.data.answer
    ? await writeAnswer(supabase, key, section.course_id, parsed.data.answer)
    : (await supabase.from('block_responses').delete().match(key)).error;
  if (error) return { status: 'error' };

  await ensureProgress(supabase, user.id, section, parsed.data.blockId);
  return { status: 'saved' };
}

async function writeAnswer(
  supabase: Awaited<ReturnType<typeof readableSection>>['supabase'],
  key: { user_id: string; section_id: string; block_id: string; item_index: number },
  courseId: string,
  answer: string,
) {
  const updated = await supabase
    .from('block_responses')
    .update({ answer })
    .match(key)
    .select('block_id');
  if (updated.error || updated.data.length > 0) return updated.error;
  const inserted = await supabase
    .from('block_responses')
    .insert({ ...key, course_id: courseId, answer });
  // Saved from another tab at the same moment: update the row it created.
  if (inserted.error?.code === '23505') {
    return (await supabase.from('block_responses').update({ answer }).match(key)).error;
  }
  return inserted.error;
}

export async function finishSection(formData: FormData): Promise<void> {
  const user = await requireArea('learn');
  const id = sectionId.safeParse(formData.get('sectionId'));
  if (!id.success) return;
  const { supabase, section } = await readableSection(id.data);
  if (!section) return;
  await ensureProgress(supabase, user.id, section, null);
  const { data } = await supabase
    .from('section_progress')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('book_section_id', section.id)
    .neq('status', 'completed')
    .select('status');
  if (data?.length) {
    await recordLearningEvent(user, 'section_completed', {
      courseId: section.course_id,
      cycleId: section.cycle_id,
      sectionId: section.id,
    });
  }
  revalidatePath('/learn', 'layout');
}
