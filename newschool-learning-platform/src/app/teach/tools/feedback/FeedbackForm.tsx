'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionForm } from '@/app/manage/ActionForm';
import { sendFeedback } from '@/server/actions/staff';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

const KINDS = ['student', 'material', 'missing_material'] as const;
const STUDENT_VERDICTS = ['ahead', 'on_track', 'needs_attention'] as const;
const MATERIAL_VERDICTS = ['works_well', 'works_with_changes', 'problematic'] as const;
const GAPS = [
  'grammar_practice',
  'listening',
  'speaking',
  'reading',
  'game_warmup',
  'tests',
  'homework',
] as const;

/** The staff room's three feedback tabs, as one form whose fields follow the kind. */
export function FeedbackForm({
  students,
  languages,
}: {
  students: { id: string; name: string }[];
  languages: string[];
}) {
  const t = useTranslations('staff.feedback');
  const locale = useLocale();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('student');
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const languageOptions = [
    { value: '', label: t('anyLanguage') },
    ...languages.map((c) => ({ value: c, label: names.of(c) ?? c })),
  ];
  const levelOptions = [
    { value: '', label: t('anyLevel') },
    ...[1, 2, 3].map((n) => ({ value: String(n), label: t('levelOption', { n }) })),
  ];

  // The kind picker sits outside the form: a successful send resets the
  // form's fields, and a reset radio would no longer match the fields shown.
  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-[0.9375rem] font-medium">{t('kindLegend')}</legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <label
              key={k}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-[0.9375rem] has-checked:border-primary has-checked:bg-primary-light has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
            >
              <input
                type="radio"
                name="feedback-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="size-4 accent-primary"
              />
              {t(`kinds.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <ActionForm action={sendFeedback} hidden={{ kind }} className="flex flex-col gap-4">
        {(pending) => (
          <>
            {kind === 'student' ? (
              students.length ? (
                <>
                  <SelectField
                    id="fb-student"
                    name="studentId"
                    label={t('student')}
                    options={students.map((s) => ({ value: s.id, label: s.name }))}
                  />
                  <SelectField
                    id="fb-verdict"
                    name="verdict"
                    label={t('verdict')}
                    defaultValue="on_track"
                    options={STUDENT_VERDICTS.map((v) => ({ value: v, label: t(`verdicts.${v}`) }))}
                  />
                </>
              ) : (
                <p className="text-fg-secondary">{t('noStudents')}</p>
              )
            ) : null}

            {kind === 'material' ? (
              <>
                <TextField
                  id="fb-subject"
                  name="subject"
                  label={t('subject')}
                  maxLength={200}
                  required
                />
                <SelectField
                  id="fb-material-verdict"
                  name="verdict"
                  label={t('verdict')}
                  defaultValue="works_well"
                  options={MATERIAL_VERDICTS.map((v) => ({ value: v, label: t(`verdicts.${v}`) }))}
                />
              </>
            ) : null}

            {kind === 'missing_material' ? (
              <SelectField
                id="fb-gap"
                name="gap"
                label={t('gap')}
                options={GAPS.map((g) => ({ value: g, label: t(`gaps.${g}`) }))}
              />
            ) : null}

            {kind !== 'student' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="fb-language"
                  name="languageCode"
                  label={t('language')}
                  options={languageOptions}
                />
                <SelectField id="fb-level" name="level" label={t('level')} options={levelOptions} />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="fb-body" className="text-[0.9375rem] font-medium">
                {t('body')}
              </label>
              <textarea
                id="fb-body"
                name="body"
                required
                maxLength={2000}
                rows={4}
                dir="auto"
                className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
              />
            </div>
            <Button type="submit" loading={pending} className="self-start">
              {t('send')}
            </Button>
          </>
        )}
      </ActionForm>
    </div>
  );
}
