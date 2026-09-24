/* /api/manage/* — the staff side of the practice platform.

   Permissions are decided here, in the Worker, per request (see can() in
   _core.js). The admin screens hide what a role cannot do, but that is a
   convenience; these checks are the boundary.

     אדמין         everything, including which levels each teacher teaches
     מנהל פדגוגי   all content (edit, preview, publish), all students, enrollments
     מנהלת קבלה    student accounts, entry codes and enrollments; no content
     מורה          only assigned levels: edit and preview drafts, see those
                   levels' students and progress, assign practice, issue codes.
                   Cannot publish and cannot change enrollments. */

import {
  ok, fail, body, parse, now, randomId, requireStaff, can, isTeacher, visibleStudentIds,
  levelLanguage, levelShape, exerciseShape, exerciseForGrading, topicSummary, strOr, STUDENT_ROLE
} from './_core.js';
import { gradeItem, itemCount, isRight } from './grade.js';
import { issueStudentCode, codeConfigured, formatCode } from '../_staff.js';
import { levelStatsFor } from './stats.js';

const STATUSES = ['draft', 'published'];
const ITEM_KINDS = ['recall', 'gap', 'choice', 'bank', 'correction', 'transform', 'translate', 'conjugation', 'reading', 'wordorder', 'selftest', 'listening'];
const INPUTS = ['text', 'sentence', 'choice', 'bank', 'tokens'];
const SKILLS = ['vocab', 'grammar', 'reading', 'writing', 'speaking', 'production', 'communication', 'listening', 'mixed'];

/* Ids stay ASCII so every route pattern matches them; a title in Hebrew,
   Arabic or Greek simply yields the generic stem plus a random suffix. */
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/* ── who am I, what may I do ─────────────────────────────────────────── */

export async function getManageMe({ request, env }) {
  const s = await requireStaff(request, env);
  if (s.res) return s.res;
  const c = s.ctx;
  const perms = {};
  for (const a of ['content.view', 'content.edit', 'content.publish', 'course.structure', 'students.view',
    'students.create', 'students.code', 'enroll', 'progress.view', 'assign', 'flags.review', 'teachers.assign']) {
    perms[a] = can(c, a);
  }
  return ok({
    ok: true, user: { id: s.user.id, name: s.user.name, role: s.user.role, mustChange: !!s.user.must_change },
    perms, teacher_levels: [...c.teacherLevels], code_login: codeConfigured(env)
  });
}

/* ── courses ─────────────────────────────────────────────────────────── */

export async function getCourses({ request, env }) {
  const s = await requireStaff(request, env);
  if (s.res) return s.res;
  const [langs, levels, counts, enr] = await Promise.all([
    env.DB.prepare('SELECT * FROM languages ORDER BY sort').all(),
    env.DB.prepare('SELECT * FROM levels ORDER BY number').all(),
    env.DB.prepare(`SELECT level_id, status, COUNT(*) AS n FROM topics GROUP BY level_id, status`).all(),
    env.DB.prepare(`SELECT level_id, COUNT(*) AS n FROM enrollments WHERE status='active' GROUP BY level_id`).all()
  ]);
  const C = {};
  for (const c of counts.results || []) (C[c.level_id] ||= { draft: 0, published: 0 })[c.status] = c.n;
  const E = Object.fromEntries((enr.results || []).map(e => [e.level_id, e.n]));
  const visibleLevel = l => !isTeacher(s.ctx) || s.ctx.teacherLevels.has(l.id);
  return ok({
    ok: true,
    languages: (langs.results || []).map(l => ({
      id: l.id, name_he: l.name_he, name_native: l.name_native, dir: l.dir, status: l.status,
      font_stack: l.font_stack, special_chars: parse(l.special_chars, []), normalize: parse(l.normalize, {}),
      levels: (levels.results || []).filter(x => x.language_id === l.id && visibleLevel(x)).map(x => ({
        id: x.id, number: x.number, name_he: x.name_he, name_target: x.name_target, cefr: x.cefr,
        status: x.status, challenge_enabled: !!x.challenge_enabled,
        topics: C[x.id] || { draft: 0, published: 0 }, enrolled: E[x.id] || 0
      }))
    }))
  });
}

export async function patchLanguage({ request, env, params }) {
  const s = await requireStaff(request, env, 'course.structure');
  if (s.res) return s.res;
  const lang = await env.DB.prepare('SELECT * FROM languages WHERE id=?').bind(params.id).first();
  if (!lang) return fail(404, 'השפה לא נמצאה.');
  const b = await body(request) || {};
  const f = {};
  if (b.name_he !== undefined) f.name_he = strOr(b.name_he, 60).trim() || lang.name_he;
  if (b.name_native !== undefined) f.name_native = strOr(b.name_native, 60).trim() || lang.name_native;
  if (b.dir !== undefined) f.dir = b.dir === 'rtl' ? 'rtl' : 'ltr';
  if (b.font_stack !== undefined) f.font_stack = strOr(b.font_stack, 200).replace(/[;{}<>]/g, '');
  if (b.special_chars !== undefined) f.special_chars = JSON.stringify((Array.isArray(b.special_chars) ? b.special_chars : []).map(c => strOr(c, 4)).slice(0, 40));
  if (b.normalize !== undefined) f.normalize = JSON.stringify(cleanPolicy(b.normalize, true));
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return fail(400, 'סטטוס לא תקין.');
    if (!can(s.ctx, 'content.publish')) return fail(403, 'פרסום שמור למנהל הפדגוגי ולאדמין.');
    if (b.status === 'published') {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM levels l WHERE l.language_id=? AND l.status='published'
        AND EXISTS (SELECT 1 FROM topics t WHERE t.level_id=l.id AND t.status='published')`).bind(lang.id).first();
      if (!r.n) return fail(409, 'אי אפשר לפרסם שפה בלי לפחות רמה אחת מפורסמת שיש בה נושאים מפורסמים. תלמידים לא רואים קורסים ריקים.');
    }
    f.status = b.status;
  }
  await update(env, 'languages', lang.id, f);
  return ok({ ok: true });
}

function cleanPolicy(p, lang = false) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  if (['strict', 'lenient'].includes(p.accents)) o.accents = p.accents;
  if (['ignore', 'strict'].includes(p.harakat)) o.harakat = p.harakat;
  if (['ignore', 'strict'].includes(p.tatweel)) o.tatweel = p.tatweel;
  if (['strict', 'lenient'].includes(p.alef)) o.alef = p.alef;
  if (['strict', 'lenient'].includes(p.eszett)) o.eszett = p.eszett;
  if (['ignore', 'strict'].includes(p.case)) o.case = p.case;
  if (['fold', 'strict'].includes(p.finalSigma)) o.finalSigma = p.finalSigma;
  if (['exact', 'content'].includes(p.match)) o.match = p.match;
  if (Array.isArray(p.optionalLeading)) o.optionalLeading = p.optionalLeading.map(w => strOr(w, 30)).filter(Boolean).slice(0, 30);
  if (lang && Array.isArray(p.stopwords)) o.stopwords = p.stopwords.map(w => strOr(w, 30)).filter(Boolean).slice(0, 200);
  return o;
}

async function update(env, table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const hasUpdated = ['languages', 'levels', 'topics', 'exercises'].includes(table);
  const sets = keys.map(k => `${k}=?`).concat(hasUpdated ? ['updated_at=?'] : []);
  const vals = keys.map(k => fields[k]).concat(hasUpdated ? [now()] : []);
  await env.DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id=?`).bind(...vals, id).run();
}

