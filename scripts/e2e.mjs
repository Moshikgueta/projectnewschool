#!/usr/bin/env node
/* End-to-end test of the auth layer against a local Worker:
     npm test
   Boots `wrangler dev` with a local D1 seeded from schema.sql, then walks the
   whole staff path: bootstrap, login, sessions, the admin user CRUD, role and
   self-lockout guards, password reset, throttling, and revocation. No network
   calls leave the machine. Exits non-zero if anything fails. */

import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync, renameSync } from 'node:fs';

const PORT = 8973;
const B = `http://127.0.0.1:${PORT}`;
const BOOT = 'e2e-bootstrap-token';
const PEPPER = 'e2e-student-code-pepper';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

const bareFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => bareFetch(url, { signal: AbortSignal.timeout(20000), ...opts });

/* Every call returns {status, body, cookie} — the cookie matters as much as
   the body in an auth suite. */
async function call(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const r = await fetch(B + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  let j = null;
  try { j = await r.json(); } catch { }
  const set = r.headers.get('set-cookie') || '';
  return { status: r.status, body: j || {}, cookie: set.split(';')[0], rawCookie: set };
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await bareFetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      if (r.status < 500) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

(async () => {
  /* Kill stragglers from an aborted earlier run before binding the port.
     SIGKILL on workerd too: it ignores SIGTERM, keeps the port, and then the
     next run dies on "Address already in use" rather than anything useful. */
  spawnSync('pkill', ['-9', '-f', `wrangler dev --port ${PORT}`]);
  spawnSync('pkill', ['-9', '-f', 'workerd']);
  await new Promise(r => setTimeout(r, 1500));
  rmSync('.wrangler/state', { recursive: true, force: true });
  const hadDevVars = existsSync('.dev.vars');
  if (hadDevVars) renameSync('.dev.vars', '.dev.vars.staff-backup');

  const seed = spawnSync('npx', ['wrangler', 'd1', 'execute', 'teacher-room', '--local', '--file=schema.sql'], { encoding: 'utf8' });
  if (seed.status !== 0) { console.error('schema seed failed:', seed.stderr.slice(0, 400)); process.exit(1); }

  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT),
    '--var', `STAFF_BOOTSTRAP_TOKEN:${BOOT}`,
    '--var', `STUDENT_CODE_PEPPER:${PEPPER}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', () => { }); dev.stderr.on('data', () => { });

  const cleanup = code => {
    try { dev.kill(); } catch { }
    if (hadDevVars) try { renameSync('.dev.vars.staff-backup', '.dev.vars'); } catch { }
    process.exit(code);
  };

  if (!await waitFor(B + '/')) { console.error('wrangler dev never came up'); cleanup(1); }

  try {
    console.log('\nBootstrap');
    /* The login screen asks this before drawing itself: an empty school gets
       the setup form, a set-up one gets the ordinary sign-in. */
    ok('an empty school reports it needs setting up',
      (await call('/api/staff/bootstrap')).body.needsSetup === true);
    let r = await call('/api/staff/bootstrap', { method: 'POST', body: { token: 'wrong', name: 'x', email: 'x@y.co', pass: 'secret1' } });
    ok('wrong bootstrap token refused', r.status === 403);
    ok('a refused attempt does not open the school',
      (await call('/api/staff/bootstrap')).body.needsSetup === true);
    r = await call('/api/staff/bootstrap', {
      method: 'POST',
      body: { token: BOOT, name: 'אלון', user: 'office', email: 'office@newschool.co.il', pass: 'admin-pass-1' }
    });
    ok('first admin created', r.status === 201 && r.body.user.role === 'אדמין', JSON.stringify(r.body));
    r = await call('/api/staff/bootstrap', {
      method: 'POST', body: { token: BOOT, name: 'שני', email: 'two@newschool.co.il', pass: 'admin-pass-2' }
    });
    ok('bootstrap closes after the first account', r.status === 409);
    ok('and the setup form stops being offered',
      (await call('/api/staff/bootstrap')).body.needsSetup === false);
    /* The probe is public, so it must carry nothing but the flag. */
    ok('the probe leaks no account data', !/email|pass|name|user/i.test(
      JSON.stringify((await call('/api/staff/bootstrap')).body)),
      JSON.stringify((await call('/api/staff/bootstrap')).body));

    console.log('\nLogin');
    ok('no session → me says no', (await call('/api/staff/auth/me')).body.ok === false);
    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'office', pass: 'nope' } });
    ok('wrong password refused', r.status === 401 && !r.cookie);
    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'ghost@newschool.co.il', pass: 'whatever' } });
    ok('unknown user gets the same message', r.status === 401 && r.body.error === 'שם משתמש או סיסמה שגויים');

    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'office', pass: 'admin-pass-1' } });
    const admin = r.cookie;
    ok('login by username', r.body.ok === true && !!admin);
    ok('session cookie is HttpOnly + SameSite', /HttpOnly/i.test(r.rawCookie) && /SameSite=Lax/i.test(r.rawCookie), r.rawCookie);
    ok('login by email too', (await call('/api/staff/auth/login', { method: 'POST', body: { user: 'office@newschool.co.il', pass: 'admin-pass-1' } })).body.ok === true);

    r = await call('/api/staff/auth/me', { cookie: admin });
    ok('me returns the admin', r.body.ok === true && r.body.user.role === 'אדמין' && r.body.user.name === 'אלון');
    ok('me never leaks a hash', !JSON.stringify(r.body).includes('pbkdf2'));

    console.log('\nAdmin guard');
    ok('users list needs a session', (await call('/api/staff/users')).status === 401);
    ok('users list works for admin', (await call('/api/staff/users', { cookie: admin })).body.users.length === 1);

    console.log('\nCreate accounts');
    r = await call('/api/staff/users', {
      method: 'POST', cookie: admin,
      body: { name: 'יותם ברוך', user: 'yotam', email: 'yotam@newschool.co.il', role: 'מורה' }
    });
    const teacherId = r.body.user && r.body.user.id;
    const tempPass = r.body.tempPassword;
    ok('teacher created with a generated password', r.status === 201 && !!teacherId && !!tempPass);
    ok('created teacher gets default screens', Array.isArray(r.body.user.screens) && r.body.user.screens.length > 0);
    ok('duplicate username refused', (await call('/api/staff/users', {
      method: 'POST', cookie: admin, body: { name: 'אחר', user: 'yotam', role: 'מורה' }
    })).status === 409);
    ok('unknown role refused', (await call('/api/staff/users', {
      method: 'POST', cookie: admin, body: { name: 'x', user: 'xx', role: 'מנהל כללי' }
    })).status === 400);

    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'yotam', pass: tempPass } });
    const teacher = r.cookie;
    ok('teacher logs in with the temp password', r.body.ok === true && !!teacher);
    ok('temp password is flagged for replacement', r.body.user.mustChange === true);
    ok('teacher is not an admin', (await call('/api/staff/users', { cookie: teacher })).status === 403);
    ok('teacher cannot create accounts', (await call('/api/staff/users', {
      method: 'POST', cookie: teacher, body: { name: 'מתחזה', user: 'evil', role: 'אדמין' }
    })).status === 403);

    console.log('\nEditing');
    r = await call('/api/staff/users/' + teacherId, { method: 'PATCH', cookie: admin, body: { name: 'יותם ב.' } });
    ok('rename works and re-derives initials', r.body.ok === true && r.body.user.name === 'יותם ב.' && r.body.user.initials.length > 0);
    r = await call('/api/staff/users/' + teacherId, { method: 'PATCH', cookie: admin, body: { screens: ['dashboard'] } });
    ok('screens narrowed', r.body.user.screens.length === 1);
    ok('teacher cannot edit anyone', (await call('/api/staff/users/' + teacherId, {
      method: 'PATCH', cookie: teacher, body: { role: 'אדמין' } })).status === 403);

    console.log('\nLockout guards');
    const me = (await call('/api/staff/auth/me', { cookie: admin })).body.user;
    ok('admin cannot disable their own account', (await call('/api/staff/users/' + me.id, {
      method: 'PATCH', cookie: admin, body: { active: false } })).status === 400);
    ok('admin cannot delete their own account', (await call('/api/staff/users/' + me.id, {
      method: 'DELETE', cookie: admin })).status === 400);

    console.log('\nRevocation');
    r = await call('/api/staff/users/' + teacherId, { method: 'PATCH', cookie: admin, body: { active: false } });
    ok('teacher disabled', r.body.ok === true && r.body.user.active === false);
    ok('disabled teacher session dies at once', (await call('/api/staff/auth/me', { cookie: teacher })).body.ok === false);
    ok('disabled teacher cannot log back in', (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'yotam', pass: tempPass } })).status === 403);
    await call('/api/staff/users/' + teacherId, { method: 'PATCH', cookie: admin, body: { active: true } });
    /* Re-enabling does not resurrect the revoked session — sign in again for
       the checks below that need a live teacher cookie. */
    const teacherAgain = (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'yotam', pass: tempPass } })).cookie;
    ok('re-enabled teacher signs in again', !!teacherAgain);

    console.log('\nPassword reset');
    r = await call('/api/staff/auth/reset-request', { method: 'POST', body: { user: 'nobody@nowhere.co.il' } });
    ok('reset-request never confirms an address', r.body.ok === true && r.body.sent === false);
    ok('reset-request never returns a token', !('relay' in r.body) && !('token' in r.body) && !('link' in r.body), JSON.stringify(r.body));

    r = await call('/api/staff/users/' + teacherId + '/reset', { method: 'POST', cookie: admin });
    const link = r.body.link;
    ok('admin can mint a relay link', r.body.ok === true && !!link);
    ok('teacher cannot mint one', (await call('/api/staff/users/' + teacherId + '/reset', { method: 'POST', cookie: teacherAgain })).status === 403);
    ok('a revoked session gets 401, not 403', (await call('/api/staff/users/' + teacherId + '/reset', { method: 'POST', cookie: teacher })).status === 401);
    const token = new URL(link).searchParams.get('reset');

    ok('short new password refused', (await call('/api/staff/auth/reset-complete', {
      method: 'POST', body: { token, pass: 'abc' } })).status === 400);
    r = await call('/api/staff/auth/reset-complete', { method: 'POST', body: { token, pass: 'brand-new-pass' } });
    ok('reset completes', r.body.ok === true);
    ok('token is single-use', (await call('/api/staff/auth/reset-complete', {
      method: 'POST', body: { token, pass: 'another-pass' } })).status === 400);
    ok('old password no longer works', (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'yotam', pass: tempPass } })).status === 401);
    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'yotam', pass: 'brand-new-pass' } });
    const teacher2 = r.cookie;
    ok('new password works', r.body.ok === true);
    ok('reset cleared the temp-password flag', r.body.user.mustChange === false);

    console.log('\nSelf-signup');
    r = await call('/api/staff/auth/signup', {
      method: 'POST', body: { name: 'מועמדת', email: 'candidate@example.com', pass: 'candidate-pass', role: 'אדמין' }
    });
    ok('signup accepted', r.body.ok === true && r.body.pending === true);
    ok('signup sets no session cookie', !r.cookie, r.rawCookie);
    ok('self-signed account cannot log in yet', (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'candidate@example.com', pass: 'candidate-pass' } })).status === 403);
    const listed = (await call('/api/staff/users', { cookie: admin })).body.users
      .find(u => u.email === 'candidate@example.com');
    ok('self-signup cannot pick the admin role', listed && listed.role === 'מורה', listed && listed.role);
    ok('self-signed account is inactive', listed && listed.active === false);
    ok('duplicate signup refused', (await call('/api/staff/auth/signup', {
      method: 'POST', body: { name: 'שוב', email: 'candidate@example.com', pass: 'candidate-pass' } })).status === 409);

    console.log('\nStudent codes');
    r = await call('/api/staff/users', {
      method: 'POST', cookie: admin,
      body: { name: 'נועה כהן', user: 'noa.cohen', role: 'תלמיד', sid: 's1' }
    });
    const studentId = r.body.user && r.body.user.id;
    const code1 = r.body.code;
    ok('student created with a code, not a password',
      r.status === 201 && !!code1 && !r.body.tempPassword, JSON.stringify(r.body));
    ok('the code is grouped for reading aloud', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code1 || ''), code1);
    ok('no I/L/O/0/1 in the alphabet', !/[ILO01]/.test(code1 || ''), code1);
    ok('the account list shows a live code', (await call('/api/staff/users', { cookie: admin }))
      .body.users.find(u => u.id === studentId).codeAt > 0);

    ok('a student cannot use the password door', (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'noa.cohen', pass: 'anything-at-all' } })).status === 401);
    ok('a wrong code is refused', (await call('/api/staff/auth/code', {
      method: 'POST', body: { code: 'ZZZZ-ZZZZ' } })).status === 401);

    /* Lower case, spaces and the wrong dash are all how a real person retypes
       something off a printed slip. */
    r = await call('/api/staff/auth/code', { method: 'POST', body: { code: ' ' + code1.toLowerCase().replace('-', ' ') + ' ' } });
    const student = r.cookie;
    ok('the code signs the student in, however they retype it', r.body.ok === true && !!student, JSON.stringify(r.body));
    ok('code entry sets the same HttpOnly session cookie', /HttpOnly/i.test(r.rawCookie));
    r = await call('/api/staff/auth/me', { cookie: student });
    ok('the session is the student', r.body.ok === true && r.body.user.role === 'תלמיד' && r.body.user.sid === 's1');
    ok('a student is not an admin', (await call('/api/staff/users', { cookie: student })).status === 403);
    /* While the student session is still live — the rotation below ends it,
       and a dead session answers 401, which would pass this for the wrong
       reason. 403 is the assertion that the ROLE was refused. */
    ok('a student cannot issue their own code', (await call('/api/staff/users/' + studentId + '/code',
      { method: 'POST', cookie: student })).status === 403);

    r = await call('/api/staff/users/' + studentId + '/code', { method: 'POST', cookie: teacher2 });
    const code2 = r.body.code;
    ok('a teacher can issue a code', r.status === 201 && !!code2 && code2 !== code1, JSON.stringify(r.body));
    ok('issuing needs a session at all', (await call('/api/staff/users/' + studentId + '/code',
      { method: 'POST' })).status === 401);
    ok('a code only exists for a student account', (await call('/api/staff/users/' + teacherId + '/code',
      { method: 'POST', cookie: admin })).status === 400);

    ok('the replaced code stops working', (await call('/api/staff/auth/code', {
      method: 'POST', body: { code: code1 } })).status === 401);
    ok('rotating kills the session opened with the old code',
      (await call('/api/staff/auth/me', { cookie: student })).body.ok === false);
    ok('the new code works', (await call('/api/staff/auth/code', {
      method: 'POST', body: { code: code2 } })).body.ok === true);

    await call('/api/staff/users/' + studentId, { method: 'PATCH', cookie: admin, body: { active: false } });
    ok('a disabled student cannot walk in with a live code', (await call('/api/staff/auth/code', {
      method: 'POST', body: { code: code2 } })).status === 401);
    await call('/api/staff/users/' + studentId, { method: 'PATCH', cookie: admin, body: { active: true } });

    /* Last in this section on purpose: the limit is keyed on the caller, and
       `wrangler dev` sends no CF-Connecting-IP, so every request here shares
       one bucket. Tripping it earlier would 429 the checks above. */
    for (let i = 0; i < 10; i++) {
      await call('/api/staff/auth/code', { method: 'POST', body: { code: 'AAAA-BBB' + (i % 8 + 2) } });
    }
    r = await call('/api/staff/auth/code', { method: 'POST', body: { code: code2 } });
    ok('guessing codes locks the door, right code included', r.status === 429, String(r.status));

    console.log('\nThrottle');
    for (let i = 0; i < 8; i++) {
      await call('/api/staff/auth/login', { method: 'POST', body: { user: 'yotam', pass: 'guess' + i } });
    }
    r = await call('/api/staff/auth/login', { method: 'POST', body: { user: 'yotam', pass: 'brand-new-pass' } });
    ok('repeated failures lock the account out, right password included', r.status === 429, String(r.status));

    console.log('\nLogout + delete');
    r = await call('/api/staff/auth/logout', { method: 'POST', cookie: teacher2 });
    ok('logout clears the cookie', r.body.ok === true && /Max-Age=0/.test(r.rawCookie));
    ok('logged-out session is dead server-side', (await call('/api/staff/auth/me', { cookie: teacher2 })).body.ok === false);
    ok('delete works', (await call('/api/staff/users/' + teacherId, { method: 'DELETE', cookie: admin })).body.ok === true);
    ok('deleted account is gone', (await call('/api/staff/auth/login', {
      method: 'POST', body: { user: 'yotam', pass: 'brand-new-pass' } })).status === 401);

    console.log('\nServing');
    /* redirect:'manual' throughout — following one would leave the harness
       chasing the asset server's own .html/stem bounce. */
    ok('bare domain serves the landing page', (await call('/')).status === 200);
    ok('dashboard serves', (await call('/dashboard')).status === 200);
    ok('mobile serves', (await call('/mobile')).status === 200);
    /* The .html form must redirect to the stem, not loop back to itself —
       rewriting '/' to '/index.html' in the Worker used to do exactly that. */
    const bounce = await call('/dashboard.html');
    ok('.html form redirects to the stem', bounce.status === 307 || bounce.status === 308, String(bounce.status));
    ok('unknown API path 404s as JSON', (await call('/api/staff/nope')).status === 404);
    /* docs/ is the asset root, so nothing outside it is reachable. */
    ok('source .dc.html is not served', (await call('/Teacher%20Dashboard%20v2.dc.html')).status === 404);
    ok('uploads/ is not served', (await call('/uploads/notebooks.docx')).status === 404);
    ok('functions/ is not served', (await call('/functions/_staff.js')).status === 404);
  } catch (e) {
    failed++;
    console.log('  ✗ suite threw:', e && e.message);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  cleanup(failed ? 1 : 0);
})();
