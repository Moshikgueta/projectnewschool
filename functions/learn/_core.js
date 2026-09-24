/* Shared plumbing for the practice platform (/api/learn/*, /api/manage/*).

   Identity is the existing staff session (functions/_staff.js): students sign
   in with their entry code, staff with a password, and both get the same
   server-side session cookie. This file adds the two questions every endpoint
   here has to answer before touching content:

     levelAccess(env, user, levelId)  — may this STUDENT open this level now?
       Yes only with an ACTIVE enrollment, in a PUBLISHED level, of a
       PUBLISHED language. Checked on every request, in SQL, never cached in
       the page. A changed URL, a guessed id or a hand-written API call gets
       the same answer as the UI.

     can(user, action, levelId)       — may this STAFF member do this here?
       Role-based, and for מורה additionally limited to the levels they are
       assigned to (teacher_levels). */

import { json } from '../_shared.js';
import { currentStaff, randomId, STUDENT_ROLE } from '../_staff.js';

export { json, randomId, STUDENT_ROLE };

export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body, status = 200) {
  return json(body, status, NO_STORE);
}

export function fail(status, error, extra = {}) {
  return json({ ok: false, error, ...extra }, status, NO_STORE);
}

export async function body(request) {
  try { return await request.json(); } catch { return null; }
}

export function parse(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export const now = () => Date.now();

/* Calendar day in Israel, for "practised today", streaks and daily XP caps. */
export function dayOf(ts = Date.now()) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

/* ── who is calling ──────────────────────────────────────────────────── */

export async function requireUser(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: fail(401, 'נדרשת התחברות.', { code: 'auth' }) };
  return { user };
}

export async function requireStudent(request, env) {
  const r = await requireUser(request, env);
  if (r.res) return r;
  if (r.user.role !== STUDENT_ROLE) {
    return { res: fail(403, 'האזור הזה מיועד לתלמידים. צוות בית הספר עובד מתוך אזור הניהול.', { code: 'not_student' }) };
  }
  return r;
}

/* ── students: enrollment is the boundary ────────────────────────────── */