/* ── levels ──────────────────────────────────────────────────────────── */

export async function postLevel({ request, env }) {
  const s = await requireStaff(request, env, 'course.structure');
  if (s.res) return s.res;
  const b = await body(request) || {};
  const lang = await env.DB.prepare('SELECT * FROM languages WHERE id=?').bind(String(b.language_id || '')).first();
  if (!lang) return fail(400, 'בחרו שפה.');
  const number = Number(b.number);
  if (!Number.isInteger(number) || number < 1 || number > 20) return fail(400, 'מספר הרמה צריך להיות בין 1 ל־20.');
  const id = `${lang.id}-${number}`;
  if (await env.DB.prepare('SELECT id FROM levels WHERE id=?').bind(id).first()) return fail(409, `כבר קיימת ${lang.name_he} רמה ${number}.`);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO levels (id,language_id,number,name_he,name_target,cefr,description,status,challenge_enabled,rubric,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'draft',1,'[]',?,?)`
  ).bind(id, lang.id, number, strOr(b.name_he, 80).trim() || `${lang.name_he} רמה ${number}`,
    strOr(b.name_target, 80), strOr(b.cefr, 10), strOr(b.description, 400), t, t).run();
  return ok({ ok: true, id }, 201);
}

export async function patchLevel({ request, env, params }) {
  const level = await env.DB.prepare('SELECT * FROM levels WHERE id=?').bind(params.id).first();
  const s = await requireStaff(request, env, 'content.edit', level ? level.id : '');
  if (s.res) return s.res;
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const b = await body(request) || {};
  const f = {};
  const structural = ['name_he', 'name_target', 'cefr', 'description'].some(k => b[k] !== undefined);
  if (structural && !can(s.ctx, 'course.structure')) return fail(403, 'שינוי פרטי רמה שמור למנהל הפדגוגי ולאדמין.');
  if (b.name_he !== undefined) f.name_he = strOr(b.name_he, 80).trim() || level.name_he;
  if (b.name_target !== undefined) f.name_target = strOr(b.name_target, 80);
  if (b.cefr !== undefined) f.cefr = strOr(b.cefr, 10);
  if (b.description !== undefined) f.description = strOr(b.description, 400);
  if (b.challenge_enabled !== undefined) {
    if (!can(s.ctx, 'content.publish')) return fail(403, 'הפעלת מצב אתגר שמורה למנהל הפדגוגי ולאדמין.');
    f.challenge_enabled = b.challenge_enabled ? 1 : 0;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return fail(400, 'סטטוס לא תקין.');
    if (!can(s.ctx, 'content.publish')) return fail(403, 'פרסום שמור למנהל הפדגוגי ולאדמין.');
    if (b.status === 'published') {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM topics t WHERE t.level_id=? AND t.status='published'
        AND EXISTS (SELECT 1 FROM exercises e WHERE e.topic_id=t.id AND e.status='published')`).bind(level.id).first();
      if (!r.n) return fail(409, 'אי אפשר לפרסם רמה בלי לפחות נושא מפורסם אחד שיש בו פעילות. פרסמו קודם נושא.');
    }
    f.status = b.status;
  }
  await update(env, 'levels', level.id, f);
  return ok({ ok: true });
}

export async function deleteLevel({ request, env, params }) {
  const s = await requireStaff(request, env, 'course.structure');
  if (s.res) return s.res;
  const level = await env.DB.prepare('SELECT * FROM levels WHERE id=?').bind(params.id).first();
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  if (level.status !== 'draft') return fail(409, 'אפשר למחוק רק רמה בטיוטה. החזירו אותה קודם לטיוטה.');
  const e = await env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE level_id=?').bind(level.id).first();
  if (e.n) return fail(409, 'לרמה הזו היו תלמידים רשומים; היא נשמרת כדי לשמור את ההיסטוריה שלהם.');
  const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM topics WHERE level_id=?').bind(level.id).first();
  if (t.n) return fail(409, 'מחקו קודם את הנושאים שברמה.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cycles WHERE level_id=?').bind(level.id),
    env.DB.prepare('DELETE FROM teacher_levels WHERE level_id=?').bind(level.id),
    env.DB.prepare('DELETE FROM levels WHERE id=?').bind(level.id)
  ]);
  return ok({ ok: true });
}

export async function getLevel({ request, env, params }) {
  const level = await levelLanguage(env, params.id);
  const s = await requireStaff(request, env, 'content.view', level ? level.id : '');
  if (s.res) return s.res;
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const [cycles, topics, ex] = await Promise.all([
    env.DB.prepare('SELECT * FROM cycles WHERE level_id=? ORDER BY sort, title_he').bind(level.id).all(),
    env.DB.prepare('SELECT * FROM topics WHERE level_id=? ORDER BY title_he').bind(level.id).all(),
    env.DB.prepare(`SELECT e.topic_id, e.status, e.mode, e.body, e.kind FROM exercises e JOIN topics t ON t.id=e.topic_id WHERE t.level_id=?`).bind(level.id).all()
  ]);
  const X = {};
  for (const e of ex.results || []) {
    const x = (X[e.topic_id] ||= { published: 0, draft: 0, self: 0, audio_missing: 0 });
    x[e.status]++;
    if (e.mode === 'self') x.self++;
    const b = parse(e.body, {});
    if (e.kind === 'listening' && !b.audio) x.audio_missing++;
  }
  return ok({
    ok: true,
    level: { ...levelShape(level), status: level.status, lang_status: level.lang_status, rubric: parse(level.rubric, []) },
    cycles: cycles.results || [],
    topics: (topics.results || []).map(t => ({
      ...topicSummary(t), status: t.status, source_ref: t.source_ref, objective_source: t.objective_source,
      exercises: X[t.id] || { published: 0, draft: 0, self: 0, audio_missing: 0 }
    })),
    audio_available: false
  });
}

