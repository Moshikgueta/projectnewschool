/* New School | Teacher Onboarding — shared helpers.

   Everything a training endpoint needs that is not itself an endpoint: the
   guards, the content-block schema the server enforces, server-side grading,
   and the arithmetic that turns progress rows into a module status.

   Two rules run through the whole file:
     - The answer key never leaves the server. A teacher's copy of a module is
       built by stripBlockForLearner(); correctness is decided in gradeAnswer()
       and only revealed once the item is finished.
     - Readiness to teach is a decision a person records. Nothing here ever
       sets it, however complete the progress looks. */

import { json } from './_shared.js';
import { currentStaff, randomId } from './_staff.js';

export { randomId };

/* Who manages training. The pedagogical manager owns it; the office admin
   has the same reach because the office already holds every other key. */
export const MANAGER_ROLES = ['אדמין', 'מנהל פדגוגי'];
export const LEARNER_ROLE = 'מורה';

export const DAY = 86400000;

/* ── guards ────────────────────────────────────────────────────────────── */

export function isManager(u) {
  return !!u && MANAGER_ROLES.indexOf(u.role) > -1;
}

export async function requireManager(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: json({ ok: false, error: 'נדרשת התחברות.' }, 401) };
  if (!isManager(user)) return { res: json({ ok: false, error: 'ניהול הכשרת מורים שמור למנהל הפדגוגי ולאדמין.' }, 403) };
  return { user };
}

/* Teachers and managers: the people the resource hub and search are for.
   Students and reception are refused — the hub is professional material. */
export async function requireStaffLearner(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: json({ ok: false, error: 'נדרשת התחברות.' }, 401) };
  if (user.role !== LEARNER_ROLE && !isManager(user)) {
    return { res: json({ ok: false, error: 'האזור הזה פתוח למורים ולהנהלה הפדגוגית.' }, 403) };
  }
  return { user };
}

/* ── small parsing helpers ─────────────────────────────────────────────── */

export function parseJson(s, fallback) {
  if (s == null) return fallback;
  try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; }
}

export function str(v, max = 400) {
  return String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
}

