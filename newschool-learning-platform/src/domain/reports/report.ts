// "Report a mistake" (ADR-040): what a student sends about a question, an
// exercise or a notebook page. The same limits are enforced by the database
// (content_reports checks and its insert trigger); these give a clear message
// before a round trip.

import { z } from 'zod';

export const REPORT_MESSAGE_MAX = 500;
export const REPORT_SUGGESTION_MAX = 300;
/** Reports one student may send per rolling hour (app.content_reports_per_hour()). */
export const REPORTS_PER_HOUR = 10;

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(uuid.optional());

export const reportInputSchema = z
  .object({
    activityId: optionalUuid,
    itemId: optionalUuid,
    sectionId: optionalUuid,
    message: z.string().trim().min(1).max(REPORT_MESSAGE_MAX),
    suggestedAnswer: z.string().trim().max(REPORT_SUGGESTION_MAX).default(''),
  })
  .refine((r) => Boolean(r.activityId) !== Boolean(r.sectionId), {
    message: 'A report is about an exercise or a page',
  })
  .refine((r) => !r.itemId || Boolean(r.activityId), {
    message: 'A question is reported with its exercise',
  });

export type ReportInput = z.infer<typeof reportInputSchema>;

/** What the report form shows after sending. */
export type ReportState =
  { status: 'idle' } | { status: 'sent'; message: string } | { status: 'error'; message: string };

/** Read a report from a submitted form (empty fields are absent). */
export function parseReportForm(form: { get(name: string): FormDataEntryValue | null }) {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  return reportInputSchema.safeParse({
    activityId: text('activityId'),
    itemId: text('itemId'),
    sectionId: text('sectionId'),
    message: text('message') ?? '',
    suggestedAnswer: text('suggestedAnswer') ?? '',
  });
}