/* ── cycles (topic groups) ───────────────────────────────────────────── */

export async function postCycle({ request, env, params }) {
  const s = await requireStaff(request, env, 'content.edit', params.id);
  if (s.res) return s.res;
  const level = await env.DB.prepare('SELECT id FROM levels WHERE id=?').bind(params.id).first();
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const b = await body(request) || {};
  const title = strOr(b.title_he, 80).trim();
  if (!title) return fail(400, 'צריך שם לקבוצת הנושאים.');
  const id = `${level.id}-${slug(b.title_target || title) || 'group'}-${randomId('').slice(0, 5)}`;
  await env.DB.prepare('INSERT INTO cycles (id,level_id,title_he,title_target,description,sort,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, level.id, title, strOr(b.title_target, 80), strOr(b.description, 300), 50, now()).run();
  return ok({ ok: true, id }, 201);
}

export async function patchCycle({ request, env, params }) {
  const c = await env.DB.prepare('SELECT * FROM cycles WHERE id=?').bind(params.id).first();
  const s = await requireStaff(request, env, 'content.edit', c ? c.level_id : '');
  if (s.res) return s.res;
  if (!c) return fail(404, 'לא נמצא.');
  const b = await body(request) || {};
  const f = {};
  if (b.title_he !== undefined) f.title_he = strOr(b.title_he, 80).trim() || c.title_he;
  if (b.title_target !== undefined) f.title_target = strOr(b.title_target, 80);
  if (b.description !== undefined) f.description = strOr(b.description, 300);
  await update(env, 'cycles', c.id, f);
  return ok({ ok: true });
}

export async function deleteCycle({ request, env, params }) {
  const c = await env.DB.prepare('SELECT * FROM cycles WHERE id=?').bind(params.id).first();
  const s = await requireStaff(request, env, 'content.edit', c ? c.level_id : '');
  if (s.res) return s.res;
  if (!c) return fail(404, 'לא נמצא.');
  await env.DB.batch([
    env.DB.prepare('UPDATE topics SET cycle_id=NULL WHERE cycle_id=?').bind(c.id),
    env.DB.prepare('DELETE FROM cycles WHERE id=?').bind(c.id)
  ]);
  return ok({ ok: true });
}

/* ── topics ──────────────────────────────────────────────────────────── */

function topicFields(b, t) {
  const f = {};
  const str = (k, n) => { if (b[k] !== undefined) f[k] = strOr(b[k], n); };
  str('title_he', 120); str('title_target', 120); str('objective', 600);
  if (b.cycle_id !== undefined) f.cycle_id = b.cycle_id || null;
  const arr = (k, fn, n) => { if (b[k] !== undefined) f[k] = JSON.stringify((Array.isArray(b[k]) ? b[k] : []).map(fn).filter(Boolean).slice(0, n)); };
  arr('skills', x => x && (x.he || x.target) ? { he: strOr(x.he, 80), target: strOr(x.target, 120) } : null, 4);
  arr('grammar', x => strOr(x, 120).trim(), 10);
  arr('vocab', x => x && x.term ? { term: strOr(x.term, 120).trim(), he: strOr(x.he, 160).trim() } : null, 400);
  arr('self_check', x => strOr(x, 300).trim(), 10);
  arr('links', x => x && /^https:\/\//.test(String(x.url || '')) ? { label: strOr(x.label, 120), url: strOr(x.url, 400) } : null, 10);
  if (b.explanation !== undefined) {
    const e = b.explanation || {};
    const list = (v, n) => (Array.isArray(v) ? v : []).map(x => strOr(x, 800).trim()).filter(Boolean).slice(0, n);
    f.explanation = JSON.stringify({
      rules: list(e.rules, 12), examples: list(e.examples, 12), tips: list(e.tips, 6),
      mistakes: (Array.isArray(e.mistakes) ? e.mistakes : []).slice(0, 6).map(m => ({
        text: strOr(m && m.text, 800), pairs: (Array.isArray(m && m.pairs) ? m.pairs : []).slice(0, 6)
          .map(p => ({ bad: strOr(p.bad, 200), good: strOr(p.good, 200) }))
      }))
    });
  }
  if (f.title_he !== undefined && !f.title_he.trim()) f.title_he = t ? t.title_he : '';
  if (f.objective !== undefined) f.objective_source = 'staff';
  return f;
}

export async function postTopic({ request, env, params }) {
  const s = await requireStaff(request, env, 'content.edit', params.id);
  if (s.res) return s.res;
  const level = await env.DB.prepare('SELECT * FROM levels WHERE id=?').bind(params.id).first();
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const b = await body(request) || {};
  const title = strOr(b.title_he, 120).trim();
  if (!title) return fail(400, 'צריך כותרת נושא (למשל: „במסעדה“).');
  if (/^(שיעור|יחידה|lesson|unit)\s*\d+/i.test(title)) return fail(400, 'כותרת נושא לא כוללת מספר שיעור. תנו שם שמתאר את הנושא.');
  if (b.cycle_id) {
    const c = await env.DB.prepare('SELECT id FROM cycles WHERE id=? AND level_id=?').bind(b.cycle_id, level.id).first();
    if (!c) return fail(400, 'קבוצת הנושאים לא שייכת לרמה הזו.');
  }
  const id = `${level.id}-${slug(b.title_target || title) || 'topic'}-${randomId('').slice(0, 5)}`;
  const f = topicFields(b);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO topics (id,level_id,cycle_id,title_he,title_target,objective,objective_source,skills,grammar,explanation,vocab,self_check,links,status,source_ref,sort,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'staff',?,?,?,?,?,?,'draft','',0,?,?)`
  ).bind(id, level.id, f.cycle_id || null, title, f.title_target || '', f.objective || '', f.skills || '[]', f.grammar || '[]',
    f.explanation || '{"rules":[],"examples":[],"tips":[],"mistakes":[]}', f.vocab || '[]', f.self_check || '[]', f.links || '[]', t, t).run();
  return ok({ ok: true, id }, 201);
}

async function topicWithAccess(request, env, id, action) {
  const t = await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(String(id || '')).first();
  const s = await requireStaff(request, env, action, t ? t.level_id : '');
  if (s.res) return s;
  if (!t) return { res: fail(404, 'הנושא לא נמצא.') };
  return { ...s, topic: t };
}

export async function getManageTopic({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.view');
  if (s.res) return s.res;
  const { results } = await env.DB.prepare('SELECT * FROM exercises WHERE topic_id=? ORDER BY sort, created_at').bind(s.topic.id).all();
  const t = s.topic;
  return ok({
    ok: true,
    topic: {
      ...topicSummary(t), status: t.status, source_ref: t.source_ref, objective_source: t.objective_source,
      explanation: parse(t.explanation, {}), vocab: parse(t.vocab, []), self_check: parse(t.self_check, []), links: parse(t.links, [])
    },
    exercises: (results || []).map(e => ({ ...exerciseShape(e), key: parse(e.key_json, {}), status: e.status, source_ref: e.source_ref, sort: e.sort }))
  });
}

export async function patchTopic({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  const b = await body(request) || {};
  const f = topicFields(b, s.topic);
  if (f.title_he && /^(שיעור|יחידה|lesson|unit)\s*\d+/i.test(f.title_he)) return fail(400, 'כותרת נושא לא כוללת מספר שיעור.');
  if (f.cycle_id) {
    const c = await env.DB.prepare('SELECT id FROM cycles WHERE id=? AND level_id=?').bind(f.cycle_id, s.topic.level_id).first();
    if (!c) return fail(400, 'קבוצת הנושאים לא שייכת לרמה הזו.');
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return fail(400, 'סטטוס לא תקין.');
    if (!can(s.ctx, 'content.publish')) return fail(403, 'פרסום שמור למנהל הפדגוגי ולאדמין. אפשר לשמור כטיוטה ולבקש פרסום.');
    if (b.status === 'published') {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM exercises WHERE topic_id=? AND status='published'`).bind(s.topic.id).first();
      if (!r.n) return fail(409, 'אי אפשר לפרסם נושא בלי פעילות מפורסמת אחת לפחות.');
      if (!(f.title_he || s.topic.title_he).trim()) return fail(409, 'חסרה כותרת.');
    }
    f.status = b.status;
  }
  await update(env, 'topics', s.topic.id, f);
  return ok({ ok: true });
}

