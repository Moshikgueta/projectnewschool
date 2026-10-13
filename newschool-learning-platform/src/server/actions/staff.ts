'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import type { ManageState } from '@/server/actions/manage';
import type { Database } from '@/server/db.types';
import { requireArea } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Staff tools (stage E). Every write uses the caller's own session, so RLS
// decides again: feedback in your own name about students you teach, links
// kept by the manager, tasks sent to a pedagogical manager and done by them.

const uuid = z.uuid();
type Key = 'saved' | 'sent' | 'invalid' | 'notAllowed' | 'failed';

async function say(key: Key): Promise<ManageState> {
  const t = await getTranslations('staff.messages');
  return key === 'saved' || key === 'sent'
    ? { status: 'ok', message: t(key) }
    : { status: 'error', message: t(key) };
}

function refresh() {
  for (const path of [
    '/teach/tools/feedback',
    '/teach/tools/resources',
    '/teach/tools/tasks',
    '/manage/feedback',
    '/manage/resources',
    '/manage/tasks',
    '/office/tasks',
  ] as const) {
    revalidatePath(path);
  }
}

const body = z.string().trim().min(1).max(2000);
const feedbackSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('student'),
    studentId: uuid,
    verdict: z.enum(['ahead', 'on_track', 'needs_attention']),
    body,
  }),
  z.object({
    kind: z.literal('material'),
    subject: z.string().trim().min(1).max(200),
    verdict: z.enum(['works_well', 'works_with_changes', 'problematic']),
    languageCode: z.union([z.literal(''), z.string().regex(/^[a-z]{2,3}$/)]),
    level: z.union([z.literal(''), z.coerce.number().int().min(1).max(3)]),
    body,
  }),
  z.object({
    kind: z.literal('missing_material'),
    subject: z.enum([
      'grammar_practice',
      'listening',
      'speaking',
      'reading',
      'game_warmup',
      'tests',
      'homework',
    ]),
    languageCode: z.union([z.literal(''), z.string().regex(/^[a-z]{2,3}$/)]),
    level: z.union([z.literal(''), z.coerce.number().int().min(1).max(3)]),
    body,
  }),
]);

/** Feedback to the pedagogical manager: about a student, a material, or what is missing. */
export async function sendFeedback(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('teach');
  const field = (name: string) => formData.get(name) ?? '';
  const parsed = feedbackSchema.safeParse({
    kind: field('kind'),
    studentId: field('studentId'),
    subject: field(formData.get('kind') === 'missing_material' ? 'gap' : 'subject'),
    verdict: field('verdict'),
    languageCode: field('languageCode'),
    level: field('level'),
    body: field('body'),
  });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const row: Database['public']['Tables']['staff_feedback']['Insert'] =
    v.kind === 'student'
      ? { kind: v.kind, student_id: v.studentId, verdict: v.verdict, body: v.body }
      : {
          kind: v.kind,
          subject: v.subject,
          verdict: v.kind === 'material' ? v.verdict : null,
          language_code: v.languageCode || null,
          level: v.level === '' ? null : v.level,
          body: v.body,
        };
  const supabase = await createSupabaseServerClient();
  // author_id defaults to the caller in the database; RLS checks it, and that
  // a student named here is one the caller teaches.
  const { error } = await supabase.from('staff_feedback').insert(row);
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh();
  return say('sent');
}

export async function withdrawFeedback(formData: FormData): Promise<void> {
  await requireArea('teach');
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from('staff_feedback').delete().eq('id', id.data);
  refresh();
}

export async function markFeedbackHandled(formData: FormData): Promise<void> {
  const manager = await requireArea('manage');
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('staff_feedback')
    .update({ handled_at: new Date().toISOString(), handled_by: manager.id })
    .eq('id', id.data)
    .is('handled_at', null);
  refresh();
}

export async function addResource(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(160),
      // https only; the database checks the same.
      url: z
        .url({ protocol: /^https$/ })
        .max(2000)
        .refine((u) => !/[\s<>"]/.test(u)),
      description: z.string().trim().max(500),
    })
    .safeParse({
      title: formData.get('title'),
      url: (formData.get('url') ?? '').toString().trim(),
      description: formData.get('description') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('staff_resources').insert(parsed.data);
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh();
  return say('saved');
}

export async function removeResource(formData: FormData): Promise<void> {
  await requireArea('manage');
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from('staff_resources').delete().eq('id', id.data);
  refresh();
}

/** Tasks work from three areas; the form says which, and that area's guard applies. */
const area = z.enum(['teach', 'office', 'manage']);

export async function sendTask(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const where = area.safeParse(formData.get('area'));
  if (!where.success) return say('invalid');
  await requireArea(where.data);
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      note: z.string().trim().max(1000),
      priority: z.enum(['normal', 'urgent']),
      assigneeId: uuid,
    })
    .safeParse({
      title: formData.get('title'),
      note: formData.get('note') ?? '',
      priority: formData.get('priority') === 'urgent' ? 'urgent' : 'normal',
      assigneeId: formData.get('assigneeId'),
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('staff_tasks').insert({
    title: parsed.data.title,
    note: parsed.data.note,
    priority: parsed.data.priority,
    assignee_id: parsed.data.assigneeId,
  });
  if (error?.code === '23514') return say('invalid');
  if (error) return say(error.code === '42501' ? 'notAllowed' : 'failed');
  refresh();
  return say('sent');
}

export async function setTaskStatus(formData: FormData): Promise<void> {
  const where = area.safeParse(formData.get('area'));
  if (!where.success) return;
  await requireArea(where.data);
  const id = uuid.safeParse(formData.get('id'));
  const status = z.enum(['open', 'done']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('staff_tasks')
    .update({
      status: status.data,
      done_at: status.data === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', id.data);
  refresh();
}

export async function removeTask(formData: FormData): Promise<void> {
  const where = area.safeParse(formData.get('area'));
  if (!where.success) return;
  await requireArea(where.data);
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from('staff_tasks').delete().eq('id', id.data);
  refresh();
}
