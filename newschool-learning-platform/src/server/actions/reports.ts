'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { parseReportForm, type ReportState } from '@/domain/reports/report';
import { requireArea } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

// "Report a mistake" (ADR-040). Every write uses the caller's own session, so
// RLS decides again: a student reports only content they can see, in their
// own name, at most 10 times an hour (database trigger); teachers of the
// course and the pedagogical manager (MFA) resolve reports, in their own name.

type Key = 'sent' | 'invalid' | 'notAllowed' | 'tooMany' | 'failed';

async function say(key: Key): Promise<ReportState> {
  const t = await getTranslations('reports.messages');
  return key === 'sent'
    ? { status: 'sent', message: t(key) }
    : { status: 'error', message: t(key) };
}

export async function reportMistake(_prev: ReportState, formData: FormData): Promise<ReportState> {
  await requireArea('learn');
  const parsed = parseReportForm(formData);
  if (!parsed.success) return say('invalid');
  const report = parsed.data;
  const supabase = await createSupabaseServerClient();

  // The course comes from the content itself, read with the student's own
  // session: content they cannot see comes back empty.
  const { data: target } = report.activityId
    ? await supabase
        .from('activities')
        .select('course_id')
        .eq('id', report.activityId)
        .maybeSingle()
    : await supabase
        .from('book_sections')
        .select('course_id')
        .eq('id', report.sectionId!)
        .maybeSingle();
  if (!target) return say('notAllowed');

  const { error } = await supabase.from('content_reports').insert({
    course_id: target.course_id,
    activity_id: report.activityId ?? null,
    item_id: report.itemId ?? null,
    book_section_id: report.sectionId ?? null,
    message: report.message,
    suggested_answer: report.suggestedAnswer,
  });
  if (error) {
    if (error.code === 'PT429') return say('tooMany');
    if (error.code === '42501') return say('notAllowed');
    if (error.code === '23514') return say('invalid');
    return say('failed');
  }
  revalidatePath('/manage/reports');
  revalidatePath('/teach/reports');
  return say('sent');
}

const statusSchema = z.object({ id: z.uuid(), status: z.enum(['open', 'resolved']) });

async function setStatus(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  // Who resolved it, and when, is set by the database (in the caller's name).
  await supabase
    .from('content_reports')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id);
  revalidatePath('/manage/reports');
  revalidatePath('/teach/reports');
}

/** The pedagogical manager (MFA) resolves or reopens a report. */
export async function setReportStatusAsManager(formData: FormData): Promise<void> {
  await requireArea('manage');
  await setStatus(formData);
}

/** A teacher resolves or reopens a report about a course they teach. */
export async function setReportStatusAsTeacher(formData: FormData): Promise<void> {
  await requireArea('teach');
  await setStatus(formData);
}
