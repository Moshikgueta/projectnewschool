'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import {
  createActivity,
  createCycle,
  createSection,
  saveActivityMeta,
  saveCourse,
  saveCycle,
  saveSectionMeta,
} from '@/server/actions/cms';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

const STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
const PHASES = ['before_class', 'during_class', 'after_class', 'review', 'optional'] as const;
type Status = (typeof STATUSES)[number];

function StatusField({ id, value }: { id: string; value: Status }) {
  const t = useTranslations('cms');
  return (
    <SelectField
      id={id}
      name="status"
      label={t('statusLabel')}
      defaultValue={value}
      options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
    />
  );
}

function Area({
  id,
  name,
  label,
  value,
  max,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.9375rem] font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        dir="auto"
        defaultValue={value}
        maxLength={max}
        rows={3}
        className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
      />
    </div>
  );
}

export function CourseForm({
  courseId,
  title,
  description,
  status,
}: {
  courseId: string;
  title: string;
  description: string;
  status: Status;
}) {
  const t = useTranslations('cms.course');
  return (
    <ActionForm action={saveCourse} hidden={{ courseId }} className="flex flex-col gap-4">
      {(pending) => (
        <>
          <TextField
            id="course-title"
            dir="auto"
            name="title"
            label={t('title')}
            defaultValue={title}
            required
            maxLength={160}
          />
          <Area
            id="course-description"
            name="description"
            label={t('description')}
            value={description}
            max={2000}
          />
          <StatusField id="course-status" value={status} />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function NewCycleForm({ courseId }: { courseId: string }) {
  const t = useTranslations('cms.course');
  return (
    <ActionForm action={createCycle} hidden={{ courseId }} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField
            id="cycle-new-title"
            dir="auto"
            name="title"
            label={t('cycleTitle')}
            required
            maxLength={160}
          />
          <TextField
            id="cycle-new-slug"
            name="slug"
            dir="ltr"
            label={t('slug')}
            hint={t('slugHint')}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
          <TextField
            id="cycle-new-goal"
            dir="auto"
            name="goal"
            className="sm:col-span-2"
            label={t('goal')}
            maxLength={500}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('addCycle')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function CycleForm({
  cycleId,
  title,
  goal,
  status,
}: {
  cycleId: string;
  title: string;
  goal: string;
  status: Status;
}) {
  const t = useTranslations('cms.course');
  return (
    <ActionForm action={saveCycle} hidden={{ cycleId }} className="flex flex-col gap-4">
      {(pending) => (
        <>
          <TextField
            id="cycle-title"
            dir="auto"
            name="title"
            label={t('cycleTitle')}
            defaultValue={title}
            required
            maxLength={160}
          />
          <TextField
            id="cycle-goal"
            dir="auto"
            name="goal"
            label={t('goal')}
            defaultValue={goal}
            maxLength={500}
          />
          <StatusField id="cycle-status" value={status} />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function NewSectionForm({ cycleId }: { cycleId: string }) {
  const t = useTranslations('cms.cycle');
  const tc = useTranslations('cms');
  return (
    <ActionForm action={createSection} hidden={{ cycleId }} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField
            id="section-new-title"
            dir="auto"
            name="title"
            label={t('sectionTitle')}
            required
            maxLength={200}
          />
          <TextField
            id="section-new-slug"
            name="slug"
            dir="ltr"
            label={tc('course.slug')}
            hint={tc('course.slugHint')}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
          <SelectField
            id="section-new-book"
            name="book"
            label={t('book')}
            options={(['notebook', 'workbook'] as const).map((b) => ({
              value: b,
              label: tc(`books.${b}`),
            }))}
          />
          <SelectField
            id="section-new-phase"
            name="phase"
            label={t('phase')}
            defaultValue="during_class"
            options={PHASES.map((p) => ({ value: p, label: tc(`phase.${p}`) }))}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('addSection')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function SectionMetaForm({
  sectionId,
  title,
  phase,
  status,
}: {
  sectionId: string;
  title: string;
  phase: (typeof PHASES)[number];
  status: Status;
}) {
  const t = useTranslations('cms.section');
  const tc = useTranslations('cms');
  return (
    <ActionForm
      action={saveSectionMeta}
      hidden={{ sectionId }}
      className="grid gap-4 sm:grid-cols-3"
    >
      {(pending) => (
        <>
          <TextField
            id="section-title"
            dir="auto"
            name="title"
            label={t('title')}
            defaultValue={title}
            required
            maxLength={200}
          />
          <SelectField
            id="section-phase"
            name="phase"
            label={t('phase')}
            defaultValue={phase}
            options={PHASES.map((p) => ({ value: p, label: tc(`phase.${p}`) }))}
          />
          <StatusField id="section-status" value={status} />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('saveDetails')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

const SCORING = ['none', 'practice', 'scored'] as const;

export function ActivityMetaForm({
  activityId,
  title,
  phase,
  scoring,
  minutes,
  status,
}: {
  activityId: string;
  title: string;
  phase: (typeof PHASES)[number];
  scoring: (typeof SCORING)[number];
  minutes: number | null;
  status: Status;
}) {
  const t = useTranslations('cms.activity');
  const tc = useTranslations('cms');
  return (
    <ActionForm
      action={saveActivityMeta}
      hidden={{ activityId }}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
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
          <StatusField id="activity-status" value={status} />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {tc('section.saveDetails')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function NewActivityForm({ cycleId }: { cycleId: string }) {
  const t = useTranslations('cms.activity');
  const tc = useTranslations('cms.course');
  return (
    <ActionForm action={createActivity} hidden={{ cycleId }} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField
            id="activity-new-title"
            dir="auto"
            name="title"
            label={t('title')}
            required
            maxLength={200}
          />
          <TextField
            id="activity-new-slug"
            name="slug"
            dir="ltr"
            label={tc('slug')}
            hint={tc('slugHint')}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('add')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
