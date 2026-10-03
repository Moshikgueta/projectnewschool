import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { directionOf } from '@/domain/i18n/locales';
import { inlineToPlainText } from '../inline';
import type { Block, TeacherNote } from '../schema';
import { AnswerBox, type AnswerAction } from './AnswerBox';
import { CopyButton } from './CopyButton';
import { InlineText } from './InlineText';

export type GroupAnswer = { student: string; answer: string };

export type NotebookViewProps = {
  sectionId: string;
  blocks: (Block | null)[];
  /** Default language of blocks without their own `lang` (the course's target language). */
  courseLang: string;
  view: 'student' | 'teacher';
  /** Student view: the student's own saved answers, keyed "blockId:index". */
  answers?: Record<string, string>;
  answerAction?: AnswerAction;
  /** Teacher view: teacher-only notes and the group's answers, keyed "blockId:index". */
  notes?: TeacherNote[];
  groupAnswers?: Record<string, GroupAnswer[]>;
  aiTutorUrl: string | null;
  /** Titles of exercises referenced by `activity` blocks that the viewer can see. */
  activities?: Record<string, { title: string; minutes: number | null }>;
};

const CARD = 'rounded-lg border border-border bg-surface p-5';

/**
 * Renders a notebook section from its block document. One component for
 * both views: the teacher view adds anchored notes and the group's answers;
 * the student view adds the student's own optional answer boxes.
 */
export function NotebookView(props: NotebookViewProps) {
  const notesByAnchor = new Map<string | null, TeacherNote[]>();
  for (const note of props.view === 'teacher' ? (props.notes ?? []) : []) {
    notesByAnchor.set(note.anchor, [...(notesByAnchor.get(note.anchor) ?? []), note]);
  }
  return (
    <div className="flex flex-col gap-6">
      <TeacherNotes notes={notesByAnchor.get(null)} />
      {props.blocks.map((block, i) => (
        <div key={block?.id ?? `invalid-${i}`} className="flex flex-col gap-3">
          {block ? <BlockView block={block} {...props} /> : <Unavailable />}
          {block ? <TeacherNotes notes={notesByAnchor.get(block.id)} /> : null}
        </div>
      ))}
    </div>
  );
}

function Unavailable() {
  const t = useTranslations('notebook');
  return (
    <p className="rounded-md bg-surface-secondary px-4 py-3 text-sm text-muted">
      {t('unavailable')}
    </p>
  );
}

function TeacherNotes({ notes }: { notes: TeacherNote[] | undefined }) {
  const t = useTranslations('notebook');
  if (!notes?.length) return null;
  return (
    <aside aria-label={t('teacherNote')} className="flex flex-col gap-2">
      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-md border border-dashed border-warning bg-warning-light px-4 py-3 text-[0.9375rem] text-warning-ink"
        >
          <span className="font-semibold">{t('teacherNote')}</span>
          {note.minutes ? <span> · {t('minutes', { minutes: note.minutes })}</span> : null}
          <p className="mt-1">
            <InlineText text={note.text} />
          </p>
        </div>
      ))}
    </aside>
  );
}

