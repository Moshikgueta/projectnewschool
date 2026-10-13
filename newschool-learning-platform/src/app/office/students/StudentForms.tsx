'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ActionForm } from '@/app/manage/ActionForm';
import { LESSON_STATUSES, type LessonStatus } from '@/domain/office/packages';
import {
  addPackage,
  bookLesson,
  createStudent,
  issueCodeAsOffice,
  saveStudentRecord,
  setLessonStatus,
} from '@/server/actions/office-records';
import type { CodeState } from '@/server/actions/teach';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

export function NewStudentForm() {
  const t = useTranslations('office.students');
  return (
    <ActionForm action={createStudent} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField id="new-name" name="name" label={t('name')} required maxLength={120} />
          <TextField
            id="new-login-email"
            name="loginEmail"
            type="email"
            dir="ltr"
            label={t('loginEmail')}
            hint={t('loginEmailHint')}
          />
          <TextField id="new-phone" name="phone" type="tel" dir="ltr" label={t('phone')} />
          <TextField
            id="new-contact-email"
            name="contactEmail"
            type="email"
            dir="ltr"
            label={t('contactEmail')}
          />
          <Button type="submit" loading={pending} className="self-start sm:col-span-2">
            {t('create')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RecordForm({
  studentId,
  phone,
  contactEmail,
  officeNote,
}: {
  studentId: string;
  phone: string;
  contactEmail: string;
  officeNote: string;
}) {
  const t = useTranslations('office.student');
  return (
    <ActionForm action={saveStudentRecord} hidden={{ studentId }} className="flex flex-col gap-4">
      {(pending) => (
        <>
          <TextField
            id="record-phone"
            name="phone"
            type="tel"
            dir="ltr"
            label={t('phone')}
            defaultValue={phone}
          />
          <TextField
            id="record-email"
            name="contactEmail"
            type="email"
            dir="ltr"
            label={t('contactEmail')}
            defaultValue={contactEmail}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="record-note" className="text-[0.9375rem] font-medium">
              {t('officeNote')}
            </label>
            <textarea
              id="record-note"
              name="officeNote"
              defaultValue={officeNote}
              maxLength={2000}
              rows={3}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
            />
          </div>
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

const noCode: CodeState = { status: 'idle' };

export function OfficeCodeForm({ studentId }: { studentId: string }) {
  const t = useTranslations('office.student');
  const tg = useTranslations('teach.group');
  const [state, action, pending] = useActionState(issueCodeAsOffice, noCode);
  return (
    <form action={action} className="flex flex-col items-start gap-3" noValidate>
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-muted">{t('codeHint')}</p>
      <Button type="submit" variant="secondary" loading={pending}>
        {tg('newCode')}
      </Button>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === 'ok' ? (
        <Alert tone="success">
          <span dir="ltr" className="block font-mono text-lg font-semibold tracking-widest">
            {state.code}
          </span>
        </Alert>
      ) : null}
    </form>
  );
}

export function PackageForm({ studentId, today }: { studentId: string; today: string }) {
  const t = useTranslations('office.student');
  return (
    <ActionForm action={addPackage} hidden={{ studentId }} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField
            id="pkg-lessons"
            name="lessons"
            type="number"
            min={1}
            max={200}
            label={t('lessons')}
            required
          />
          <TextField
            id="pkg-minutes"
            name="minutes"
            type="number"
            min={15}
            max={240}
            step={5}
            defaultValue={60}
            label={t('minutes')}
          />
          <TextField
            id="pkg-starts"
            name="startsOn"
            type="date"
            defaultValue={today}
            label={t('startsOn')}
            required
          />
          <TextField id="pkg-expires" name="expiresOn" type="date" label={t('expiresOn')} />
          <TextField
            id="pkg-price"
            name="price"
            type="number"
            min={0}
            step="0.01"
            label={t('priceField')}
          />
          <TextField id="pkg-note" name="note" maxLength={500} label={t('note')} />
          <label className="flex min-h-11 items-center gap-2 text-[0.9375rem] sm:col-span-2">
            <input type="checkbox" name="paid" className="size-5 accent-primary" />
            {t('paidNow')}
          </label>
          <Button type="submit" loading={pending} className="self-start sm:col-span-2">
            {t('addPackageButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function BookLessonForm({
  studentId,
  teachers,
}: {
  studentId: string;
  teachers: { id: string; name: string }[];
}) {
  const t = useTranslations('office.student');
  return (
    <ActionForm action={bookLesson} hidden={{ studentId }} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <SelectField
            id="lesson-teacher"
            name="teacherId"
            label={t('teacher')}
            options={teachers.map((x) => ({ value: x.id, label: x.name }))}
          />
          <TextField
            id="lesson-starts"
            name="startsAt"
            type="datetime-local"
            label={t('startsAt')}
            required
          />
          <TextField
            id="lesson-minutes"
            name="minutes"
            type="number"
            min={15}
            max={240}
            step={5}
            defaultValue={60}
            label={t('duration')}
          />
          <SelectField
            id="lesson-package"
            name="usePackage"
            label={t('package')}
            options={[
              { value: 'auto', label: t('packageAuto') },
              { value: 'none', label: t('packageNone') },
            ]}
          />
          <TextField id="lesson-note" name="note" maxLength={500} label={t('note')} />
          <Button type="submit" loading={pending} className="self-start sm:col-span-2">
            {t('bookButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function LessonStatusForm({
  lessonId,
  current,
  allowed,
  dateLabel,
}: {
  lessonId: string;
  current: LessonStatus;
  allowed: LessonStatus[];
  dateLabel: string;
}) {
  const t = useTranslations('office.student');
  return (
    <ActionForm
      action={setLessonStatus}
      hidden={{ lessonId }}
      className="flex flex-wrap items-end gap-2"
    >
      {(pending) => (
        <>
          <SelectField
            id={`status-${lessonId}`}
            name="status"
            label={t('statusLabel', { date: dateLabel })}
            defaultValue={current}
            options={LESSON_STATUSES.filter((s) => allowed.includes(s) || s === current).map(
              (s) => ({ value: s, label: t(`status.${s}`) }),
            )}
          />
          <Button type="submit" variant="secondary" loading={pending}>
            {t('setStatus')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
