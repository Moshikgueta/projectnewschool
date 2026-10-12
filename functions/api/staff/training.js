/* /api/staff/training/* — New School | Teacher Onboarding.

   One file with its own small router, because the area has some forty
   routes and src/worker.js should not have to list them all. Every handler
   resolves the caller through the same session as the rest of the portal
   and checks the role itself; the UI hiding a button is never the guard.

   Teacher-facing routes live under me/; management routes need
   MANAGER_ROLES. The hub, search and notifications are shared. */

import { json } from '../../_shared.js';
import { currentStaff, readJson, roleLabel } from '../../_staff.js';
import {
  requireManager, requireStaffLearner, isManager, LEARNER_ROLE, DAY,
  parseJson, str, text, isoDate, safeUrl, randomId,
  sanitizeBlocks, stripBlockForLearner, gradeAnswer, cleanSubmission, isActivity, actKind,
  moduleRow, loadAssignmentState, buildAssignmentState, moduleState, CONTENT_KEY,
  READINESS_LABEL, FOLLOWUPS, addDays, audit, notify, notifyManagers
} from '../../_training.js';
import { TEMPLATE_MODULES, SAMPLE_RESOURCES } from '../../_training_template.js';

const ID = '([A-Za-z0-9_-]{1,64})';
const bad = (error, status = 400) => json({ ok: false, error }, status);
const notFound = (what) => bad(what + ' לא נמצא/ה.', 404);

const ICONS = ['welcome', 'philosophy', 'program', 'cycle', 'notebook', 'teach', 'tools', 'classroom', 'policy', 'hub', 'checklist', 'assessment', 'book', 'video', 'star'];
const RES_KINDS = ['notebook', 'syllabus', 'lesson_plan', 'guide', 'video', 'enrichment', 'policy', 'link', 'faq', 'template'];
const RES_STATUS = ['official', 'draft', 'review', 'archived'];

/* ── shapes ────────────────────────────────────────────────────────────── */

function moduleSnapshot(m, blocks) {
  return {
    title: m.title, description: m.description, objectives: parseJson(m.objectives, []),
    icon: m.icon, estMinutes: m.est_minutes, passScore: m.pass_score, blocks
  };
}

function publicModule(m, withContent) {
  const draft = parseJson(m.draft, []);
  const out = {
    id: m.id, title: m.title, description: m.description,
    objectives: parseJson(m.objectives, []), icon: m.icon, estMinutes: m.est_minutes,
    passScore: m.pass_score, status: m.status, rev: m.rev, publishedRev: m.published_rev,
    publishedAt: m.published_at || 0, updatedAt: m.updated_at, updatedBy: m.updated_by,
    /* "Unpublished changes": the draft has moved on since the last publish. */
    dirty: m.published_rev !== m.rev,
    everPublished: m.published != null,
    blockCount: draft.length, activityCount: draft.filter(isActivity).length
  };
  if (withContent) out.blocks = draft;
  return out;
}

function publicPath(p, mods) {
  return {
    id: p.id, title: p.title, description: p.description, kind: p.kind,
    language: p.language, audience: p.audience, status: p.status,
    updatedAt: p.updated_at,
    modules: (mods || []).map(x => ({
      moduleId: x.module_id, title: x.title || '', required: !!x.required,
      prereq: x.prereq_module_id || null, sort: x.sort, moduleStatus: x.mstatus || ''
    }))
  };
}

function publicResource(r, favs) {
  return {
    id: r.id, title: r.title, description: r.description, url: r.url, kind: r.kind,
    category: r.category, language: r.language, level: r.level, program: r.program,
    tags: parseJson(r.tags, []), moduleIds: parseJson(r.module_ids, []),
    status: r.status, linkStatus: r.link_status, linkCheckedAt: r.link_checked_at || 0,
    updatedAt: r.updated_at, favorite: favs ? favs.has(r.id) : false
  };
}

function publicSubmission(s) {
  return {
    id: s.id, moduleId: s.module_id, blockId: s.block_id, attempt: s.attempt,
    body: parseJson(s.body, {}), status: s.status, feedback: s.feedback,
    reviewedBy: s.reviewed_by, reviewedAt: s.reviewed_at || 0, createdAt: s.created_at
  };
}

/* managerNotes are the manager's own working notes, like the impressions in
   פיתוח מורים — kept from the teacher. Recommendations are written for them. */
function publicFollowup(f, forLearner) {
  const def = FOLLOWUPS.find(x => x.key === f.checkpoint) || { label: f.checkpoint };
  const out = {
    id: f.id, checkpoint: f.checkpoint, label: def.label, dueDate: f.due_date, status: f.status,
    reflection: f.reflection, meetingAt: f.meeting_at,
    recommendations: f.recommendations, updatedAt: f.updated_at
  };
  if (!forLearner) out.managerNotes = f.manager_notes;
  return out;
}

function publicAssignment(a, path, state, extra) {
  return Object.assign({
    id: a.id, pathId: a.path_id, pathTitle: path ? path.title : '', pathKind: path ? path.kind : '',
    pathDescription: path ? path.description : '',
    userId: a.user_id, status: a.status, dueDate: a.due_date, assignedBy: a.assigned_by,
    assignedAt: a.assigned_at, startedAt: a.started_at || 0, lastActivityAt: a.last_activity_at || 0,
    lastModuleId: a.last_module_id || null,
    readiness: a.readiness || null, readinessLabel: a.readiness ? READINESS_LABEL[a.readiness] : '',
    readinessNote: a.readiness_note, readinessBy: a.readiness_by, readinessAt: a.readiness_at || 0,
    percent: state ? state.percent : 0, allRequiredDone: state ? state.allRequiredDone : false,
    pendingReview: state ? state.pendingReview : 0, needsRevision: state ? state.needsRevision : 0,
    modules: state ? state.modules : []
  }, extra || {});
}

async function profileOf(env, userId) {
  return env.DB.prepare('SELECT * FROM training_profiles WHERE user_id=?').bind(userId).first();
}

function publicProfile(u, p) {
  return {
    userId: u ? u.id : '', name: u ? u.name : '(חשבון נמחק)', email: u ? u.email : '',
    role: u ? u.role : '', roleLabel: u ? roleLabel(u.role) : '', active: u ? !!u.active : false,
    language: p ? p.language : '', position: p ? p.position : '', startDate: p ? p.start_date : ''
  };
}

/* ── teacher: my training ──────────────────────────────────────────────── */

