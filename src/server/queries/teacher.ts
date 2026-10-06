import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type TaughtGroup = {
  id: string;
  name: string;
  courseTitle: string | null;
  studentCount: number;
};

export async function listTaughtGroups(teacherId: string): Promise<TaughtGroup[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('group_teachers')
    .select('group:groups ( id, name, course:courses ( title ), enrollments ( count ) )')
    .eq('teacher_id', teacherId);
  if (error) throw new Error(`Could not load groups: ${error.message}`);

  return (data ?? []).flatMap(({ group }) =>
    group
      ? [
          {
            id: group.id,
            name: group.name,
            courseTitle: group.course?.title ?? null,
            studentCount: group.enrollments[0]?.count ?? 0,
          },
        ]
      : [],
  );
}
