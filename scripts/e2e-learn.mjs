#!/usr/bin/env node
/* End-to-end validation of New School Cycles against a local Worker + D1.

     npm run test:learn

   Boots `wrangler dev` on its own persisted state (.wrangler/e2e-learn), so it
   never touches the development database. Seeds the schema, the Spanish
   content and the demo accounts (with a throwaway pepper), then walks the ten
   required flows and the access rules through the real API. When Playwright
   is available it finishes with browser checks: text direction, mobile width,
   and no lesson numbering or forced sequence in the student interface.

   Exits non-zero if anything fails. */

import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const PORT = 8974;
const B = `http://127.0.0.1:${PORT}`;
const PEPPER = 'e2e-learn-pepper';
const PERSIST = '.wrangler/e2e-learn';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
const section = s => console.log('\n' + s);

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body === undefined && method !== 'GET') body = {};      // as the page does: every write is JSON
  if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual', signal: AbortSignal.timeout(30000) });
  let j = null;
  const text = await r.text();
  try { j = JSON.parse(text); } catch { }
  const set = r.headers.get('set-cookie') || '';
  return { status: r.status, body: j || {}, text, cookie: set.split(';')[0], headers: r.headers };
}

const cid = () => 'e2e' + Math.random().toString(36).slice(2, 14).padEnd(12, 'x');

function run(args) {
  const r = spawnSync('npx', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(args.join(' '), r.stderr.slice(0, 600)); process.exit(1); }
}

(async () => {
  spawnSync('pkill', ['-9', '-f', `dev --port ${PORT}`]);
  spawnSync('pkill', ['-9', '-f', `entry=localhost:${PORT}`]);
  rmSync(PERSIST, { recursive: true, force: true });
  run(['wrangler', 'd1', 'execute', 'teacher-room', '--local', '--persist-to', PERSIST, '--file=schema.sql']);
  spawnSync('node', ['scripts/build-seed.mjs'], { stdio: 'ignore' });
  run(['wrangler', 'd1', 'execute', 'teacher-room', '--local', '--persist-to', PERSIST, '--file=seed/content.sql']);
  const demo = spawnSync('node', ['scripts/seed-demo.mjs'], { env: { ...process.env, DEMO_PEPPER: PEPPER, DEMO_SQL_OUT: PERSIST + '/demo.sql' }, encoding: 'utf8' });
  if (demo.status !== 0) { console.error(demo.stderr); process.exit(1); }
  run(['wrangler', 'd1', 'execute', 'teacher-room', '--local', '--persist-to', PERSIST, `--file=${PERSIST}/demo.sql`]);

  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', PERSIST,
    '--var', `STUDENT_CODE_PEPPER:${PEPPER}`, '--var', 'DEMO_MODE:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', () => { }); dev.stderr.on('data', () => { });
  const cleanup = code => { try { dev.kill('SIGKILL'); } catch { } spawnSync('pkill', ['-9', '-f', `dev --port ${PORT}`]); spawnSync('pkill', ['-9', '-f', `entry=localhost:${PORT}`]); process.exit(code); };
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(B + '/api/learn/config'); up = r.ok; } catch { }
    if (!up) await new Promise(r => setTimeout(r, 1000));
  }
  if (!up) { console.error('wrangler dev never came up'); cleanup(1); }

  try {
    await suite();
    await ui();
  } catch (e) {
    failed++; console.error('suite crashed:', e);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  cleanup(failed ? 1 : 0);
})();

async function student(code) {
  const r = await call('/api/staff/auth/code', { method: 'POST', body: { code } });
  return r.cookie;
}
async function staff(user, pass) {
  const r = await call('/api/staff/auth/login', { method: 'POST', body: { user, pass } });
  return r.cookie;
}