export function text(v, max = 8000) {
  /* Like str() but keeps inner newlines — paragraphs are content. */
  return String(v == null ? '' : v).replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function isoDate(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/* Only http(s). Every URL in this system ends up in an href or a src, and a
   javascript: link stored by one person runs in the browser of the next. */
export function safeUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

/* ── content blocks ────────────────────────────────────────────────────── */

/* The shape of every block type, which the server enforces on save. Field
   kinds: line (short text), area (paragraphs), url, bool, int, or an array of
   allowed values. `list` is the repeating part (options, items, pairs).
   `act` marks an activity and how it completes:
     check  — every checklist item ticked
     auto   — graded here against the key (mcq, match, order)
     choice — any choice completes; feedback is about reasoning, not a key
     human  — a submission; completes on approval, or on submission when
              review is switched off for that block */
export const BLOCK_TYPES = {
  heading:     { f: { text: 'line' } },
  text:        { f: { body: 'area' } },
  image:       { f: { url: 'url', alt: 'line', caption: 'line' } },
  video:       { f: { url: 'url', caption: 'line' } },
  link:        { f: { url: 'url', label: 'line', note: 'area' } },
  file:        { f: { url: 'url', label: 'line', note: 'area' } },
  callout:     { f: { title: 'line', body: 'area', tone: ['info', 'tip', 'warning', 'pending'] } },
  accordion:   { f: {}, list: { k: 'items', f: { title: 'line', body: 'area' } } },
  steps:       { f: { title: 'line', note: 'area', layout: ['linear', 'cycle'] }, list: { k: 'items', f: { title: 'line', body: 'area' } } },
  embed:       { f: { url: 'url', title: 'line' } },
  checklist:   { act: 'check', f: { title: 'line', required: 'bool' }, list: { k: 'items', f: { text: 'line' } } },
  mcq:         { act: 'auto', f: { question: 'area', multi: 'bool', maxAttempts: 'int', explain: 'area', required: 'bool' }, list: { k: 'options', f: { text: 'line', correct: 'bool', explain: 'line' } } },
  match:       { act: 'auto', f: { prompt: 'area', maxAttempts: 'int', required: 'bool' }, list: { k: 'pairs', f: { left: 'line', right: 'line' } } },
  order:       { act: 'auto', f: { prompt: 'area', maxAttempts: 'int', required: 'bool' }, list: { k: 'items', f: { text: 'line' } } },
  scenario:    { act: 'choice', f: { situation: 'area', considerations: 'area', required: 'bool' }, list: { k: 'options', f: { text: 'line', quality: ['recommended', 'acceptable', 'problematic'], feedback: 'area' } } },
  open:        { act: 'human', f: { prompt: 'area', review: 'bool', required: 'bool' } },
  lesson_plan: { act: 'human', f: { prompt: 'area', review: 'bool', required: 'bool' } },
  reflection:  { act: 'human', f: { prompt: 'area', review: 'bool', required: 'bool' } },
  upload:      { act: 'human', f: { prompt: 'area', review: 'bool', required: 'bool' } }
};

/* The fields of a lesson-plan submission, in the order the form shows them. */
export const PLAN_FIELDS = ['goal', 'skills', 'stages', 'materials', 'timing', 'backup'];

const MAX_BLOCKS = 150;
const MAX_ITEMS = 40;

function cleanField(kind, v) {
  if (Array.isArray(kind)) return kind.indexOf(v) > -1 ? v : kind[0];
  if (kind === 'line') return str(v, 400);
  if (kind === 'area') return text(v, 8000);
  if (kind === 'url') return safeUrl(v);
  if (kind === 'bool') return !!v;
  if (kind === 'int') return Math.max(0, Math.min(99, parseInt(v, 10) || 0));
  return '';
}

function shortId(prefix) {
  return randomId(prefix).slice(0, 13);
}

/* What the editor sent, reduced to what the schema allows. Unknown types are
   dropped, ids are kept when they look like ids (progress points at them)
   and minted when missing. Duplicated ids — a copy-pasted block — get fresh
   ones, or two blocks would share one progress row. */
export function sanitizeBlocks(input) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(input) ? input : []).slice(0, MAX_BLOCKS)) {
    if (!raw || typeof raw !== 'object') continue;
    const def = BLOCK_TYPES[raw.type];
    if (!def) continue;
    let id = /^[A-Za-z0-9_-]{4,40}$/.test(String(raw.id || '')) ? String(raw.id) : '';
    if (!id || seen.has(id)) id = shortId('b');
    seen.add(id);
    const b = { id, type: raw.type };
    for (const [k, kind] of Object.entries(def.f)) {
      if (k === 'required') { b.required = raw.required === undefined ? true : !!raw.required; continue; }
      if (k === 'review') { b.review = raw.review === undefined ? raw.type !== 'reflection' : !!raw.review; continue; }
      b[k] = cleanField(kind, raw[k]);
    }
    if (def.list) {
      const items = [];
      const iseen = new Set();
      for (const it of (Array.isArray(raw[def.list.k]) ? raw[def.list.k] : []).slice(0, MAX_ITEMS)) {
        if (!it || typeof it !== 'object') continue;
        let iid = /^[A-Za-z0-9_-]{2,40}$/.test(String(it.id || '')) ? String(it.id) : '';
        if (!iid || iseen.has(iid)) iid = shortId('i');
        iseen.add(iid);
        const item = { id: iid };
        for (const [k, kind] of Object.entries(def.list.f)) item[k] = cleanField(kind, it[k]);
        items.push(item);
      }
      b[def.list.k] = items;
    }
    out.push(b);
  }
  return out;
}

/* What must be there before a module can be published. Content blocks may
   go out with a link still missing — the template does that on purpose and
   the page says "טרם הוזן קישור" — but an activity a teacher cannot complete
   (a question with no answers, no correct option) would block their path.
   Returns a list of problems, each naming the block by its position. */