export async function deleteTopic({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  if (s.topic.status !== 'draft') return fail(409, 'אפשר למחוק רק נושא בטיוטה.');
  const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM exercise_progress WHERE topic_id=?').bind(s.topic.id).first();
  if (a.n) return fail(409, 'תלמידים כבר תרגלו את הנושא. השאירו אותו בטיוטה כדי לשמור את ההיסטוריה שלהם.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM exercises WHERE topic_id=?').bind(s.topic.id),
    env.DB.prepare('DELETE FROM topics WHERE id=?').bind(s.topic.id)
  ]);
  return ok({ ok: true });
}

/* ── exercises ───────────────────────────────────────────────────────── */

/* The one place exercise content is validated. What passes here is safe to
   render and possible to grade. Returns {ex} or {error}. */
export function validateExercise(b) {
  const kind = String(b.kind || '');
  const title = strOr(b.title, 160).trim();
  if (!title) return { error: 'צריך כותרת לפעילות.' };
  if (/^(שיעור|lesson)\s*\d+/i.test(title)) return { error: 'כותרת הפעילות לא כוללת מספר שיעור.' };
  const skill = SKILLS.includes(b.skill) ? b.skill : 'mixed';
  const instructions = strOr(b.instructions, 1500);
  const B = b.body || {}, K = b.key || {};
  const audio = B.audio ? strOr(B.audio, 64) : undefined;
  if (kind === 'open') {
    return { ex: { kind, mode: 'self', skill, title, instructions,
      body: { prompt: strOr(B.prompt, 3000), brief: strOr(B.brief, 1500), note: strOr(B.note, 500), ...(audio ? { audio } : {}) },
      key: { models: (Array.isArray(K.models) ? K.models : []).map(m => strOr(m, 4000)).filter(Boolean).slice(0, 4), criteria: strOr(K.criteria, 2000) } } };
  }
  if (kind === 'match') {
    const left = (Array.isArray(B.left) ? B.left : []).map(x => strOr(x, 200).trim()).filter(Boolean);
    const right = (Array.isArray(B.right) ? B.right : []).map((x, i) => ({ id: String.fromCharCode(65 + i), text: strOr(x && x.text !== undefined ? x.text : x, 200).trim() }));
    const pairs = (Array.isArray(K.pairs) ? K.pairs : []).map(p => String(p).trim().toUpperCase());
    if (left.length < 2 || right.length < left.length) return { error: 'בהתאמה צריך לפחות שני פריטים, ולכל פריט אפשרות.' };
    if (pairs.length !== left.length || pairs.some(p => !right.find(r => r.id === p))) return { error: 'המפתח צריך אות תקינה לכל פריט.' };
    return { ex: { kind, mode: 'auto', skill, title, instructions, body: { left, right }, key: { pairs, policy: cleanPolicy(K.policy) } } };
  }
  if (kind === 'order') {
    const lines = (Array.isArray(B.lines) ? B.lines : []).map((x, i) => ({ id: String.fromCharCode(65 + i), text: strOr(x && x.text !== undefined ? x.text : x, 400).trim() })).filter(l => l.text);
    const order = (Array.isArray(K.order) ? K.order : []).map(p => String(p).trim().toUpperCase());
    if (lines.length < 2) return { error: 'בסידור צריך לפחות שתי שורות.' };
    if (order.length !== lines.length || new Set(order).size !== lines.length || order.some(o => !lines.find(l => l.id === o))) {
      return { error: 'המפתח צריך את כל האותיות, כל אחת פעם אחת.' };
    }
    return { ex: { kind, mode: 'auto', skill, title, instructions, body: { lines }, key: { order, policy: cleanPolicy(K.policy) } } };
  }
  if (!ITEM_KINDS.includes(kind)) return { error: 'סוג פעילות לא מוכר.' };
  const items = Array.isArray(B.items) ? B.items : [];
  const keys = Array.isArray(K.items) ? K.items : [];
  if (!items.length) return { error: 'צריך לפחות פריט אחד.' };
  if (items.length > 40) return { error: 'עד 40 פריטים בפעילות.' };
  if (keys.length !== items.length) return { error: 'לכל פריט צריך תשובה במפתח.' };
  const outItems = [], outKeys = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}, k = keys[i] || {};
    const input = INPUTS.includes(it.input) ? it.input : 'text';
    const o = { prompt: strOr(it.prompt, 600), input };
    if (it.cue) o.cue = strOr(it.cue, 200);
    if (it.hint) o.hint = strOr(it.hint, 200);
    if (it.inText) o.inText = true;
    const kk = {};
    if (k.note) kk.note = strOr(k.note, 500);
    if (k.policy) kk.policy = cleanPolicy(k.policy);
    if (input === 'choice') {
      o.options = (Array.isArray(it.options) ? it.options : []).map(x => strOr(x, 300).trim()).filter(Boolean).slice(0, 6);
      const c = Number(k.choice);
      if (o.options.length < 2) return { error: `פריט ${i + 1}: צריך לפחות שתי אפשרויות.` };
      if (!(Number.isInteger(c) && c >= 0 && c < o.options.length)) return { error: `פריט ${i + 1}: סמנו את האפשרות הנכונה.` };
      kk.choice = c; kk.display = o.options[c];
    } else {
      if (input === 'tokens') {
        o.tokens = (Array.isArray(it.tokens) ? it.tokens : []).map(x => strOr(x, 60).trim()).filter(Boolean).slice(0, 30);
        if (o.tokens.length < 2) return { error: `פריט ${i + 1}: צריך לפחות שתי מילים לסידור.` };
      }
      kk.answers = (Array.isArray(k.answers) ? k.answers : [k.display]).map(x => strOr(x, 600).trim()).filter(Boolean).slice(0, 12);
      if (!kk.answers.length) return { error: `פריט ${i + 1}: חסרה תשובה במפתח.` };
      kk.display = strOr(k.display, 600).trim() || kk.answers[0];
    }
    outItems.push(o); outKeys.push(kk);
  }
  const body2 = { items: outItems };
  if (B.text) body2.text = strOr(B.text, 8000);
  if (Array.isArray(B.wordbank)) body2.wordbank = B.wordbank.map(x => strOr(x, 80)).filter(Boolean).slice(0, 30);
  if (audio) body2.audio = audio;
  return { ex: { kind, mode: 'auto', skill, title, instructions, body: body2, key: { items: outKeys, policy: cleanPolicy(K.policy) } } };
}