async function suite() {
  section('Sign-in');
  const S1 = await student('DEMA-ESAA');
  const S2 = await student('dema esbb');
  const S12 = await student('DEMAESCC');
  const ADMIN = await staff('demo-admin', 'demo-admin-2026');
  const TEACH = await staff('demo-teacher', 'demo-teacher-2026');
  const OFFICE = await staff('demo-office', 'demo-office-2026');
  ok('three students and three staff sign in', [S1, S2, S12, ADMIN, TEACH, OFFICE].every(c => c && c.startsWith('ns_staff=')));
  ok('unauthenticated learn API → 401', (await call('/api/learn/me')).status === 401);

  section('1 · Only enrolled, published courses and levels');
  const me1 = (await call('/api/learn/me', { cookie: S1 })).body;
  const me2 = (await call('/api/learn/me', { cookie: S2 })).body;
  const me12 = (await call('/api/learn/me', { cookie: S12 })).body;
  ok('Level 1 student sees exactly Spanish Level 1', JSON.stringify(me1.enrollments.map(e => e.id)) === '["es-1"]');
  ok('Level 2 student sees exactly Spanish Level 2', JSON.stringify(me2.enrollments.map(e => e.id)) === '["es-2"]');
  ok('multi-enrollment student sees both and can switch', JSON.stringify(me12.enrollments.map(e => e.id)) === '["es-1","es-2"]');
  ok('no draft language appears', me1.enrollments.every(e => e.language === 'es'));
  const cfg = (await call('/api/learn/config')).body;
  ok('demo mode is flagged by the server', cfg.demo === true);

  section('2 · Any topic in the assigned level, no numbering, no order');
  const tl = (await call('/api/learn/levels/es-1/topics', { cookie: S1 })).body;
  ok('Level 1 has 19 published topics', tl.topics && tl.topics.length === 19, tl.topics && tl.topics.length);
  const numbered = tl.topics.filter(x => /^(\d|שיעור|יחידה|lesson|unit)/i.test(x.title_he) || /\b(lesson|unidad)\s*\d/i.test(x.title_target));
  ok('no topic title carries a lesson number', numbered.length === 0, numbered.map(x => x.title_he).join(','));
  ok('topic list exposes no order field', tl.topics.every(x => !('sort' in x) && !('unit' in x) && !('source_ref' in x)));
  let allOpen = true;
  for (const tp of tl.topics) {
    const r = await call(`/api/learn/topics/${tp.id}`, { cookie: S1 });
    if (r.status !== 200) allOpen = false;
  }
  ok('every published topic opens without prerequisites', allOpen);
  const topic = (await call('/api/learn/topics/es1-charla-informal', { cookie: S1 })).body;
  ok('topic has objective, two skills and activities', topic.topic.objective && topic.topic.skills.length === 2 && topic.exercises.length === 16);
  const tjson = JSON.stringify(topic.exercises.map(e => ({ ...e, state: undefined })));
  ok('no answer key in the activities sent to the student', topic.exercises.every(e => !('key' in e)) && !tjson.includes('"answers"') && !tjson.includes('key_json') && !tjson.includes('"choice":') && !tjson.includes('"pairs"') && !tjson.includes('"models"') && !tjson.includes('"order":'));
  const l2topic = (await call('/api/learn/levels/es-2/topics', { cookie: S2 })).body.topics[0];

  section('3 · Activities and accurate feedback');
  const ex2 = topic.exercises.find(e => e.id === 'es1-charla-informal-02');
  const right = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0, 7: 0 };
  let r = await call(`/api/learn/exercises/${ex2.id}/check`, { method: 'POST', cookie: S1, body: { client_id: cid(), answers: right } });
  ok('all-correct choice answers graded correct', r.body.summary && r.body.summary.correct === 8 && r.body.summary.completed, JSON.stringify(r.body.summary));
  const ex5 = 'es1-charla-informal-05';
  const c1 = cid();
  r = await call(`/api/learn/exercises/${ex5}/check`, { method: 'POST', cookie: S1, body: { client_id: c1, answers: { 0: 'yo vivo en tel aviv', 1: 'Como te llamas' } } });
  ok('optional subject pronoun and case/punctuation accepted', r.body.results[0].status === 'correct');
  ok('missing accent on a question word is "almost", not right', r.body.results[1].status === 'almost');
  ok('specific feedback names the word', JSON.stringify(r.body.results[1].feedback).includes('como'));
  ok('first miss does not reveal the answer', !r.body.results[1].expected && r.body.results[1].can_reveal);
  const again = await call(`/api/learn/exercises/${ex5}/check`, { method: 'POST', cookie: S1, body: { client_id: c1, answers: { 0: 'x', 1: 'y' } } });
  ok('double submit with the same id is one attempt (replayed)', again.body.replayed === true && again.body.results[0].status === 'correct');
  r = await call(`/api/learn/exercises/${ex5}/check`, { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 1: 'Donde te llamas' } } });
  ok('retry only changes the retried item', r.body.results.length === 1 && r.body.results[0].i === 1);
  ok('second miss reveals the answer', r.body.results[0].expected === '¿Cómo te llamas?');
  r = await call(`/api/learn/exercises/${ex5}/check`, { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 1: '¿Cómo te llamas?' } } });
  ok('corrected answer is right', r.body.results[0].status === 'correct');
  r = await call('/api/learn/exercises/es1-charla-informal-06/check', { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'De Argentina' } } });
  ok('reading answer judged on content ("De Argentina")', r.body.results[0].status === 'correct', JSON.stringify(r.body.results[0]));
  r = await call('/api/learn/exercises/es1-charla-informal-14/check', { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: ['D', 'A', 'C', 'B', 'E'] } } });
  ok('dialogue order graded', r.body.results[0].status === 'correct');
  r = await call('/api/learn/exercises/es1-charla-informal-11/check', { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'D', 1: 'A' } } });
  ok('matching graded per row', r.body.results[0].status === 'correct' && r.body.results[1].status === 'incorrect');
  r = await call('/api/learn/exercises/es1-charla-informal-16/check', { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'x' } } });
  ok('open writing is not auto-graded', r.status === 400);
  r = await call('/api/learn/exercises/es1-charla-informal-16/self', { method: 'POST', cookie: S1, body: { client_id: cid(), text: 'Me llamo Ana.', rating: 'almost' } });
  ok('open writing returns model + criteria for self-review', r.body.models.length === 1 && r.body.criteria && r.body.completed);

  section('4 · Save, leave and resume');
  await call('/api/learn/exercises/es1-familia-03/state', { method: 'PUT', cookie: S1, body: { state: { values: { 0: 'Mi hermana se llama Ana.' } } } });
  const d1 = (await call('/api/learn/levels/es-1/dashboard', { cookie: S1 })).body;
  ok('dashboard offers to resume the unfinished activity', d1.resume && d1.resume.exercise_id === 'es1-familia-03');
  const S1b = await student('DEMA-ESAA');                    // another device
  const t2 = (await call('/api/learn/topics/es1-familia', { cookie: S1b })).body;
  ok('saved answers come back on a new session', t2.exercises.find(e => e.id === 'es1-familia-03').state.values[0] === 'Mi hermana se llama Ana.');
  ok('completion and accuracy kept separate from mastery', d1.overall.activities_completed === 3 && d1.overall.evidence_items === 0);
  ok('topic statuses reported', d1.counts.in_progress >= 1 && d1.counts.new >= 1);

  section('5 · Mistakes and saved items');
  r = await call('/api/learn/exercises/es1-charla-informal-03/check', { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'Yo soy trabajo en una escuela.' } } });
  const rev = (await call('/api/learn/levels/es-1/review', { cookie: S1 })).body;
  ok('wrong item listed for review', rev.mistakes.some(m => m.exercise_id === 'es1-charla-informal-03' && m.item_idx === 0));
  const sess = (await call('/api/learn/levels/es-1/review/session?source=mistakes', { cookie: S1 })).body;
  ok('mistake review session built from own mistakes', sess.items.length >= 1 && sess.items.every(i => i.exercise_id.startsWith('es1-')));
  ok('review items carry no answers', !JSON.stringify(sess).includes('"answers"'));
  const item = sess.items.find(i => i.exercise_id === 'es1-charla-informal-03');
  r = await call('/api/learn/items/check', { method: 'POST', cookie: S1, body: { client_id: cid(), exercise_id: item.exercise_id, item_idx: item.item_idx, value: 'Yo trabajo en una escuela.' } });
  ok('review item checked', r.body.results[0].status === 'correct');
  r = await call('/api/learn/saved', { method: 'POST', cookie: S1, body: { kind: 'word', ref: 'abuela', level_id: 'es-1' } });
  ok('save a word from the level', r.body.saved === true);
  r = await call('/api/learn/saved', { method: 'POST', cookie: S1, body: { kind: 'exercise', ref: 'es1-charla-informal-05', level_id: 'es-1' } });
  const saved = (await call('/api/learn/levels/es-1/saved', { cookie: S1 })).body;
  ok('saved list holds word and activity', saved.items.length === 2);

  section('6 · Gamification on and off');
  r = await call('/api/learn/prefs', { method: 'PATCH', cookie: S1, body: { gamification: true, weekly_goal: 4 } });
  let dg = (await call('/api/learn/levels/es-1/dashboard', { cookie: S1 })).body;
  ok('Challenge Mode shows XP, goal and badges', dg.game && dg.game.xp > 0 && dg.game.weekly_goal === 4 && dg.game.badges.length === 7);
  const g = (await call('/api/learn/levels/es-1/game?game=sprint', { cookie: S1 })).body;
  ok('sprint game from enrolled vocabulary', g.questions && g.questions.length === 20);
  r = await call('/api/learn/levels/es-1/game', { method: 'POST', cookie: S1, body: { game: 'sprint', score: 60, total: 60, duration_ms: 90000 } });
  const r2 = await call('/api/learn/levels/es-1/game', { method: 'POST', cookie: S1, body: { game: 'sprint', score: 60, total: 60, duration_ms: 90000 } });
  ok('game XP is capped per day', r.body.xp_gained === 10 && r2.body.xp_gained === 0);
  const before = dg.overall.activities_completed;
  await call('/api/learn/prefs', { method: 'PATCH', cookie: S1, body: { gamification: false } });
  dg = (await call('/api/learn/levels/es-1/dashboard', { cookie: S1 })).body;
  ok('Practice Mode hides game layer, keeps progress', dg.game === null && dg.overall.activities_completed === before);

  section('Level 1 ↔ Level 2 isolation (links and API)');
  const L2ex = (await call(`/api/learn/topics/${l2topic.id}`, { cookie: S2 })).body.exercises[0].id;
  const probes = [
    ['GET', '/api/learn/levels/es-2/topics'], ['GET', '/api/learn/levels/es-2/dashboard'], ['GET', `/api/learn/topics/${l2topic.id}`],
    ['GET', '/api/learn/levels/es-2/glossary'], ['GET', '/api/learn/levels/es-2/review/session'], ['GET', '/api/learn/levels/es-2/game?game=memory'],
    ['GET', '/api/learn/levels/es-2/progress'], ['GET', '/api/learn/levels/es-3/topics'],
    ['POST', `/api/learn/exercises/${L2ex}/check`, { client_id: cid(), answers: { 0: 'x' } }],
    ['PUT', `/api/learn/exercises/${L2ex}/state`, { state: { values: {} } }],
    ['POST', '/api/learn/items/check', { client_id: cid(), exercise_id: L2ex, item_idx: 0, value: 'x' }],
    ['POST', '/api/learn/saved', { kind: 'exercise', ref: L2ex, level_id: 'es-2' }],
    ['POST', '/api/learn/saved', { kind: 'word', ref: 'aburrido', level_id: 'es-2' }]
  ];
  let blocked = 0;
  for (const [m, p, b] of probes) { const x = await call(p, { method: m, cookie: S1, body: b }); if (x.status === 403 && x.body.code === 'outside_enrollment') blocked++; else console.log('    leak?', m, p, x.status); }
  ok(`Level 1 student blocked from all ${probes.length} Level 2/3 requests`, blocked === probes.length);
  let blocked2 = 0;
  for (const p of ['/api/learn/levels/es-1/topics', '/api/learn/topics/es1-charla-informal', '/api/learn/levels/es-1/glossary']) {
    const x = await call(p, { cookie: S2 }); if (x.status === 403) blocked2++;
  }
  const x2 = await call('/api/learn/exercises/es1-charla-informal-02/check', { method: 'POST', cookie: S2, body: { client_id: cid(), answers: { 0: 0 } } });
  ok('Level 2 student blocked from Level 1 content and checks', blocked2 === 3 && x2.status === 403);
  const rev2 = (await call('/api/learn/levels/es-2/review', { cookie: S2 })).body;
  ok("Level 2 student's review holds none of Level 1's mistakes", rev2.mistakes.length === 0);
  ok('students cannot use staff endpoints', (await call('/api/manage/students', { cookie: S1 })).status === 403);
  ok('students cannot enroll themselves', (await call('/api/manage/enrollments', { method: 'POST', cookie: S1, body: { user_id: 'demo-s1', level_id: 'es-2' } })).status === 403);
  ok('staff are kept out of student endpoints', (await call('/api/learn/me', { cookie: ADMIN })).status === 403);

  section('7 · Enrollment changes by authorized staff');
  ok('teacher cannot change enrollments', (await call('/api/manage/enrollments', { method: 'POST', cookie: TEACH, body: { user_id: 'demo-s1', level_id: 'es-2' } })).status === 403);
  r = await call('/api/manage/enrollments', { method: 'POST', cookie: OFFICE, body: { user_id: 'demo-s1', level_id: 'es-2' } });
  ok('office enrolls the Level 1 student in Level 2', r.status === 201);
  const enrollId = r.body.id;
  ok('duplicate enrollment refused', (await call('/api/manage/enrollments', { method: 'POST', cookie: OFFICE, body: { user_id: 'demo-s1', level_id: 'es-2' } })).status === 409);
  ok('Level 2 now opens for that student', (await call(`/api/learn/topics/${l2topic.id}`, { cookie: S1 })).status === 200);
  r = await call(`/api/learn/exercises/${L2ex}/check`, { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'zzz', 1: 'Corrí' } } });
  ok('practice recorded in Level 2', r.status === 200);

  section('8 · History kept, access withdrawn');
  r = await call(`/api/manage/enrollments/${enrollId}/end`, { method: 'POST', cookie: ADMIN });
  ok('enrollment ended', r.status === 200);
  ok('Level 2 closed again immediately', (await call(`/api/learn/topics/${l2topic.id}`, { cookie: S1 })).status === 403);
  const meAfter = (await call('/api/learn/me', { cookie: S1 })).body;
  ok('student sees a history line for the ended level, no content', meAfter.past.some(p => p.level_id === 'es-2') && !JSON.stringify(meAfter.past).includes('es2-'));
  const s1rev = (await call('/api/learn/levels/es-1/review/session?source=mixed', { cookie: S1 })).body;
  ok('review stays inside current enrollments', s1rev.items.every(i => i.exercise_id.startsWith('es1-')));
  const rep = (await call('/api/manage/students/demo-s1/progress', { cookie: ADMIN })).body;
  const l2rep = rep.levels.find(l => l.level_id === 'es-2');
  ok('staff report keeps the Level 2 history', l2rep && l2rep.summary.activities_completed + l2rep.topics.reduce((s, x) => s + x.seen, 0) > 0 && l2rep.enrollment[0].status === 'ended');
  ok('staff report separates completion, accuracy and evidence', rep.levels[0].summary && 'accuracy' in rep.levels[0].summary && 'evidence' in rep.levels[0].summary);

  section('9 · Draft course in another language: create and preview');
  const courses = (await call('/api/manage/courses', { cookie: ADMIN })).body;
  ok('all seven languages in the admin area', courses.languages.map(l => l.id).join() === 'es,en,de,it,fr,ar,el');
  ok('six additional languages start as Draft', courses.languages.filter(l => l.id !== 'es').every(l => l.status === 'draft'));
  ok('empty language cannot be published', (await call('/api/manage/languages/en', { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } })).status === 409);
  ok('teacher cannot create levels', (await call('/api/manage/levels', { method: 'POST', cookie: TEACH, body: { language_id: 'en', number: 1 } })).status === 403);
  r = await call('/api/manage/levels', { method: 'POST', cookie: ADMIN, body: { language_id: 'en', number: 1, name_he: 'אנגלית רמה 1', cefr: 'A1' } });
  ok('English Level 1 created (draft)', r.status === 201 && r.body.id === 'en-1');
  r = await call('/api/manage/levels/en-1/cycles', { method: 'POST', cookie: ADMIN, body: { title_he: 'בעיר' } });
  const cycleId = r.body.id;
  ok('topic titled "Lesson 3" refused', (await call('/api/manage/levels/en-1/topics', { method: 'POST', cookie: ADMIN, body: { title_he: 'שיעור 3' } })).status === 400);
  r = await call('/api/manage/levels/en-1/topics', { method: 'POST', cookie: ADMIN, body: { title_he: 'במסעדה', title_target: 'At a Restaurant', cycle_id: cycleId, objective: 'DEMO — להזמין אוכל במסעדה' } });
  const enTopic = r.body.id;
  ok('topic created', r.status === 201);
  r = await call(`/api/manage/topics/${enTopic}/exercises`, { method: 'POST', cookie: ADMIN, body: {
    kind: 'gap', title: 'DEMO — Ordering', skill: 'grammar', instructions: 'השלימו',
    body: { items: [{ prompt: "I'd like ___ water, please.", input: 'text' }, { prompt: 'Can I have the ___?', input: 'choice', options: ['menu', 'many'] }] },
    key: { items: [{ answers: ['some', 'a glass of'] }, { choice: 0 }] } } });
  ok('exercise added', r.status === 201);
  const enEx = r.body.id;
  ok('invalid exercise refused by server validation', (await call(`/api/manage/topics/${enTopic}/exercises`, { method: 'POST', cookie: ADMIN, body: { kind: 'gap', title: 'x', body: { items: [{ prompt: 'a' }] }, key: { items: [] } } })).status === 400);
  const prev = await call(`/api/manage/preview/topics/${enTopic}`, { cookie: ADMIN });
  ok('staff preview renders the draft topic', prev.status === 200 && prev.body.preview && prev.body.exercises.length === 1);
  r = await call(`/api/manage/preview/exercises/${enEx}/check`, { method: 'POST', cookie: ADMIN, body: { answers: { 0: 'A glass of', 1: 0 } } });
  ok('preview check grades without recording', r.body.results.every(x => x.status === 'correct') && r.body.preview);
  const empty = (await call('/api/manage/levels/en-1/topics', { method: 'POST', cookie: ADMIN, body: { title_he: 'בשדה התעופה' } })).body.id;
  ok('topic without exercises cannot be published', (await call(`/api/manage/topics/${empty}`, { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } })).status === 409);
  ok('teacher cannot publish', (await call(`/api/manage/topics/${enTopic}`, { method: 'PATCH', cookie: TEACH, body: { status: 'published' } })).status === 403);
  ok('level with no published topic cannot be published', (await call('/api/manage/levels/en-1', { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } })).status === 409);

  section('10 · Draft courses stay closed to students');
  await call('/api/manage/enrollments', { method: 'POST', cookie: ADMIN, body: { user_id: 'demo-s1', level_id: 'en-1' } });
  const probesDraft = async () => {
    const a = await call('/api/learn/levels/en-1/topics', { cookie: S1 });
    const b = await call(`/api/learn/topics/${enTopic}`, { cookie: S1 });
    const c = await call(`/api/learn/exercises/${enEx}/check`, { method: 'POST', cookie: S1, body: { client_id: cid(), answers: { 0: 'some' } } });
    const m = (await call('/api/learn/me', { cookie: S1 })).body;
    return a.status === 403 && b.status === 403 && c.status === 403 && !m.enrollments.some(e => e.id === 'en-1');
  };
  ok('enrolled in a draft level: invisible and unreachable', await probesDraft());
  await call(`/api/manage/topics/${enTopic}`, { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } });
  await call('/api/manage/levels/en-1', { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } });
  ok('published level of a draft language: still closed', await probesDraft());
  r = await call('/api/manage/languages/en', { method: 'PATCH', cookie: ADMIN, body: { status: 'published' } });
  ok('language published once it has content', r.status === 200);
  ok('now it opens for the enrolled student', (await call(`/api/learn/topics/${enTopic}`, { cookie: S1 })).status === 200);
  await call('/api/manage/languages/en', { method: 'PATCH', cookie: ADMIN, body: { status: 'draft' } });
  ok('back to draft closes it again', (await call(`/api/learn/topics/${enTopic}`, { cookie: S1 })).status === 403);

  section('Language-specific answers (Arabic RTL preview)');
  await call('/api/manage/levels', { method: 'POST', cookie: ADMIN, body: { language_id: 'ar', number: 1 } });
  r = await call('/api/manage/levels/ar-1/topics', { method: 'POST', cookie: ADMIN, body: { title_he: 'היכרות', title_target: 'تعارف' } });
  const arTopic = r.body.id;
  r = await call(`/api/manage/topics/${arTopic}/exercises`, { method: 'POST', cookie: ADMIN, body: {
    kind: 'recall', title: 'DEMO — מילים', skill: 'vocab', body: { items: [{ prompt: 'ספר ___', input: 'text' }, { prompt: 'אכל ___', input: 'text' }] },
    key: { items: [{ answers: ['كِتَاب'] }, { answers: ['أكل'] }] } } });
  r = await call(`/api/manage/preview/exercises/${r.body.id}/check`, { method: 'POST', cookie: ADMIN, body: { answers: { 0: 'كتاب', 1: 'اكل' } } });
  ok('Arabic: short-vowel marks optional by default', r.body.results[0].status === 'correct');
  ok('Arabic: hamza on alef stays significant by default', r.body.results[1].status !== 'correct');
  const arLevel = (await call('/api/manage/levels/ar-1', { cookie: ADMIN })).body.level;
  ok('Arabic content direction is RTL', arLevel.lang.dir === 'rtl');

  section('Teacher scope');
  ok('teacher sees assigned Level 1', (await call('/api/manage/levels/es-1', { cookie: TEACH })).status === 200);
  ok('teacher refused an unassigned level', (await call('/api/manage/levels/es-2', { cookie: TEACH })).status === 403);
  const ts = (await call('/api/manage/students', { cookie: TEACH })).body.students.map(s => s.id);
  ok('teacher sees only students of their levels', ts.includes('demo-s1') && ts.includes('demo-s12') && !ts.includes('demo-s2'));
  ok("teacher refused an unassigned student's report", (await call('/api/manage/students/demo-s2/progress', { cookie: TEACH })).status === 404);
  const tp = (await call('/api/manage/students/demo-s12/progress', { cookie: TEACH })).body;
  ok("teacher sees only their level in a student's report", tp.levels.every(l => l.level_id === 'es-1'));
  r = await call('/api/manage/levels/es-1/assignments', { method: 'POST', cookie: TEACH, body: { topic_ids: ['es1-familia', 'es1-comidas'], note: 'לשבוע הזה' } });
  ok('teacher assigns practice (a set, not a sequence)', r.status === 201);
  const da = (await call('/api/learn/levels/es-1/dashboard', { cookie: S12 })).body;
  ok('student sees the suggestion', da.assignments.length === 1 && da.assignments[0].topics.length === 2);
  ok('teacher cannot toggle Challenge Mode', (await call('/api/manage/levels/es-1', { method: 'PATCH', cookie: TEACH, body: { challenge_enabled: false } })).status === 403);
  await call('/api/manage/levels/es-1', { method: 'PATCH', cookie: ADMIN, body: { challenge_enabled: false } });
  ok('Challenge Mode off for the course → games refused', (await call('/api/learn/levels/es-1/game?game=memory', { cookie: S1 })).status === 403);
  await call('/api/manage/levels/es-1', { method: 'PATCH', cookie: ADMIN, body: { challenge_enabled: true } });
  const report = (await call('/api/manage/levels/es-1/report', { cookie: TEACH })).body;
  ok('level report lists students and items needing review', report.students.length >= 2 && Array.isArray(report.hard_items));

  section('Alternative answers');
  await call('/api/learn/exercises/es1-charla-informal-13/check', { method: 'POST', cookie: S12, body: { client_id: cid(), answers: { 0: 'Vive en Madrid.' } } });
  await call('/api/learn/exercises/es1-charla-informal-13/flag', { method: 'POST', cookie: S12, body: { item_idx: 0, answer: 'Vive en Madrid.' } });
  const flags = (await call('/api/manage/levels/es-1/flags', { cookie: TEACH })).body.flags;
  ok('student proposal reaches the teacher', flags.length === 1);
  await call(`/api/manage/flags/${flags[0].id}`, { method: 'POST', cookie: TEACH, body: { decision: 'accept' } });
  r = await call('/api/learn/exercises/es1-charla-informal-13/check', { method: 'POST', cookie: S12, body: { client_id: cid(), answers: { 0: 'Vive en Madrid.' } } });
  ok('accepted alternative is now graded right', r.body.results[0].status === 'correct');

  section('Security edges');
  const csrf = await call('/api/learn/exercises/es1-charla-informal-02/check', { method: 'POST', cookie: S1, body: JSON.stringify({ client_id: cid(), answers: {} }), headers: { 'content-type': 'text/plain' } });
  ok('non-JSON write refused (CSRF)', csrf.status === 403);
  const cross = await call('/api/learn/prefs', { method: 'PATCH', cookie: S1, body: { gamification: true }, headers: { origin: 'https://evil.example' } });
  ok('cross-origin write refused', cross.status === 403);
  ok('protected responses are not cacheable', (await call('/api/learn/levels/es-1/topics', { cookie: S1 })).headers.get('cache-control').includes('no-store'));
  ok('unknown media refused', (await call('/api/learn/media/nope', { cookie: S1 })).status === 403);
  const shell = await call('/learn/');
  ok('app page served with a strict Content-Security-Policy', shell.status === 200 && /frame-ancestors 'none'/.test(shell.headers.get('content-security-policy') || ''));
  const bundle = (await call('/learn/app.js')).text;
  ok('app bundle contains no course content or keys', bundle.length > 1000 && !bundle.includes('Charla informal') && !bundle.includes('Me gustan los libros') && !bundle.includes('Yo trabajo en una escuela'));
  for (const p of ['/content/spanish/level-1.json', '/seed/content.sql', '/learn-src/main.jsx', '/content/source/spanish-practice/dist/practice/level-1/', '/functions/learn/grade.js']) {
    const x = await call(p);
    ok(`not served: ${p}`, x.status === 404 || !x.text.includes('Charla'), x.status);
  }
}

