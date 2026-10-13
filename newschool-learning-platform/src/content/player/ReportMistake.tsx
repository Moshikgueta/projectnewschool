'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import {
  REPORT_MESSAGE_MAX,
  REPORT_SUGGESTION_MAX,
  type ReportState,
} from '@/domain/reports/report';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { TextField } from '@/ui/TextField';

export type ReportAction = (prev: ReportState, formData: FormData) => Promise<ReportState>;

const initial: ReportState = { status: 'idle' };

/**
 * "Report a mistake" (ADR-040): a quiet button that opens a short form about
 * one question of an exercise, or one notebook page. The report goes to the
 * course's teachers and the pedagogical team; the student's name is never
 * shown to other students.
 */
export function ReportMistake({
  action,
  activityId,
  itemId,
  sectionId,
}: {
  action: ReportAction;
  activityId?: string;
  itemId?: string;
  sectionId?: string;
}) {
  const t = useTranslations('reports.form');
  const [state, formAction, pending] = useActionState(action, initial);
  const id = useId();

  return (
    <Dialog trigger={t('trigger')} title={t('title')} closeLabel={t('close')} triggerStyle="quiet">
      {state.status === 'sent' ? (
        <Alert tone="success">{state.message}</Alert>
      ) : (
        <form action={formAction} className="flex flex-col gap-4 text-fg" noValidate>
          <p className="text-sm text-fg-secondary">{t('intro')}</p>
          {activityId ? <input type="hidden" name="activityId" value={activityId} /> : null}
          {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
          {sectionId ? <input type="hidden" name="sectionId" value={sectionId} /> : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-message`} className="text-[0.9375rem] font-medium">
              {t('message')}
            </label>
            <p id={`${id}-message-hint`} className="text-sm text-muted">
              {t('messageHint', { max: REPORT_MESSAGE_MAX })}
            </p>
            <textarea
              id={`${id}-message`}
              name="message"
              required
              maxLength={REPORT_MESSAGE_MAX}
              rows={4}
              dir="auto"
              aria-describedby={`${id}-message-hint`}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
            />
          </div>
          <TextField
            id={`${id}-suggestion`}
            name="suggestedAnswer"
            label={t('suggestion')}
            maxLength={REPORT_SUGGESTION_MAX}
            dir="auto"
            autoComplete="off"
          />
          {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
          <Button type="submit" loading={pending} className="self-start">
            {t('send')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
