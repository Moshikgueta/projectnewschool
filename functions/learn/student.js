/* /api/learn/* — everything a student does. Every handler resolves the
   student from the session and every content read goes through
   levelAccess / topicAccess / exerciseAccess (see _core.js). Queries on the
   student's own record always filter by user_id = the session's user, so one
   student's attempts, mistakes and saved items are never reachable by another. */

import {
  ok, fail, body, parse, now, dayOf, randomId, requireStudent, activeLevels, levelAccess,
  topicAccess, exerciseAccess, outsideEnrollment, levelShape, exerciseShape, exerciseForGrading,
  topicSummary, strOr
} from './_core.js';
import { gradeItem, itemCount, isRight } from './grade.js';
import { codeConfigured } from '../_staff.js';
import { levelStats, publicStats, PRACTICED_SHARE } from './stats.js';

export { PRACTICED_SHARE };

const XP_ITEM = 2, XP_REVIEW = 3, XP_OPEN = 5, XP_GAME_DAILY_CAP = 10;

/* ── helpers ─────────────────────────────────────────────────────────── */

function langCfg(level) {
  return parse(level.lang_normalize, {});
}

async function prefsOf(env, userId) {
  const p = await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(userId).first();
  return p ? { gamification: !!p.gamification, weekly_goal: p.weekly_goal, current_level: p.current_level }
    : { gamification: false, weekly_goal: 3, current_level: null };
}

async function publishedExercises(env, levelId) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.topic_id, e.kind, e.mode, e.skill, e.title, e.body
       FROM exercises e JOIN topics t ON t.id = e.topic_id
      WHERE t.level_id = ? AND t.status = 'published' AND e.status = 'published'`
  ).bind(levelId).all();
  return results || [];
}

async function publishedTopics(env, levelId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM topics WHERE level_id = ? AND status = 'published' ORDER BY title_he`
  ).bind(levelId).all();
  return results || [];
}