export function publishProblems(blocks) {
  const out = [];
  const filled = (arr, ...keys) => (arr || []).filter(x => keys.every(k => String(x[k] || '').trim()));
  blocks.forEach((b, i) => {
    const n = 'רכיב ' + (i + 1);
    if (b.type === 'heading' && !b.text) out.push(n + ': כותרת ריקה');
    if (b.type === 'text' && !b.body) out.push(n + ': טקסט ריק');
    if (b.type === 'mcq') {
      if (!b.question) out.push(n + ': שאלת רב-ברירה בלי שאלה');
      if (filled(b.options, 'text').length < 2) out.push(n + ': צריך לפחות שתי תשובות');
      if (!b.options.some(o => o.correct && o.text)) out.push(n + ': לא סומנה תשובה נכונה');
    }
    if (b.type === 'match' && filled(b.pairs, 'left', 'right').length < 2) out.push(n + ': צריך לפחות שני זוגות מלאים');
    if (b.type === 'match' && filled(b.pairs, 'left', 'right').length !== b.pairs.length) out.push(n + ': יש זוג חסר');
    if (b.type === 'order' && filled(b.items, 'text').length < 2) out.push(n + ': צריך לפחות שני פריטים לסידור');
    if (b.type === 'scenario') {
      if (!b.situation) out.push(n + ': תרחיש בלי תיאור מצב');
      if (filled(b.options, 'text').length < 2) out.push(n + ': צריך לפחות שתי אפשרויות תגובה');
    }
    if (b.type === 'checklist' && !filled(b.items, 'text').length) out.push(n + ': צ\'קליסט ריק');
    if (BLOCK_TYPES[b.type] && BLOCK_TYPES[b.type].act === 'human' && !b.prompt) out.push(n + ': משימה בלי הנחיה');
  });
  return out;
}

export function isActivity(b) {
  const def = BLOCK_TYPES[b.type];
  return !!(def && def.act);
}

export function actKind(b) {
  const def = BLOCK_TYPES[b.type];
  return def ? def.act || '' : '';
}

/* ── the learner's copy ────────────────────────────────────────────────── */

/* Stable shuffle: the same block shows the same order on every reload (so
   a half-done ordering task does not jump around) without that order being
   the answer. */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function stableShuffle(arr, seed, key) {
  const out = arr.slice().sort((a, b) => hashStr(seed + key(a)) - hashStr(seed + key(b)));
  /* A shuffle that lands on the original order gives the answer away. */
  if (out.length > 1 && out.every((x, i) => x === arr[i])) out.push(out.shift());
  return out;
}

/* A block as a teacher may see it. `done` reveals what the key would have
   given away while the item was still open: correct options, explanations,
   the quality of each scenario choice. */
export function stripBlockForLearner(b, done) {
  if (b.type === 'mcq') {
    return {
      id: b.id, type: b.type, question: b.question, multi: !!b.multi,
      maxAttempts: b.maxAttempts || 0, required: b.required !== false,
      options: b.options.map(o => done
        ? { id: o.id, text: o.text, correct: !!o.correct, explain: o.explain }
        : { id: o.id, text: o.text }),
      explain: done ? b.explain : ''
    };
  }
  if (b.type === 'match') {
    const rights = Array.from(new Set(b.pairs.map(p => p.right))).sort((x, y) => x.localeCompare(y, 'he'));
    return {
      id: b.id, type: b.type, prompt: b.prompt, maxAttempts: b.maxAttempts || 0, required: b.required !== false,
      lefts: b.pairs.map(p => ({ id: p.id, text: p.left })),
      rights,
      key: done ? b.pairs.map(p => ({ id: p.id, right: p.right })) : null
    };
  }
  if (b.type === 'order') {
    return {
      id: b.id, type: b.type, prompt: b.prompt, maxAttempts: b.maxAttempts || 0, required: b.required !== false,
      items: (done ? b.items : stableShuffle(b.items, b.id, x => x.id)).map(x => ({ id: x.id, text: x.text })),
      key: done ? b.items.map(x => x.id) : null
    };
  }
  if (b.type === 'scenario') {
    return {
      id: b.id, type: b.type, situation: b.situation, required: b.required !== false,
      options: b.options.map(o => done
        ? { id: o.id, text: o.text, quality: o.quality, feedback: o.feedback }
        : { id: o.id, text: o.text }),
      considerations: done ? b.considerations : ''
    };
  }
  return Object.assign({}, b);
}

