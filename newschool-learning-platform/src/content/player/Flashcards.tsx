'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/ui/Button';
import { ProgressBar } from '@/ui/Progress';

type Card = { id: string; term: string; gloss: string; example: string };

/**
 * Flashcards: see the word, try to remember it, show the meaning, then say
 * honestly whether you knew it. The server schedules the next review.
 */
export function Flashcards({
  cards: initialCards,
  termLang,
  glossLang,
  rate,
}: {
  cards: Card[];
  termLang: string;
  glossLang: string;
  rate: (itemId: string, knew: boolean) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations('vocabulary');
  // The deck is fixed for the session: a server refresh mid-session must not
  // reshuffle the cards under the student.
  const [cards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [knewCount, setKnewCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const card = cards[index];

  if (!card) {
    return (
      <div role="status" className="rounded-lg border border-border bg-surface p-6">
        <p className="text-lg font-semibold">{t('done')}</p>
        <p className="text-fg-secondary">
          {t('doneSummary', { knew: knewCount, total: cards.length })}
        </p>
      </div>
    );
  }

  function onRate(knew: boolean) {
    if (!card) return;
    startTransition(async () => {
      const result = await rate(card.id, knew);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      if (knew) setKnewCount((n) => n + 1);
      setShown(false);
      setIndex((i) => i + 1);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ProgressBar
        value={(index / cards.length) * 100}
        label={t('progress')}
        valueText={t('cardOf', { current: index + 1, total: cards.length })}
      />
      <section
        aria-labelledby="card-heading"
        className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface p-6 text-center"
      >
        <h2 id="card-heading" className="text-sm font-medium text-muted">
          {t('cardOf', { current: index + 1, total: cards.length })}
        </h2>
        <p lang={termLang} dir="auto" className="text-3xl font-semibold text-balance">
          {card.term}
        </p>
        <div aria-live="polite" className="flex flex-col items-center gap-1">
          {shown ? (
            <>
              <p lang={glossLang} dir="auto" className="text-xl text-fg-secondary">
                {card.gloss}
              </p>
              {card.example ? (
                <p lang={termLang} dir="auto" className="text-muted">
                  {card.example}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
      {failed ? (
        <p role="alert" className="font-medium text-error-ink">
          {t('failed')}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        {shown ? (
          <>
            <Button
              type="button"
              variant="secondary"
              loading={pending}
              onClick={() => onRate(false)}
            >
              {t('notYet')}
            </Button>
            <Button type="button" loading={pending} onClick={() => onRate(true)}>
              {t('knewIt')}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => setShown(true)}>
            {t('show')}
          </Button>
        )}
      </div>
    </div>
  );
}