async function myAssignments(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, p.title AS p_title, p.kind AS p_kind, p.description AS p_desc
       FROM training_assignments a JOIN training_paths p ON p.id = a.path_id
      WHERE a.user_id = ? AND a.status <> 'withdrawn' ORDER BY a.assigned_at`
  ).bind(user.id).all();
  return results || [];
}

async function meGet({ request, env }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  if (user.role === 'תלמיד') return bad('האזור הזה פתוח לצוות בלבד.', 403);

  const rows = await myAssignments(env, user);
  const assignments = [];
  for (const a of rows) {
    const st = await loadAssignmentState(env, a);
    const { results: fu } = await env.DB.prepare(
      'SELECT * FROM training_followups WHERE assignment_id=? ORDER BY due_date'
    ).bind(a.id).all();
    assignments.push(publicAssignment(a, { title: a.p_title, kind: a.p_kind, description: a.p_desc }, st, {
      followups: (fu || []).map(f => publicFollowup(f, true))
    }));
  }
  const { results: ann } = await env.DB.prepare(
    "SELECT * FROM training_announcements WHERE status='published' ORDER BY created_at DESC LIMIT 8"
  ).all();
  const { results: notes } = await env.DB.prepare(
    'SELECT * FROM training_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30'
  ).bind(user.id).all();

  return json({
    ok: true,
    profile: publicProfile(user, await profileOf(env, user.id)),
    assignments,
    announcements: (ann || []).map(x => ({ id: x.id, title: x.title, body: x.body, kind: x.kind, by: x.by_name, at: x.created_at })),
    notifications: (notes || []).map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.created_at, read: !!n.read_at })),
    unread: (notes || []).filter(n => !n.read_at).length
  });
}

/* The one door into module content for a teacher: the assignment must be
   theirs and live, the path must contain the module, the module must be
   published, and its prerequisite must be complete. */
async function learnerContext(env, user, assignmentId, moduleId) {
  const a = await env.DB.prepare('SELECT * FROM training_assignments WHERE id=?').bind(assignmentId).first();
  if (!a || a.user_id !== user.id) return { res: notFound('ההכשרה') };
  if (a.status === 'withdrawn') return { res: bad('ההכשרה הזו בוטלה.', 403) };
  const st = await loadAssignmentState(env, a);
  const entry = st.modules.find(m => m.moduleId === moduleId);
  if (!entry) return { res: notFound('המודול') };
  if (!entry.available) return { res: bad('המודול עדיין לא פורסם.', 403) };
  if (entry.locked) return { res: bad('המודול ייפתח אחרי השלמת המודול הקודם במסלול.', 403) };
  const m = await moduleRow(env, moduleId);
  return { a, m, blocks: parseJson(m.published, []), entry, state: st };
}

async function blockProgress(env, assignmentId, moduleId) {
  const { results: prog } = await env.DB.prepare(
    'SELECT * FROM training_progress WHERE assignment_id=? AND module_id=?'
  ).bind(assignmentId, moduleId).all();
  const { results: subs } = await env.DB.prepare(
    'SELECT * FROM training_submissions WHERE assignment_id=? AND module_id=? ORDER BY created_at'
  ).bind(assignmentId, moduleId).all();
  const p = {}, s = {}, hist = {};
  for (const r of prog || []) p[r.block_id] = r;
  for (const r of subs || []) { s[r.block_id] = r; (hist[r.block_id] = hist[r.block_id] || []).push(publicSubmission(r)); }
  return { p, s, hist };
}

function learnerModulePayload(ctx, bp) {
  const { m, blocks } = ctx;
  return {
    id: m.id, title: m.title, description: m.description,
    objectives: parseJson(m.objectives, []), icon: m.icon, estMinutes: m.est_minutes,
    passScore: m.pass_score, publishedAt: m.published_at || 0,
    state: moduleState(m, blocks, bp.p, bp.s),
    viewed: !!bp.p[CONTENT_KEY],
    blocks: blocks.map(b => {
      const pr = bp.p[b.id];
      const done = !!(pr && pr.state === 'done');
      return {
        block: stripBlockForLearner(b, done),
        progress: pr ? {
          state: pr.state, attempts: pr.attempts,
          correct: pr.correct == null ? null : !!pr.correct,
          answer: parseJson(pr.answer, null)
        } : null,
        submission: bp.s[b.id] ? publicSubmission(bp.s[b.id]) : null,
        history: bp.hist[b.id] || []
      };
    })
  };
}

async function touchAssignment(env, a, moduleId) {
  const now = Date.now();
  await env.DB.prepare(
    'UPDATE training_assignments SET last_activity_at=?, last_module_id=?, started_at=COALESCE(started_at, ?) WHERE id=?'
  ).bind(now, moduleId, now, a.id).run();
}

async function meModuleGet({ request, env, m: match, url }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  const ctx = await learnerContext(env, user, url.searchParams.get('assignment') || '', match[1]);
  if (ctx.res) return ctx.res;
  await touchAssignment(env, ctx.a, ctx.m.id);
  return json({ ok: true, module: learnerModulePayload(ctx, await blockProgress(env, ctx.a.id, ctx.m.id)) });
}

async function meProgress({ request, env }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const ctx = await learnerContext(env, user, str(b.assignmentId, 64), str(b.moduleId, 64));
  if (ctx.res) return ctx.res;
  const now = Date.now();

  /* "I have gone through the material" — the viewed layer, one row for all
     of the module's non-activity blocks. */
  if (b.action === 'viewed') {
    await env.DB.prepare(
      `INSERT INTO training_progress (assignment_id, module_id, block_id, state, attempts, updated_at)
       VALUES (?,?,?,'viewed',0,?) ON CONFLICT(assignment_id, module_id, block_id) DO UPDATE SET updated_at=excluded.updated_at`
    ).bind(ctx.a.id, ctx.m.id, CONTENT_KEY, now).run();
  } else if (b.action === 'answer') {
    const block = ctx.blocks.find(x => x.id === b.blockId);
    if (!block) return notFound('הפריט');
    const kind = actKind(block);
    if (kind !== 'auto' && kind !== 'choice' && kind !== 'check') return bad('הפריט הזה מוגש לבדיקה, לא נענה כאן.');
    const prev = await env.DB.prepare(
      'SELECT * FROM training_progress WHERE assignment_id=? AND module_id=? AND block_id=?'
    ).bind(ctx.a.id, ctx.m.id, block.id).first();
    /* A finished graded item stays finished: re-answering until it comes
       out right would make maxAttempts meaningless. A manager can reset it. */
    if (prev && prev.state === 'done' && kind !== 'check') return bad('כבר ענית על הפריט הזה.', 409);
    const g = gradeAnswer(block, b.answer, prev);
    if (g.error) return bad(g.error);
    await env.DB.prepare(
      `INSERT INTO training_progress (assignment_id, module_id, block_id, state, attempts, correct, answer, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(assignment_id, module_id, block_id) DO UPDATE SET
         state=excluded.state, attempts=excluded.attempts, correct=excluded.correct,
         answer=excluded.answer, updated_at=excluded.updated_at`
    ).bind(ctx.a.id, ctx.m.id, block.id, g.done ? 'done' : 'viewed', g.attempts,
      g.correct == null ? null : (g.correct ? 1 : 0), JSON.stringify(g.answer), now).run();
  } else {
    return bad('פעולה לא מוכרת.');
  }
  await touchAssignment(env, ctx.a, ctx.m.id);
  return json({ ok: true, module: learnerModulePayload(ctx, await blockProgress(env, ctx.a.id, ctx.m.id)) });
}

async function meSubmit({ request, env }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const ctx = await learnerContext(env, user, str(b.assignmentId, 64), str(b.moduleId, 64));
  if (ctx.res) return ctx.res;
  const block = ctx.blocks.find(x => x.id === b.blockId);
  if (!block) return notFound('הפריט');
  if (actKind(block) !== 'human') return bad('הפריט הזה לא מוגש לבדיקה.');

  const last = await env.DB.prepare(
    'SELECT * FROM training_submissions WHERE assignment_id=? AND module_id=? AND block_id=? ORDER BY created_at DESC LIMIT 1'
  ).bind(ctx.a.id, ctx.m.id, block.id).first();
  if (last && last.status === 'approved') return bad('המשימה כבר אושרה.', 409);
  if (last && last.status === 'submitted' && block.review !== false) return bad('המשימה ממתינה לבדיקה. אפשר יהיה לעדכן אותה אם יתבקש תיקון.', 409);

  const c = cleanSubmission(block, b.body);
  if (c.error) return bad(c.error);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO training_submissions (id, assignment_id, module_id, block_id, user_id, attempt, body, status, created_at)
     VALUES (?,?,?,?,?,?,?,'submitted',?)`
  ).bind(randomId('sb'), ctx.a.id, ctx.m.id, block.id, user.id, last ? last.attempt + 1 : 1, JSON.stringify(c.body), now).run();
  await touchAssignment(env, ctx.a, ctx.m.id);
  if (block.review !== false) {
    await notifyManagers(env, 'submission', 'משימה ממתינה לבדיקה', user.name + ' · ' + ctx.m.title);
  }
  return json({ ok: true, module: learnerModulePayload(ctx, await blockProgress(env, ctx.a.id, ctx.m.id)) });
}

async function meFollowup({ request, env, m: match }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  const f = await env.DB.prepare(
    `SELECT f.* FROM training_followups f JOIN training_assignments a ON a.id = f.assignment_id
      WHERE f.id=? AND a.user_id=?`
  ).bind(match[1], user.id).first();
  if (!f) return notFound('נקודת המעקב');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  await env.DB.prepare('UPDATE training_followups SET reflection=?, updated_at=? WHERE id=?')
    .bind(text(b.reflection, 6000), Date.now(), f.id).run();
  await notifyManagers(env, 'followup', 'רפלקציה חדשה בליווי', user.name);
  const row = await env.DB.prepare('SELECT * FROM training_followups WHERE id=?').bind(f.id).first();
  return json({ ok: true, followup: publicFollowup(row, true) });
}

/* ── notifications & announcements ─────────────────────────────────────── */

async function notifRead({ request, env }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  await env.DB.prepare('UPDATE training_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL')
    .bind(Date.now(), user.id).run();
  return json({ ok: true });
}

