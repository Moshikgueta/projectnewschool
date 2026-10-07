import { describe, expect, it } from 'vitest';
import { countBlanks, inlineToPlainText, parseInline } from './inline';
import { isAllowedLink } from './links';

describe('parseInline', () => {
  it('parses bold, italic, blanks and line breaks', () => {
    expect(parseInline('My **mother** is *kind*.\nHer name is ____.')).toEqual([
      { kind: 'text', text: 'My ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'mother' }] },
      { kind: 'text', text: ' is ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'kind' }] },
      { kind: 'text', text: '.' },
      { kind: 'break' },
      { kind: 'text', text: 'Her name is ' },
      { kind: 'blank' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps allowed links and drops other links but keeps their words', () => {
    expect(parseInline('[Flashcards](https://quizlet.com/x)')).toEqual([
      {
        kind: 'link',
        href: 'https://quizlet.com/x',
        children: [{ kind: 'text', text: 'Flashcards' }],
      },
    ]);
    expect(parseInline('[Click](https://evil.example/steal)')).toEqual([
      { kind: 'text', text: 'Click' },
    ]);
  });

  it('never produces markup from HTML-looking or script input', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[x](javascript:alert(1))',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](http://quizlet.com/insecure)',
      '**<b onmouseover=alert(1)>**',
    ];
    for (const input of hostile) {
      const tokens = JSON.stringify(parseInline(input));
      expect(tokens, input).not.toContain('"kind":"link"');
    }
    // HTML stays literal text, to be escaped by React.
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ]);
  });

  it('handles unmatched markers as plain text', () => {
    expect(parseInline('5 * 3 = 15 and **unfinished')).toEqual([
      { kind: 'text', text: '5 * 3 = 15 and **unfinished' },
    ]);
  });
});

describe('helpers', () => {
  it('produce plain text and count blanks', () => {
    expect(inlineToPlainText('I live **with** my ____ and ____.')).toBe(
      'I live with my ___ and ___.',
    );
    expect(countBlanks('I live with my ____ and ________.')).toBe(2);
  });

  it('allow only https links to listed hosts', () => {
    expect(isAllowedLink('https://quizlet.com/il/123')).toBe(true);
    expect(isAllowedLink('https://www.quizlet.com/il/123')).toBe(true);
    expect(isAllowedLink('https://quizlet.com.evil.example/')).toBe(false);
    expect(isAllowedLink('https://user:pw@quizlet.com/')).toBe(false);
    expect(isAllowedLink('http://quizlet.com/')).toBe(false);
    expect(isAllowedLink('not a url')).toBe(false);
  });
});
