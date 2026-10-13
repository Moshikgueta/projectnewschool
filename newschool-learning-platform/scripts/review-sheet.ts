// A review sheet for teachers (docs/CONTENT-MODEL.md §6): every cycle of a
// course with its open review questions and every exercise question with its
// right answers and the feedback students see, as one HTML page.
//
//   pnpm content:review-sheet <course-slug> <out.html> [dir]
//
// The sheet holds answer keys: share it with teachers only, never students.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import type { AuthoredItem } from '../src/content/activities-file';
import { validateContent, type CycleFile } from '../src/content/files';
import { inlineToPlainText } from '../src/content/inline';

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const plain = (s: string) => esc(inlineToPlainText(s));

function promptText(item: AuthoredItem): string {
  if (typeof item.prompt === 'string') return plain(item.prompt);
  return item.prompt
    .map((b) => ('text' in b && typeof b.text === 'string' ? plain(b.text) : ''))
    .filter(Boolean)
    .join('<br>');
}

const TYPE_NAMES: Record<AuthoredItem['type'], string> = {
  multipleChoice: 'Multiple choice',
  trueFalse: 'True or false',
  fillBlank: 'Fill in the blanks',
  matching: 'Matching',
  reorderSentence: 'Word order',
  shortAnswer: 'Short answer',
  reflection: 'Reflection',
};

function answer(item: AuthoredItem): string {
  switch (item.type) {
    case 'multipleChoice':
      return `<ul class="opts">${item.options
        .map(
          (o) =>
            `<li class="${o.correct ? 'ok' : 'no'}"><span class="mark" aria-label="${o.correct ? 'right' : 'wrong'}">${o.correct ? '✓' : '✗'}</span><span><bdi>${plain(o.text)}</bdi>${o.feedback ? `<small>Feedback: ${plain(o.feedback)}</small>` : ''}</span></li>`,
        )
        .join('')}</ul>`;
    case 'trueFalse':
      return `<p class="key">Right answer: <b>${item.answer ? 'True' : 'False'}</b></p>`;
    case 'fillBlank': {
      let n = 0;
      const text = esc(item.text).replace(/_{2,}/g, () => {
        const accepted = item.blanks[n++] ?? [];
        return `<mark>${accepted.map(esc).join(' / ')}</mark>`;
      });
      const bank = item.wordBank?.length
        ? `<small>Word bank: ${item.wordBank.map(esc).join(', ')}</small>`
        : '';
      return `<p class="key"><bdi>${text}</bdi></p>${bank}<small>Accents: ${item.accents === 'strict' ? 'must be right' : 'ignored'}</small>`;
    }
    case 'matching':
      return `<table class="pairs"><tbody>${item.pairs
        .map(
          ([l, r]) =>
            `<tr><td><bdi>${plain(l)}</bdi></td><td aria-hidden="true">→</td><td><bdi>${plain(r)}</bdi></td></tr>`,
        )
        .join('')}</tbody></table>`;
    case 'reorderSentence':
      return `<p class="key"><bdi>${esc(item.sentence)}</bdi></p>${
        item.alsoAccept.length
          ? `<small>Also accepted: ${item.alsoAccept.map((s) => `<bdi>${esc(s)}</bdi>`).join(' · ')}</small>`
          : ''
      }`;
    default:
      return `<p class="open">Open answer: the teacher reads it.</p>`;
  }
}

function itemHtml(item: AuthoredItem, n: number): string {
  const fb = [
    item.feedback.correct ? `When right: ${plain(item.feedback.correct)}` : '',
    item.feedback.incorrect ? `When wrong: ${plain(item.feedback.incorrect)}` : '',
  ].filter(Boolean);
  return `<li class="item">
    <div class="item-head"><span class="num">${n}</span><span class="type">${TYPE_NAMES[item.type]}</span><code>${esc(item.id)}</code></div>
    <p class="prompt"><bdi>${promptText(item)}</bdi></p>
    ${answer(item)}
    ${fb.length ? `<small>${fb.join('<br>')}</small>` : ''}
  </li>`;
}