/* ── grading ───────────────────────────────────────────────────────────── */

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

/* Returns {answer, correct, done} or {error}. `correct` is true/false for
   graded items and null where there is no key to be right against.
   `prev` is the existing progress row, for the attempt count. */
export function gradeAnswer(b, rawAnswer, prev) {
  const a = rawAnswer && typeof rawAnswer === 'object' ? rawAnswer : {};
  const attempts = ((prev && prev.attempts) || 0) + 1;
  const max = b.maxAttempts || 0;
  const finish = (answer, correct) => ({
    answer, correct, attempts,
    done: correct !== false || (max > 0 && attempts >= max)
  });

  if (b.type === 'mcq') {
    const ids = new Set(b.options.map(o => o.id));
    const selected = (Array.isArray(a.selected) ? a.selected : []).map(String).filter(x => ids.has(x));
    if (!selected.length) return { error: 'צריך לבחור תשובה' };
    if (!b.multi && selected.length > 1) return { error: 'אפשר לבחור תשובה אחת' };
    const key = b.options.filter(o => o.correct).map(o => o.id);
    /* No option marked correct is a module still being written — count the
       answer as participation rather than fail everyone on a missing key. */
    return finish({ selected }, key.length ? sameSet(selected, key) : null);
  }
  if (b.type === 'match') {
    const map = a.map && typeof a.map === 'object' ? a.map : {};
    if (b.pairs.some(p => !map[p.id])) return { error: 'צריך להתאים כל שורה' };
    const clean = {};
    for (const p of b.pairs) clean[p.id] = str(map[p.id], 400);
    return finish({ map: clean }, b.pairs.every(p => clean[p.id] === p.right));
  }
  if (b.type === 'order') {
    const order = (Array.isArray(a.order) ? a.order : []).map(String);
    if (!sameSet(order, b.items.map(x => x.id))) return { error: 'הסדר לא שלם' };
    return finish({ order }, order.every((id, i) => b.items[i].id === id));
  }
  if (b.type === 'scenario') {
    const choice = String(a.choice || '');
    if (!b.options.some(o => o.id === choice)) return { error: 'צריך לבחור תגובה' };
    return { answer: { choice }, correct: null, attempts, done: true };
  }
  if (b.type === 'checklist') {
    const ids = new Set(b.items.map(x => x.id));
    const checked = Array.from(new Set((Array.isArray(a.checked) ? a.checked : []).map(String).filter(x => ids.has(x))));
    return { answer: { checked }, correct: null, attempts: (prev && prev.attempts) || 0, done: checked.length === b.items.length && b.items.length > 0 };
  }
  return { error: 'סוג הפריט לא נבדק אוטומטית' };
}

/* What a submission body may hold, per block type. */
export function cleanSubmission(b, raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  if (b.type === 'lesson_plan') {
    const fields = {};
    for (const k of PLAN_FIELDS) fields[k] = text(a.fields && a.fields[k], 4000);
    if (!fields.goal || !fields.stages) return { error: 'צריך למלא לפחות את מטרת השיעור ואת שלבי השיעור' };
    return { body: { fields } };
  }
  if (b.type === 'upload') {
    const url = safeUrl(a.url);
    if (!url) return { error: 'צריך קישור תקין (https://…) לקובץ — למשל קובץ בגוגל דרייב' };
    return { body: { url, note: text(a.note, 2000) } };
  }
  const t = text(a.text, 12000);
  if (t.length < 2) return { error: 'התשובה ריקה' };
  return { body: { text: t } };
}

/* ── status arithmetic ─────────────────────────────────────────────────── */

export const CONTENT_KEY = '_content';

export const MODULE_STATUS_LABEL = {
  not_started: 'טרם התחיל',
  in_progress: 'בתהליך',
  completed: 'הושלם',
  pending_review: 'ממתין לבדיקה',
  needs_revision: 'נדרש תיקון',
  locked: 'נעול'
};

/* One module, one learner. `progress` is a map blockId → progress row,
   `subs` a map blockId → newest submission row. Keeps the four layers the
   brief asks for apart:
     viewed   — the content was gone through
     done     — the activity was completed
     passed   — the auto-checked score meets the module's threshold (if any)
     approved — a person accepted the submission */