export async function activeLevels(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, lg.name_he AS lang_name_he, lg.name_native AS lang_name_native, lg.dir AS lang_dir,
            lg.font_stack, lg.special_chars, lg.normalize AS lang_normalize, e.started_at
       FROM enrollments e
       JOIN levels l ON l.id = e.level_id
       JOIN languages lg ON lg.id = l.language_id
      WHERE e.user_id = ? AND e.status = 'active'
        AND l.status = 'published' AND lg.status = 'published'
        AND EXISTS (SELECT 1 FROM topics t WHERE t.level_id = l.id AND t.status = 'published')
      ORDER BY lg.sort, l.number`
  ).bind(userId).all();
  return results || [];
}

/* The one gate for student content. Returns {level} or {res}. The message
   for "not enrolled" and "not published" is the same on purpose: a draft
   course is not announced to students by its error message either. */
export async function levelAccess(env, user, levelId) {
  const level = await env.DB.prepare(
    `SELECT l.*, lg.name_he AS lang_name_he, lg.name_native AS lang_name_native, lg.dir AS lang_dir,
            lg.font_stack, lg.special_chars, lg.normalize AS lang_normalize
       FROM enrollments e
       JOIN levels l ON l.id = e.level_id
       JOIN languages lg ON lg.id = l.language_id
      WHERE e.user_id = ? AND e.level_id = ? AND e.status = 'active'
        AND l.status = 'published' AND lg.status = 'published'`
  ).bind(user.id, String(levelId || '')).first();
  if (!level) return { res: outsideEnrollment() };
  return { level };
}

export function outsideEnrollment() {
  return fail(403,
    'התוכן הזה אינו חלק מהקורסים שאתם רשומים אליהם כרגע. אפשר לחזור ללוח האישי ולבחור נושא מהרמה שלכם, או לפנות למשרד בית הספר אם נראה לכם שזו טעות.',
    { code: 'outside_enrollment' });
}

/* A published topic in a level the student may open, or {res}. */
export async function topicAccess(env, user, topicId) {
  const topic = await env.DB.prepare(
    `SELECT * FROM topics WHERE id = ? AND status = 'published'`
  ).bind(String(topicId || '')).first();
  if (!topic) return { res: outsideEnrollment() };
  const a = await levelAccess(env, user, topic.level_id);
  if (a.res) return a;
  return { topic, level: a.level };
}

export async function exerciseAccess(env, user, exerciseId) {
  const ex = await env.DB.prepare(
    `SELECT * FROM exercises WHERE id = ? AND status = 'published'`
  ).bind(String(exerciseId || '')).first();
  if (!ex) return { res: outsideEnrollment() };
  const t = await topicAccess(env, user, ex.topic_id);
  if (t.res) return t;
  return { ex, topic: t.topic, level: t.level };
}

/* ── staff roles ─────────────────────────────────────────────────────── */

const ADMIN = 'אדמין', PEDAGOGY = 'מנהל פדגוגי', OFFICE = 'מנהלת קבלה', TEACHER = 'מורה';
export const STAFF_ROLES = [ADMIN, PEDAGOGY, OFFICE, TEACHER];

/* action → roles that may do it anywhere. TEACHER entries are additionally
   scoped to assigned levels in can(). */
const MATRIX = {
  'content.view': [ADMIN, PEDAGOGY, TEACHER],
  'content.edit': [ADMIN, PEDAGOGY, TEACHER],
  'content.publish': [ADMIN, PEDAGOGY],
  'course.structure': [ADMIN, PEDAGOGY],   // languages, new levels, level settings
  'students.view': [ADMIN, PEDAGOGY, OFFICE, TEACHER],
  'students.create': [ADMIN, PEDAGOGY, OFFICE],
  'students.code': [ADMIN, PEDAGOGY, OFFICE, TEACHER],
  'enroll': [ADMIN, PEDAGOGY, OFFICE],
  'progress.view': [ADMIN, PEDAGOGY, TEACHER],
  'assign': [ADMIN, PEDAGOGY, TEACHER],
  'flags.review': [ADMIN, PEDAGOGY, TEACHER],
  'teachers.assign': [ADMIN]
};

export async function staffContext(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT level_id FROM teacher_levels WHERE teacher_id = ?').bind(user.id).all();
  return { user, teacherLevels: new Set((results || []).map(r => r.level_id)) };
}

export function can(ctx, action, levelId) {
  const roles = MATRIX[action] || [];
  if (roles.indexOf(ctx.user.role) < 0) return false;
  if (ctx.user.role !== TEACHER) return true;
  if (levelId === undefined) return true;          // list endpoints filter themselves
  return ctx.teacherLevels.has(levelId);
}

export function isTeacher(ctx) {
  return ctx.user.role === TEACHER;
}

export async function requireStaff(request, env, action, levelId) {
  const r = await requireUser(request, env);
  if (r.res) return r;
  if (STAFF_ROLES.indexOf(r.user.role) < 0) {
    return { res: fail(403, 'אזור הניהול פתוח לצוות בית הספר בלבד.', { code: 'not_staff' }) };
  }
  const ctx = await staffContext(env, r.user);
  if (action && !can(ctx, action, levelId)) {
    return { res: fail(403, 'אין לכם הרשאה לפעולה הזו בקורס הזה.', { code: 'forbidden' }) };
  }
  return { ctx, user: r.user };
}

/* Students a staff member may see. Teachers: anyone with any enrollment
   (active or ended) in one of their levels. Everyone else: all students. */
export async function visibleStudentIds(env, ctx) {
  if (!isTeacher(ctx)) return null;               // null = unrestricted
  const levels = [...ctx.teacherLevels];
  if (!levels.length) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM enrollments WHERE level_id IN (${levels.map(() => '?').join(',')})`
  ).bind(...levels).all();
  return new Set((results || []).map(r => r.user_id));
}

export async function levelLanguage(env, levelId) {
  return env.DB.prepare(
    `SELECT l.*, lg.name_he AS lang_name_he, lg.name_native AS lang_name_native, lg.dir AS lang_dir,
            lg.font_stack, lg.special_chars, lg.normalize AS lang_normalize, lg.status AS lang_status
       FROM levels l JOIN languages lg ON lg.id = l.language_id WHERE l.id = ?`
  ).bind(levelId).first();
}

/* ── shapes ──────────────────────────────────────────────────────────── */

export function levelShape(l) {
  return {
    id: l.id, language: l.language_id, number: l.number, name_he: l.name_he, name_target: l.name_target,
    cefr: l.cefr, description: l.description, challenge_enabled: !!l.challenge_enabled,
    rubric: parse(l.rubric, []),
    lang: {
      id: l.language_id, name_he: l.lang_name_he, name_native: l.lang_name_native, dir: l.lang_dir,
      font: l.font_stack, chars: parse(l.special_chars, [])
    }
  };
}

/* What a student may see of an exercise: everything but the key. */
export function exerciseShape(e) {
  const b = parse(e.body, {});
  return {
    id: e.id, kind: e.kind, skill: e.skill, title: e.title, instructions: e.instructions,
    mode: e.mode, body: b
  };
}

export function exerciseForGrading(e) {
  return { id: e.id, kind: e.kind, mode: e.mode, skill: e.skill, body: parse(e.body, {}), key: parse(e.key_json, {}) };
}

export function topicSummary(t) {
  return {
    id: t.id, level_id: t.level_id, cycle_id: t.cycle_id, title_he: t.title_he, title_target: t.title_target,
    objective: t.objective, skills: parse(t.skills, []), grammar: parse(t.grammar, [])
  };
}

export function strOr(v, max = 4000) {
  return String(v ?? '').slice(0, max);
}
