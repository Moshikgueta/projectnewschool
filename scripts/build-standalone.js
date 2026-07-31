#!/usr/bin/env node
/**
 * Build fully self-contained copies of the dashboard pages into docs/.
 *
 * The source pages load `./support.js`, which in turn fetches React and ReactDOM
 * from unpkg at runtime — so they need a web server AND internet access. The
 * runtime skips that fetch when `window.React` / `window.ReactDOM` already exist
 * (see `loadReactUmd` in support.js), so inlining the two UMD builds ahead of it
 * makes the page render with no network at all: it can be opened straight from
 * disk with file://, or hosted anywhere as a single file.
 *
 * Babel is deliberately NOT inlined. support.js only loads it for `x-import`ed
 * JSX modules, which these pages don't use — verified in a browser with the
 * Babel request blocked.
 *
 * Usage: node scripts/build-standalone.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'docs');

const PAGES = [
  ['Teacher Dashboard v2.dc.html', 'dashboard.html'],
  ['Teacher Mobile.dc.html', 'mobile.html'],
];

/**
 * Inline a JS file into a <script> block.
 *
 * Script-tag-like sequences in the source have to be escaped or the HTML
 * tokenizer mis-parses the block: react-dom.production.min.js contains a literal
 * `"<script>"` string, and an opening `<script` inside script data puts the
 * parser into the double-escaped state where the following `</script>` no longer
 * closes the element — the rest of the bundle then renders as visible text.
 *
 * `\x3c` is the JS escape for `<`, so the string values are unchanged. It is only
 * valid inside a string or template literal, so the escaped source is parsed
 * before being emitted — if a future bundle carries `<script` outside a string,
 * the build fails here instead of shipping a broken page.
 */
function inlineScript(file) {
  const name = path.basename(file);
  const escaped = fs.readFileSync(file, 'utf8')
    .replace(/<script/gi, '\\x3cscript')
    .replace(/<\/script/gi, '\\x3c/script');
  try {
    new Function(escaped);
  } catch (err) {
    throw new Error(`${name}: escaping script tags produced invalid JS (${err.message}) — a <script sequence appears outside a string literal`);
  }
  return `<script>\n${escaped}\n</script>`;
}

const bundle = [
  inlineScript(path.join(ROOT, 'vendor', 'react.production.min.js')),
  inlineScript(path.join(ROOT, 'vendor', 'react-dom.production.min.js')),
  inlineScript(path.join(ROOT, 'support.js')),
].join('\n');

fs.mkdirSync(DIST, { recursive: true });

for (const [srcName, outName] of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, srcName), 'utf8');
  const tag = '<script src="./support.js"></script>';
  if (!html.includes(tag)) {
    throw new Error(`${srcName}: expected ${tag} — the page structure changed, update this script`);
  }
  // Replacer function, not a string: React's minified source contains `"$&/"`,
  // and `$&` in a string replacement expands to the matched text — which would
  // splice the script tag into the middle of the bundle and break it.
  const out = html.replace(tag, () => bundle);
  fs.writeFileSync(path.join(DIST, outName), out);
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`${outName.padEnd(16)} ${kb(html.length)} -> ${kb(out.length)}`);
}

console.log(`\nWrote ${PAGES.length} self-contained pages to docs/ — no server or network needed.`);
