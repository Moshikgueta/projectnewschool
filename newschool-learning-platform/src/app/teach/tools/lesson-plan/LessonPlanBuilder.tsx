'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  buildLessonPrompt,
  CEFR_LEVELS,
  CYCLE_LEVELS,
  PLAN_DEFAULTS,
  PLAN_FOCUS,
  PLAN_LANGUAGES,
  PLAN_LIMITS,
  PLAN_MODES,
  planFromGroup,
  type LessonPlanInput,
  type PlanLanguage,
} from '@/domain/staff/lesson-plan';
import type { PlannerGroup } from '@/server/queries/staff';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

/**
 * The form and its prompt, side by side. Everything happens in the browser:
 * no request is made, nothing is stored. The teacher copies the prompt.
 */
export function LessonPlanBuilder({ groups }: { groups: PlannerGroup[] }) {
  const t = useTranslations('staff.plan');
  const locale = useLocale();
  const [plan, setPlan] = useState<LessonPlanInput>(PLAN_DEFAULTS);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const prompt = useMemo(() => buildLessonPrompt(plan), [plan]);
  const set = <K extends keyof LessonPlanInput>(key: K, value: LessonPlanInput[K]) => {
    setPlan((p) => ({ ...p, [key]: value }));
    setCopied('idle');
  };
  const languageName = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    return (code: string) => names.of(code) ?? code;
  }, [locale]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }

  const textarea = 'rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-fg';

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        {groups.length ? (
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">{t('fromGroup')}</h2>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <Button
                  key={g.id}
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPlan((p) => ({ ...p, ...planFromGroup(g) }));
                    setCopied('idle');
                  }}
                >
                  {g.name}
                </Button>
              ))}
            </div>
          </Card>
        ) : null}

        <Card className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="plan-language"
            label={t('language')}
            value={plan.language}
            onChange={(e) => set('language', e.target.value as PlanLanguage)}
            options={(Object.keys(PLAN_LANGUAGES) as PlanLanguage[])
              .map((code) => ({ value: code, label: languageName(code) }))
              .sort((a, b) => a.label.localeCompare(b.label, locale))}
          />
          <SelectField
            id="plan-focus"
            label={t('focus')}
            value={plan.focus}
            onChange={(e) => set('focus', e.target.value as LessonPlanInput['focus'])}
            options={PLAN_FOCUS.map((f) => ({ value: f, label: t(`focuses.${f}`) }))}
          />
          <SelectField
            id="plan-cycle"
            label={t('cycle')}
            value={String(plan.cycle)}
            onChange={(e) => set('cycle', Number(e.target.value) as LessonPlanInput['cycle'])}
            options={CYCLE_LEVELS.map((n) => ({
              value: String(n),
              label: t('cycleOption', { n }),
            }))}
          />
          <SelectField
            id="plan-cefr"
            label={t('cefr')}
            value={plan.cefr}
            onChange={(e) => set('cefr', e.target.value as LessonPlanInput['cefr'])}
            options={CEFR_LEVELS.map((c) => ({ value: c, label: c }))}
          />
          <SelectField
            id="plan-mode"
            label={t('mode')}
            value={plan.mode}
            onChange={(e) => set('mode', e.target.value as LessonPlanInput['mode'])}
            options={PLAN_MODES.map((m) => ({ value: m, label: t(`modes.${m}`) }))}
          />
          {plan.mode === 'group' ? (
            <TextField
              id="plan-size"
              type="number"
              min={1}
              max={99}
              label={t('size')}
              value={plan.size}
              onChange={(e) => set('size', e.target.value.slice(0, PLAN_LIMITS.size))}
            />
          ) : null}
          <TextField
            id="plan-topic"
            className="sm:col-span-2"
            label={t('topic')}
            placeholder={t('topicPlaceholder')}
            maxLength={PLAN_LIMITS.topic}
            value={plan.topic}
            onChange={(e) => set('topic', e.target.value)}
            required
          />
          <TextField
            id="plan-last"
            className="sm:col-span-2"
            label={t('last')}
            maxLength={PLAN_LIMITS.last}
            value={plan.last}
            onChange={(e) => set('last', e.target.value)}
          />
          <TextField
            id="plan-materials"
            className="sm:col-span-2"
            label={t('materials')}
            maxLength={PLAN_LIMITS.materials}
            value={plan.materials}
            onChange={(e) => set('materials', e.target.value)}
          />
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="plan-notes" className="text-[0.9375rem] font-medium">
              {t('notes')}
            </label>
            <textarea
              id="plan-notes"
              rows={3}
              maxLength={PLAN_LIMITS.notes}
              value={plan.notes}
              onChange={(e) => set('notes', e.target.value)}
              className={textarea}
            />
          </div>
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-2 text-[0.9375rem] font-medium">{t('extras')}</legend>
            {(
              [
                ['check', 'check'],
                ['homework', 'homework'],
                ['variations', 'variations'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
                <input
                  type="checkbox"
                  checked={plan[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="size-5 accent-primary"
                />
                {t(`extrasOptions.${label}`)}
              </label>
            ))}
          </fieldset>
        </Card>
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <label htmlFor="plan-prompt" className="font-semibold">
          {t('prompt')}
        </label>
        <p id="plan-prompt-hint" className="text-sm text-muted">
          {t('promptHint')}
        </p>
        <textarea
          id="plan-prompt"
          readOnly
          dir="rtl"
          lang="he"
          rows={22}
          value={prompt}
          aria-describedby="plan-prompt-hint"
          className={`${textarea} text-[0.9375rem] leading-relaxed`}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={copy}>
            {t('copy')}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            onClick={() => {
              setPlan(PLAN_DEFAULTS);
              setCopied('idle');
            }}
          >
            {t('reset')}
          </Button>
        </div>
        <div aria-live="polite">
          {copied === 'ok' ? <Alert tone="success">{t('copied')}</Alert> : null}
          {copied === 'failed' ? <Alert tone="error">{t('copyFailed')}</Alert> : null}
        </div>
        <p className="text-sm text-fg-secondary">{t('after')}</p>
      </div>
    </div>
  );
}