export function moduleState(mod, blocks, progress, subs) {
  const hasContent = blocks.some(b => !isActivity(b));
  const viewed = !hasContent || !!(progress[CONTENT_KEY]);
  let units = hasContent ? 1 : 0;
  let doneUnits = hasContent && viewed ? 1 : 0;
  let autoTotal = 0, autoCorrect = 0, autoAnswered = 0, pending = 0, revise = 0, exhausted = 0, touched = !!progress[CONTENT_KEY];
  let activities = 0, activitiesDone = 0;

  for (const b of blocks) {
    const kind = actKind(b);
    if (!kind) continue;
    const required = b.required !== false;
    const p = progress[b.id];
    const s = subs[b.id];
    if (p || s) touched = true;
    let done = false;
    if (kind === 'human') {
      if (s && s.status === 'approved') done = true;
      else if (s && s.status === 'received') done = true;
      else if (s && s.status === 'submitted') { if (required) pending++; }
      else if (s && s.status === 'needs_revision') { if (required) revise++; }
    } else {
      done = !!(p && p.state === 'done');
      if (kind === 'auto') {
        const graded = b.type !== 'mcq' || b.options.some(o => o.correct);
        if (graded) {
          autoTotal++;
          if (p) autoAnswered++;
          if (p && p.correct === 1) autoCorrect++;
          if (p && p.state === 'done' && p.correct === 0 && required) exhausted++;
        }
      }
    }
    activities++;
    if (done) activitiesDone++;
    if (required) { units++; if (done) doneUnits++; }
  }

  /* No score until something has been answered — 0% before the first try
     reads as a failure that never happened. */
  const score = autoTotal && autoAnswered ? Math.round((autoCorrect / autoTotal) * 100) : null;
  const threshold = mod.pass_score == null ? null : mod.pass_score;
  const allAutoDone = blocks.filter(b => actKind(b) === 'auto' && b.required !== false)
    .every(b => progress[b.id] && progress[b.id].state === 'done');
  const failedScore = threshold != null && score != null && allAutoDone && score < threshold;

  let status;
  if (!touched) status = 'not_started';
  /* Spent attempts on a wrong answer still complete the item — completion
     and passing are different things. Without a threshold the score is
     reported (and `exhausted` counts the misses) but blocks nothing; with
     one, falling short sends the module back. */
  else if (revise > 0 || failedScore) status = 'needs_revision';
  else if (doneUnits === units) status = 'completed';
  else if (doneUnits + pending === units && pending > 0) status = 'pending_review';
  else status = 'in_progress';

  return {
    status, label: MODULE_STATUS_LABEL[status],
    percent: units ? Math.round((doneUnits / units) * 100) : (touched ? 100 : 0),
    viewed, activities, activitiesDone,
    autoTotal, autoCorrect, score, passScore: threshold,
    passed: threshold == null ? null : (score != null && score >= threshold),
    failedScore, missed: exhausted, pendingReview: pending, needsRevision: revise
  };
}

export const READINESS_LABEL = {
  ready: 'מוכן/ה להוראה',
  conditional: 'מוכן/ה בכפוף להשלמות',
  more_training: 'נדרשת הכשרה נוספת',
  completed: 'ההכשרה אושרה כהושלמה'
};

export const FOLLOWUPS = [
  { key: 'first_lesson', label: 'אחרי השיעור הראשון', days: 0 },
  { key: 'week1', label: 'סוף השבוע הראשון', days: 7 },
  { key: 'week2', label: 'אחרי שבועיים', days: 14 },
  { key: 'month1', label: 'תום החודש הראשון', days: 30 }
];