function Answers({
  props,
  block,
  index,
  label,
  lang,
}: {
  props: NotebookViewProps;
  block: Block;
  index: number;
  label: string;
  lang: string;
}) {
  const t = useTranslations('notebook');
  const key = `${block.id}:${index}`;
  if (props.view === 'teacher') {
    const list = props.groupAnswers?.[key] ?? [];
    return (
      <details className="mt-2 rounded-md bg-surface-secondary px-3 py-2 text-[0.9375rem]">
        <summary className="cursor-pointer font-medium">
          {t('studentAnswers', { count: list.length })}
        </summary>
        {list.length === 0 ? (
          <p className="mt-2 text-muted">{t('noAnswers')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {list.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.student}:</span>{' '}
                <span lang={lang} dir="auto">
                  {a.answer}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    );
  }
  if (!props.answerAction) return null;
  return (
    <AnswerBox
      sectionId={props.sectionId}
      blockId={block.id}
      itemIndex={index}
      label={t('answerFor', { question: label })}
      initial={props.answers?.[key] ?? ''}
      action={props.answerAction}
      lang={lang}
    />
  );
}

function Wrap({
  lang,
  children,
  className = '',
}: {
  lang: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div lang={lang} dir={directionOf(lang)} className={className}>
      {children}
    </div>
  );
}

function BlockView({ block, ...props }: { block: Block } & NotebookViewProps) {
  const t = useTranslations('notebook');
  const lang = block.lang ?? props.courseLang;

  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4';
      const size = block.level === 2 ? 'text-2xl' : block.level === 3 ? 'text-xl' : 'text-lg';
      return (
        <Wrap lang={lang}>
          <Tag className={`${size} font-semibold text-balance text-fg`}>{block.text}</Tag>
        </Wrap>
      );
    }
    case 'text':
      return (
        <Wrap lang={lang}>
          <p className="max-w-prose leading-relaxed">
            <InlineText text={block.text} />
          </p>
        </Wrap>
      );
    case 'callout': {
      const tone =
        block.tone === 'warning'
          ? 'border-warning bg-warning-light text-warning-ink'
          : 'border-primary/30 bg-primary-light text-fg';
      return (
        <Wrap lang={lang} className={`rounded-lg border-s-4 px-5 py-4 ${tone}`}>
          {block.title ? <p className="font-semibold">{block.title}</p> : null}
          <p className="leading-relaxed">
            <InlineText text={block.text} />
          </p>
        </Wrap>
      );
    }
    case 'examples':
      return (
        <Wrap lang={lang} className={CARD}>
          <p className="mb-2 text-sm font-medium text-muted">{t('example')}</p>
          <ul className="flex flex-col gap-2">
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineText text={item.text} />
                {item.gloss ? (
                  <span className="block text-sm text-muted" dir="auto">
                    <InlineText text={item.gloss} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Wrap>
      );
    case 'dialogue':
      return (
        <Wrap lang={lang} className={CARD}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {block.lines.map((line, i) => (
              <div key={i} className="contents">
                <dt className="font-semibold">{line.speaker}</dt>
                <dd>
                  <InlineText text={line.text} />
                </dd>
              </div>
            ))}
          </dl>
        </Wrap>
      );
    case 'table':
      return (
        <Wrap lang={lang} className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[0.9375rem]">
            {block.caption ? (
              <caption className="px-4 py-2 text-start font-medium">{block.caption}</caption>
            ) : null}
            {block.header ? (
              <thead className="bg-surface-secondary">
                <tr>
                  {block.header.map((h, i) => (
                    <th key={i} scope="col" className="px-4 py-2 text-start font-medium">
                      <InlineText text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody className="divide-y divide-border">
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-4 py-2 align-top" dir="auto">
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Wrap>
      );
    case 'vocabulary':
      return (
        <Wrap lang={lang} className="flex flex-col gap-2">
          {block.title ? <p className="font-semibold">{block.title}</p> : null}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[0.9375rem]">
              <thead className="bg-surface-secondary text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('term')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t('gloss')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {block.items.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium">{item.term}</td>
                    <td
                      className="px-4 py-2"
                      lang={block.glossLang}
                      dir={block.glossLang ? directionOf(block.glossLang) : 'auto'}
                    >
                      {item.gloss}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.link ? (
            <a
              href={block.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[0.9375rem] font-medium text-primary underline"
            >
              {t('practiseOnline')}
              <span className="sr-only"> {t('opensNewTab')}</span>
            </a>
          ) : null}
        </Wrap>
      );
    case 'cycleOverview':
      return (
        <Wrap lang={lang} className={CARD}>
          <p className="mb-2 text-sm font-medium text-muted">{t('skills')}</p>
          <ul className="flex flex-col gap-2">
            {block.skills.map((skill, i) => (
              <li key={i}>
                <span className="font-semibold">{skill.name}</span>
                {skill.description ? (
                  <span className="block text-fg-secondary">
                    <InlineText text={skill.description} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Wrap>
      );
    case 'sentenceFrame':
      return (
        <Wrap lang={lang} className={CARD}>
          {block.prompt ? (
            <p className="mb-2 font-medium">
              <InlineText text={block.prompt} />
            </p>
          ) : null}
          <p className="text-lg leading-relaxed">
            <InlineText text={block.frame} />
          </p>
          {block.example ? (
            <p className="mt-2 text-[0.9375rem] text-fg-secondary">
              <span className="font-medium">{t('example')}: </span>
              <InlineText text={block.example} />
            </p>
          ) : null}
          {block.answerable ? (
            <Answers
              props={props}
              block={block}
              index={0}
              lang={lang}
              label={inlineToPlainText(block.prompt ?? block.frame)}
            />
          ) : null}
        </Wrap>
      );
    case 'discussionQuestions':
      return (
        <Wrap lang={lang} className={CARD}>
          {block.title ? <p className="mb-3 font-semibold">{block.title}</p> : null}
          <ol className="flex list-decimal flex-col gap-5 ps-5">
            {block.items.map((item, i) => (
              <li key={i}>
                <p className="font-medium">
                  <InlineText text={item.question} />
                </p>
                {item.frame ? (
                  <p className="text-fg-secondary">
                    <InlineText text={item.frame} />
                  </p>
                ) : null}
                {block.answerable ? (
                  <Answers
                    props={props}
                    block={block}
                    index={i}
                    lang={lang}
                    label={inlineToPlainText(item.question)}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </Wrap>
      );
    case 'classActivity':
      return (
        <Wrap lang={lang} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">{block.title}</h3>
            {block.minutes ? (
              <span className="text-sm text-muted">{t('minutes', { minutes: block.minutes })}</span>
            ) : null}
          </div>
          {block.skills.length ? (
            <p className="mt-1 flex flex-wrap gap-2">
              {block.skills.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-primary-light px-2.5 py-0.5 text-[0.8125rem] font-medium text-primary"
                >
                  {s}
                </span>
              ))}
            </p>
          ) : null}
          <ol className="mt-3 flex list-decimal flex-col gap-2 ps-5">
            {block.steps.map((step, i) => (
              <li key={i}>
                <InlineText text={step} />
              </li>
            ))}
          </ol>
          {block.example ? (
            <p className="mt-3 rounded-md bg-surface-secondary px-3 py-2">
              <span className="font-medium">{t('example')}: </span>
              <InlineText text={block.example} />
            </p>
          ) : null}
          {block.wordBank?.length ? (
            <WordList words={block.wordBank} title={t('wordBank')} />
          ) : null}
          {block.resource ? (
            <a
              href={block.resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block font-medium text-primary underline"
            >
              {block.resource.label}
              <span className="sr-only"> {t('opensNewTab')}</span>
            </a>
          ) : null}
        </Wrap>
      );
    case 'wordBank':
      return (
        <Wrap lang={lang}>
          <WordList words={block.words} title={t('wordBank')} />
        </Wrap>
      );
    case 'ruleSummary':
      return (
        <Wrap lang={lang} className={CARD}>
          <h3 className="text-lg font-semibold">{block.skill}</h3>
          <ol className="mt-3 flex list-decimal flex-col gap-3 ps-5">
            {block.rules.map((rule, i) => (
              <li key={i}>
                <InlineText text={rule.text} />
                {rule.examples?.length ? (
                  <ul className="mt-1 flex flex-col gap-1 text-fg-secondary">
                    {rule.examples.map((ex, j) => (
                      <li key={j}>
                        <InlineText text={ex} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </Wrap>
      );
    case 'aiTutorPrompt':
      return (
        <Wrap lang={lang} className={CARD}>
          <h3 className="text-lg font-semibold">{block.title ?? t('tutorTitle')}</h3>
          {block.intro ? (
            <p className="mt-1 text-fg-secondary">
              <InlineText text={block.intro} />
            </p>
          ) : null}
          <pre
            className="mt-3 rounded-md bg-surface-secondary px-4 py-3 font-sans text-[0.9375rem] whitespace-pre-wrap"
            dir="auto"
          >
            {block.message}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <CopyButton text={block.message} />
            {props.aiTutorUrl ? (
              <a
                href={props.aiTutorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                {t('openTutor')}
                <span className="sr-only"> {t('opensNewTab')}</span>
              </a>
            ) : (
              <span className="text-sm text-muted">
                {t(props.view === 'teacher' ? 'tutorMissingTeacher' : 'tutorMissing')}
              </span>
            )}
          </div>
        </Wrap>
      );
    case 'externalLink':
      return (
        <Wrap lang={lang}>
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline"
          >
            {block.label}
            <span className="sr-only"> {t('opensNewTab')}</span>
          </a>
          {block.description ? (
            <p className="text-[0.9375rem] text-fg-secondary">
              <InlineText text={block.description} />
            </p>
          ) : null}
        </Wrap>
      );
    case 'speakingPrompt':
      return (
        <Wrap lang={lang} className={CARD}>
          <p className="text-lg">
            <InlineText text={block.text} />
          </p>
          {block.minutes ? (
            <p className="mt-1 text-sm text-muted">{t('speakFor', { minutes: block.minutes })}</p>
          ) : null}
        </Wrap>
      );
    case 'reflection':
      return (
        <Wrap lang={lang} className={CARD}>
          <p className="font-medium">
            <InlineText text={block.prompt} />
          </p>
          {block.answerable ? (
            <Answers
              props={props}
              block={block}
              index={0}
              lang={lang}
              label={inlineToPlainText(block.prompt)}
            />
          ) : null}
        </Wrap>
      );
    case 'activity': {
      const activity = props.activities?.[block.activityId];
      if (!activity) {
        return (
          <p className="rounded-md bg-surface-secondary px-4 py-3 text-sm text-muted">
            {t('exerciseSoon')}
          </p>
        );
      }
      return <ActivityCard id={block.activityId} view={props.view} {...activity} />;
    }
  }
}

function ActivityCard({
  id,
  title,
  minutes,
  view,
}: {
  id: string;
  title: string;
  minutes: number | null;
  view: 'student' | 'teacher';
}) {
  const t = useTranslations('activity');
  return (
    <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 border-primary`}>
      <div>
        <p className="font-semibold text-fg">{title}</p>
        <p className="text-sm text-muted">
          {view === 'teacher' ? t('block.teacher') : minutes ? t('minutes', { minutes }) : null}
        </p>
      </div>
      {view === 'student' ? (
        <Link
          href={`/learn/activities/${id}` as Route}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-[0.9375rem] font-medium text-on-brand hover:bg-primary-hover"
        >
          {t('block.open')}
        </Link>
      ) : null}
    </div>
  );
}

function WordList({ words, title }: { words: string[]; title: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-medium text-muted">{title}</p>
      <ul className="flex flex-wrap gap-2">
        {words.map((w) => (
          <li
            key={w}
            className="rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-[0.9375rem]"
          >
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}