async function ui() {
  let chromium;
  const require = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { ({ chromium } = require(p)); break; } catch { }
  }
  if (!chromium) { console.log('\n(Playwright not found — browser checks skipped)'); return; }
  section('Browser: direction, mobile, no numbering');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(B + '/learn/');
    await page.fill('#code', 'DEMA-ESBB');
    await page.click('button[type=submit]');
    await page.waitForSelector('text=שלום');
    ok('interface is Hebrew RTL', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'he'));
    const FORBIDDEN = /(שיעור|יחידה)\s*\d|\bLesson\s*\d|\bUnit\s*\d|השיעור הבא|השיעור הקודם|Next lesson|Previous lesson/i;
    const pages = ['#/', '#/l/es-2/topics', '#/l/es-2/review', '#/l/es-2/progress', '#/l/es-2/glossary'];
    const tlist = await page.evaluate(() => fetch('/api/learn/levels/es-2/topics').then(r => r.json()));
    const tp = tlist.topics[0].id;
    pages.push(`#/t/${tp}`);
    let overflow = [], numbered = [];
    for (const h of pages) {
      await page.goto(B + '/learn/' + h);
      await page.waitForSelector('main h1', { timeout: 15000 });
      await page.waitForTimeout(400);
      const txt = await page.evaluate(() => document.querySelector('main').innerText);
      if (FORBIDDEN.test(txt)) numbered.push(h + ': ' + txt.match(FORBIDDEN)[0]);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) overflow.push(h);
    }
    ok('no lesson numbers or next/previous lesson on student pages', !numbered.length, numbered.join('; '));
    ok('no horizontal scrolling at 375px', !overflow.length, overflow.join(','));
    await page.goto(B + `/learn/#/t/${tp}`);
    await page.waitForSelector('.activity');
    const ex = await page.getAttribute('.activity', 'href');
    await page.goto(B + '/learn/' + ex);
    await page.waitForSelector('.items, .match-table, .order-list, textarea');
    const dirs = await page.evaluate(() => [...document.querySelectorAll('.tl-block, .answer-input, .gap-input')].map(e => e.getAttribute('dir') || getComputedStyle(e).direction));
    ok('Spanish content and answer fields are LTR', dirs.length > 0 && dirs.every(d => d === 'ltr'), dirs.join(','));
    await page.goto(B + '/learn/#/t/es1-charla-informal');
    await page.waitForSelector('text=התוכן הזה לא פתוח עבורכם');
    ok('restricted link shows the friendly message', true);
    await page.goto(B + '/learn/#/l/es-1/topics');
    await page.waitForSelector('text=התוכן הזה לא פתוח עבורכם');
    ok('restricted level link shows the friendly message', true);
    await page.goto(B + '/learn/#/');
    await page.waitForSelector('text=שלום');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return e.tagName + ' ' + s.outlineStyle; });
    ok('keyboard focus is visible', /solid/.test(focus), focus);
    ok('no script errors', !errs.length, errs.join('; '));
  } finally {
    await browser.close();
  }
}
