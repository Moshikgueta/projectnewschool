import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type MyCourse = {
  groupId: string;
  groupName: string;
  courseId: string;
  courseTitle: string;
  levelTitle: string;
  languageName: string;
  languageCode: string;
  direction: 'ltr' | 'rtl';
};

/**
 * Courses the signed-in student can study: their active enrollments whose
 * course is published. RLS already hides other students' enrollments and
 * unpublished courses; a draft course comes back as `null` and is dropped.
 */
export async function listMyCourses(userId: string): Promise<MyCourse[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      `group:groups (
         id, name,
         course:courses ( id, title, level:levels ( title, language:languages ( name, code, direction ) ) )
       )`,
    )
    .eq('student_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(`Could not load courses: ${error.message}`);

  return (data ?? []).flatMap(({ group }) => {
    const course = group?.course;
    const language = course?.level?.language;
    if (!group || !course || !course.level || !language) return [];
    return [
      {
        groupId: group.id,
        groupName: group.name,
        courseId: course.id,
        courseTitle: course.title,
        levelTitle: course.level.title,
        languageName: language.name,
        languageCode: language.code,
        direction: language.direction,
      },
    ];
  });
}
