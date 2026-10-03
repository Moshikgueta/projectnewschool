import 'server-only';
import type { Database } from '@/server/db.types';
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

export type GroupDetail = {
  id: string;
  name: string;
  courseTitle: string | null;
  students: {
    id: string;
    displayName: string;
    status: Database['public']['Enums']['enrollment_status'];
  }[];
};

/**
 * A group the caller teaches (or manages). RLS returns nothing for any other
 * group, which the page turns into a 404.
 */
export async function getGroup(groupId: string): Promise<GroupDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('groups')
    .select(
      'id, name, course:courses ( title ), enrollments ( status, student:profiles ( id, display_name ) )',
    )
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`Could not load group: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    courseTitle: data.course?.title ?? null,
    students: data.enrollments.flatMap((e) =>
      e.student
        ? [{ id: e.student.id, displayName: e.student.display_name, status: e.status }]
        : [],
    ),
  };
}
