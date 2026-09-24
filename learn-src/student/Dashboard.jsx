import { t, pct, dateHe } from '../i18n.js';
import { useApi, View, Status, Meter, useTitle } from '../ui.jsx';
import { TopicMap } from './Topics.jsx';
import { GameCard } from './Games.jsx';

export function Dashboard({ levelId, me, onLevel }) {
  const q = useApi(`/api/learn/levels/${levelId}/dashboard`, [levelId]);
  const topics = useApi(`/api/learn/levels/${levelId}/topics`, [levelId]);
  useTitle(t.navHome);
  return (
    <View q={q}>{d => (
      <div class="stack">
        <div class="hello">
          <div>
            <h1>{t.hello(me.user.name)}</h1>
            <p class="lead" style={{ margin: 0 }}>{t.dashLead}</p>
          </div>
          <div class="course-chips" role="group" aria-label={t.course}>
            {me.enrollments.map(e => (
              <button key={e.id} class="course-chip" aria-current={e.id === levelId ? 'true' : undefined} onClick={() => onLevel(e.id)}>
                {e.name_he}{e.cefr ? ` · ${e.cefr}` : ''}
              </button>
            ))}
          </div>
        </div>

        <div class="grid three">
          <div class="card feature">
            <div class="icon" aria-hidden="true">↺</div>
            <h2>{t.resume}</h2>
            {d.resume ? (
              <>
                <p class="grow"><b>{d.resume.title}</b><br /><span class="muted">{d.resume.topic_title} · {dateHe(d.resume.updated_at)}</span></p>
                <a class="btn primary" href={`#/t/${d.resume.topic_id}/a/${d.resume.exercise_id}`}>{t.resumeBtn}</a>
              </>
            ) : <p class="muted grow">{t.resumeNone}</p>}
          </div>
          <div class="card feature warm">
            <div class="icon" aria-hidden="true">✦</div>
            <h2>{t.mixedReview}</h2>
            {d.review_ready >= 3 ? (
              <>
                <p class="grow muted">{t.mixedReviewLead}</p>
                <a class="btn warm" href={`#/l/${levelId}/review/session?source=mixed`}>{t.start}</a>
              </>
            ) : <p class="muted grow">{t.mixedReviewEmpty}</p>}
          </div>
          <div class="card feature">
            <div class="icon" aria-hidden="true">✎</div>
            <h2>{d.mistakes_open ? t.mistakesToReview(d.mistakes_open) : t.navReview}</h2>
            <p class="muted grow">{d.mistakes_open ? t.reviewLead : t.noMistakes}</p>
            {d.mistakes_open > 0 && <a class="btn secondary" href={`#/l/${levelId}/review`}>{t.goReview}</a>}
          </div>
        </div>

        {(d.assignments.length > 0 || d.recommendations.length > 0) && (
          <div class="card">
            <h2>{t.suggestions}</h2>
            <p class="muted small">{t.suggestionsLead}</p>
            <ul class="rec-list">
              {d.assignments.map(a => (
                <li key={a.id}>
                  <div>
                    <span class="pill warm">{t.teacherAssigned}</span>{' '}
                    {a.note && <span>{a.note}</span>}
                    <div class="topic-cloud" style={{ marginTop: 8 }}>
                      {a.topics.map(tp => <a key={tp.id} class="topic-chip" href={`#/t/${tp.id}`}><Status s={tp.status} />{tp.title_he}</a>)}
                    </div>
                  </div>
                </li>
              ))}
              {d.recommendations.map((r, i) => <Rec key={i} r={r} levelId={levelId} />)}
            </ul>
          </div>
        )}

        {d.game && <GameCard game={d.game} levelId={levelId} />}

        <div class="grid two">
          <div class="card">
            <h2>{t.recent}</h2>
            {d.recent.length ? (
              <ul class="list-plain">
                {d.recent.map(r => (
                  <li key={r.id} class="row between">
                    <a href={`#/t/${r.id}`}><b>{r.title_he}</b></a>
                    <span class="row"><Status s={r.status} /><span class="muted small">{dateHe(r.last_at)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p class="muted">{t.recentNone}</p>}
          </div>
          <ProgressCard d={d} levelId={levelId} />
        </div>

        <div class="section-title">
          <h2>{t.choose}</h2>
          <a href={`#/l/${levelId}/topics`}>{t.exploreAll}</a>
        </div>
        <View q={topics}>{td => <TopicMap cycles={td.cycles} topics={td.topics} />}</View>

        {me.past.length > 0 && <div class="card flat"><PastCourses past={me.past} /></div>}
      </div>
    )}</View>
  );
}

function Rec({ r, levelId }) {
  let text, href;
  if (r.type === 'mistakes') { text = t.rec.mistakes(r.title_he, r.count); href = `#/l/${levelId}/review/session?source=mistakes&topic=${r.topic_id}`; }
  else if (r.type === 'continue') { text = t.rec.continue(r.title_he); href = `#/t/${r.topic_id}`; }
  else if (r.type === 'skill') { text = t.rec.skill(t.skill[r.skill] || r.skill); href = `#/l/${levelId}/review/session?source=mixed`; }
  else { text = t.rec.explore(r.title_he); href = `#/t/${r.topic_id}`; }
  return <li><span>{text}</span><a class="btn ghost small" href={href}>{t.start}</a></li>;
}

function ProgressCard({ d, levelId }) {
  const o = d.overall;
  return (
    <div class="card">
      <h2>{t.progressTitle}</h2>
      <div class="tiles" style={{ marginBottom: 14 }}>
        {['new', 'in_progress', 'practiced'].map(s => (
          <div class="tile stat" key={s}><b>{d.counts[s]}</b><Status s={s} /></div>
        ))}
      </div>
      <p class="small" style={{ marginBottom: 4 }}>{t.activitiesDone(o.activities_completed, o.activities_total)}</p>
      <Meter value={o.activities_total ? o.activities_completed / o.activities_total : 0} label={t.activitiesDone(o.activities_completed, o.activities_total)} />
      <p class="hint" style={{ marginTop: 4 }}>{t.completionHelp}</p>
      <div class="kv small" style={{ marginTop: 10 }}>
        <span>{t.accuracy}</span><b>{pct(o.accuracy)}</b>
        <span>{t.evidence}</span><b>{o.evidence_items} / {o.auto_items}</b>
      </div>
      <p class="hint">{t.evidenceHelp}</p>
      <h3 style={{ marginTop: 12 }}>{t.skillsNeed}</h3>
      {d.needs.length ? (
        <ul class="list-plain">
          {d.needs.map(s => <li key={s.skill} class="row between"><span>{t.skill[s.skill] || s.skill}</span><span class="muted small">{t.accuracy}: {pct(s.accuracy)} · {t.openMistakes}: {s.open}</span></li>)}
        </ul>
      ) : <p class="muted small">{t.skillsNeedNone}</p>}
      <a href={`#/l/${levelId}/progress`}>{t.navProgress}</a>
    </div>
  );
}

export function PastCourses({ past }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h2>{t.pastCourses}</h2>
      <p class="muted small">{t.pastCoursesNote}</p>
      <ul class="list-plain">
        {past.map(x => <li key={x.level_id}><b>{x.name_he}</b> <span class="muted small">· {t.pastLine(x.completed, x.retained)}</span></li>)}
      </ul>
    </div>
  );
}

