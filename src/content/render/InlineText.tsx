import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { parseInline, type InlineToken } from '../inline';

function renderTokens(tokens: InlineToken[], blankLabel: string, newTab: string): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.kind) {
      case 'text':
        return token.text;
      case 'bold':
        return <strong key={i}>{renderTokens(token.children, blankLabel, newTab)}</strong>;
      case 'italic':
        return <em key={i}>{renderTokens(token.children, blankLabel, newTab)}</em>;
      case 'link':
        return (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            {renderTokens(token.children, blankLabel, newTab)}
            <span className="sr-only"> {newTab}</span>
          </a>
        );
      case 'blank':
        return (
          <span
            key={i}
            className="mx-0.5 inline-block w-16 border-b-2 border-border-strong align-baseline"
          >
            <span className="sr-only">({blankLabel})</span>
          </span>
        );
      case 'break':
        return <br key={i} />;
    }
  });
}

/** Renders the restricted inline format (inline.ts). Never renders HTML from content. */
export function InlineText({ text }: { text: string }) {
  const t = useTranslations('notebook');
  return <>{renderTokens(parseInline(text), t('blank'), t('opensNewTab'))}</>;
}
