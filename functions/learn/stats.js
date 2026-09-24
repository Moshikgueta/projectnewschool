/* The numbers behind "how am I doing", computed one way for everyone: the
   student dashboard, the topic list, the student's progress page and the
   staff reports all call levelStats, so they cannot disagree.

   Three things are kept apart on purpose:
     completion — activities finished (every item answered, or the open task
                  self-reviewed). Says the work was done.
     accuracy   — share of items answered right the FIRST time.
     evidence   — items answered right on a LATER day than first seen, with
                  no revealed answer that day (item_state.retained_at). This
                  is the only number that says something was retained.
   XP is none of these and lives in xp_events. */

import { parse } from './_core.js';
import { itemCount } from './grade.js';

/* A topic counts as "practised" once this share of its activities has been
   completed. Completion only — mastery is measured separately. */
export const PRACTICED_SHARE = 0.75;

export async function levelStats(env, userId, levelId, { includeDraft = false } = {}) {
  const published = includeDraft ? '' : `AND t.status = 'published' AND e.status = 'published'`;
  const [exs, prog, items] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.topic_id, e.kind, e.mode, e.body FROM exercises e JOIN topics t ON t.id = e.topic_id
        WHERE t.level_id = ? ${published}`).bind(levelId).all(),
    env.DB.prepare('SELECT * FROM exercise_progress WHERE user_id=? AND level_id=?').bind(userId, levelId).all(),
    env.DB.prepare('SELECT * FROM item_state WHERE user_id=? AND level_id=?').bind(userId, levelId).all()
  ]);
  const exList = exs.results || [];
  const exIds = new Set(exList.map(e => e.id));
  const topics = {};
  const T = id => (topics[id] ||= {
    activities: 0, completed: 0, autoItems: 0, seen: 0, firstRight: 0, retained: 0, open: 0, last_at: 0
  });
  for (const e of exList) {
    const t = T(e.topic_id);
    t.activities++;
    t.autoItems += itemCount({ kind: e.kind, mode: e.mode, body: parse(e.body, {}) });
  }
  const progress = {};
  for (const p of prog.results || []) {
    if (!exIds.has(p.exercise_id)) continue;      // hidden since: history kept, not counted
    progress[p.exercise_id] = p;
    const t = T(p.topic_id);
    if (p.completed) t.completed++;
    t.last_at = Math.max(t.last_at, p.last_at);
  }
  const skills = {};
  let open = 0, retained = 0, seen = 0, firstRight = 0;
  for (const it of items.results || []) {
    if (!exIds.has(it.exercise_id)) continue;
    const t = T(it.topic_id);
    t.seen++; seen++;
    if (it.first_result) { t.firstRight++; firstRight++; }
    if (it.retained_at) { t.retained++; retained++; }
    if (it.status === 'open') { t.open++; open++; }
    t.last_at = Math.max(t.last_at, it.last_seen_at);
    const s = (skills[it.skill || 'mixed'] ||= { seen: 0, firstRight: 0, open: 0, retained: 0 });
    s.seen++;
    if (it.first_result) s.firstRight++;
    if (it.status === 'open') s.open++;
    if (it.retained_at) s.retained++;
  }
  for (const id in topics) {
    const t = topics[id];
    t.status = t.completed === 0 && t.seen === 0 ? 'new'
      : t.activities && t.completed / t.activities >= PRACTICED_SHARE ? 'practiced' : 'in_progress';
  }
  return { topics, skills, progress, totals: { open, retained, seen, firstRight, exercises: exList.length } };
}

export function publicStats(t) {
  if (!t) return { status: 'new', activities: 0, completed: 0, accuracy: null, evidence: null, retained: 0, auto_items: 0, open_mistakes: 0, last_at: null };
  return {
    status: t.status, activities: t.activities, completed: t.completed,
    accuracy: t.seen ? t.firstRight / t.seen : null,
    evidence: t.autoItems ? t.retained / t.autoItems : null,
    retained: t.retained, auto_items: t.autoItems, open_mistakes: t.open, last_at: t.last_at || null,
    seen: t.seen, first_right: t.firstRight
  };
}

/* Staff report shape: per topic rows plus a one-line summary. */
export async function levelStatsFor(env, userId, levelId, opts = {}) {
  const [st, topics] = await Promise.all([
    levelStats(env, userId, levelId, opts),
    env.DB.prepare(`SELECT id, title_he, status FROM topics WHERE level_id=? ${opts.includeDraft ? '' : "AND status='published'"} ORDER BY title_he`).bind(levelId).all()
  ]);
  const rows = (topics.results || []).map(t => ({ id: t.id, title_he: t.title_he, topic_status: t.status, ...publicStats(st.topics[t.id]) }));
  const autoTotal = rows.reduce((s, r) => s + r.auto_items, 0);
  let last = 0;
  for (const r of rows) last = Math.max(last, r.last_at || 0);
  return {
    topics: rows,
    skills: Object.entries(st.skills).map(([k, s]) => ({ skill: k, seen: s.seen, accuracy: s.seen ? s.firstRight / s.seen : null, open: s.open, retained: s.retained })),
    summary: {
      practiced: rows.filter(r => r.status === 'practiced').length,
      in_progress: rows.filter(r => r.status === 'in_progress').length,
      topics_total: rows.length,
      activities_completed: rows.reduce((s, r) => s + r.completed, 0),
      activities_total: st.totals.exercises,
      accuracy: st.totals.seen ? st.totals.firstRight / st.totals.seen : null,
      evidence: autoTotal ? st.totals.retained / autoTotal : null,
      open_mistakes: st.totals.open,
      last_activity: last || null
    }
  };
}