async function notifGet({ request, env }) {
  const user = await currentStaff(request, env);
  if (!user) return bad('נדרשת התחברות.', 401);
  const { results } = await env.DB.prepare(
    'SELECT * FROM training_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 40'
  ).bind(user.id).all();
  const list = (results || []).map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.created_at, read: !!n.read_at }));
  return json({ ok: true, notifications: list, unread: list.filter(n => !n.read).length });
}

async function annGet({ request, env }) {
  const guard = await requireStaffLearner(request, env);
  if (guard.res) return guard.res;
  const all = isManager(guard.user);
  const { results } = await env.DB.prepare(
    `SELECT * FROM training_announcements ${all ? '' : "WHERE status='published'"} ORDER BY created_at DESC LIMIT 50`
  ).all();
  return json({ ok: true, announcements: (results || []).map(x => ({ id: x.id, title: x.title, body: x.body, kind: x.kind, status: x.status, by: x.by_name, at: x.created_at })) });
}

async function annPost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const title = str(b.title, 200);
  if (!title) return bad('צריך כותרת לעדכון');
  const kind = ['update', 'policy', 'module', 'tool'].indexOf(b.kind) > -1 ? b.kind : 'update';
  const id = randomId('an');
  await env.DB.prepare(
    'INSERT INTO training_announcements (id, title, body, kind, status, by_name, created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(id, title, text(b.body, 6000), kind, 'published', guard.user.name, Date.now()).run();
  /* Teachers who have training or hub access hear about it in the portal. */
  const { results } = await env.DB.prepare("SELECT id FROM staff_users WHERE active=1 AND role=?").bind(LEARNER_ROLE).all();
  for (const r of results || []) await notify(env, r.id, kind === 'policy' ? 'policy' : 'announcement', kind === 'policy' ? 'עודכן נוהל: ' + title : 'עדכון חדש: ' + title);
  await audit(env, guard.user, 'announcement.publish', { type: 'announcement', id, detail: title });
  return json({ ok: true, id }, 201);
}

async function annPatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const status = b.status === 'archived' ? 'archived' : 'published';
  const r = await env.DB.prepare('UPDATE training_announcements SET status=? WHERE id=?').bind(status, match[1]).run();
  if (!r.meta || !r.meta.changes) return notFound('העדכון');
  await audit(env, guard.user, 'announcement.' + status, { type: 'announcement', id: match[1] });
  return json({ ok: true });
}

/* ── resource hub ──────────────────────────────────────────────────────── */

async function resourcesGet({ request, env }) {
  const guard = await requireStaffLearner(request, env);
  if (guard.res) return guard.res;
  const mgr = isManager(guard.user);
  /* Teachers see what is official. Drafts and items under review are the
     manager's working set and stay with them. */
  const { results } = await env.DB.prepare(
    `SELECT * FROM training_resources ${mgr ? '' : "WHERE status='official'"} ORDER BY updated_at DESC`
  ).all();
  const { results: fav } = await env.DB.prepare('SELECT resource_id FROM training_favorites WHERE user_id=?').bind(guard.user.id).all();
  const favs = new Set((fav || []).map(x => x.resource_id));
  return json({ ok: true, resources: (results || []).map(r => publicResource(r, favs)) });
}

