import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Flashcards } from '@/content/player/Flashcards';
import { reviewWord } from '@/server/actions/vocabulary';
import { requireArea } from '@/server/auth/session';
import { getVocabularySession } from '@/server/queries/vocabulary';
import { CourseSwitcher } from '@/ui/CourseSwitcher';
import { EmptyState, PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('vocabulary');
  return { title: t('title') };
}

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireArea('learn');
  const [{ course: requested }, t, td, format] = await Promise.all([
    searchParams,
    getTranslations('vocabulary'),
    getTranslations('learn.dashboard'),
    getFormatter(),
  ]);
  const session = await getVocabularySession(user, requested);
  const { course } = session;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
        {session.courses.length > 1 && course ? (
          <CourseSwitcher
            action="/learn/vocabulary"
            label={td('courseSwitcher')}
            submitLabel={td('continueCta')}
            current={course.courseId}
            courses={session.courses.map((c) => ({ id: c.courseId, title: c.courseTitle }))}
          />
        ) : null}
      </div>
      {!course || session.total === 0 ? (
        <EmptyState title={t('empty')}>{t('emptyBody')}</EmptyState>
      ) : (
        <>
          <p className="text-fg-secondary">
            {t('summary', { total: session.total, strong: session.strong })}
          </p>
          {session.cards.length ? (
            <>
              <p className="text-sm text-muted">{t('how')}</p>
              <Flashcards
                cards={session.cards}
                termLang={course.languageCode}
                glossLang={session.instructionLang}
                rate={reviewWord}
              />
            </>
          ) : (
            <EmptyState title={t('nothingDue')}>
              {session.nextDueAt
                ? t('nextDue', {
                    date: format.dateTime(new Date(session.nextDueAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: user.timezone,
                    }),
                  })
                : null}
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