export function addDays(iso, n) {
  const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── loading ───────────────────────────────────────────────────────────── */

export function moduleRow(env, id) {
  return env.DB.prepare('SELECT * FROM training_modules WHERE id=?').bind(id).first();
}

export function publishedBlocks(m) {
  return parseJson(m && m.published, null);
}

/* Everything needed to compute one assignment's progress, in four queries
   rather than one per module. */
export async function loadAssignmentState(env, a) {
  const { results: pm } = await env.DB.prepare(
    `SELECT pm.*, m.title, m.description, m.icon, m.est_minutes, m.status AS mstatus,
            m.published, m.published_at, m.pass_score
       FROM training_path_modules pm JOIN training_modules m ON m.id = pm.module_id
      WHERE pm.path_id = ? ORDER BY pm.sort, m.title`
  ).bind(a.path_id).all();
  const { results: prog } = await env.DB.prepare(
    'SELECT * FROM training_progress WHERE assignment_id=?'
  ).bind(a.id).all();
  const { results: subs } = await env.DB.prepare(
    'SELECT * FROM training_submissions WHERE assignment_id=? ORDER BY created_at'
  ).bind(a.id).all();
  return buildAssignmentState(a, pm || [], prog || [], subs || []);
}

export function buildAssignmentState(a, pathModules, progRows, subRows) {
  const progBy = {}, subBy = {};
  for (const p of progRows) (progBy[p.module_id] = progBy[p.module_id] || {})[p.block_id] = p;
  for (const s of subRows) (subBy[s.module_id] = subBy[s.module_id] || {})[s.block_id] = s; /* newest wins: ordered by created_at */

  const modules = [];
  const stateById = {};
  for (const pm of pathModules) {
    /* A module nobody has published yet, or one taken out of service, is not
       part of what a teacher can be measured against. */
    const blocks = pm.mstatus === 'archived' ? null : parseJson(pm.published, null);
    const available = !!blocks;
    const st = available
      ? moduleState(pm, blocks, progBy[pm.module_id] || {}, subBy[pm.module_id] || {})
      : null;
    stateById[pm.module_id] = st;
    modules.push({
      moduleId: pm.module_id, title: pm.title, description: pm.description, icon: pm.icon,
      estMinutes: pm.est_minutes, required: !!pm.required, prereq: pm.prereq_module_id || null,
      available, blocks: available ? blocks.length : 0,
      activities: available ? blocks.filter(isActivity).length : 0,
      state: st
    });
  }
  for (const m of modules) {
    const pre = m.prereq && stateById[m.prereq];
    m.locked = !!(m.prereq && (!pre || pre.status !== 'completed'));
    if (m.locked && m.state && m.state.status === 'not_started') {
      m.state = Object.assign({}, m.state, { status: 'locked', label: MODULE_STATUS_LABEL.locked });
    }
  }
  const req = modules.filter(m => m.required && m.available);
  const percent = req.length ? Math.round(req.reduce((n, m) => n + m.state.percent, 0) / req.length) : 0;
  const allDone = req.length > 0 && req.every(m => m.state.status === 'completed');
  return {
    modules, percent, allRequiredDone: allDone,
    pendingReview: modules.reduce((n, m) => n + (m.state ? m.state.pendingReview : 0), 0),
    needsRevision: modules.reduce((n, m) => n + (m.state && m.state.status === 'needs_revision' ? 1 : 0), 0)
  };
}

/* ── audit & notifications ─────────────────────────────────────────────── */

export function audit(env, actor, action, { type = '', id = '', subject = '', detail = '' } = {}) {
  return env.DB.prepare(
    `INSERT INTO training_audit (id, at, actor_id, actor_name, action, target_type, target_id, subject_user_id, detail)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(randomId('al'), Date.now(), actor ? actor.id : '', actor ? actor.name : '',
    action, type, id, subject || '', typeof detail === 'string' ? detail : JSON.stringify(detail)).run();
}

export function notify(env, userId, kind, title, body = '') {
  return env.DB.prepare(
    'INSERT INTO training_notifications (id, user_id, kind, title, body, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(randomId('n'), userId, kind, str(title, 200), str(body, 600), Date.now()).run();
}

/* Every active manager — submissions waiting for review go to all of them,
   since whoever is in today should be able to pick it up. */
export async function notifyManagers(env, kind, title, body = '') {
  const { results } = await env.DB.prepare(
    `SELECT id FROM staff_users WHERE active=1 AND role IN (${MANAGER_ROLES.map(() => '?').join(',')})`
  ).bind(...MANAGER_ROLES).all();
  for (const r of results || []) await notify(env, r.id, kind, title, body);
}