function resourceFields(b, base) {
  const out = {};
  const pick = (k, fn) => { if (b[k] !== undefined) out[k] = fn(b[k]); else if (base) out[k] = base[k]; };
  pick('title', v => str(v, 200));
  pick('description', v => text(v, 4000));
  pick('url', v => safeUrl(v));
  pick('kind', v => RES_KINDS.indexOf(v) > -1 ? v : 'guide');
  pick('category', v => str(v, 80));
  pick('language', v => str(v, 40));
  pick('level', v => str(v, 40));
  pick('program', v => str(v, 80));
  pick('status', v => RES_STATUS.indexOf(v) > -1 ? v : 'draft');
  if (b.tags !== undefined) out.tags = JSON.stringify((Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(x => str(x, 40)).filter(Boolean).slice(0, 20));
  else if (base) out.tags = base.tags;
  if (b.moduleIds !== undefined) out.module_ids = JSON.stringify((Array.isArray(b.moduleIds) ? b.moduleIds : []).map(x => str(x, 64)).filter(Boolean).slice(0, 20));
  else if (base) out.module_ids = base.module_ids;
  return out;
}

async function resourcesPost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const f = resourceFields(b, null);
  if (!f.title) return bad('צריך שם למשאב');
  if (b.url && !f.url) return bad('הקישור לא תקין — רק https:// או http://');
  const id = randomId('rs'), now = Date.now();
  await env.DB.prepare(
    `INSERT INTO training_resources (id, title, description, url, kind, category, language, level, program, tags, module_ids, status, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, f.title, f.description || '', f.url || '', f.kind || 'guide', f.category || '', f.language || '',
    f.level || '', f.program || '', f.tags || '[]', f.module_ids || '[]', f.status || 'draft', guard.user.name, now, now).run();
  await audit(env, guard.user, 'resource.create', { type: 'resource', id, detail: f.title });
  const row = await env.DB.prepare('SELECT * FROM training_resources WHERE id=?').bind(id).first();
  return json({ ok: true, resource: publicResource(row) }, 201);
}

async function resourcePatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const cur = await env.DB.prepare('SELECT * FROM training_resources WHERE id=?').bind(match[1]).first();
  if (!cur) return notFound('המשאב');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const f = resourceFields(b, cur);
  if (!f.title) return bad('צריך שם למשאב');
  if (b.url && !f.url) return bad('הקישור לא תקין — רק https:// או http://');
  const urlChanged = f.url !== cur.url;
  await env.DB.prepare(
    `UPDATE training_resources SET title=?, description=?, url=?, kind=?, category=?, language=?, level=?, program=?,
       tags=?, module_ids=?, status=?, updated_at=?, link_status=?, link_checked_at=? WHERE id=?`
  ).bind(f.title, f.description, f.url, f.kind, f.category, f.language, f.level, f.program, f.tags, f.module_ids,
    f.status, Date.now(), urlChanged ? 'unchecked' : cur.link_status, urlChanged ? null : cur.link_checked_at, cur.id).run();
  await audit(env, guard.user, f.status !== cur.status ? 'resource.status.' + f.status : 'resource.edit', { type: 'resource', id: cur.id, detail: f.title });
  const row = await env.DB.prepare('SELECT * FROM training_resources WHERE id=?').bind(cur.id).first();
  return json({ ok: true, resource: publicResource(row) });
}

/* Whether a link actually opens. Google answers a private document with a
   redirect to its sign-in page, which is "restricted" — the link is fine, the
   reader needs access — and is different from "broken". Never followed: a
   redirect is reported, not chased. Only public hostnames are fetched. */
export function classifyLink(status, location) {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) {
    return /accounts\.google\.com|ServiceLogin|\/signin|login/i.test(location || '') ? 'restricted' : 'ok';
  }
  if (status === 401 || status === 403) return 'restricted';
  if (status === 404 || status === 410) return 'broken';
  return 'error';
}

async function resourceCheck({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const cur = await env.DB.prepare('SELECT * FROM training_resources WHERE id=?').bind(match[1]).first();
  if (!cur) return notFound('המשאב');
  let result = 'broken';
  if (cur.url) {
    let host = '';
    try { host = new URL(cur.url).hostname; } catch { }
    if (!host || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^\[/.test(host)) {
      result = 'error';
    } else {
      try {
        const r = await fetch(cur.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'NewSchool-LinkCheck/1.0' } });
        result = classifyLink(r.status, r.headers.get('location'));
      } catch { result = 'error'; }
    }
  }
  const now = Date.now();
  await env.DB.prepare('UPDATE training_resources SET link_status=?, link_checked_at=? WHERE id=?').bind(result, now, cur.id).run();
  return json({ ok: true, linkStatus: result, checkedAt: now });
}

async function resourceFav({ request, env, m: match }) {
  const guard = await requireStaffLearner(request, env);
  if (guard.res) return guard.res;
  const r = await env.DB.prepare('SELECT id, status FROM training_resources WHERE id=?').bind(match[1]).first();
  if (!r || (r.status !== 'official' && !isManager(guard.user))) return notFound('המשאב');
  const b = (await readJson(request)) || {};
  if (b.favorite === false) {
    await env.DB.prepare('DELETE FROM training_favorites WHERE user_id=? AND resource_id=?').bind(guard.user.id, r.id).run();
  } else {
    await env.DB.prepare('INSERT OR IGNORE INTO training_favorites (user_id, resource_id, created_at) VALUES (?,?,?)').bind(guard.user.id, r.id, Date.now()).run();
  }
  return json({ ok: true, favorite: b.favorite !== false });
}

/* ── search ────────────────────────────────────────────────────────────── */

function blockText(b) {
  const parts = [];
  for (const [k, v] of Object.entries(b)) {
    if (k === 'id' || k === 'type' || k === 'url' || k === 'correct') continue;
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object') {
      for (const [ik, iv] of Object.entries(it)) if (typeof iv === 'string' && ik !== 'id' && ik !== 'quality') parts.push(iv);
    }
  }
  return parts.join(' ');
}

/* Searches what has actually been entered — published modules the caller
   can open, and hub resources — and points at the place, never a made-up
   answer. Teachers search only modules in their own live paths. */
async function search({ request, env, url }) {
  const guard = await requireStaffLearner(request, env);
  if (guard.res) return guard.res;
  const q = str(url.searchParams.get('q'), 120).toLowerCase();
  const terms = q.split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return json({ ok: true, results: [] });
  const mgr = isManager(guard.user);
  const hit = (s) => { const t = s.toLowerCase(); return terms.every(x => t.includes(x)); };
  const results = [];

  let mods;
  if (mgr) {
    ({ results: mods } = await env.DB.prepare("SELECT * FROM training_modules WHERE status <> 'archived'").all());
  } else {
    ({ results: mods } = await env.DB.prepare(
      `SELECT DISTINCT m.*, a.id AS assignment_id FROM training_modules m
         JOIN training_path_modules pm ON pm.module_id = m.id
         JOIN training_assignments a ON a.path_id = pm.path_id
        WHERE a.user_id = ? AND a.status <> 'withdrawn' AND m.status = 'published' AND m.published IS NOT NULL`
    ).bind(guard.user.id).all());
  }
  const seen = new Set();
  for (const m of mods || []) {
    if (seen.has(m.id)) continue;
    const blocks = parseJson(mgr ? m.draft : m.published, []);
    const head = m.title + ' ' + m.description + ' ' + parseJson(m.objectives, []).join(' ');
    const match = blocks.find(b => hit(blockText(b)));
    if (hit(head) || match) {
      seen.add(m.id);
      const snippet = match ? blockText(match).replace(/\s+/g, ' ').slice(0, 160) : m.description.slice(0, 160);
      results.push({ type: 'module', id: m.id, assignmentId: m.assignment_id || null, title: m.title, snippet, score: hit(m.title) ? 3 : hit(head) ? 2 : 1 });
    }
  }
  const { results: res } = await env.DB.prepare(
    `SELECT * FROM training_resources ${mgr ? "WHERE status <> 'archived'" : "WHERE status='official'"}`
  ).all();
  for (const r of res || []) {
    const t = [r.title, r.description, r.category, r.language, r.level, r.program, parseJson(r.tags, []).join(' ')].join(' ');
    if (hit(t)) results.push({ type: 'resource', id: r.id, title: r.title, url: r.url, snippet: r.description.slice(0, 160), score: hit(r.title) ? 3 : 1 });
  }
  results.sort((a, b) => b.score - a.score);
  return json({ ok: true, results: results.slice(0, 25) });
}

/* ── management: modules ───────────────────────────────────────────────── */

async function modulesGet({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const { results } = await env.DB.prepare('SELECT * FROM training_modules ORDER BY created_at').all();
  return json({ ok: true, modules: (results || []).map(m => publicModule(m, false)) });
}

function moduleFields(b, base) {
  const f = {};
  f.title = b.title !== undefined ? str(b.title, 200) : base.title;
  f.description = b.description !== undefined ? text(b.description, 4000) : base.description;
  f.objectives = b.objectives !== undefined
    ? JSON.stringify((Array.isArray(b.objectives) ? b.objectives : String(b.objectives).split('\n')).map(x => str(x, 300)).filter(Boolean).slice(0, 20))
    : base.objectives;
  f.icon = b.icon !== undefined ? (ICONS.indexOf(b.icon) > -1 ? b.icon : 'book') : base.icon;
  f.est_minutes = b.estMinutes !== undefined ? Math.max(0, Math.min(1000, parseInt(b.estMinutes, 10) || 0)) : base.est_minutes;
  if (b.passScore !== undefined) {
    const n = parseInt(b.passScore, 10);
    f.pass_score = b.passScore === null || b.passScore === '' || isNaN(n) ? null : Math.max(0, Math.min(100, n));
  } else f.pass_score = base.pass_score;
  return f;
}

async function saveVersion(env, m, kind, by, note, blocks) {
  await env.DB.prepare(
    'INSERT INTO training_module_versions (id, module_id, rev, kind, snapshot, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(randomId('mv'), m.id, m.rev, kind, JSON.stringify(moduleSnapshot(m, blocks)), str(note, 300), by, Date.now()).run();
}

async function createModule(env, user, data) {
  const base = { title: '', description: '', objectives: '[]', icon: 'book', est_minutes: 0, pass_score: null };
  const f = moduleFields(data, base);
  if (!f.title) return { error: 'צריך כותרת למודול' };
  const blocks = sanitizeBlocks(data.blocks || []);
  const id = randomId('md'), now = Date.now();
  await env.DB.prepare(
    `INSERT INTO training_modules (id, title, description, objectives, icon, est_minutes, pass_score, status, draft, rev, published_rev, updated_at, updated_by, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?,1,0,?,?,?)`
  ).bind(id, f.title, f.description, f.objectives, f.icon, f.est_minutes, f.pass_score, JSON.stringify(blocks), now, user.name, now).run();
  const m = await moduleRow(env, id);
  await saveVersion(env, m, 'save', user.name, 'נוצר', blocks);
  return { m };
}

async function modulePost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const r = await createModule(env, guard.user, b);
  if (r.error) return bad(r.error);
  await audit(env, guard.user, 'module.create', { type: 'module', id: r.m.id, detail: r.m.title });
  return json({ ok: true, module: publicModule(r.m, true) }, 201);
}

async function moduleGet({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  return json({ ok: true, module: publicModule(m, true) });
}

/* Saving a draft. `rev` is the version the editor loaded; if someone else
   saved in between, the save is refused with the newer copy rather than
   silently overwriting their work. */
async function modulePatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  if (b.rev !== undefined && Number(b.rev) !== m.rev) {
    return json({ ok: false, conflict: true, error: 'מישהו אחר שמר את המודול בינתיים (' + m.updated_by + '). השינויים שלך לא נשמרו — הם עדיין במסך.', module: publicModule(m, true) }, 409);
  }
  if (m.status === 'archived') return bad('המודול בארכיון. צריך להחזיר אותו מהארכיון לפני עריכה.', 409);
  const f = moduleFields(b, m);
  if (!f.title) return bad('צריך כותרת למודול');
  const blocks = b.blocks !== undefined ? sanitizeBlocks(b.blocks) : parseJson(m.draft, []);
  const now = Date.now();
  const r = await env.DB.prepare(
    `UPDATE training_modules SET title=?, description=?, objectives=?, icon=?, est_minutes=?, pass_score=?, draft=?,
       rev=rev+1, updated_at=?, updated_by=? WHERE id=? AND rev=?`
  ).bind(f.title, f.description, f.objectives, f.icon, f.est_minutes, f.pass_score, JSON.stringify(blocks), now, guard.user.name, m.id, m.rev).run();
  if (!r.meta || !r.meta.changes) {
    return json({ ok: false, conflict: true, error: 'המודול נשמר בינתיים ממקום אחר. השינויים שלך עדיין במסך.', module: publicModule(await moduleRow(env, m.id), true) }, 409);
  }
  const fresh = await moduleRow(env, m.id);
  await saveVersion(env, fresh, 'save', guard.user.name, str(b.note, 300), blocks);
  return json({ ok: true, module: publicModule(fresh, true) });
}

async function modulePublish({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  const b = (await readJson(request)) || {};
  if (b.rev !== undefined && Number(b.rev) !== m.rev) return bad('יש גרסה חדשה יותר של המודול. צריך לטעון אותה לפני פרסום.', 409);
  const blocks = parseJson(m.draft, []);
  if (!blocks.length) return bad('אי אפשר לפרסם מודול ריק.');
  const now = Date.now();
  const first = m.published == null;
  await env.DB.prepare(
    "UPDATE training_modules SET published=?, published_rev=rev, published_at=?, status='published' WHERE id=?"
  ).bind(JSON.stringify(blocks), now, m.id).run();
  const fresh = await moduleRow(env, m.id);
  await saveVersion(env, fresh, 'publish', guard.user.name, str(b.note, 300), blocks);
  await audit(env, guard.user, 'module.publish', { type: 'module', id: m.id, detail: m.title + ' · גרסה ' + fresh.rev });
  /* Teachers whose live path holds this module hear about it. */
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT a.user_id FROM training_assignments a JOIN training_path_modules pm ON pm.path_id = a.path_id
      WHERE pm.module_id=? AND a.status='active'`
  ).bind(m.id).all();
  for (const r of results || []) await notify(env, r.user_id, 'module', (first ? 'מודול חדש במסלול שלך: ' : 'מודול עודכן: ') + m.title);
  return json({ ok: true, module: publicModule(fresh, true) });
}

