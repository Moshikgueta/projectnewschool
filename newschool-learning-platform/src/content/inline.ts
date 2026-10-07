// The restricted inline text format used inside content blocks. It is NOT
// HTML and NOT full Markdown: only what the notebooks need, so nothing in
// content can ever inject markup (docs/SECURITY.md, XSS control).
//
//   **bold**   *italic*   [label](https://allowed.host/…)   ____ (a blank)   line breaks
//
// As in Markdown, emphasis cannot start or end with a space ("5 * 3 * 2" stays text).
//
// Anything else is plain text. Parsing returns tokens; React renders them as
// text nodes and a few fixed elements.

import { isAllowedLink } from './links';

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlineToken[] }
  | { kind: 'italic'; children: InlineToken[] }
  | { kind: 'link'; href: string; children: InlineToken[] }
  | { kind: 'blank' }
  | { kind: 'break' };

const PATTERN =
  /(\*\*(?<bold>[^\s*](?:[^\n]*?[^\s*])?)\*\*)|(\*(?<italic>[^\s*](?:[^*\n]*?[^\s*])?)\*)|(\[(?<label>[^\]\n]+)\]\((?<href>[^)\s]+)\))|(?<blank>_{3,})|(?<br>\n)/;

export function parseInline(source: string, depth = 0): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = source;
  while (rest.length > 0) {
    const match = depth > 2 ? null : PATTERN.exec(rest);
    if (!match || match.index === undefined) {
      tokens.push({ kind: 'text', text: rest });
      break;
    }
    if (match.index > 0) tokens.push({ kind: 'text', text: rest.slice(0, match.index) });
    const g = match.groups ?? {};
    if (g.bold !== undefined)
      tokens.push({ kind: 'bold', children: parseInline(g.bold, depth + 1) });
    else if (g.italic !== undefined)
      tokens.push({ kind: 'italic', children: parseInline(g.italic, depth + 1) });
    else if (g.label !== undefined && g.href !== undefined) {
      tokens.push(
        isAllowedLink(g.href)
          ? { kind: 'link', href: g.href, children: parseInline(g.label, depth + 1) }
          : { kind: 'text', text: g.label }, // disallowed link: keep the words, drop the link
      );
    } else if (g.blank !== undefined) tokens.push({ kind: 'blank' });
    else tokens.push({ kind: 'break' });
    rest = rest.slice(match.index + match[0].length);
  }
  return mergeText(tokens);
}

function mergeText(tokens: InlineToken[]): InlineToken[] {
  return tokens.reduce<InlineToken[]>((acc, token) => {
    const last = acc[acc.length - 1];
    if (token.kind === 'text' && last?.kind === 'text') {
      acc[acc.length - 1] = { kind: 'text', text: last.text + token.text };
    } else {
      acc.push(token);
    }
    return acc;
  }, []);
}

/** Plain-text version (for screen-reader labels, search, previews). */
export function inlineToPlainText(source: string): string {
  const walk = (tokens: InlineToken[]): string =>
    tokens
      .map((t) => {
        switch (t.kind) {
          case 'text':
            return t.text;
          case 'blank':
            return '___';
          case 'break':
            return ' ';
          default:
            return walk(t.children);
        }
      })
      .join('');
  return walk(parseInline(source));
}

/** Number of blanks (____) in a sentence frame. */
export function countBlanks(source: string): number {
  return (source.match(/_{3,}/g) ?? []).length;
}
