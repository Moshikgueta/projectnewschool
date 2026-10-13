'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AudienceFields, type AudienceStudent } from '@/app/_staff/AudienceFields';
import { ActionForm } from '@/app/manage/ActionForm';
import type { ManageState } from '@/server/actions/manage';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

// Forms of the teacher's and the office's exercise pages (ADR-038). Each
// takes its area's own server action, so the same form never reaches another
// area's guard.

type Action = (prev: ManageState, formData: FormData) => Promise<ManageState>;

const PHASES = ['before_class', 'during_class', 'after_class', 'review', 'optional'] as const;
const SCORING = ['none', 'practice', 'scored'] as const;

export function NewExerciseForm({
  action,
  cycles,
  defaultCycleId,
}: {
  action: Action;
  cycles: { value: string; label: string }[];
  defaultCycleId: string | null;
}) {
  const t = useTranslations('exercises.list');
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField
            id="exercise-new-title"
            dir="auto"
            name="title"
            label={t('newName')}
            required
            maxLength={200}
          />
          <SelectField
            id="exercise-new-cycle"
            name="cycleId"
            label={t('cycle')}
            defaultValue={defaultCycleId ?? undefined}
            options={cycles}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('create')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ExerciseDetailsForm({
  action,
  activityId,
  title,
  phase,
  scoring,
  minutes,
}: {
  action: Action;
  activityId: string;
  title: string;
  phase: (typeof PHASES)[number];
  scoring: (typeof SCORING)[number];
  minutes: number | null;
}) {
  const t = useTranslations('cms.activity');
  const tc = useTranslations('cms');
  return (
    <ActionForm
      action={action}
      hidden={{ activityId }}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {(pending) => (
        <>
          <TextField
            id="activity-title"
            dir="auto"
            name="title"
            label={t('title')}
            defaultValue={title}
            required
            maxLength={200}
          />
          <SelectField
            id="activity-phase"
            name="phase"
            label={tc('section.phase')}
            defaultValue={phase}
            options={PHASES.map((p) => ({ value: p, label: tc(`phase.${p}`) }))}
          />
          <SelectField
            id="activity-scoring"
            name="scoring"
            label={t('scoring')}
            defaultValue={scoring}
            options={SCORING.map((s) => ({ value: s, label: t(`scoringOptions.${s}`) }))}
          />
          <TextField
            id="activity-minutes"
            name="minutes"
            type="number"
            min={1}
            max={240}
            label={t('minutes')}
            defaultValue={minutes ?? ''}
          />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {tc('section.saveDetails')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function AssignExerciseForm({
  action,
  activityId,
  groups,
}: {
  action: Action;
  activityId: string;
  /** Groups to give it to, each with the students that can be chosen by name. */
  groups: { id: string; name: string; students: AudienceStudent[] }[];
}) {
  const t = useTranslations('exercises.edit');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const students = groups.find((g) => g.id === groupId)?.students ?? [];
  return (
    <ActionForm action={action} hidden={{ activityId }} className="flex flex-col gap-3">
      {(pending) => (
        <>
          <SelectField
            id="assign-group"
            name="groupId"
            label={t('group')}
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="assign-due" name="dueDate" type="date" label={t('dueDate')} />
            <TextField id="assign-note" name="note" dir="auto" label={t('note')} maxLength={1000} />
          </div>
          {/* A new group starts again from "the whole group". */}
          <AudienceFields key={groupId} students={students} idPrefix="assign" />
          <Button type="submit" loading={pending} className="self-start">
            {t('assignButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
