import 'server-only';
import type { SessionUser } from '@/server/auth/session';
import { recordLearningEvent } from '@/server/privileged/events';
import { createSupabaseServerClient } from '@/server/supabase/server';

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** A notebook section the signed-in user can read (RLS decides). */
export async function readableSection(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('book_sections')
    .select('id, course_id, cycle_id, blocks')
    .eq('id', id)
    .maybeSingle();
  return { supabase, section: data };
}

/**
 * Start the user's reading record for a section if there is none, otherwise
 * move the reading position. Writes with the user's own session, so RLS keeps
 * them to their own row (ADR-023). Returns true when the record was created.
 */
export async function ensureProgress(
  supabase: Client,
  userId: string,
  section: { id: string; course_id: string },
  lastBlockId: string | null,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('section_progress')
    .select('status')
    .eq('user_id', userId)
    .eq('book_section_id', section.id)
    .maybeSingle();
  if (!existing) {
    const { error } = await supabase.from('section_progress').insert({
      user_id: userId,
      book_section_id: section.id,
      course_id: section.course_id,
      status: 'in_progress',
      last_block_id: lastBlockId,
    });
    // A parallel request may have created it first; that is fine.
    return !error;
  }
  if (lastBlockId) {
    await supabase
      .from('section_progress')
      .update({ last_block_id: lastBlockId })
      .eq('user_id', userId)
      .eq('book_section_id', section.id);
  }
  return false;
}

/** Record that a student opened a section, once. Safe to call on every visit. */
export async function markSectionOpened(user: SessionUser, sectionId: string): Promise<void> {
  const { supabase, section } = await readableSection(sectionId);
  if (!section) return;
  if (await ensureProgress(supabase, user.id, section, null)) {
    await recordLearningEvent(user, 'section_opened', {
      courseId: section.course_id,
      cycleId: section.cycle_id,
      sectionId: section.id,
    });
  }
}