function cycleHtml(c: CycleFile): string {
  const total = c.activities.reduce((n, a) => n + a.items.length, 0);
  return `<section class="cycle" id="${esc(c.slug)}" aria-labelledby="h-${esc(c.slug)}">
  <header class="cycle-head">
    <p class="eyebrow">Cycle ${c.position}</p>
    <h2 id="h-${esc(c.slug)}"><bdi>${esc(c.title)}</bdi></h2>
    <p class="goal"><bdi>${esc(c.goal)}</bdi></p>
    <label class="done"><input type="checkbox" id="done-${esc(c.slug)}" data-cycle="${esc(c.slug)}"> I've checked this cycle</label>
  </header>
  ${
    c.review.length
      ? `<div class="questions"><h3>Questions for the teacher (${c.review.length})</h3><ol>${c.review
          .map((r) => `<li>${esc(r)}</li>`)
          .join('')}</ol></div>`
      : ''
  }
  <h3>Exercises (${total} questions)</h3>
  ${c.activities
    .map(
      (a) =>
        `<div class="exercise"><h4><bdi>${esc(a.title)}</bdi> <code>${esc(a.slug)}</code></h4><ol class="items">${a.items
          .map((item, i) => itemHtml(item, i + 1))
          .join('')}</ol></div>`,
    )
    .join('')}
</section>`;
}

const CSS = `
/* Layout: a narrow reading column with a cycle index on top; each cycle a section, each question a quiet row. */
:root {
  --bg: #f6f7f4; --surface: #ffffff; --ink: #1d2320; --muted: #5d6862; --line: #d9ded8;
  --accent: #2f5d50; --ok: #1f6b3a; --ok-bg: #e4f2e8; --no: #8a3b2e; --hl: #fff1b8;
  --display: "Fraunces", Georgia, serif; --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #141917; --surface: #1c2320; --ink: #e6ebe7; --muted: #9aa69f; --line: #303a35;
  --accent: #8cc7b4; --ok: #8fd6a6; --ok-bg: #1d3326; --no: #f0a495; --hl: #4a4220; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #141917; --surface: #1c2320; --ink: #e6ebe7; --muted: #9aa69f; --line: #303a35;
  --accent: #8cc7b4; --ok: #8fd6a6; --ok-bg: #1d3326; --no: #f0a495; --hl: #4a4220; color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font: 16px/1.55 var(--body); padding-inline: 16px; padding-block: 24px 64px; }
main { max-width: 52rem; margin-inline: auto; display: flex; flex-direction: column; gap: 32px; }
h1, h2 { font-family: var(--display); font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: 2rem; } h2 { font-size: 1.6rem; } h3 { font-size: 1.05rem; margin: 20px 0 8px; } h4 { font-size: 1rem; margin: 16px 0 8px; }
code { font-family: var(--mono); font-size: 0.8rem; color: var(--muted); }
small { display: block; color: var(--muted); font-size: 0.875rem; }
.intro p { margin: 8px 0; max-width: 65ch; } .warn { color: var(--no); font-weight: 600; }
.index { display: flex; flex-wrap: wrap; gap: 6px 10px; padding: 0; list-style: none; }
.index a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--line); }
.index a.checked::after { content: " ✓"; color: var(--ok); }
/* Right-to-left courses lay out their cycles right to left; the page frame stays English. */
.cycles { display: flex; flex-direction: column; gap: 32px; }
.cycle { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 20px; min-width: 0; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; color: var(--muted); margin: 0; }
.goal { color: var(--muted); margin: 4px 0 8px; }
.done { display: inline-flex; gap: 8px; align-items: center; min-height: 44px; font-weight: 600; color: var(--accent); }
.done input { width: 20px; height: 20px; accent-color: var(--accent); }
.questions ol { padding-inline-start: 1.4rem; margin: 0; } .questions li { margin-bottom: 6px; max-width: 70ch; }
.items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.item { border-top: 1px solid var(--line); padding-block: 12px; display: flex; flex-direction: column; gap: 6px; }
.item-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; }
.num { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent); }
.type { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.prompt { margin: 0; font-weight: 600; }
.opts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.opts li { display: flex; gap: 8px; padding: 4px 8px; border-radius: 6px; }
.opts li.ok { background: var(--ok-bg); color: var(--ok); font-weight: 600; }
.mark { width: 1.2em; flex: none; } .opts li.no .mark { color: var(--no); }
.key { margin: 0; } .key b { color: var(--ok); }
mark { background: var(--hl); color: var(--ink); padding: 0 4px; border-radius: 3px; font-weight: 600; }
.pairs { border-collapse: collapse; } .pairs td { padding: 2px 10px 2px 0; }
.open { margin: 0; color: var(--muted); font-style: italic; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

function page(courseTitle: string, cycles: CycleFile[], dir: 'ltr' | 'rtl'): string {
  const total = cycles.reduce(
    (n, c) => n + c.activities.reduce((m, a) => m + a.items.length, 0),
    0,
  );
  return `<title>${esc(courseTitle)} answer check</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>${CSS}</style>
