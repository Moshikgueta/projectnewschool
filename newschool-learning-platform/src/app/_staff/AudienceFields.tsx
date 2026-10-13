'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

export type AudienceStudent = { id: string; name: string };

const CHOICE =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-[0.9375rem] has-checked:border-primary has-checked:bg-primary-light has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary';

/**
 * "Who gets it": the whole group (default) or selected students of it. Sends
 * `audience` ('group' | 'selected') and one `studentId` per ticked student.
 * The server checks the students again, and the database refuses anyone not
 * enrolled in the group (ADR-039).
 */
export function AudienceFields({
  students,
  idPrefix,
}: {
  students: AudienceStudent[];
  idPrefix: string;
}) {
  const t = useTranslations('assignAudience');
  const [selected, setSelected] = useState(false);
  const listId = useId();
  const ref = useRef<HTMLFieldSetElement>(null);
  // The radios are uncontrolled, so a form reset (React resets a form after
  // its action) puts them back on "all students"; follow it here too.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const reset = () => setSelected(false);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [students.length]);
  if (students.length === 0) return <input type="hidden" name="audience" value="group" />;
  return (
    <fieldset ref={ref} className="flex flex-col gap-3">
      <legend className="mb-2 text-[0.9375rem] font-medium text-fg">{t('who')}</legend>
      <div className="flex flex-wrap gap-2">
        <label className={CHOICE}>
          <input
            type="radio"
            name="audience"
            value="group"
            defaultChecked
            onChange={() => setSelected(false)}
            className="size-4 accent-primary"
          />
          {t('group')}
        </label>
        <label className={CHOICE}>
          <input
            type="radio"
            name="audience"
            value="selected"
            onChange={() => setSelected(true)}
            aria-controls={listId}
            className="size-4 accent-primary"
          />
          {t('selected')}
        </label>
      </div>
      <fieldset id={listId} hidden={!selected} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-fg-secondary">{t('choose')}</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {students.map((s) => (
            <li key={s.id}>
              <label className={CHOICE}>
                <input
                  type="checkbox"
                  name="studentId"
                  value={s.id}
                  id={`${idPrefix}-student-${s.id}`}
                  disabled={!selected}
                  className="size-4 accent-primary"
                />
                <bdi>{s.name}</bdi>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </fieldset>
  );
}