export async function postExercise({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  const b = await body(request) || {};
  const v = validateExercise(b);
  if (v.error) return fail(400, v.error);
  const id = `${s.topic.id}-x${randomId('').slice(0, 6)}`;
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM exercises WHERE topic_id=?').bind(s.topic.id).first();
  const t = now();
  const status = b.status === 'draft' ? 'draft' : 'published';
  await env.DB.prepare(
    `INSERT INTO exercises (id,topic_id,kind,skill,title,instructions,mode,body,key_json,status,source_ref,sort,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?)`
  ).bind(id, s.topic.id, v.ex.kind, v.ex.skill, v.ex.title, v.ex.instructions, v.ex.mode,
    JSON.stringify(v.ex.body), JSON.stringify(v.ex.key), status, max.n, t, t).run();
  return ok({ ok: true, id }, 201);
}

async function exerciseWithAccess(request, env, id, action) {
  const e = await env.DB.prepare('SELECT e.*, t.level_id FROM exercises e JOIN topics t ON t.id=e.topic_id WHERE e.id=?').bind(String(id || '')).first();
  const s = await requireStaff(request, env, action, e ? e.level_id : '');
  if (s.res) return s;
  if (!e) return { res: fail(404, 'הפעילות לא נמצאה.') };
  return { ...s, ex: e };
}

export async function patchExercise({ request, env, params }) {
  const s = await exerciseWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  const b = await body(request) || {};
  const f = {};
  if (b.body !== undefined || b.key !== undefined || b.title !== undefined || b.kind !== undefined || b.instructions !== undefined || b.skill !== undefined) {
    const cur = exerciseForGrading(s.ex);
    const merged = {
      kind: b.kind ?? s.ex.kind, title: b.title ?? s.ex.title, instructions: b.instructions ?? s.ex.instructions,
      skill: b.skill ?? s.ex.skill, body: b.body ?? cur.body, key: b.key ?? cur.key
    };
    const v = validateExercise(merged);
    if (v.error) return fail(400, v.error);
    Object.assign(f, { kind: v.ex.kind, mode: v.ex.mode, title: v.ex.title, instructions: v.ex.instructions, skill: v.ex.skill,
      body: JSON.stringify(v.ex.body), key_json: JSON.stringify(v.ex.key) });
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return fail(400, 'סטטוס לא תקין.');
    f.status = b.status;
  }
  if (b.sort !== undefined && Number.isInteger(b.sort)) f.sort = b.sort;
  await update(env, 'exercises', s.ex.id, f);
  return ok({ ok: true });
}

export async function deleteExercise({ request, env, params }) {
  const s = await exerciseWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM exercise_progress WHERE exercise_id=?').bind(s.ex.id).first();
  if (a.n) return fail(409, 'תלמידים כבר ענו על הפעילות. הסתירו אותה (טיוטה) במקום למחוק, כדי לשמור את ההיסטוריה שלהם.');
  await env.DB.prepare('DELETE FROM exercises WHERE id=?').bind(s.ex.id).run();
  return ok({ ok: true });
}

/* ── preview: the student view of drafts, without recording anything ── */

export async function getPreviewTopic({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.view');
  if (s.res) return s.res;
  const level = await levelLanguage(env, s.topic.level_id);
  const [ex, cycle] = await Promise.all([
    env.DB.prepare('SELECT * FROM exercises WHERE topic_id=? ORDER BY sort').bind(s.topic.id).all(),
    s.topic.cycle_id ? env.DB.prepare('SELECT id,title_he,title_target FROM cycles WHERE id=?').bind(s.topic.cycle_id).first() : null
  ]);
  const t = s.topic;
  return ok({
    ok: true, preview: true, level: { ...levelShape(level), status: level.status, lang_status: level.lang_status }, cycle,
    topic: { ...topicSummary(t), status: t.status, explanation: parse(t.explanation, {}), vocab: parse(t.vocab, []), self_check: parse(t.self_check, []), links: parse(t.links, []) },
    exercises: (ex.results || []).map(e => ({ ...exerciseShape(e), status: e.status, items: itemCount(exerciseForGrading(e)), progress: null, state: null, item_status: {} }))
  });
}

export async function postPreviewCheck({ request, env, params }) {
  const s = await exerciseWithAccess(request, env, params.id, 'content.view');
  if (s.res) return s.res;
  const level = await levelLanguage(env, s.ex.level_id);
  const ex = exerciseForGrading(s.ex);
  const b = await body(request) || {};
  if (ex.mode === 'self') return ok({ ok: true, models: ex.key.models || [], criteria: ex.key.criteria || '', preview: true });
  const answers = b.answers || {};
  const reveal = new Set(Array.isArray(b.reveal) ? b.reveal.map(Number) : []);
  const results = [];
  const n = itemCount(ex);
  for (const i of new Set([...Object.keys(answers).map(Number), ...reveal])) {
    if (!(i >= 0 && i < n)) continue;
    const g = gradeItem(ex, i, answers[i], parse(level.lang_normalize, {}));
    const k = (ex.key.items || [])[i] || {};
    results.push({ i, status: i in answers ? g.status : 'revealed', feedback: g.feedback, expected: g.expectedText, note: k.note || undefined });
  }
  const graded = results.filter(r => r.status !== 'empty' && r.status !== 'revealed');
  return ok({ ok: true, preview: true, results, xp_gained: 0,
    summary: { graded: graded.length, correct: graded.filter(r => isRight(r.status)).length, score: graded.filter(r => isRight(r.status)).length, total: n, completed: false } });
}

/* ── students & enrollments ──────────────────────────────────────────── */

export async function getStudents({ request, env }) {
  const s = await requireStaff(request, env, 'students.view');
  if (s.res) return s.res;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const levelFilter = url.searchParams.get('level') || '';
  const visible = await visibleStudentIds(env, s.ctx);
  const { results: students } = await env.DB.prepare(
    `SELECT u.id, u.name, u.active, u.created_at, c.created_at AS code_at FROM staff_users u
       LEFT JOIN student_codes c ON c.user_id = u.id WHERE u.role = ? ORDER BY u.name`
  ).bind(STUDENT_ROLE).all();
  const { results: enr } = await env.DB.prepare(
    `SELECT e.*, l.name_he, l.language_id, l.number FROM enrollments e JOIN levels l ON l.id = e.level_id ORDER BY e.started_at DESC`
  ).all();
  const { results: last } = await env.DB.prepare('SELECT user_id, MAX(created_at) AS at FROM attempts GROUP BY user_id').all();
  const L = Object.fromEntries((last || []).map(x => [x.user_id, x.at]));
  const byUser = {};
  for (const e of enr || []) (byUser[e.user_id] ||= []).push(e);
  let list = (students || []).filter(u => !visible || visible.has(u.id));
  if (q) list = list.filter(u => u.name.includes(q));
  const teacherScope = isTeacher(s.ctx) ? s.ctx.teacherLevels : null;
  list = list.map(u => ({
    id: u.id, name: u.name, active: !!u.active, has_code: !!u.code_at, last_activity: L[u.id] || null,
    enrollments: (byUser[u.id] || []).filter(e => !teacherScope || teacherScope.has(e.level_id)).map(e => ({
      id: e.id, level_id: e.level_id, name_he: e.name_he, status: e.status, started_at: e.started_at, ended_at: e.ended_at
    }))
  }));
  if (levelFilter) list = list.filter(u => u.enrollments.some(e => e.level_id === levelFilter && e.status === 'active'));
  return ok({ ok: true, students: list });
}

async function studentVisible(env, ctx, studentId) {
  const u = await env.DB.prepare('SELECT * FROM staff_users WHERE id=? AND role=?').bind(String(studentId || ''), STUDENT_ROLE).first();
  if (!u) return null;
  const visible = await visibleStudentIds(env, ctx);
  if (visible && !visible.has(u.id)) return null;
  return u;
}

export async function postStudent({ request, env }) {
  const s = await requireStaff(request, env, 'students.create');
  if (s.res) return s.res;
  const b = await body(request) || {};
  const name = strOr(b.name, 80).trim();
  if (name.length < 2) return fail(400, 'צריך שם תלמיד/ה.');
  const id = randomId('s');
  await env.DB.prepare(
    `INSERT INTO staff_users (id,email,username,pass_hash,role,name,initials,active,must_change,created_at)
     VALUES (?,?,NULL,'!',?,?,?,1,0,?)`
  ).bind(id, `${id}@students.invalid`, STUDENT_ROLE, name, name.split(' ').map(w => w[0]).join('').slice(0, 2), now()).run();
  let code = null;
  if (codeConfigured(env)) code = formatCode(await issueStudentCode(env, id, s.user.id));
  return ok({ ok: true, id, code }, 201);
}

export async function postStudentCode({ request, env, params }) {
  const s = await requireStaff(request, env, 'students.code');
  if (s.res) return s.res;
  const u = await studentVisible(env, s.ctx, params.id);
  if (!u) return fail(404, 'התלמיד/ה לא נמצא/ה.');
  if (!codeConfigured(env)) return fail(503, 'כניסה בקוד לא הופעלה: חסר STUDENT_CODE_PEPPER.');
  const code = formatCode(await issueStudentCode(env, u.id, s.user.id));
  return ok({ ok: true, code });
}

export async function postEnrollment({ request, env }) {
  const b = await body(request) || {};
  const s = await requireStaff(request, env, 'enroll', String(b.level_id || ''));
  if (s.res) return s.res;
  const u = await studentVisible(env, s.ctx, b.user_id);
  if (!u) return fail(404, 'אפשר לרשום לרמה רק חשבון תלמיד/ה.');
  const level = await env.DB.prepare('SELECT * FROM levels WHERE id=?').bind(String(b.level_id || '')).first();
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const cur = await env.DB.prepare(`SELECT id FROM enrollments WHERE user_id=? AND level_id=? AND status='active'`).bind(u.id, level.id).first();
  if (cur) return fail(409, 'התלמיד/ה כבר רשום/ה לרמה הזו.');
  const id = randomId('en');
  await env.DB.prepare(`INSERT INTO enrollments (id,user_id,level_id,status,started_at,created_by) VALUES (?,?,?,'active',?,?)`)
    .bind(id, u.id, level.id, now(), s.user.id).run();
  return ok({ ok: true, id, note: level.status !== 'published' ? 'הרמה עדיין בטיוטה: התלמיד/ה יראו אותה רק אחרי פרסום.' : '' }, 201);
}

export async function postEndEnrollment({ request, env, params }) {
  const e = await env.DB.prepare('SELECT * FROM enrollments WHERE id=?').bind(String(params.id || '')).first();
  const s = await requireStaff(request, env, 'enroll', e ? e.level_id : '');
  if (s.res) return s.res;
  if (!e) return fail(404, 'לא נמצא.');
  if (e.status !== 'active') return ok({ ok: true });
  /* History stays: attempts, mistakes and progress rows are untouched. */
  await env.DB.prepare(`UPDATE enrollments SET status='ended', ended_at=?, ended_by=? WHERE id=?`).bind(now(), s.user.id, e.id).run();
  return ok({ ok: true });
}

/* ── progress reports ────────────────────────────────────────────────── */

export async function getStudentProgress({ request, env, params }) {
  const s = await requireStaff(request, env, 'progress.view');
  if (s.res) return s.res;
  const u = await studentVisible(env, s.ctx, params.id);
  if (!u) return fail(404, 'התלמיד/ה לא נמצא/ה.');
  const { results: enr } = await env.DB.prepare(
    `SELECT e.*, l.name_he, l.status AS level_status FROM enrollments e JOIN levels l ON l.id=e.level_id WHERE e.user_id=? ORDER BY e.started_at DESC`
  ).bind(u.id).all();
  const levels = [...new Set((enr || []).map(e => e.level_id))].filter(l => can(s.ctx, 'progress.view', l));
  const out = [];
  for (const L of levels) {
    const stats = await levelStatsFor(env, u.id, L, { includeDraft: true });
    out.push({
      level_id: L, name_he: (enr.find(e => e.level_id === L) || {}).name_he,
      enrollment: enr.filter(e => e.level_id === L).map(e => ({ id: e.id, status: e.status, started_at: e.started_at, ended_at: e.ended_at })),
      ...stats
    });
  }
  const { results: writing } = await env.DB.prepare(
    `SELECT a.created_at, a.answers, a.result, e.title, t.title_he AS topic_title, a.level_id FROM attempts a
       JOIN exercises e ON e.id=a.exercise_id JOIN topics t ON t.id=a.topic_id
      WHERE a.user_id=? AND a.self_assessed=1 ORDER BY a.created_at DESC LIMIT 30`
  ).bind(u.id).all();
  return ok({
    ok: true, student: { id: u.id, name: u.name, active: !!u.active }, levels: out,
    writing: (writing || []).filter(w => levels.includes(w.level_id)).map(w => ({
      at: w.created_at, title: w.title, topic_title: w.topic_title, text: parse(w.answers, {}).text || '', rating: parse(w.result, {}).rating || null
    }))
  });
}

export async function getLevelReport({ request, env, params }) {
  const s = await requireStaff(request, env, 'progress.view', params.id);
  if (s.res) return s.res;
  const level = await env.DB.prepare('SELECT * FROM levels WHERE id=?').bind(params.id).first();
  if (!level) return fail(404, 'הרמה לא נמצאה.');
  const { results: studs } = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.name FROM enrollments e JOIN staff_users u ON u.id=e.user_id WHERE e.level_id=? AND e.status='active' ORDER BY u.name`
  ).bind(level.id).all();
  const rows = [];
  const topicAgg = {};
  for (const st of studs || []) {
    const stats = await levelStatsFor(env, st.id, level.id, {});
    rows.push({ id: st.id, name: st.name, ...stats.summary });
    for (const t of stats.topics) {
      const a = (topicAgg[t.id] ||= { id: t.id, title_he: t.title_he, practiced: 0, started: 0, seen: 0, firstRight: 0, retained: 0, autoItems: t.auto_items, open: 0 });
      if (t.status !== 'new') a.started++;
      if (t.status === 'practiced') a.practiced++;
      a.seen += t.seen; a.firstRight += t.first_right; a.retained += t.retained; a.open += t.open_mistakes;
    }
  }
  const ids = (studs || []).map(x => x.id);
  let hard = [];
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT s.exercise_id, s.item_idx, SUM(s.wrong_count) AS wrong, COUNT(*) AS students,
              SUM(CASE WHEN s.status='open' THEN 1 ELSE 0 END) AS still_open, e.title, e.kind, e.body, t.title_he AS topic_title
         FROM item_state s JOIN exercises e ON e.id=s.exercise_id JOIN topics t ON t.id=s.topic_id
        WHERE s.level_id=? AND s.user_id IN (${ids.map(() => '?').join(',')}) AND s.wrong_count > 0
        GROUP BY s.exercise_id, s.item_idx ORDER BY wrong DESC LIMIT 15`
    ).bind(level.id, ...ids).all();
    hard = (results || []).map(h => {
      const b = parse(h.body, {});
      const p = h.kind === 'match' ? (b.left || [])[h.item_idx] : h.kind === 'order' ? '' : ((b.items || [])[h.item_idx] || {}).prompt;
      return { exercise_id: h.exercise_id, item_idx: h.item_idx, wrong: h.wrong, students: h.students, still_open: h.still_open, title: h.title, topic_title: h.topic_title, prompt: p || '' };
    });
  }
  const flags = await env.DB.prepare(`SELECT COUNT(*) AS n FROM answer_flags WHERE level_id=? AND status='open'`).bind(level.id).first();
  return ok({
    ok: true, level: { id: level.id, name_he: level.name_he },
    students: rows,
    topics: Object.values(topicAgg).map(a => ({
      ...a, accuracy: a.seen ? a.firstRight / a.seen : null,
      evidence: a.autoItems && ids.length ? a.retained / (a.autoItems * ids.length) : null
    })).sort((x, y) => x.title_he.localeCompare(y.title_he, 'he')),
    hard_items: hard, open_flags: flags.n
  });
}

