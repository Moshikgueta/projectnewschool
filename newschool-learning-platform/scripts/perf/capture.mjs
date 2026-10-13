#!/usr/bin/env node
// Turns a Postgres statement log into the SQL PostgREST ran for each API call,
// with its parameters filled in, as a starting point for scripts/perf/bench.sql
// (docs/PERFORMANCE.md, "Refreshing the queries"). LOCAL ONLY.
//
//   docker logs --since <time> supabase_db_<project> 2>&1 | node scripts/perf/capture.mjs > captured.sql
//
// Prints, per statement: a comment with the duration, the role and the user
// (JWT `sub`), then the statement. Statements by service_role are marked; the
// secret key and tokens that appear in the log are never printed.

import { readFileSync } from 'node:fs';

const log = readFileSync(0, 'utf8');
const line =
  /^(?:\S+ )?\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ UTC \[(\d+)\] (\S+) (LOG|DETAIL|ERROR|STATEMENT|WARNING|HINT|CONTEXT):  (.*)$/;

const records = [];
for (const text of log.split('\n')) {
  const m = line.exec(text);
  if (m) records.push({ pid: m[1], user: m[2], kind: m[3], msg: m[4] });
  else if (records.length) records[records.length - 1].msg += `\n${text}`;
}

const params = (msg) =>
  Object.fromEntries(
    [...msg.matchAll(/\$(\d+) = ('(?:[^']|'')*'|NULL)/g)].map((m) => [m[1], m[2]]),
  );

const claims = new Map(); // pid → { role, sub }
const last = new Map(); // pid → 'config' | statement
const out = [];
for (const r of records) {
  if (!r.user.startsWith('authenticator')) continue;
  if (r.kind === 'LOG') {
    const m = /^duration: ([\d.]+) ms {2}execute [^:]+: ([\s\S]*)$/.exec(r.msg);
    last.delete(r.pid);
    if (!m) continue;
    if (m[2].includes('set_config') && m[2].includes('request.jwt.claims')) {
      last.set(r.pid, 'config');
    } else if (m[2].includes('pgrst_')) {
      const s = { ms: Number(m[1]), sql: m[2], params: {}, who: claims.get(r.pid) };
      out.push(s);
      last.set(r.pid, s);
    }
  } else if (r.kind === 'DETAIL' && r.msg.startsWith('Parameters:')) {
    const target = last.get(r.pid);
    const p = params(r.msg);
    if (target === 'config') {
      const jwt = Object.values(p).find((v) => v.startsWith("'{") && v.includes('"role"')) ?? '';
      claims.set(r.pid, {
        role: /"role"\s*:\s*"(\w+)"/.exec(jwt)?.[1] ?? '?',
        sub: /"sub"\s*:\s*"([0-9a-f-]+)"/.exec(jwt)?.[1] ?? '',
        aal: /"aal"\s*:\s*"(\w+)"/.exec(jwt)?.[1] ?? '',
      });
    } else if (target && typeof target === 'object') {
      target.params = p;
    }
  }
}

for (const s of out) {
  let sql = s.sql;
  for (const k of Object.keys(s.params).sort((a, b) => Number(b) - Number(a))) {
    sql = sql.replace(new RegExp(`\\$${k}(?!\\d)`, 'g'), () => s.params[k]);
  }
  const table = /FROM "public"\."(\w+)"/.exec(sql)?.[1] ?? '?';
  const who = s.who ? `${s.who.role} ${s.who.sub} ${s.who.aal}`.trim() : 'unknown';
  console.log(
    `-- ${s.ms.toFixed(2)} ms · ${table} · ${who}${s.who?.role === 'service_role' ? ' (service role)' : ''}`,
  );
  console.log(`${sql};\n`);
}
