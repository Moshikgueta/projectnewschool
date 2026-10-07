import 'server-only';
import { nextDue, sessionCards } from '@/domain/learning/leitner';
import type { SessionUser } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { listMyCourses, type MyCourse } from './student';

export type Card = { id: string; term: string; gloss: string; example: string; position: number };

export type VocabularySession = {
  courses: MyCourse[];
  course: MyCourse | null;
  cards: Card[];
  total: number;
  /** Words in box 4 or 5: reviewed successfully several times. */
  strong: number;
  nextDueAt: string | null;
  instructionLang: string;
};

/**
 * Today's flashcards for one course: due words, then new ones. RLS limits
 * words to published sets of the student's courses, and review state to
 * the student's own rows.
 */
export async function getVocabularySession(
  user: SessionUser,
  requestedCourseId: string | undefined,
  now = new Date(),
): Promise<VocabularySession> {
  const courses = await listMyCourses(user.id);
  const course = courses.find((c) => c.courseId === requestedCourseId) ?? courses[0] ?? null;
  const empty = {
    courses,
    course,
    cards: [],
    total: 0,
    strong: 0,
    nextDueAt: null,
    instructionLang: 'he',
  };
  if (!course) return empty;

  const supabase = await createSupabaseServerClient();
  const [items, states, info] = await Promise.all([
    supabase
      .from('vocabulary_items')
      .select('id, term, gloss, example, position, set:vocabulary_sets ( created_at )')
      .eq('course_id', course.courseId),
    supabase
      .from('vocab_review_state')
      .select('vocabulary_item_id, box, due_at')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
    supabase.from('courses').select('instruction_locale').eq('id', course.courseId).maybeSingle(),
  ]);
  if (items.error) throw new Error(`Could not load vocabulary: ${items.error.message}`);
  if (states.error) throw new Error(`Could not load reviews: ${states.error.message}`);

  // Course order: sets in the order they were added, words in their position.
  const words = [...items.data]
    .sort(
      (a, b) =>
        (a.set?.created_at ?? '').localeCompare(b.set?.created_at ?? '') || a.position - b.position,
    )
    .map((w, i) => ({ id: w.id, term: w.term, gloss: w.gloss, example: w.example, position: i }));
  const byWord = new Map(
    states.data.map((s) => [s.vocabulary_item_id, { dueAt: new Date(s.due_at), box: s.box }]),
  );

  return {
    courses,
    course,
    cards: sessionCards(words, byWord, now),
    total: words.length,
    strong: states.data.filter((s) => s.box >= 4).length,
    nextDueAt: nextDue(byWord.values(), now)?.toISOString() ?? null,
    instructionLang: info.data?.instruction_locale ?? 'he',
  };
}
