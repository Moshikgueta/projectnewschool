import { getLocale, getTranslations } from 'next-intl/server';
import type { Feedback } from '@/server/queries/staff';
import { Badge } from '@/ui/Card';

const WORRY = new Set(['needs_attention', 'problematic']);

/** What a piece of feedback is about, as badges: kind, subject, verdict, language and level. */
export async function FeedbackBadges({ feedback: f }: { feedback: Feedback }) {
  const [t, locale] = await Promise.all([getTranslations('staff.feedback'), getLocale()]);
  const language = f.languageCode
    ? (new Intl.DisplayNames([locale], { type: 'language' }).of(f.languageCode) ?? f.languageCode)
    : null;
  const subject =
    f.kind === 'student'
      ? f.studentName
      : f.kind === 'missing_material'
        ? t(`gaps.${f.subject as 'listening'}`)
        : f.subject;
  return (
    <p className="flex flex-wrap items-center gap-2">
      <Badge tone="brand">{t(`kinds.${f.kind}`)}</Badge>
      {subject ? <bdi className="font-medium">{subject}</bdi> : null}
      {f.verdict ? (
        <Badge tone={WORRY.has(f.verdict) ? 'warning' : 'neutral'}>
          {t(`verdicts.${f.verdict as 'on_track'}`)}
        </Badge>
      ) : null}
      {language ? <Badge>{language}</Badge> : null}
      {f.level ? <Badge>{t('levelOption', { n: f.level })}</Badge> : null}
    </p>
  );
}
