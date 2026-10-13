#!/usr/bin/env node
// Runner for the school-scale RLS benchmark (docs/PERFORMANCE.md). LOCAL ONLY.
//
//   node scripts/perf/perf.mjs seed                  load scripts/perf/seed-scale.sql
//   node scripts/perf/perf.mjs bench [options]       run scripts/perf/bench.sql
//
// bench options:
//   --runs N          timed runs per query (median reported; default 7)
//   --save NAME       keep the results as perf-results/NAME.csv (and NAME.plans.txt with --plans)
//   --compare NAME    compare with perf-results/NAME.csv: time per query, and whether every
//                     query returned the same rows (count and checksum); exits 1 if not
//   --plans           also save EXPLAIN (ANALYZE, BUFFERS) of every query
//   --now ISO         fix "now" (use the same value for runs you compare)
//   --student/--teacher/--office/--manager/--admin EMAIL
//
// Uses `psql` with DATABASE_URL (default: the local Supabase database), or, when
// psql is not installed, `docker exec` into the local Supabase database container.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(root, 'perf-results');
const MAX_ROWS = '1000'; // supabase/config.toml [api] max_rows
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'; // local Supabase default

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

function projectId() {
  const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  return /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
}

/** Run a SQL file with psql variables; returns stdout. */
function psql(file, vars = {}) {
  const url = process.env.DATABASE_URL ?? LOCAL_URL;
  if (!/127\.0\.0\.1|localhost/.test(url) && !process.env.PERF_ALLOW_REMOTE) {
    throw new Error(
      'Refusing to run against a non-local database (set PERF_ALLOW_REMOTE=1 to override).',
    );
  }
  const v = Object.entries(vars).flatMap(([k, val]) => ['-v', `${k}=${val}`]);
  const sql = readFileSync(join(root, file), 'utf8');
  const common = ['-X', '-v', 'ON_ERROR_STOP=1', ...v, '-f', '-'];
  let res = spawnSync('psql', [url, ...common], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (res.error?.code === 'ENOENT') {
    const container = `supabase_db_${projectId()}`;
    res = spawnSync(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', ...common],
      { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 },
    );
  }
  if (res.error) throw res.error;
  if (res.status !== 0) {
    process.stderr.write(res.stderr);
    process.exit(res.status ?? 1);
  }
  if (res.stderr.trim()) process.stderr.write(res.stderr);
  return res.stdout;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        cells.push(cur);
        cur = '';
      } else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function bench() {
  const vars = { runs: arg('runs', '7'), plans: flag('plans') ? '1' : '0' };
  for (const k of ['now', 'student', 'teacher', 'office', 'manager', 'admin']) {
    const val = arg(k);
    if (val) vars[k] = val;
  }
  const out = psql('scripts/perf/bench.sql', vars);
  const [table, rest = ''] = out.split('-- bench:csv\n');
  const [csv, plans = ''] = rest.split('-- bench:plans\n');
  process.stdout.write(table);
  const rows = parseCsv(csv);

  const save = arg('save');
  if (save) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${save}.csv`), csv);
    if (plans) writeFileSync(join(OUT_DIR, `${save}.plans.txt`), plans);
    console.log(`\nSaved perf-results/${save}.csv${plans ? ' and .plans.txt' : ''}`);
  }

  const compare = arg('compare');
  if (compare) {
    const before = new Map(
      parseCsv(readFileSync(join(OUT_DIR, `${compare}.csv`), 'utf8')).map((r) => [
        `${r.who}|${r.label}`,
        r,
      ]),
    );
    let mismatches = 0;
    const lines = rows.map((r) => {
      const b = before.get(`${r.who}|${r.label}`);
      const sameCount = !b || (b.total_rows === r.total_rows && b.page_rows === r.page_rows);
      // A read capped by PostgREST's max_rows (1000) without an order returns
      // *some* 1000 rows, which may differ between plans: counts only.
      const capped = r.page_rows === MAX_ROWS;
      const same = sameCount && (!b || b.checksum === r.checksum || capped);
      if (!same) mismatches++;
      return {
        who: r.who,
        query: r.label,
        before_ms: b ? Number(b.median_ms) : null,
        after_ms: Number(r.median_ms),
        speedup: b
          ? `${(Number(b.median_ms) / Math.max(Number(r.median_ms), 0.01)).toFixed(1)}×`
          : '',
        rows: r.total_rows || r.page_rows,
        same_rows: !b
          ? 'new'
          : !same
            ? 'NO'
            : b.checksum === r.checksum
              ? 'yes'
              : 'yes (count; capped)',
      };
    });
    console.log(`\nCompared with perf-results/${compare}.csv`);
    console.table(lines);
    if (mismatches) {
      console.error(`${mismatches} queries returned different rows than in ${compare}.`);
      process.exit(1);
    }
    console.log(
      'Every query returned the same rows as before (count and checksum; count only for capped reads).',
    );
  }
  const slow = rows.filter((r) => Number(r.median_ms) >= 50);
  console.log(`\n${rows.length} queries; ${slow.length} at or over 50 ms.`);
}

const command = process.argv[2];
if (command === 'seed') {
  process.stdout.write(psql('scripts/perf/seed-scale.sql'));
} else if (command === 'bench') {
  bench();
} else {
  console.error(
    'usage: node scripts/perf/perf.mjs seed | bench [--runs N] [--save NAME] [--compare NAME] [--plans] [--now ISO]',
  );
  process.exit(2);
}