/* ── assignments: suggested practice, never an order ─────────────────── */

export async function getAssignments({ request, env, params }) {
  const s = await requireStaff(request, env, 'assign', params.id);
  if (s.res) return s.res;
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name AS student_name, c.name AS author FROM practice_assignments a
       LEFT JOIN staff_users u ON u.id=a.student_id LEFT JOIN staff_users c ON c.id=a.created_by
      WHERE a.level_id=? AND a.archived=0 ORDER BY a.created_at DESC`
  ).bind(params.id).all();
  return ok({ ok: true, assignments: (results || []).map(a => ({ ...a, topic_ids: parse(a.topic_ids, []), exercise_ids: parse(a.exercise_ids, []) })) });
}

export async function postAssignment({ request, env, params }) {
  const s = await requireStaff(request, env, 'assign', params.id);
  if (s.res) return s.res;
  const b = await body(request) || {};
  const topicIds = (Array.isArray(b.topic_ids) ? b.topic_ids : []).map(String).slice(0, 20);
  if (!topicIds.length) return fail(400, 'בחרו לפחות נושא אחד.');
  const { results } = await env.DB.prepare(
    `SELECT id FROM topics WHERE level_id=? AND id IN (${topicIds.map(() => '?').join(',')})`).bind(params.id, ...topicIds).all();
  if ((results || []).length !== topicIds.length) return fail(400, 'חלק מהנושאים לא שייכים לרמה.');
  let studentId = null;
  if (b.student_id) {
    const u = await studentVisible(env, s.ctx, b.student_id);
    const e = u && await env.DB.prepare(`SELECT id FROM enrollments WHERE user_id=? AND level_id=? AND status='active'`).bind(u.id, params.id).first();
    if (!e) return fail(400, 'התלמיד/ה לא רשום/ה לרמה הזו.');
    studentId = u.id;
  }
  const id = randomId('pa');
  await env.DB.prepare(
    `INSERT INTO practice_assignments (id,level_id,student_id,topic_ids,exercise_ids,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(id, params.id, studentId, JSON.stringify(topicIds), '[]', strOr(b.note, 400), s.user.id, now()).run();
  return ok({ ok: true, id }, 201);
}

export async function postArchiveAssignment({ request, env, params }) {
  const a = await env.DB.prepare('SELECT * FROM practice_assignments WHERE id=?').bind(String(params.id || '')).first();
  const s = await requireStaff(request, env, 'assign', a ? a.level_id : '');
  if (s.res) return s.res;
  if (!a) return fail(404, 'לא נמצא.');
  await env.DB.prepare('UPDATE practice_assignments SET archived=1 WHERE id=?').bind(a.id).run();
  return ok({ ok: true });
}

/* ── teachers ↔ levels ───────────────────────────────────────────────── */

export async function getTeachers({ request, env }) {
  const s = await requireStaff(request, env, 'teachers.assign');
  if (s.res) return s.res;
  const { results: t } = await env.DB.prepare(`SELECT id, name, active FROM staff_users WHERE role='מורה' ORDER BY name`).all();
  const { results: tl } = await env.DB.prepare('SELECT * FROM teacher_levels').all();
  return ok({ ok: true, teachers: (t || []).map(x => ({ ...x, levels: (tl || []).filter(r => r.teacher_id === x.id).map(r => r.level_id) })) });
}

export async function putTeacherLevels({ request, env, params }) {
  const s = await requireStaff(request, env, 'teachers.assign');
  if (s.res) return s.res;
  const t = await env.DB.prepare(`SELECT id FROM staff_users WHERE id=? AND role='מורה'`).bind(String(params.id || '')).first();
  if (!t) return fail(404, 'המורה לא נמצא/ה.');
  const b = await body(request) || {};
  const ids = [...new Set((Array.isArray(b.level_ids) ? b.level_ids : []).map(String))].slice(0, 50);
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id FROM levels WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    if ((results || []).length !== ids.length) return fail(400, 'רמה לא מוכרת.');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM teacher_levels WHERE teacher_id=?').bind(t.id),
    ...ids.map(l => env.DB.prepare('INSERT INTO teacher_levels (teacher_id, level_id) VALUES (?,?)').bind(t.id, l))
  ]);
  return ok({ ok: true });
}