async function addXp(env, stmts, userId, levelId, amount, reason, ref) {
  stmts.push(env.DB.prepare(
    'INSERT INTO xp_events (id,user_id,level_id,amount,reason,ref,day,created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(randomId('x'), userId, levelId, amount, reason, ref, dayOf(), now()));
}

/* ── identity & preferences ──────────────────────────────────────────── */

export async function getConfig({ env }) {
  return ok({
    ok: true, demo: env.DEMO_MODE === '1' || env.DEMO_MODE === 'true',
    codeLogin: codeConfigured(env), media: !!env.MEDIA, year: new Date().getFullYear()
  });
}

export async function getMe({ request, env }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const levels = await activeLevels(env, r.user.id);
  const prefs = await prefsOf(env, r.user.id);
  /* Levels the student used to be enrolled in: the numbers survive, the
     content does not — nothing below carries a topic or an exercise. */
  const { results: past } = await env.DB.prepare(
    `SELECT e.level_id, l.name_he, l.cefr, lg.name_he AS lang, MAX(e.ended_at) AS ended_at,
            (SELECT COUNT(*) FROM exercise_progress p WHERE p.user_id = e.user_id AND p.level_id = e.level_id AND p.completed = 1) AS completed,
            (SELECT COUNT(*) FROM item_state s WHERE s.user_id = e.user_id AND s.level_id = e.level_id AND s.retained_at IS NOT NULL) AS retained
       FROM enrollments e JOIN levels l ON l.id = e.level_id JOIN languages lg ON lg.id = l.language_id
      WHERE e.user_id = ? AND e.status = 'ended'
        AND e.level_id NOT IN (SELECT level_id FROM enrollments WHERE user_id = ? AND status = 'active')
      GROUP BY e.level_id`
  ).bind(r.user.id, r.user.id).all();
  return ok({
    ok: true,
    user: { id: r.user.id, name: r.user.name, role: r.user.role },
    enrollments: levels.map(levelShape),
    past: past || [],
    prefs
  });
}

export async function patchPrefs({ request, env }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  if (!b) return fail(400, 'בקשה לא תקינה.');
  const cur = await prefsOf(env, r.user.id);
  const gam = b.gamification === undefined ? cur.gamification : !!b.gamification;
  let goal = b.weekly_goal === undefined ? cur.weekly_goal : Number(b.weekly_goal);
  if (!Number.isInteger(goal) || goal < 1 || goal > 7) goal = cur.weekly_goal;
  let lvl = b.current_level === undefined ? cur.current_level : String(b.current_level || '');
  if (lvl) {
    const a = await levelAccess(env, r.user, lvl);
    if (a.res) lvl = cur.current_level;
  }
  await env.DB.prepare(
    `INSERT INTO preferences (user_id, gamification, weekly_goal, current_level, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET gamification=excluded.gamification, weekly_goal=excluded.weekly_goal,
       current_level=excluded.current_level, updated_at=excluded.updated_at`
  ).bind(r.user.id, gam ? 1 : 0, goal, lvl || null, now()).run();
  return ok({ ok: true, prefs: { gamification: gam, weekly_goal: goal, current_level: lvl || null } });
}

/* ── topics ──────────────────────────────────────────────────────────── */

export async function getLevelTopics({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const [topics, cyc, stats] = await Promise.all([
    publishedTopics(env, a.level.id),
    env.DB.prepare('SELECT id, title_he, title_target, description FROM cycles WHERE level_id=? ORDER BY sort').bind(a.level.id).all(),
    levelStats(env, r.user.id, a.level.id)
  ]);
  return ok({
    ok: true, level: levelShape(a.level),
    cycles: (cyc.results || []).filter(c => topics.some(t => t.cycle_id === c.id)),
    topics: topics.map(t => ({
      ...topicSummary(t),
      vocab: parse(t.vocab, []).map(v => v.term),
      stats: publicStats(stats.topics[t.id])
    }))
  });
}

export async function getTopic({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await topicAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const t = a.topic;
  const [exs, prog, states, items, cycle] = await Promise.all([
    env.DB.prepare(`SELECT * FROM exercises WHERE topic_id=? AND status='published' ORDER BY sort`).bind(t.id).all(),
    env.DB.prepare('SELECT * FROM exercise_progress WHERE user_id=? AND topic_id=?').bind(r.user.id, t.id).all(),
    env.DB.prepare('SELECT exercise_id, state, updated_at FROM activity_state WHERE user_id=? AND topic_id=?').bind(r.user.id, t.id).all(),
    env.DB.prepare('SELECT exercise_id, item_idx, status FROM item_state WHERE user_id=? AND topic_id=?').bind(r.user.id, t.id).all(),
    t.cycle_id ? env.DB.prepare('SELECT id, title_he, title_target FROM cycles WHERE id=?').bind(t.cycle_id).first() : null
  ]);
  const P = Object.fromEntries((prog.results || []).map(p => [p.exercise_id, p]));
  const S = Object.fromEntries((states.results || []).map(s => [s.exercise_id, parse(s.state, null)]));
  const I = {};
  for (const it of items.results || []) (I[it.exercise_id] ||= {})[it.item_idx] = it.status;
  const saved = await env.DB.prepare(
    `SELECT ref FROM saved_items WHERE user_id=? AND kind='exercise' AND level_id=?`).bind(r.user.id, a.level.id).all();
  const savedSet = new Set((saved.results || []).map(s => s.ref));
  return ok({
    ok: true, level: levelShape(a.level), cycle,
    topic: {
      ...topicSummary(t), explanation: parse(t.explanation, {}), vocab: parse(t.vocab, []),
      self_check: parse(t.self_check, []), links: parse(t.links, [])
    },
    exercises: (exs.results || []).map(e => ({
      ...exerciseShape(e),
      items: itemCount({ kind: e.kind, mode: e.mode, body: parse(e.body, {}) }),
      progress: P[e.id] ? {
        completed: !!P[e.id].completed, last_correct: P[e.id].last_correct, total: P[e.id].total,
        attempts: P[e.id].attempts, self_rating: P[e.id].self_rating, last_at: P[e.id].last_at
      } : null,
      state: S[e.id] || null,
      item_status: I[e.id] || {},
      saved: savedSet.has(e.id)
    }))
  });
}

/* ── doing an activity ───────────────────────────────────────────────── */

export async function putState({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await exerciseAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const b = await body(request);
  if (!b || typeof b.state !== 'object') return fail(400, 'בקשה לא תקינה.');
  const state = JSON.stringify(b.state);
  if (state.length > 20000) return fail(413, 'התשובה ארוכה מדי לשמירה.');
  await env.DB.prepare(
    `INSERT INTO activity_state (user_id, exercise_id, topic_id, level_id, state, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, exercise_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`
  ).bind(r.user.id, a.ex.id, a.topic.id, a.level.id, state, now()).run();
  return ok({ ok: true, saved_at: now() });
}

/* Grades the submitted items and records them. `answers` maps item index →
   value; only the items present are graded, so retrying the wrong ones
   leaves the right ones exactly as they were. `reveal` lists items whose
   answer the student asked to see — recorded, and that day's later correct
   answer on the item does not count as evidence of mastery. */
async function gradeAndRecord(env, user, a, answers, reveal, context, clientId) {
  const ex = exerciseForGrading(a.ex);
  const cfg = langCfg(a.level);
  const n = itemCount(ex);
  const today = dayOf();
  const t = now();

  const { results: prevRows } = await env.DB.prepare(
    'SELECT * FROM item_state WHERE user_id=? AND exercise_id=?').bind(user.id, ex.id).all();
  const prev = Object.fromEntries((prevRows || []).map(p => [p.item_idx, p]));

  const stmts = [];
  const results = [];
  let xp = 0;
  const revealSet = new Set((reveal || []).map(Number).filter(i => i >= 0 && i < n));
  const idxs = new Set([...Object.keys(answers || {}).map(Number), ...revealSet]);
  for (const i of [...idxs].sort((x, y) => x - y)) {
    if (!(i >= 0 && i < n)) continue;
    const skill = ex.skill || 'mixed';
    const p = prev[i];
    if (!(i in (answers || {})) && revealSet.has(i)) {
      /* Reveal without an answer: the item goes on the review list. */
      const r = gradeItem(ex, i, '', cfg);
      results.push({ i, status: 'revealed', feedback: [], expected: r.expectedText, note: noteOf(ex, i) });
      if (p) {
        stmts.push(env.DB.prepare(
          `UPDATE item_state SET revealed_day=?, status='open', last_seen_at=? WHERE user_id=? AND exercise_id=? AND item_idx=?`
        ).bind(today, t, user.id, ex.id, i));
      } else {
        stmts.push(env.DB.prepare(
          `INSERT INTO item_state (user_id,exercise_id,item_idx,topic_id,level_id,skill,status,first_result,wrong_count,right_count,wrong_tries,revealed_day,first_seen_at,last_seen_at,last_wrong_at)
           VALUES (?,?,?,?,?,?,'open',0,0,0,0,?,?,?,?)`
        ).bind(user.id, ex.id, i, a.topic.id, a.level.id, skill, today, t, t, t));
      }
      continue;
    }
    const g = gradeItem(ex, i, answers[i], cfg);
    if (g.status === 'empty') { results.push({ i, status: 'empty', feedback: g.feedback }); continue; }
    const right = isRight(g.status);
    const revealedToday = revealSet.has(i) || (p && p.revealed_day === today);
    const out = { i, status: g.status, feedback: g.feedback };
    if (!p) {
      stmts.push(env.DB.prepare(
        `INSERT INTO item_state (user_id,exercise_id,item_idx,topic_id,level_id,skill,status,first_result,wrong_count,right_count,wrong_tries,first_seen_at,last_seen_at,last_wrong_at,xp_awarded)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(user.id, ex.id, i, a.topic.id, a.level.id, skill, right ? 'ok' : 'open', right ? 1 : 0,
        right ? 0 : 1, right ? 1 : 0, right ? 0 : 1, t, t, right ? null : t, right && !revealedToday ? 1 : 0));
      if (right && !revealedToday) { xp += XP_ITEM; await addXp(env, stmts, user.id, a.level.id, XP_ITEM, 'item', ex.id + ':' + i); }
      out.tries = right ? 0 : 1;
    } else if (right) {
      const laterDay = dayOf(p.first_seen_at) !== today;
      const retained = !p.retained_at && laterDay && !revealedToday ? t : p.retained_at;
      const wasOpen = p.status === 'open';
      const giveItemXp = !p.xp_awarded && !revealedToday;
      stmts.push(env.DB.prepare(
        `UPDATE item_state SET status='ok', right_count=right_count+1, wrong_tries=0, last_seen_at=?, retained_at=?,
            xp_awarded=? WHERE user_id=? AND exercise_id=? AND item_idx=?`
      ).bind(t, retained, giveItemXp || p.xp_awarded ? 1 : 0, user.id, ex.id, i));
      if (giveItemXp) { xp += XP_ITEM; await addXp(env, stmts, user.id, a.level.id, XP_ITEM, 'item', ex.id + ':' + i); }
      if (wasOpen && p.last_wrong_at && dayOf(p.last_wrong_at) !== today && !revealedToday) {
        xp += XP_REVIEW; await addXp(env, stmts, user.id, a.level.id, XP_REVIEW, 'review', ex.id + ':' + i);
        out.improved = true;
      }
      if (retained && !p.retained_at) out.evidence = true;
      out.tries = 0;
    } else {
      stmts.push(env.DB.prepare(
        `UPDATE item_state SET status='open', wrong_count=wrong_count+1, wrong_tries=wrong_tries+1,
            last_seen_at=?, last_wrong_at=? WHERE user_id=? AND exercise_id=? AND item_idx=?`
      ).bind(t, t, user.id, ex.id, i));
      out.tries = (p.wrong_tries || 0) + 1;
    }
    /* The model answer is shown when the item is right, after two misses in
       a row, or when the student asked for it. Before that: feedback that
       points at the problem without giving the answer away. */
    if (right || out.tries >= 2 || revealSet.has(i)) out.expected = g.expectedText;
    else out.can_reveal = true;
    const note = noteOf(ex, i);
    if (note && (right || out.expected)) out.note = note;
    if (revealSet.has(i)) out.revealed = true;
    results.push(out);
  }

  /* exercise progress: completed once every item has been answered once */
  const answeredBefore = new Set(Object.keys(prev).map(Number).filter(k => prev[k].right_count + prev[k].wrong_count > 0));
  for (const r of results) if (r.status !== 'empty' && r.status !== 'revealed') answeredBefore.add(r.i);
  const completed = n > 0 && answeredBefore.size >= n;
  const graded = results.filter(r => r.status !== 'empty' && r.status !== 'revealed');
  const correct = graded.filter(r => isRight(r.status)).length;
  const pp = await env.DB.prepare('SELECT * FROM exercise_progress WHERE user_id=? AND exercise_id=?').bind(user.id, ex.id).first();
  /* current score: items whose latest state is right */
  const okNow = new Set(Object.keys(prev).map(Number).filter(k => prev[k].status === 'ok'));
  for (const r of results) { if (isRight(r.status)) okNow.add(r.i); else if (r.status !== 'empty') okNow.delete(r.i); }
  const score = okNow.size;
  if (pp) {
    stmts.push(env.DB.prepare(
      `UPDATE exercise_progress SET attempts=attempts+1, last_correct=?, best_correct=MAX(best_correct, ?), total=?,
          completed=MAX(completed, ?), last_at=? WHERE user_id=? AND exercise_id=?`
    ).bind(score, score, n, completed ? 1 : 0, t, user.id, ex.id));
  } else {
    stmts.push(env.DB.prepare(
      `INSERT INTO exercise_progress (user_id,exercise_id,topic_id,level_id,attempts,last_correct,best_correct,total,completed,first_at,last_at)
       VALUES (?,?,?,?,1,?,?,?,?,?,?)`
    ).bind(user.id, ex.id, a.topic.id, a.level.id, score, score, n, completed ? 1 : 0, t, t));
  }
  const response = {
    ok: true, results, xp_gained: xp,
    summary: { graded: graded.length, correct, score, total: n, completed, all_right: score === n }
  };
  stmts.push(env.DB.prepare(
    `INSERT INTO attempts (id,user_id,exercise_id,topic_id,level_id,client_id,context,answers,result,correct,total,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(randomId('a'), user.id, ex.id, a.topic.id, a.level.id, clientId, context,
    JSON.stringify({ answers, reveal: [...revealSet] }).slice(0, 20000), JSON.stringify(response), correct, graded.length, t));
  await env.DB.batch(stmts);
  return response;
}

function noteOf(ex, i) {
  const k = (ex.key.items || [])[i];
  return k && k.note ? k.note : '';
}

function validClientId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

async function replay(env, userId, clientId) {
  const row = await env.DB.prepare('SELECT result FROM attempts WHERE user_id=? AND client_id=?').bind(userId, clientId).first();
  return row ? { ...parse(row.result, {}), replayed: true } : null;
}

export async function postCheck({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  if (!b || !validClientId(b.client_id)) return fail(400, 'בקשה לא תקינה.');
  const a = await exerciseAccess(env, r.user, params.id);
  if (a.res) return a.res;
  if (a.ex.mode === 'self') return fail(400, 'זו משימה פתוחה: היא נבדקת בהשוואה למודל, לא אוטומטית.');
  const dup = await replay(env, r.user.id, b.client_id);
  if (dup) return ok(dup);
  const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
  const context = ['practice', 'review', 'challenge'].includes(b.context) ? b.context : 'practice';
  const res = await gradeAndRecord(env, r.user, a, answers, Array.isArray(b.reveal) ? b.reveal : [], context, b.client_id);
  return ok(res);
}

/* Open tasks: no automatic assessment exists for free writing or speaking,
   so none is claimed. The text is saved, the model and the criteria are
   returned, and the student rates their own work against them. */
export async function postSelf({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  if (!b || !validClientId(b.client_id)) return fail(400, 'בקשה לא תקינה.');
  const a = await exerciseAccess(env, r.user, params.id);
  if (a.res) return a.res;
  if (a.ex.mode !== 'self') return fail(400, 'הפעילות הזו נבדקת אוטומטית.');
  const dup = await replay(env, r.user.id, b.client_id);
  if (dup) return ok(dup);
  const key = parse(a.ex.key_json, {});
  const text = strOr(b.text, 6000);
  const rating = ['not_yet', 'almost', 'done'].includes(b.rating) ? b.rating : null;
  const t = now();
  const stmts = [];
  let xp = 0;
  const pp = await env.DB.prepare('SELECT * FROM exercise_progress WHERE user_id=? AND exercise_id=?').bind(r.user.id, a.ex.id).first();
  const completed = rating ? 1 : 0;
  if (pp) {
    stmts.push(env.DB.prepare(
      `UPDATE exercise_progress SET attempts=attempts+1, completed=MAX(completed, ?), self_rating=COALESCE(?, self_rating), last_at=?
        WHERE user_id=? AND exercise_id=?`).bind(completed, rating, t, r.user.id, a.ex.id));
  } else {
    stmts.push(env.DB.prepare(
      `INSERT INTO exercise_progress (user_id,exercise_id,topic_id,level_id,attempts,last_correct,best_correct,total,completed,self_rating,first_at,last_at)
       VALUES (?,?,?,?,1,0,0,0,?,?,?,?)`).bind(r.user.id, a.ex.id, a.topic.id, a.level.id, completed, rating, t, t));
  }
  if (rating && !(pp && pp.completed)) {
    xp = XP_OPEN;
    await addXp(env, stmts, r.user.id, a.level.id, XP_OPEN, 'open', a.ex.id);
  }
  const response = { ok: true, models: key.models || [], criteria: key.criteria || '', rating, completed: !!(completed || (pp && pp.completed)), xp_gained: xp };
  stmts.push(env.DB.prepare(
    `INSERT INTO attempts (id,user_id,exercise_id,topic_id,level_id,client_id,context,answers,result,correct,total,self_assessed,created_at)
     VALUES (?,?,?,?,?,?,'practice',?,?,0,0,1,?)`
  ).bind(randomId('a'), r.user.id, a.ex.id, a.topic.id, a.level.id, b.client_id, JSON.stringify({ text }), JSON.stringify(response), t));
  await env.DB.batch(stmts);
  return ok(response);
}

/* "My answer is also right" — goes to the teacher; never counted until accepted. */
export async function postFlag({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  const a = await exerciseAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const idx = Number(b && b.item_idx);
  const n = itemCount(exerciseForGrading(a.ex));
  const answer = strOr(b && b.answer, 500).trim();
  if (!(idx >= 0 && idx < n) || !answer) return fail(400, 'בקשה לא תקינה.');
  const dup = await env.DB.prepare(
    `SELECT id FROM answer_flags WHERE user_id=? AND exercise_id=? AND item_idx=? AND answer=? AND status='open'`
  ).bind(r.user.id, a.ex.id, idx, answer).first();
  if (!dup) {
    await env.DB.prepare(
      'INSERT INTO answer_flags (id,user_id,exercise_id,item_idx,level_id,answer,created_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(randomId('f'), r.user.id, a.ex.id, idx, a.level.id, answer, now()).run();
  }
  return ok({ ok: true });
}

/* ── dashboard ───────────────────────────────────────────────────────── */

export async function getDashboard({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const L = a.level.id, uid = r.user.id;
  const [topics, stats, prefs, resumeRow, assignments] = await Promise.all([
    publishedTopics(env, L),
    levelStats(env, uid, L),
    prefsOf(env, uid),
    env.DB.prepare(
      `SELECT s.exercise_id, s.topic_id, s.updated_at, e.title, t.title_he
         FROM activity_state s
         JOIN exercises e ON e.id = s.exercise_id AND e.status = 'published'
         JOIN topics t ON t.id = s.topic_id AND t.status = 'published'
         LEFT JOIN exercise_progress p ON p.user_id = s.user_id AND p.exercise_id = s.exercise_id
        WHERE s.user_id = ? AND s.level_id = ? AND (p.completed IS NULL OR p.completed = 0)
          AND s.state NOT IN ('{}', 'null')
        ORDER BY s.updated_at DESC LIMIT 1`).bind(uid, L).first(),
    env.DB.prepare(
      `SELECT * FROM practice_assignments WHERE level_id=? AND archived=0 AND (student_id IS NULL OR student_id=?)
        ORDER BY created_at DESC LIMIT 5`).bind(L, uid).all()
  ]);
  const byId = Object.fromEntries(topics.map(t => [t.id, t]));
  const topicStats = topics.map(t => ({ id: t.id, title_he: t.title_he, title_target: t.title_target, cycle_id: t.cycle_id, ...publicStats(stats.topics[t.id]) }));
  const recent = topicStats.filter(t => t.last_at).sort((x, y) => y.last_at - x.last_at).slice(0, 4);
  const counts = { new: 0, in_progress: 0, practiced: 0 };
  topicStats.forEach(t => counts[t.status]++);

  const skills = Object.entries(stats.skills).map(([k, s]) => ({
    skill: k, seen: s.seen, accuracy: s.seen ? s.firstRight / s.seen : null, open: s.open, retained: s.retained
  }));
  const needs = skills.filter(s => s.seen >= 4 && (s.accuracy < 0.7 || s.open >= 3))
    .sort((x, y) => (x.accuracy ?? 1) - (y.accuracy ?? 1)).slice(0, 3);

  /* Suggestions — optional, never a sequence. Each carries its reason. */
  const recs = [];
  const withMistakes = topicStats.filter(t => t.open_mistakes > 0).sort((x, y) => y.open_mistakes - x.open_mistakes);
  if (withMistakes[0]) recs.push({ type: 'mistakes', topic_id: withMistakes[0].id, title_he: withMistakes[0].title_he, count: withMistakes[0].open_mistakes });
  const inProg = topicStats.filter(t => t.status === 'in_progress' && t.id !== (withMistakes[0] || {}).id)
    .sort((x, y) => (y.last_at || 0) - (x.last_at || 0));
  if (inProg[0]) recs.push({ type: 'continue', topic_id: inProg[0].id, title_he: inProg[0].title_he });
  if (needs[0]) {
    const cand = topicStats.filter(t => t.status !== 'new').map(t => t.id);
    recs.push({ type: 'skill', skill: needs[0].skill, topic_ids: cand.slice(0, 3) });
  }
  const fresh = topicStats.filter(t => t.status === 'new');
  if (fresh.length) {
    // a different suggestion each day, not the first in any list
    const d = Number(dayOf().replace(/-/g, ''));
    const pick = fresh[d % fresh.length];
    recs.push({ type: 'explore', topic_id: pick.id, title_he: pick.title_he });
  }

  const assigned = (assignments.results || []).map(x => ({
    id: x.id, note: x.note, created_at: x.created_at,
    topics: parse(x.topic_ids, []).filter(id => byId[id]).map(id => ({ id, title_he: byId[id].title_he, status: publicStats(stats.topics[id]).status })),
    exercise_ids: parse(x.exercise_ids, [])
  })).filter(x => x.topics.length || x.exercise_ids.length);

  let game = null;
  if (prefs.gamification && a.level.challenge_enabled) game = await gameSummary(env, uid, L, prefs, stats, topics);

  const autoTotal = Object.values(stats.topics).reduce((s, t) => s + t.autoItems, 0);
  return ok({
    ok: true, level: levelShape(a.level), prefs,
    counts, topics_total: topics.length, recent,
    resume: resumeRow ? { exercise_id: resumeRow.exercise_id, topic_id: resumeRow.topic_id, title: resumeRow.title, topic_title: resumeRow.title_he, updated_at: resumeRow.updated_at } : null,
    mistakes_open: stats.totals.open,
    skills, needs,
    overall: {
      activities_completed: Object.values(stats.topics).reduce((s, t) => s + t.completed, 0),
      activities_total: stats.totals.exercises,
      accuracy: stats.totals.seen ? stats.totals.firstRight / stats.totals.seen : null,
      evidence_items: stats.totals.retained, auto_items: autoTotal, items_seen: stats.totals.seen
    },
    review_ready: stats.totals.seen,
    recommendations: recs, assignments: assigned, game
  });
}

async function gameSummary(env, uid, L, prefs, stats, topics) {
  const [xpRow, days, best, resolved, writing] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS xp FROM xp_events WHERE user_id=? AND level_id=?').bind(uid, L).first(),
    env.DB.prepare(`SELECT DISTINCT day FROM xp_events WHERE user_id=? ORDER BY day DESC LIMIT 400`).bind(uid).all(),
    env.DB.prepare('SELECT game, MAX(score) AS best FROM game_scores WHERE user_id=? AND level_id=? GROUP BY game').bind(uid, L).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM xp_events WHERE user_id=? AND level_id=? AND reason='review'`).bind(uid, L).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM exercise_progress p JOIN exercises e ON e.id=p.exercise_id
                     WHERE p.user_id=? AND p.level_id=? AND e.mode='self' AND p.completed=1`).bind(uid, L).first()
  ]);
  const daySet = new Set((days.results || []).map(d => d.day));
  // streak of consecutive days ending today or yesterday — shown kindly, never as a loss
  let streak = 0;
  const d = new Date();
  const fmt = x => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  if (!daySet.has(fmt(d))) d.setDate(d.getDate() - 1);
  while (daySet.has(fmt(d))) { streak++; d.setDate(d.getDate() - 1); }
  // this week (Sunday-based, the Israeli week)
  const today = new Date();
  const dow = Number(new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay());
  let weekDays = 0;
  for (let i = 0; i <= dow; i++) { const x = new Date(); x.setDate(x.getDate() - i); if (daySet.has(fmt(x))) weekDays++; }
  const cycles = new Set();
  const byId = Object.fromEntries(topics.map(t => [t.id, t]));
  let practiced = 0, started = 0;
  for (const [id, t] of Object.entries(stats.topics)) {
    if (t.status !== 'new') { started++; if (byId[id]) cycles.add(byId[id].cycle_id); }
    if (t.status === 'practiced') practiced++;
  }
  const badges = [
    { id: 'first_step', earned: started >= 1 },
    { id: 'explorer', earned: cycles.size >= 3 },
    { id: 'five_topics', earned: practiced >= 5 },
    { id: 'fixer', earned: (resolved.n || 0) >= 10 },
    { id: 'retention', earned: stats.totals.retained >= 25 },
    { id: 'writer', earned: (writing.n || 0) >= 3 },
    { id: 'weekly_goal', earned: weekDays >= prefs.weekly_goal }
  ];
  return {
    xp: xpRow.xp || 0, streak, week_days: weekDays, weekly_goal: prefs.weekly_goal,
    best: Object.fromEntries((best.results || []).map(b => [b.game, b.best])), badges
  };
}

/* ── review ──────────────────────────────────────────────────────────── */

export async function getReview({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const { results } = await env.DB.prepare(
    `SELECT s.exercise_id, s.item_idx, s.wrong_count, s.last_wrong_at, s.status, s.retained_at,
            e.title, e.kind, e.body, t.id AS topic_id, t.title_he AS topic_title
       FROM item_state s
       JOIN exercises e ON e.id = s.exercise_id AND e.status = 'published'
       JOIN topics t ON t.id = s.topic_id AND t.status = 'published'
      WHERE s.user_id = ? AND s.level_id = ? AND s.status = 'open'
      ORDER BY s.last_wrong_at DESC LIMIT 200`
  ).bind(r.user.id, a.level.id).all();
  const mistakes = (results || []).map(m => ({
    exercise_id: m.exercise_id, item_idx: m.item_idx, wrong_count: m.wrong_count, last_wrong_at: m.last_wrong_at,
    title: m.title, topic_id: m.topic_id, topic_title: m.topic_title,
    prompt: promptOf(m.kind, parse(m.body, {}), m.item_idx)
  }));
  /* improvement over time: per week, items fixed in review vs new mistakes */
  const since = now() - 8 * 7 * 86400000;
  const [fixed, wrong] = await Promise.all([
    env.DB.prepare(`SELECT day, COUNT(*) AS n FROM xp_events WHERE user_id=? AND level_id=? AND reason='review' AND created_at>? GROUP BY day`).bind(r.user.id, a.level.id, since).all(),
    env.DB.prepare(`SELECT created_at, correct, total FROM attempts WHERE user_id=? AND level_id=? AND created_at>?`).bind(r.user.id, a.level.id, since).all()
  ]);
  return ok({
    ok: true, level: levelShape(a.level), mistakes,
    weeks: weekly(fixed.results || [], wrong.results || [])
  });
}

function weekKey(ts) {
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function weekly(fixedByDay, attempts) {
  const w = {};
  for (let i = 7; i >= 0; i--) w[weekKey(now() - i * 7 * 86400000)] = { fixed: 0, answered: 0, correct: 0 };
  for (const f of fixedByDay) { const k = weekKey(Date.parse(f.day)); if (w[k]) w[k].fixed += f.n; }
  for (const x of attempts) { const k = weekKey(x.created_at); if (w[k]) { w[k].answered += x.total; w[k].correct += x.correct; } }
  return Object.entries(w).map(([week, v]) => ({ week, ...v }));
}

function promptOf(kind, b, idx) {
  if (kind === 'match') return (b.left || [])[idx] || '';
  if (kind === 'order') return '';
  const it = (b.items || [])[idx] || {};
  if (it.inText) return '';
  if (it.input === 'tokens') return (it.tokens || []).join(' / ');
  return it.prompt || '';
}

/* One reviewable item, rendered on its own. Order tasks are whole-exercise
   and are left to the activity itself. */
function reviewItem(e, idx, topicTitle) {
  const b = parse(e.body, {});
  const base = { exercise_id: e.id || e.exercise_id, item_idx: idx, kind: e.kind, title: e.title, instructions: e.instructions, topic_id: e.topic_id, topic_title: topicTitle };
  if (e.kind === 'match') {
    return { ...base, input: 'match', prompt: b.left[idx], options: b.right };
  }
  const it = b.items[idx];
  if (!it) return null;
  const item = { ...it };
  if (it.inText) {
    /* a gap inside a text: show the text with just this gap open */
    item.prompt = String(b.text || '').replace(/\{\{(\d+)\}\}/g, (m, n) => (Number(n) - 1 === idx ? '___' : '…'));
  }
  return { ...base, ...item, wordbank: b.wordbank, text: e.kind === 'reading' ? b.text : undefined };
}

export async function getReviewSession({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const url = new URL(request.url);
  const size = Math.min(12, Math.max(3, Number(url.searchParams.get('size')) || 8));
  const source = url.searchParams.get('source') || 'mixed';
  const topicFilter = url.searchParams.get('topic');
  const rows = await env.DB.prepare(
    `SELECT s.exercise_id, s.item_idx, s.status, s.last_seen_at, s.topic_id, e.kind, e.body, e.title, e.instructions,
            e.mode, t.title_he
       FROM item_state s
       JOIN exercises e ON e.id = s.exercise_id AND e.status = 'published' AND e.kind != 'order'
       JOIN topics t ON t.id = s.topic_id AND t.status = 'published'
      WHERE s.user_id = ? AND s.level_id = ?`
  ).bind(r.user.id, a.level.id).all();
  let pool = rows.results || [];
  if (topicFilter) pool = pool.filter(p => p.topic_id === topicFilter);
  if (source === 'saved') {
    const saved = await env.DB.prepare(`SELECT ref FROM saved_items WHERE user_id=? AND level_id=? AND kind='exercise'`).bind(r.user.id, a.level.id).all();
    const ids = new Set((saved.results || []).map(s => s.ref));
    pool = pool.filter(p => ids.has(p.exercise_id));
  }
  const open = shuffle(pool.filter(p => p.status === 'open'));
  // items answered right before, not seen today: the "do I still know it" check
  const today = dayOf();
  const old = shuffle(pool.filter(p => p.status === 'ok' && dayOf(p.last_seen_at) !== today));
  let pick;
  if (source === 'mistakes') pick = open.slice(0, size);
  else {
    const nOpen = Math.min(open.length, Math.ceil(size * 0.6));
    pick = open.slice(0, nOpen).concat(old.slice(0, size - nOpen));
    if (pick.length < size) pick = pick.concat(open.slice(nOpen, nOpen + size - pick.length));
    if (source === 'saved' && pick.length < size) pick = pick.concat(shuffle(pool.filter(p => !pick.includes(p))).slice(0, size - pick.length));
  }
  const items = shuffle(pick).map(p => reviewItem(p, p.item_idx, p.title_he)).filter(Boolean);
  return ok({ ok: true, level: levelShape(a.level), items, available: pool.length });
}

export async function postItemCheck({ request, env }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  if (!b || !validClientId(b.client_id)) return fail(400, 'בקשה לא תקינה.');
  const a = await exerciseAccess(env, r.user, b.exercise_id);
  if (a.res) return a.res;
  if (a.ex.mode === 'self') return fail(400, 'בקשה לא תקינה.');
  const dup = await replay(env, r.user.id, b.client_id);
  if (dup) return ok(dup);
  const idx = Number(b.item_idx);
  const context = b.context === 'challenge' ? 'challenge' : 'review';
  const answers = b.reveal ? {} : { [idx]: b.value };
  const res = await gradeAndRecord(env, r.user, a, answers, b.reveal ? [idx] : [], context, b.client_id);
  /* in review the answer is shown after the first try: review is for learning */
  const item = res.results[0];
  if (item && !item.expected && item.status !== 'empty') {
    const g = gradeItem(exerciseForGrading(a.ex), idx, b.value, langCfg(a.level));
    item.expected = g.expectedText;
    delete item.can_reveal;
  }
  return ok(res);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── saved items ─────────────────────────────────────────────────────── */

export async function getSaved({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const { results } = await env.DB.prepare(
    `SELECT s.kind, s.ref, s.meaning, s.created_at, e.title AS ex_title, e.topic_id, t.title_he AS topic_title
       FROM saved_items s
       LEFT JOIN exercises e ON s.kind = 'exercise' AND e.id = s.ref AND e.status = 'published'
       LEFT JOIN topics t ON t.id = e.topic_id AND t.status = 'published'
      WHERE s.user_id = ? AND s.level_id = ? ORDER BY s.created_at DESC`
  ).bind(r.user.id, a.level.id).all();
  const items = (results || []).filter(x => x.kind === 'word' || (x.ex_title && x.topic_title));
  return ok({ ok: true, level: levelShape(a.level), items });
}

export async function postSaved({ request, env }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const b = await body(request);
  if (!b || !['word', 'exercise'].includes(b.kind)) return fail(400, 'בקשה לא תקינה.');
  const levelId = String(b.level_id || '');
  let ref = strOr(b.ref, 200).trim(), meaning = '';
  if (b.kind === 'exercise') {
    const a = await exerciseAccess(env, r.user, ref);
    if (a.res) return a.res;
    if (a.level.id !== levelId) return outsideEnrollment();
  } else {
    const a = await levelAccess(env, r.user, levelId);
    if (a.res) return a.res;
    /* a word can be saved only if it is in the vocabulary of a published topic of this level */
    const topics = await publishedTopics(env, levelId);
    for (const t of topics) {
      const v = parse(t.vocab, []).find(x => x.term === ref);
      if (v) { meaning = v.he; break; }
    }
    if (!meaning) return fail(404, 'המילה לא נמצאה באוצר המילים של הרמה.');
  }
  if (b.remove) {
    await env.DB.prepare('DELETE FROM saved_items WHERE user_id=? AND kind=? AND ref=? AND level_id=?').bind(r.user.id, b.kind, ref, levelId).run();
    return ok({ ok: true, saved: false });
  }
  await env.DB.prepare(
    'INSERT OR IGNORE INTO saved_items (user_id, kind, ref, level_id, meaning, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(r.user.id, b.kind, ref, levelId, meaning, now()).run();
  return ok({ ok: true, saved: true });
}

/* ── glossary & search ───────────────────────────────────────────────── */

async function levelVocab(env, levelId) {
  const topics = await publishedTopics(env, levelId);
  const map = new Map();
  for (const t of topics) {
    for (const v of parse(t.vocab, [])) {
      const k = v.term;
      if (!map.has(k)) map.set(k, { term: v.term, he: v.he, topics: [] });
      map.get(k).topics.push({ id: t.id, title_he: t.title_he });
    }
  }
  return [...map.values()].sort((x, y) => x.term.localeCompare(y.term, 'es'));
}

export async function getGlossary({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const words = await levelVocab(env, a.level.id);
  const saved = await env.DB.prepare(`SELECT ref FROM saved_items WHERE user_id=? AND level_id=? AND kind='word'`).bind(r.user.id, a.level.id).all();
  return ok({ ok: true, level: levelShape(a.level), words, saved: (saved.results || []).map(s => s.ref) });
}

/* ── games (Challenge Mode only) ─────────────────────────────────────── */

async function gameGate(request, env, params) {
  const r = await requireStudent(request, env);
  if (r.res) return r;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a;
  if (!a.level.challenge_enabled) return { res: fail(403, 'מצב האתגר כבוי בקורס הזה.', { code: 'challenge_off' }) };
  return { user: r.user, level: a.level };
}

async function gameWords(env, userId, levelId) {
  const words = await levelVocab(env, levelId);
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT topic_id FROM exercise_progress WHERE user_id=? AND level_id=?').bind(userId, levelId).all();
  const practiced = new Set((results || []).map(x => x.topic_id));
  const short = words.filter(w => w.term.length <= 28 && w.he.length <= 28 && !/[/()]/.test(w.term));
  const mine = short.filter(w => w.topics.some(t => practiced.has(t.id)));
  return { all: short, preferred: mine.length >= 12 ? mine : short, fromPracticed: mine.length >= 12 };
}

export async function getGame({ request, env, params }) {
  const g = await gameGate(request, env, params);
  if (g.res) return g.res;
  const url = new URL(request.url);
  const kind = url.searchParams.get('game');
  const w = await gameWords(env, g.user.id, g.level.id);
  if (w.all.length < 8) return fail(404, 'אין עדיין מספיק אוצר מילים ברמה הזו למשחק.');
  if (kind === 'memory') {
    const pairs = shuffle(w.preferred).slice(0, 6).map(x => ({ term: x.term, he: x.he }));
    return ok({ ok: true, game: 'memory', pairs, from_practiced: w.fromPracticed });
  }
  if (kind === 'sprint') {
    const qs = shuffle(w.preferred).slice(0, 20).map(x => {
      const distract = shuffle(w.all.filter(y => y.term !== x.term && y.he !== x.he)).slice(0, 3).map(y => y.term);
      const options = shuffle([x.term, ...distract]);
      return { he: x.he, options, answer: options.indexOf(x.term) };
    });
    return ok({ ok: true, game: 'sprint', seconds: 90, questions: qs, from_practiced: w.fromPracticed });
  }
  return fail(400, 'משחק לא מוכר.');
}

export async function postGameResult({ request, env, params }) {
  const g = await gameGate(request, env, params);
  if (g.res) return g.res;
  const b = await body(request);
  const game = b && ['memory', 'sprint'].includes(b.game) ? b.game : null;
  const score = Math.max(0, Math.min(100, Number(b && b.score) | 0));
  const total = Math.max(0, Math.min(100, Number(b && b.total) | 0));
  const duration = Math.max(0, Math.min(3600000, Number(b && b.duration_ms) | 0));
  if (!game || score > total) return fail(400, 'בקשה לא תקינה.');
  const prev = await env.DB.prepare('SELECT MAX(score) AS best FROM game_scores WHERE user_id=? AND level_id=? AND game=?').bind(g.user.id, g.level.id, game).first();
  /* XP from games is capped per day, so replaying familiar words is not a way to farm it */
  const today = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM xp_events WHERE user_id=? AND reason=? AND day=?`).bind(g.user.id, 'game:' + game, dayOf()).first();
  const xp = Math.max(0, Math.min(Math.floor(score / 2), XP_GAME_DAILY_CAP - (today.n || 0)));
  const stmts = [env.DB.prepare(
    'INSERT INTO game_scores (id,user_id,level_id,game,score,total,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(randomId('g'), g.user.id, g.level.id, game, score, total, duration, now())];
  if (xp > 0) await addXp(env, stmts, g.user.id, g.level.id, xp, 'game:' + game, '');
  await env.DB.batch(stmts);
  return ok({ ok: true, xp_gained: xp, personal_best: Math.max(prev.best || 0, score), new_best: score > (prev.best || 0) });
}

/* ── progress page ───────────────────────────────────────────────────── */

export async function getProgress({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const a = await levelAccess(env, r.user, params.id);
  if (a.res) return a.res;
  const [topics, stats, cyc] = await Promise.all([
    publishedTopics(env, a.level.id),
    levelStats(env, r.user.id, a.level.id),
    env.DB.prepare('SELECT id, title_he FROM cycles WHERE level_id=? ORDER BY sort').bind(a.level.id).all()
  ]);
  const since = now() - 8 * 7 * 86400000;
  const [fixed, att] = await Promise.all([
    env.DB.prepare(`SELECT day, COUNT(*) AS n FROM xp_events WHERE user_id=? AND level_id=? AND reason='review' AND created_at>? GROUP BY day`).bind(r.user.id, a.level.id, since).all(),
    env.DB.prepare(`SELECT created_at, correct, total FROM attempts WHERE user_id=? AND level_id=? AND created_at>?`).bind(r.user.id, a.level.id, since).all()
  ]);
  return ok({
    ok: true, level: levelShape(a.level), cycles: cyc.results || [],
    topics: topics.map(t => ({ id: t.id, title_he: t.title_he, title_target: t.title_target, cycle_id: t.cycle_id, ...publicStats(stats.topics[t.id]) })),
    skills: Object.entries(stats.skills).map(([k, s]) => ({ skill: k, seen: s.seen, accuracy: s.seen ? s.firstRight / s.seen : null, open: s.open, retained: s.retained })),
    totals: stats.totals,
    weeks: weekly(fixed.results || [], att.results || [])
  });
}

/* ── protected media ─────────────────────────────────────────────────── */

export async function getMedia({ request, env, params }) {
  const r = await requireStudent(request, env);
  if (r.res) return r.res;
  const m = await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(String(params.id || '')).first();
  if (!m) return outsideEnrollment();
  const a = await levelAccess(env, r.user, m.level_id);
  if (a.res) return a.res;
  if (m.topic_id) {
    const t = await topicAccess(env, r.user, m.topic_id);
    if (t.res) return t.res;
  }
  if (!env.MEDIA || !m.r2_key) return fail(404, 'קובץ השמע עדיין לא הועלה.', { code: 'media_missing' });
  const obj = await env.MEDIA.get(m.r2_key);
  if (!obj) return fail(404, 'קובץ השמע עדיין לא הועלה.', { code: 'media_missing' });
  return new Response(obj.body, {
    headers: { 'Content-Type': m.mime || 'audio/mpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' }
  });
}
