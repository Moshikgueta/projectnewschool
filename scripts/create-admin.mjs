#!/usr/bin/env node
/* Create (or reset) a staff account straight in D1 — no bootstrap token, no
   curl. For whoever already has wrangler access to the database, which is a
   strictly higher level of trust than any HTTP endpoint could grant.

     npm run admin -- --email office@newschool.co.il --pass "…" --name "אלון"
     npm run admin -- --email … --pass … --name … --remote     # production

   Re-running with an existing email resets that account's password and
   re-enables it, which is the "I locked myself out" escape hatch.

   The hash format matches functions/_shared.js exactly — PBKDF2-SHA256,
   100k iterations, 16-byte salt, 32-byte output, packed as
   pbkdf2$<iterations>$<saltHex>$<hashHex>. Keep the two in step. */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROLES = ['אדמין', 'מנהל פדגוגי', 'מורה', 'מנהלת קבלה', 'תלמיד'];
const DB = 'teacher-room';

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

const remote = process.argv.includes('--remote');
const email = String(arg('email') || '').trim().toLowerCase();
const pass = String(arg('pass') || '');
const name = String(arg('name') || '').trim();
const username = String(arg('user') || '').trim().toLowerCase() || null;
const role = String(arg('role') || 'אדמין');

const die = m => { console.error('✗ ' + m); process.exit(1); };

if (!email || !pass || !name) {
  console.error(`Usage:
  npm run admin -- --email <email> --pass <password> --name <full name> [options]

Options:
  --user  <handle>   short login handle, e.g. "office" (login accepts either)
  --role  <role>     ${ROLES.join(' | ')}   (default: אדמין)
  --remote           write to the deployed D1 instead of the local one

Re-running with an existing --email resets that account's password and
re-enables it.`);
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('האימייל לא תקין');
if (pass.length < 6) die('הסיסמה צריכה להיות לפחות 6 תווים');
if (!ROLES.includes(role)) die(`תפקיד לא מוכר: ${role}\nהתפקידים: ${ROLES.join(' · ')}`);

/* Same derivation as functions/_shared.js hashPassword(). */
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pass, salt, 100000, 32, 'sha256');
const packed = `pbkdf2$100000$${salt.toString('hex')}$${hash.toString('hex')}`;

const id = 'u' + crypto.randomBytes(12).toString('hex');
const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('');
const q = s => s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;

/* ON CONFLICT so a second run is a password reset rather than an error —
   must_change stays 0 because the operator chose this password deliberately. */
const sql = `
INSERT INTO staff_users
  (id, email, username, pass_hash, role, name, initials, active, must_change,
   screens, student_id, failed_attempts, locked_until, created_at)
VALUES
  (${q(id)}, ${q(email)}, ${q(username)}, ${q(packed)}, ${q(role)}, ${q(name)},
   ${q(initials)}, 1, 0, NULL, NULL, 0, 0, ${Date.now()})
ON CONFLICT(email) DO UPDATE SET
  pass_hash = excluded.pass_hash,
  name      = excluded.name,
  role      = excluded.role,
  initials  = excluded.initials,
  active    = 1,
  must_change = 0,
  failed_attempts = 0,
  locked_until = 0;`.trim();

const where = remote ? '--remote' : '--local';
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, where, '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  die(`wrangler failed. If the table is missing, apply the schema first:
   npx wrangler d1 execute ${DB} ${where} --file=schema.sql`);
}

console.log(`✓ ${role} ready on the ${remote ? 'REMOTE' : 'LOCAL'} database

   email:    ${email}${username ? `\n   username: ${username}` : ''}
   password: the one you just passed

Sign in at ${remote ? 'https://<your-domain>/dashboard' : 'http://localhost:8787/dashboard'}.`);
if (!remote) console.log('\nLocal only — `npm run dev` serves that URL.');