async function moduleArchive({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  const b = (await readJson(request)) || {};
  const status = b.archived === false ? (m.published != null ? 'published' : 'draft') : 'archived';
  await env.DB.prepare('UPDATE training_modules SET status=?, updated_at=? WHERE id=?').bind(status, Date.now(), m.id).run();
  await audit(env, guard.user, status === 'archived' ? 'module.archive' : 'module.unarchive', { type: 'module', id: m.id, detail: m.title });
  return json({ ok: true, module: publicModule(await moduleRow(env, m.id), true) });
}

async function moduleDuplicate({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  /* Fresh block ids: the copy must not inherit anyone's progress. */
  const blocks = parseJson(m.draft, []).map(x => Object.assign({}, x, { id: '' }));
  const r = await createModule(env, guard.user, {
    title: m.title + ' (עותק)', description: m.description, objectives: parseJson(m.objectives, []),
    icon: m.icon, estMinutes: m.est_minutes, passScore: m.pass_score, blocks
  });
  await audit(env, guard.user, 'module.duplicate', { type: 'module', id: r.m.id, detail: 'מתוך ' + m.title });
  return json({ ok: true, module: publicModule(r.m, true) }, 201);
}

async function moduleVersions({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const { results } = await env.DB.prepare(
    'SELECT id, rev, kind, note, by_name, created_at FROM training_module_versions WHERE module_id=? ORDER BY created_at DESC LIMIT 60'
  ).bind(match[1]).all();
  return json({ ok: true, versions: (results || []).map(v => ({ id: v.id, rev: v.rev, kind: v.kind, note: v.note, by: v.by_name, at: v.created_at })) });
}

/* Restoring is itself a save: the old snapshot becomes the newest draft, and
   the draft it replaces stays in the history. Nothing is lost either way. */
async function moduleRestore({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  const b = (await readJson(request)) || {};
  const v = await env.DB.prepare('SELECT * FROM training_module_versions WHERE id=? AND module_id=?').bind(str(b.versionId, 64), m.id).first();
  if (!v) return notFound('הגרסה');
  const snap = parseJson(v.snapshot, {});
  const f = moduleFields({ title: snap.title, description: snap.description, objectives: snap.objectives, icon: snap.icon, estMinutes: snap.estMinutes, passScore: snap.passScore }, m);
  await env.DB.prepare(
    `UPDATE training_modules SET title=?, description=?, objectives=?, icon=?, est_minutes=?, pass_score=?, draft=?, rev=rev+1, updated_at=?, updated_by=? WHERE id=?`
  ).bind(f.title, f.description, f.objectives, f.icon, f.est_minutes, f.pass_score, JSON.stringify(sanitizeBlocks(snap.blocks || [])), Date.now(), guard.user.name, m.id).run();
  const fresh = await moduleRow(env, m.id);
  await saveVersion(env, fresh, 'restore', guard.user.name, 'שוחזר מגרסה ' + v.rev, parseJson(fresh.draft, []));
  await audit(env, guard.user, 'module.restore', { type: 'module', id: m.id, detail: m.title + ' ← גרסה ' + v.rev });
  return json({ ok: true, module: publicModule(fresh, true) });
}

/* A manager's look at the teacher's view, from the draft. Same stripping as
   the real thing, so the preview shows exactly what a teacher would get. */
async function modulePreview({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const m = await moduleRow(env, match[1]);
  if (!m) return notFound('המודול');
  const blocks = parseJson(m.draft, []);
  return json({
    ok: true, module: {
      id: m.id, title: m.title, description: m.description, objectives: parseJson(m.objectives, []),
      icon: m.icon, estMinutes: m.est_minutes, passScore: m.pass_score, preview: true,
      state: moduleState(m, blocks, {}, {}), viewed: false,
      blocks: blocks.map(b => ({ block: stripBlockForLearner(b, false), progress: null, submission: null, history: [] }))
    }
  });
}

/* ── management: paths ─────────────────────────────────────────────────── */

async function pathModules(env, pathId) {
  const { results } = await env.DB.prepare(
    `SELECT pm.*, m.title, m.status AS mstatus FROM training_path_modules pm JOIN training_modules m ON m.id = pm.module_id
      WHERE pm.path_id=? ORDER BY pm.sort`
  ).bind(pathId).all();
  return results || [];
}

async function pathsGet({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const { results } = await env.DB.prepare('SELECT * FROM training_paths ORDER BY status, created_at').all();
  const out = [];
  for (const p of results || []) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM training_assignments WHERE path_id=? AND status<>'withdrawn'").bind(p.id).first();
    out.push(Object.assign(publicPath(p, await pathModules(env, p.id)), { learners: n ? n.n : 0 }));
  }
  return json({ ok: true, paths: out });
}

function pathFields(b, base) {
  return {
    title: b.title !== undefined ? str(b.title, 200) : base.title,
    description: b.description !== undefined ? text(b.description, 3000) : base.description,
    kind: b.kind !== undefined ? (b.kind === 'continuing' ? 'continuing' : 'onboarding') : base.kind,
    language: b.language !== undefined ? str(b.language, 40) : base.language,
    audience: b.audience !== undefined ? str(b.audience, 200) : base.audience,
    status: b.status !== undefined ? (b.status === 'archived' ? 'archived' : 'active') : base.status
  };
}

/* The module list is replaced wholesale — it is one ordered list the editor
   owns. Prerequisites must point inside the path and not at the module
   itself, or a module could never open. */
async function writePathModules(env, pathId, list) {
  const clean = [];
  const seen = new Set();
  for (const x of (Array.isArray(list) ? list : []).slice(0, 60)) {
    const id = str(x && x.moduleId, 64);
    if (!id || seen.has(id)) continue;
    const exists = await moduleRow(env, id);
    if (!exists) return 'מודול לא קיים ברשימה';
    seen.add(id);
    clean.push({ id, required: x.required !== false, prereq: str(x.prereq, 64) || null });
  }
  for (const c of clean) {
    if (c.prereq && (c.prereq === c.id || !seen.has(c.prereq))) c.prereq = null;
  }
  const stmts = [env.DB.prepare('DELETE FROM training_path_modules WHERE path_id=?').bind(pathId)];
  clean.forEach((c, i) => stmts.push(env.DB.prepare(
    'INSERT INTO training_path_modules (path_id, module_id, sort, required, prereq_module_id) VALUES (?,?,?,?,?)'
  ).bind(pathId, c.id, i, c.required ? 1 : 0, c.prereq)));
  await env.DB.batch(stmts);
  return null;
}

async function pathsPost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const f = pathFields(b, { title: '', description: '', kind: 'onboarding', language: '', audience: '', status: 'active' });
  if (!f.title) return bad('צריך שם למסלול');
  const id = randomId('pt'), now = Date.now();
  await env.DB.prepare(
    'INSERT INTO training_paths (id, title, description, kind, language, audience, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(id, f.title, f.description, f.kind, f.language, f.audience, f.status, now, now).run();
  if (b.modules) {
    const err = await writePathModules(env, id, b.modules);
    if (err) return bad(err);
  }
  await audit(env, guard.user, 'path.create', { type: 'path', id, detail: f.title });
  const p = await env.DB.prepare('SELECT * FROM training_paths WHERE id=?').bind(id).first();
  return json({ ok: true, path: publicPath(p, await pathModules(env, id)) }, 201);
}

async function pathPatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const p = await env.DB.prepare('SELECT * FROM training_paths WHERE id=?').bind(match[1]).first();
  if (!p) return notFound('המסלול');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const f = pathFields(b, p);
  if (!f.title) return bad('צריך שם למסלול');
  await env.DB.prepare(
    'UPDATE training_paths SET title=?, description=?, kind=?, language=?, audience=?, status=?, updated_at=? WHERE id=?'
  ).bind(f.title, f.description, f.kind, f.language, f.audience, f.status, Date.now(), p.id).run();
  if (b.modules !== undefined) {
    const err = await writePathModules(env, p.id, b.modules);
    if (err) return bad(err);
  }
  await audit(env, guard.user, b.modules !== undefined ? 'path.modules' : 'path.edit', { type: 'path', id: p.id, detail: f.title });
  const fresh = await env.DB.prepare('SELECT * FROM training_paths WHERE id=?').bind(p.id).first();
  return json({ ok: true, path: publicPath(fresh, await pathModules(env, p.id)) });
}

/* ── management: teachers, assignments, review ─────────────────────────── */

async function teachersGet({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const { results } = await env.DB.prepare(
    `SELECT u.*, p.language AS p_language, p.position AS p_position, p.start_date AS p_start
       FROM staff_users u LEFT JOIN training_profiles p ON p.user_id = u.id
      WHERE u.role=? ORDER BY u.name`
  ).bind(LEARNER_ROLE).all();
  return json({
    ok: true, teachers: (results || []).map(u => publicProfile(u, { language: u.p_language || '', position: u.p_position || '', start_date: u.p_start || '' }))
  });
}

/* All live assignments with their computed progress — the overview and the
   teacher table are both views of this one list. */
async function allAssignmentStates(env) {
  const { results: as } = await env.DB.prepare(
    `SELECT a.*, p.title AS p_title, p.kind AS p_kind, u.name AS u_name, u.active AS u_active,
            pr.language AS p_language, pr.position AS p_position
       FROM training_assignments a JOIN training_paths p ON p.id = a.path_id
       LEFT JOIN staff_users u ON u.id = a.user_id
       LEFT JOIN training_profiles pr ON pr.user_id = a.user_id
      WHERE a.status <> 'withdrawn' ORDER BY a.assigned_at DESC`
  ).all();
  const { results: pm } = await env.DB.prepare(
    `SELECT pm.*, m.title, m.description, m.icon, m.est_minutes, m.status AS mstatus, m.published, m.published_at, m.pass_score
       FROM training_path_modules pm JOIN training_modules m ON m.id = pm.module_id ORDER BY pm.sort`
  ).all();
  const { results: prog } = await env.DB.prepare(
    `SELECT pr.* FROM training_progress pr JOIN training_assignments a ON a.id = pr.assignment_id WHERE a.status <> 'withdrawn'`
  ).all();
  const { results: subs } = await env.DB.prepare(
    `SELECT s.* FROM training_submissions s JOIN training_assignments a ON a.id = s.assignment_id
      WHERE a.status <> 'withdrawn' ORDER BY s.created_at`
  ).all();
  const byPath = {}, progBy = {}, subBy = {};
  for (const x of pm || []) (byPath[x.path_id] = byPath[x.path_id] || []).push(x);
  for (const x of prog || []) (progBy[x.assignment_id] = progBy[x.assignment_id] || []).push(x);
  for (const x of subs || []) (subBy[x.assignment_id] = subBy[x.assignment_id] || []).push(x);
  return (as || []).map(a => ({ a, st: buildAssignmentState(a, byPath[a.path_id] || [], progBy[a.id] || [], subBy[a.id] || []) }));
}

function attentionReasons(a, st, now) {
  const why = [];
  if (a.status !== 'active') return why;
  if (st.needsRevision) why.push('נדרש תיקון');
  if (a.due_date && a.due_date < new Date(now).toISOString().slice(0, 10) && !st.allRequiredDone) why.push('עבר מועד היעד');
  const last = a.last_activity_at || a.assigned_at;
  if (!st.allRequiredDone && now - last > 7 * DAY) why.push('אין פעילות שבוע');
  if (a.readiness === 'more_training') why.push('נדרשת הכשרה נוספת');
  return why;
}

async function overview({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const now = Date.now();
  const rows = await allAssignmentStates(env);
  const active = rows.filter(r => r.a.status === 'active');
  const { results: queue } = await env.DB.prepare(
    `SELECT s.*, u.name AS u_name, m.title AS m_title FROM training_submissions s
       JOIN training_assignments a ON a.id = s.assignment_id
       LEFT JOIN staff_users u ON u.id = s.user_id
       LEFT JOIN training_modules m ON m.id = s.module_id
      WHERE s.status='submitted' AND a.status <> 'withdrawn'
        AND s.created_at = (SELECT MAX(s2.created_at) FROM training_submissions s2
                             WHERE s2.assignment_id=s.assignment_id AND s2.module_id=s.module_id AND s2.block_id=s.block_id)
      ORDER BY s.created_at`
  ).all();
  const teacherRows = rows.map(({ a, st }) => ({
    assignmentId: a.id, userId: a.user_id, name: a.u_name || '(חשבון נמחק)', accountActive: !!a.u_active,
    language: a.p_language || '', position: a.p_position || '',
    pathId: a.path_id, pathTitle: a.p_title, pathKind: a.p_kind, status: a.status,
    percent: st.percent, allRequiredDone: st.allRequiredDone,
    pendingReview: st.pendingReview, needsRevision: st.needsRevision,
    readiness: a.readiness || null, readinessLabel: a.readiness ? READINESS_LABEL[a.readiness] : '',
    lastActivityAt: a.last_activity_at || 0, dueDate: a.due_date,
    attention: attentionReasons(a, st, now)
  }));
  const learnersIn = new Set(active.filter(r => r.a.p_kind === 'onboarding').map(r => r.a.user_id));
  return json({
    ok: true,
    stats: {
      inTraining: learnersIn.size,
      completed: rows.filter(r => r.a.status === 'completed').length,
      awaitingApproval: active.filter(r => r.st.allRequiredDone && !r.a.readiness).length,
      toReview: (queue || []).length,
      avgProgress: active.length ? Math.round(active.reduce((n, r) => n + r.st.percent, 0) / active.length) : 0,
      needsAttention: teacherRows.filter(r => r.attention.length).length
    },
    rows: teacherRows,
    queue: (queue || []).map(s => Object.assign(publicSubmission(s), { assignmentId: s.assignment_id, userId: s.user_id, name: s.u_name || '', moduleTitle: s.m_title || '' })),
    empty: !(await env.DB.prepare('SELECT 1 AS x FROM training_modules LIMIT 1').first())
  });
}

async function learnerGet({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const u = await env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(match[1]).first();
  const { results: as } = await env.DB.prepare(
    `SELECT a.*, p.title AS p_title, p.kind AS p_kind, p.description AS p_desc FROM training_assignments a
       JOIN training_paths p ON p.id = a.path_id WHERE a.user_id=? ORDER BY a.assigned_at`
  ).bind(match[1]).all();
  if (!u && !(as || []).length) return notFound('המורה');
  const assignments = [];
  for (const a of as || []) {
    const st = await loadAssignmentState(env, a);
    /* Answers and submissions per module, with the full block (key
       included) — this is the manager's view. */
    const detail = {};
    for (const mod of st.modules) {
      if (!mod.available) continue;
      const m = await moduleRow(env, mod.moduleId);
      const blocks = parseJson(m.published, []);
      const bp = await blockProgress(env, a.id, mod.moduleId);
      detail[mod.moduleId] = blocks.filter(isActivity).map(b => ({
        block: b,
        progress: bp.p[b.id] ? { state: bp.p[b.id].state, attempts: bp.p[b.id].attempts, correct: bp.p[b.id].correct == null ? null : !!bp.p[b.id].correct, answer: parseJson(bp.p[b.id].answer, null) } : null,
        history: bp.hist[b.id] || []
      }));
    }
    const { results: fu } = await env.DB.prepare('SELECT * FROM training_followups WHERE assignment_id=? ORDER BY due_date').bind(a.id).all();
    assignments.push(publicAssignment(a, { title: a.p_title, kind: a.p_kind, description: a.p_desc }, st, {
      detail, followups: (fu || []).map(f => publicFollowup(f)), attention: attentionReasons(a, st, Date.now())
    }));
  }
  const { results: log } = await env.DB.prepare(
    'SELECT * FROM training_audit WHERE subject_user_id=? ORDER BY at DESC LIMIT 80'
  ).bind(match[1]).all();
  return json({
    ok: true,
    profile: publicProfile(u, await profileOf(env, match[1])),
    assignments,
    audit: (log || []).map(x => ({ id: x.id, at: x.at, actor: x.actor_name, action: x.action, detail: x.detail }))
  });
}

async function profilePut({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const u = await env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(match[1]).first();
  if (!u || u.role !== LEARNER_ROLE) return notFound('המורה');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  await env.DB.prepare(
    `INSERT INTO training_profiles (user_id, language, position, start_date, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET language=excluded.language, position=excluded.position,
       start_date=excluded.start_date, updated_at=excluded.updated_at`
  ).bind(u.id, str(b.language, 40), str(b.position, 120), isoDate(b.startDate), Date.now()).run();
  await audit(env, guard.user, 'profile.edit', { type: 'profile', id: u.id, subject: u.id });
  return json({ ok: true, profile: publicProfile(u, await profileOf(env, u.id)) });
}

async function assignmentsPost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const u = await env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(str(b.userId, 64)).first();
  if (!u) return notFound('המורה');
  if (u.role !== LEARNER_ROLE) return bad('אפשר לשייך הכשרה רק לחשבון מורה.');
  const p = await env.DB.prepare('SELECT * FROM training_paths WHERE id=?').bind(str(b.pathId, 64)).first();
  if (!p) return notFound('המסלול');
  if (p.status === 'archived') return bad('המסלול בארכיון.');
  const dup = await env.DB.prepare('SELECT * FROM training_assignments WHERE path_id=? AND user_id=?').bind(p.id, u.id).first();
  const now = Date.now();
  let id;
  if (dup && dup.status !== 'withdrawn') return bad('המסלול כבר משויך למורה הזה.', 409);
  if (dup) {
    /* Re-assigning a withdrawn path revives the same record, progress and
       all, instead of starting a second history beside it. */
    id = dup.id;
    await env.DB.prepare("UPDATE training_assignments SET status='active', due_date=?, assigned_by=?, assigned_at=? WHERE id=?")
      .bind(isoDate(b.dueDate), guard.user.name, now, id).run();
  } else {
    id = randomId('as');
    await env.DB.prepare(
      'INSERT INTO training_assignments (id, path_id, user_id, status, due_date, assigned_by, assigned_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(id, p.id, u.id, 'active', isoDate(b.dueDate), guard.user.name, now).run();
  }
  await notify(env, u.id, 'assigned', 'שויכה לך הכשרה: ' + p.title, p.description.slice(0, 200));
  await audit(env, guard.user, 'assignment.create', { type: 'assignment', id, subject: u.id, detail: p.title });
  return json({ ok: true, id }, 201);
}

async function assignmentPatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const a = await env.DB.prepare('SELECT * FROM training_assignments WHERE id=?').bind(match[1]).first();
  if (!a) return notFound('השיוך');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const status = b.status !== undefined ? (['active', 'withdrawn', 'completed'].indexOf(b.status) > -1 ? b.status : a.status) : a.status;
  const due = b.dueDate !== undefined ? isoDate(b.dueDate) : a.due_date;
  await env.DB.prepare('UPDATE training_assignments SET status=?, due_date=? WHERE id=?').bind(status, due, a.id).run();
  await audit(env, guard.user, status !== a.status ? 'assignment.' + status : 'assignment.edit', { type: 'assignment', id: a.id, subject: a.user_id, detail: due ? 'יעד ' + due : '' });
  return json({ ok: true });
}

/* Readiness is a person's decision, recorded with who, what and why. The
   data informs it (the manager sees every score on the same screen) but
   never makes it. */
async function readinessPost({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const a = await env.DB.prepare('SELECT a.*, p.title AS p_title FROM training_assignments a JOIN training_paths p ON p.id=a.path_id WHERE a.id=?').bind(match[1]).first();
  if (!a) return notFound('השיוך');
  const b = await readJson(request);
  if (!b || !READINESS_LABEL[b.decision]) return bad('צריך לבחור החלטה');
  const note = text(b.note, 3000);
  if (b.decision !== 'ready' && b.decision !== 'completed' && !note) return bad('בהחלטה הזו צריך לכתוב מה נדרש להשלים');
  const now = Date.now();
  const status = b.decision === 'ready' || b.decision === 'completed' ? 'completed' : 'active';
  await env.DB.prepare(
    'UPDATE training_assignments SET readiness=?, readiness_note=?, readiness_by=?, readiness_at=?, status=? WHERE id=?'
  ).bind(b.decision, note, guard.user.name, now, status, a.id).run();
  /* Ready (fully or with conditions) opens the 30-day follow-up, dated from
     the day teaching starts. Existing checkpoints are kept, not reset. */
  if ((b.decision === 'ready' || b.decision === 'conditional') && b.followups !== false) {
    const start = isoDate(b.teachingStart) || new Date(now).toISOString().slice(0, 10);
    for (const f of FOLLOWUPS) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO training_followups (id, assignment_id, checkpoint, due_date, status, updated_at) VALUES (?,?,?,?,'open',?)`
      ).bind(randomId('fu'), a.id, f.key, addDays(start, f.days), now).run();
    }
  }
  await notify(env, a.user_id, 'readiness', READINESS_LABEL[b.decision], note.slice(0, 300));
  await audit(env, guard.user, 'readiness.' + b.decision, { type: 'assignment', id: a.id, subject: a.user_id, detail: a.p_title + (note ? ' · ' + note : '') });
  return json({ ok: true });
}

/* Clears auto-checked answers in one module so the teacher can try again —
   the manager's override for exhausted attempts. Submissions are untouched. */
async function resetPost({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const a = await env.DB.prepare('SELECT * FROM training_assignments WHERE id=?').bind(match[1]).first();
  if (!a) return notFound('השיוך');
  const b = (await readJson(request)) || {};
  const moduleId = str(b.moduleId, 64);
  if (!moduleId) return bad('צריך לבחור מודול');
  await env.DB.prepare(
    `DELETE FROM training_progress WHERE assignment_id=? AND module_id=? AND block_id <> ? ${b.blockId ? 'AND block_id=?' : ''}`
  ).bind(...[a.id, moduleId, CONTENT_KEY].concat(b.blockId ? [str(b.blockId, 64)] : [])).run();
  await audit(env, guard.user, 'progress.reset', { type: 'assignment', id: a.id, subject: a.user_id, detail: moduleId });
  return json({ ok: true });
}

async function reviewPost({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const s = await env.DB.prepare('SELECT * FROM training_submissions WHERE id=?').bind(match[1]).first();
  if (!s) return notFound('ההגשה');
  const latest = await env.DB.prepare(
    'SELECT id FROM training_submissions WHERE assignment_id=? AND module_id=? AND block_id=? ORDER BY created_at DESC LIMIT 1'
  ).bind(s.assignment_id, s.module_id, s.block_id).first();
  if (latest.id !== s.id) return bad('יש הגשה חדשה יותר של המשימה הזו.', 409);
  const b = await readJson(request);
  if (!b || (b.decision !== 'approve' && b.decision !== 'revise')) return bad('צריך לבחור: אישור או בקשת תיקון');
  const feedback = text(b.feedback, 6000);
  if (b.decision === 'revise' && !feedback) return bad('בבקשת תיקון צריך לכתוב מה לתקן');
  const status = b.decision === 'approve' ? 'approved' : 'needs_revision';
  await env.DB.prepare('UPDATE training_submissions SET status=?, feedback=?, reviewed_by=?, reviewed_at=? WHERE id=?')
    .bind(status, feedback, guard.user.name, Date.now(), s.id).run();
  const m = await moduleRow(env, s.module_id);
  await notify(env, s.user_id, status === 'approved' ? 'approved' : 'revision',
    (status === 'approved' ? 'משימה אושרה: ' : 'נדרש תיקון: ') + (m ? m.title : ''), feedback.slice(0, 300));
  await audit(env, guard.user, 'submission.' + status, { type: 'submission', id: s.id, subject: s.user_id, detail: (m ? m.title : '') + (feedback ? ' · ' + feedback.slice(0, 200) : '') });
  return json({ ok: true });
}

async function followupPatch({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const f = await env.DB.prepare('SELECT f.*, a.user_id FROM training_followups f JOIN training_assignments a ON a.id=f.assignment_id WHERE f.id=?').bind(match[1]).first();
  if (!f) return notFound('נקודת המעקב');
  const b = await readJson(request);
  if (!b) return bad('בקשה לא תקינה.');
  const v = (k, col, fn) => b[k] !== undefined ? fn(b[k]) : f[col];
  const status = v('status', 'status', x => x === 'done' ? 'done' : 'open');
  await env.DB.prepare(
    'UPDATE training_followups SET due_date=?, status=?, manager_notes=?, meeting_at=?, recommendations=?, updated_at=? WHERE id=?'
  ).bind(v('dueDate', 'due_date', isoDate), status, v('managerNotes', 'manager_notes', x => text(x, 6000)),
    v('meetingAt', 'meeting_at', x => str(x, 40)), v('recommendations', 'recommendations', x => text(x, 6000)), Date.now(), f.id).run();
  if (b.recommendations !== undefined || b.managerNotes !== undefined) {
    await notify(env, f.user_id, 'feedback', 'התקבל משוב בליווי', (FOLLOWUPS.find(x => x.key === f.checkpoint) || {}).label || '');
  }
  await audit(env, guard.user, status !== f.status ? 'followup.' + status : 'followup.edit', { type: 'followup', id: f.id, subject: f.user_id, detail: f.checkpoint });
  return json({ ok: true, followup: publicFollowup(await env.DB.prepare('SELECT * FROM training_followups WHERE id=?').bind(f.id).first()) });
}

async function followupsCreate({ request, env, m: match }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const a = await env.DB.prepare('SELECT * FROM training_assignments WHERE id=?').bind(match[1]).first();
  if (!a) return notFound('השיוך');
  const b = (await readJson(request)) || {};
  const start = isoDate(b.teachingStart) || new Date().toISOString().slice(0, 10);
  for (const f of FOLLOWUPS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO training_followups (id, assignment_id, checkpoint, due_date, status, updated_at) VALUES (?,?,?,?,'open',?)`
    ).bind(randomId('fu'), a.id, f.key, addDays(start, f.days), Date.now()).run();
  }
  await audit(env, guard.user, 'followup.create', { type: 'assignment', id: a.id, subject: a.user_id, detail: 'מתחיל ' + start });
  return json({ ok: true }, 201);
}

async function auditGet({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const { results } = await env.DB.prepare(
    `SELECT t.*, u.name AS s_name FROM training_audit t LEFT JOIN staff_users u ON u.id = t.subject_user_id
      ORDER BY t.at DESC LIMIT 200`
  ).all();
  return json({ ok: true, audit: (results || []).map(x => ({ id: x.id, at: x.at, actor: x.actor_name, action: x.action, type: x.target_type, detail: x.detail, subject: x.s_name || '' })) });
}

/* Seeds the starting template — on request, as drafts, and only what is not
   there yet (matched by title), so pressing it twice changes nothing. */
async function templatePost({ request, env }) {
  const guard = await requireManager(request, env);
  if (guard.res) return guard.res;
  const b = (await readJson(request)) || {};
  let modules = 0, resources = 0;
  if (b.modules !== false) {
    const created = [];
    for (const t of TEMPLATE_MODULES) {
      const have = await env.DB.prepare('SELECT id FROM training_modules WHERE title=?').bind(t.title).first();
      if (have) { created.push(have.id); continue; }
      const r = await createModule(env, guard.user, {
        title: t.title, description: t.description, objectives: t.objectives, icon: t.icon, estMinutes: t.est, blocks: t.blocks
      });
      created.push(r.m.id);
      modules++;
    }
    /* A starting path in the same order, so the template is usable at once —
       also a draft in spirit: it only reaches anyone when assigned. */
    const pathTitle = 'אונבורדינג למורה חדש · תבנית';
    const havePath = await env.DB.prepare('SELECT id FROM training_paths WHERE title=?').bind(pathTitle).first();
    if (!havePath) {
      const id = randomId('pt'), now = Date.now();
      await env.DB.prepare(
        'INSERT INTO training_paths (id, title, description, kind, language, audience, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
      ).bind(id, pathTitle, 'מסלול הקליטה המלא — 12 מודולים. יש להתאים לפני שיוך.', 'onboarding', '', 'מורים חדשים', 'active', now, now).run();
      await writePathModules(env, id, created.map(mid => ({ moduleId: mid, required: true })));
    }
  }
  if (b.resources !== false) {
    for (const r of SAMPLE_RESOURCES) {
      const have = await env.DB.prepare('SELECT id FROM training_resources WHERE url=?').bind(r.url).first();
      if (have) continue;
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO training_resources (id, title, description, url, kind, category, language, level, program, tags, module_ids, status, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'[]','draft',?,?,?)`
      ).bind(randomId('rs'), r.title, 'מתוך מסמך ההכשרה "Training - Rabi & Moshik" (04.03.2026). דוגמה — ממתין לבדיקה ולאישור.',
        r.url, r.kind, r.category || '', r.language || '', r.level || '', r.program || '', JSON.stringify(r.tags || []), guard.user.name, now, now).run();
      resources++;
    }
  }
  await audit(env, guard.user, 'template.seed', { detail: modules + ' מודולים · ' + resources + ' משאבים' });
  return json({ ok: true, modules, resources });
}

/* ── router ────────────────────────────────────────────────────────────── */

const ROUTES = [
  ['GET', '^me$', meGet],
  ['GET', `^me/modules/${ID}$`, meModuleGet],
  ['POST', '^me/progress$', meProgress],
  ['POST', '^me/submit$', meSubmit],
  ['PATCH', `^me/followups/${ID}$`, meFollowup],
  ['GET', '^notifications$', notifGet],
  ['POST', '^notifications/read$', notifRead],
  ['GET', '^announcements$', annGet],
  ['POST', '^announcements$', annPost],
  ['PATCH', `^announcements/${ID}$`, annPatch],
  ['GET', '^resources$', resourcesGet],
  ['POST', '^resources$', resourcesPost],
  ['PATCH', `^resources/${ID}$`, resourcePatch],
  ['POST', `^resources/${ID}/check$`, resourceCheck],
  ['POST', `^resources/${ID}/favorite$`, resourceFav],
  ['GET', '^search$', search],
  ['GET', '^modules$', modulesGet],
  ['POST', '^modules$', modulePost],
  ['GET', `^modules/${ID}$`, moduleGet],
  ['PATCH', `^modules/${ID}$`, modulePatch],
  ['POST', `^modules/${ID}/publish$`, modulePublish],
  ['POST', `^modules/${ID}/archive$`, moduleArchive],
  ['POST', `^modules/${ID}/duplicate$`, moduleDuplicate],
  ['GET', `^modules/${ID}/versions$`, moduleVersions],
  ['POST', `^modules/${ID}/restore$`, moduleRestore],
  ['GET', `^modules/${ID}/preview$`, modulePreview],
  ['GET', '^paths$', pathsGet],
  ['POST', '^paths$', pathsPost],
  ['PATCH', `^paths/${ID}$`, pathPatch],
  ['GET', '^admin/overview$', overview],
  ['GET', '^admin/teachers$', teachersGet],
  ['GET', `^admin/learners/${ID}$`, learnerGet],
  ['PUT', `^admin/learners/${ID}/profile$`, profilePut],
  ['POST', '^admin/template$', templatePost],
  ['POST', '^assignments$', assignmentsPost],
  ['PATCH', `^assignments/${ID}$`, assignmentPatch],
  ['POST', `^assignments/${ID}/readiness$`, readinessPost],
  ['POST', `^assignments/${ID}/reset$`, resetPost],
  ['POST', `^assignments/${ID}/followups$`, followupsCreate],
  ['POST', `^submissions/${ID}/review$`, reviewPost],
  ['PATCH', `^followups/${ID}$`, followupPatch],
  ['GET', '^audit$', auditGet]
].map(([method, re, fn]) => ({ method, re: new RegExp(re), fn }));

export const PREFIX = '/api/staff/training/';

export async function handle(request, env, path) {
  const url = new URL(request.url);
  const rest = path.slice(PREFIX.length);
  for (const r of ROUTES) {
    if (r.method !== request.method) continue;
    const m = r.re.exec(rest);
    if (!m) continue;
    try {
      return await r.fn({ request, env, m, url });
    } catch (e) {
      /* A failed write must say so — the client keeps the user's input and
         offers to retry, rather than showing a success that did not happen. */
      console.error('training route failed', request.method, rest, e && e.stack);
      return json({ ok: false, error: 'השמירה נכשלה בשרת. השינויים שלך לא אבדו — נסו שוב.' }, 500);
    }
  }
  return json({ ok: false, error: 'not found' }, 404);
}