/* ── alternative answers proposed by students ────────────────────────── */

export async function getFlags({ request, env, params }) {
  const s = await requireStaff(request, env, 'flags.review', params.id);
  if (s.res) return s.res;
  const { results } = await env.DB.prepare(
    `SELECT f.*, u.name AS student, e.title, e.body, e.key_json, t.title_he AS topic_title FROM answer_flags f
       JOIN staff_users u ON u.id=f.user_id JOIN exercises e ON e.id=f.exercise_id JOIN topics t ON t.id=e.topic_id
      WHERE f.level_id=? AND f.status='open' ORDER BY f.created_at DESC LIMIT 100`
  ).bind(params.id).all();
  return ok({ ok: true, flags: (results || []).map(f => {
    const b = parse(f.body, {}), k = parse(f.key_json, {});
    return { id: f.id, student: f.student, answer: f.answer, created_at: f.created_at, title: f.title, topic_title: f.topic_title,
      prompt: ((b.items || [])[f.item_idx] || {}).prompt || '', expected: ((k.items || [])[f.item_idx] || {}).display || '' };
  }) });
}

export async function postFlagDecision({ request, env, params }) {
  const f = await env.DB.prepare('SELECT * FROM answer_flags WHERE id=?').bind(String(params.id || '')).first();
  const s = await requireStaff(request, env, 'flags.review', f ? f.level_id : '');
  if (s.res) return s.res;
  if (!f) return fail(404, 'לא נמצא.');
  const b = await body(request) || {};
  const accept = b.decision === 'accept';
  const stmts = [env.DB.prepare('UPDATE answer_flags SET status=?, reviewed_by=? WHERE id=?').bind(accept ? 'accepted' : 'rejected', s.user.id, f.id)];
  if (accept) {
    /* the alternative joins the key, so the next student who writes it is right */
    const e = await env.DB.prepare('SELECT key_json FROM exercises WHERE id=?').bind(f.exercise_id).first();
    const k = parse(e.key_json, {});
    const it = (k.items || [])[f.item_idx];
    if (it && Array.isArray(it.answers) && !it.answers.includes(f.answer)) {
      it.answers.push(f.answer);
      stmts.push(env.DB.prepare('UPDATE exercises SET key_json=?, updated_at=? WHERE id=?').bind(JSON.stringify(k), now(), f.exercise_id));
    }
  }
  await env.DB.batch(stmts);
  return ok({ ok: true });
}

/* ── media upload (R2) ───────────────────────────────────────────────── */

export async function postMedia({ request, env, params }) {
  const s = await topicWithAccess(request, env, params.id, 'content.edit');
  if (s.res) return s.res;
  if (!env.MEDIA) return fail(503, 'אחסון קבצים (R2, binding MEDIA) לא הוגדר. ראו README.');
  const form = await request.formData().catch(() => null);
  const file = form && form.get('file');
  if (!file || typeof file === 'string') return fail(400, 'לא נבחר קובץ.');
  if (!/^audio\//.test(file.type)) return fail(400, 'אפשר להעלות רק קובצי שמע.');
  if (file.size > 20 * 1024 * 1024) return fail(413, 'עד 20MB לקובץ.');
  const id = randomId('m');
  const key = `media/${s.topic.level_id}/${id}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await env.DB.prepare('INSERT INTO media (id,level_id,topic_id,kind,title,r2_key,mime,size,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, s.topic.level_id, s.topic.id, 'audio', strOr(form.get('title'), 120), key, file.type, file.size, s.user.id, now()).run();
  return ok({ ok: true, id }, 201);
}
