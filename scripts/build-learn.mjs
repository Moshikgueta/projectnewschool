#!/usr/bin/env node
/* Builds the New School Cycles web app: learn-src/ → docs/learn/

     node scripts/build-learn.mjs

   The bundle is interface only. It contains no course content, no answer
   keys and no student data: everything a student sees is fetched from
   /api/learn/* after the Worker has checked the session and the enrollment.
   So docs/ can stay public (GitHub Pages, the Worker's asset server) without
   publishing a single lesson. */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'learn');
mkdirSync(join(OUT, 'assets'), { recursive: true });

await build({
  entryPoints: [join(ROOT, 'learn-src', 'main.jsx')],
  bundle: true, minify: true, format: 'iife', target: 'es2019',
  jsx: 'automatic', jsxImportSource: 'preact',
  outfile: join(OUT, 'app.js'), legalComments: 'eof', logLevel: 'warning'
});
await build({
  entryPoints: [join(ROOT, 'learn-src', 'styles.css')],
  bundle: true, minify: true, outfile: join(OUT, 'app.css'), logLevel: 'warning'
});

const hash = f => createHash('sha256').update(readFileSync(join(OUT, f))).digest('hex').slice(0, 10);
const html = readFileSync(join(ROOT, 'learn-src', 'index.html'), 'utf8')
  .replace('app.css', `app.css?v=${hash('app.css')}`)
  .replace('app.js', `app.js?v=${hash('app.js')}`);
writeFileSync(join(OUT, 'index.html'), html);

/* The official logo, exactly as supplied in the course ZIP. */
copyFileSync(join(ROOT, 'content', 'source', 'spanish-practice', 'dist', 'assets', 'new-school-logo.jpeg'),
  join(OUT, 'assets', 'new-school-logo.jpeg'));

/* Third-party notices ship next to the code they cover. */
const preactLicense = readFileSync(join(ROOT, 'node_modules', 'preact', 'LICENSE'), 'utf8');
writeFileSync(join(OUT, 'THIRD-PARTY-NOTICES.txt'),
  'New School Cycles includes third-party software. New School does not own it.\n\n' +
  '== Preact (https://preactjs.com) — MIT License ==\n\n' + preactLicense + '\n\n' +
  '== Fonts — served by Google Fonts, SIL Open Font License 1.1 ==\n' +
  'Assistant, Frank Ruhl Libre, Noto Naskh Arabic, Noto Serif — copyright their respective authors.\n' +
  'https://openfontlicense.org\n');
console.log('docs/learn built');