<main>
  <header class="intro">
    <p class="eyebrow">For teachers</p>
    <h1><bdi>${esc(courseTitle)}</bdi>: answer check</h1>
    <p>${cycles.length} cycles, ${total} self-correcting questions. The exercises are new: they were written from each cycle's rules and vocabulary, so every right answer needs a teacher's check before students see it. Right answers are marked ✓ or highlighted; the feedback is what a student sees after a wrong answer.</p>
    <p>Each cycle also lists the corrections made to the notebook and the questions left for you. Tick a cycle when you have checked it (the ticks stay in this browser only), and send your corrections to the person who manages the course content.</p>
    <p class="warn">This page shows the answers. Don't share it with students.</p>
    <nav aria-label="Cycles"><ul class="index">${cycles
      .map(
        (c) =>
          `<li><a href="#${esc(c.slug)}" data-index="${esc(c.slug)}">${c.position}. <bdi>${esc(c.title)}</bdi></a></li>`,
      )
      .join('')}</ul></nav>
  </header>
  <div dir="${dir}" class="cycles">${cycles.map(cycleHtml).join('\n')}</div>
</main>
<script>
(() => {
  const key = (slug) => 'answer-check:' + slug;
  for (const box of document.querySelectorAll('input[data-cycle]')) {
    const slug = box.dataset.cycle;
    const link = document.querySelector('a[data-index="' + slug + '"]');
    try { box.checked = localStorage.getItem(key(slug)) === '1'; } catch {}
    link?.classList.toggle('checked', box.checked);
    box.addEventListener('change', () => {
      try { localStorage.setItem(key(slug), box.checked ? '1' : '0'); } catch {}
      link?.classList.toggle('checked', box.checked);
    });
  }
})();
</script>
`;
}

function main() {
  const [courseSlug, out, dir = 'content'] = process.argv.slice(2);
  if (!courseSlug || !out) {
    console.error('Usage: content:review-sheet <course-slug> <out.html> [dir]');
    process.exit(2);
  }
  const files = yamlFiles(dir).map((path) => ({
    file: relative(process.cwd(), path),
    data: parseDocument(readFileSync(path, 'utf8')).toJS() as unknown,
  }));
  const { courses, cycles, problems } = validateContent(files);
  if (problems.length) {
    console.error(`${problems.length} problem(s) in ${dir}/: run pnpm content:validate`);
    process.exit(1);
  }
  const course = courses.find((c) => c.slug === courseSlug);
  if (!course) {
    console.error(`No course "${courseSlug}" in ${dir}/`);
    process.exit(1);
  }
  const own = cycles.filter((c) => c.course === courseSlug).sort((a, b) => a.position - b.position);
  writeFileSync(out, page(course.title, own, course.language.direction));
  console.log(`✓ ${own.length} cycle(s) → ${out}`);
}

main();
