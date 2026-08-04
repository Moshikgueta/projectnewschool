#!/usr/bin/env node
/* Regenerate schema-console.sql from schema.sql.

   The Cloudflare D1 web console is fussier than wrangler: SQL comments trip
   it up, and it is happiest running one statement at a time. schema.sql is
   the source of truth and keeps its comments; this strips them and lays the
   statements out so the file can be selected whole and pasted, or run block
   by block. No header comment on purpose — the whole file has to be safe to
   paste.

   Run after any schema change:  npm run schema:console  */

import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('schema.sql', 'utf8');
const stripped = src
  .split('\n')
  .map(l => l.replace(/--.*$/, '').trimEnd())   // no string literal here contains --
  .filter(l => l.trim())
  .join('\n');

const statements = stripped.split(';').map(s => s.trim()).filter(Boolean);
writeFileSync('schema-console.sql', statements.join(';\n\n') + ';\n');
console.log(`schema-console.sql — ${statements.length} statements, no comments`);
