import 'server-only';
import { z } from 'zod';
import type { Database } from '@/server/db.types';
import type { createSupabaseServerClient } from '@/server/supabase/server';

// Giving homework to the whole group or to selected students of it (ADR-039),
// shared by the teacher's and the office's assign actions. Written with the
// caller's own session: RLS decides who may give homework and choose
// recipients, and a trigger refuses any recipient who is not a student of the
// group. The checks here only give clear messages.

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type AssignmentInsert = Database['public']['Tables']['assignments']['Insert'];

export type Audience = { audience: 'group' } | { audience: 'selected'; studentIds: string[] };

const audienceForm = z.discriminatedUnion('audience', [
  z.object({ audience: z.literal('group') }),
  z.object({
    audience: z.literal('selected'),
    studentIds: z.array(z.uuid()).max(500),
  }),
]);

/**
 * Who the form gives the homework to. A missing `audience` means the whole
 * group (the default). Null if the form is malformed.
 */
export function readAudience(formData: FormData): Audience | null {
  const parsed = audienceForm.safeParse({
    audience: formData.get('audience') ?? 'group',
    studentIds: formData.getAll('studentId'),
  });
  if (!parsed.success) return null;
  if (parsed.data.audience === 'group') return { audience: 'group' };
  return { audience: 'selected', studentIds: [...new Set(parsed.data.studentIds)] };
}

export type GiveResult = 'ok' | 'noStudents' | 'notInGroup' | 'notAllowed' | 'failed';

/**
 * Insert the assignment and, for selected students, its recipients. If the
 * recipients cannot be written, the assignment is removed again, so nobody is
 * left with homework addressed to no one.
 */
export async function giveHomework(
  supabase: Client,
  row: Omit<AssignmentInsert, 'audience'>,
  audience: Audience,
): Promise<GiveResult> {
  if (audience.audience === 'selected') {
    if (audience.studentIds.length === 0) return 'noStudents';
    const { data: enrolled, error } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('group_id', row.group_id)
      .in('student_id', audience.studentIds)
      .in('status', ['active', 'paused']);
    if (error) return 'failed';
    if (enrolled.length !== audience.studentIds.length) return 'notInGroup';
  }

  const { data: created, error } = await supabase
    .from('assignments')
    .insert({ ...row, audience: audience.audience })
    .select('id')
    .single();
  if (error || !created) return error?.code === '42501' ? 'notAllowed' : 'failed';
  if (audience.audience === 'group') return 'ok';

  const recipients = await supabase
    .from('assignment_recipients')
    .insert(audience.studentIds.map((student_id) => ({ assignment_id: created.id, student_id })));
  if (recipients.error) {
    await supabase.from('assignments').delete().eq('id', created.id);
    if (recipients.error.code === '23514') return 'notInGroup';
    return recipients.error.code === '42501' ? 'notAllowed' : 'failed';
  }
  return 'ok';
}
