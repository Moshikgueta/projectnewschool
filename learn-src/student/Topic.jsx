import { useState } from 'preact/hooks';
import { t, dateHe } from '../i18n.js';
import { api } from '../api.js';
import { useApi, View, Status, Crumbs, useTitle, ensureFont } from '../ui.jsx';
import { T, TL } from '../text.jsx';

const SECTION_ORDER = ['vocab', 'grammar', 'reading', 'communication', 'open', 'mixed'];

export function sectionOf(ex) {
  if (ex.mode === 'self') return 'open';
  if (ex.skill === 'vocab') return 'vocab';
  if (ex.skill === 'reading') return 'reading';
  if (ex.skill === 'communication') return 'communication';
  if (ex.skill === 'mixed') return 'mixed';
  return 'grammar';
}

export function TopicPage({ topicId, me }) {
  const q = useApi(`/api/learn/topics/${topicId}`, [topicId]);
  return <View q={q}>{d => <TopicView d={d} base={`#/t/${topicId}`} levelHref={`#/l/${d.level.id}`} student />}</View>;
}

/* Shared by the student page and the staff preview. */
export function TopicView({ d, base, levelHref, student, preview }) {
  const { topic, level, exercises, cycle } = d;
  const lang = level.lang.id, dir = level.lang.dir;
  ensureFont(lang);
  useTitle(topic.title_he);
  const [savedWords, setSavedWords] = useState(null);
  const done = exercises.filter(e => e.progress && e.progress.completed).length;
  const status = !exercises.some(e => e.progress) ? 'new' : exercises.length && done / exercises.length >= 0.75 ? 'practiced' : 'in_progress';
  const sections = {};
  exercises.forEach(e => (sections[sectionOf(e)] ||= []).push(e));
  const exp = topic.explanation || {};
  const hasExplain = (exp.rules || []).length || (exp.tips || []).length || (exp.mistakes || []).length;

  return (
    <div>
      <Crumbs items={[
        { href: levelHref, label: level.name_he },
        ...(preview ? [] : [{ href: `${levelHref}/topics`, label: t.navTopics }]),
        ...(cycle ? [{ label: cycle.title_he }] : [])
      ]} />
      <div class="topic-head">
        <div>
          {cycle && <div class="eyebrow">{cycle.title_he}</div>}
          <h1>{topic.title_he}</h1>
          <div class="tl-title" lang={lang} dir={dir}>{topic.title_target}</div>
          {topic.objective && <p class="lead" style={{ marginTop: 10 }}><b>{t.goal}: </b><T text={topic.objective} lang={lang} dir={dir} /></p>}
          {topic.skills.length > 0 && (
            <div class="skills" aria-label={t.mainSkills}>
              {topic.skills.map((s, i) => (
                <span class="skill" key={i}><b>{s.he}</b>{s.target && <> · <bdi class="tl" lang={lang} dir={dir}>{s.target}</bdi></>}</span>
              ))}
            </div>
          )}
        </div>
        {student && (
          <div class="card flat" style={{ minWidth: 220 }}>
            <Status s={status} />
            <p class="small" style={{ margin: '6px 0' }}>{t.activitiesDone(done, exercises.length)}</p>
            <a href={`${base}/recap`}>{t.recapBtn}</a>
          </div>
        )}
      </div>

      <details class="fold" open={!student || status === 'new'}>
        <summary>{t.briefExplain}</summary>
        <div class="fold-body">
          {topic.grammar.length > 0 && <p><b>{t.grammarFocus}: </b><T text={topic.grammar.join(' · ')} lang={lang} dir={dir} /></p>}
          {hasExplain ? (
            <div class="explain">
              {(exp.rules || []).map((r, i) => <p key={i}><T text={r} lang={lang} dir={dir} /></p>)}
            </div>
          ) : <p class="muted small">{t.noExplanation}</p>}
          {(exp.examples || []).length > 0 && (
            <div>
              <div class="label" style={{ marginTop: 8 }}>{exp.examples_source === 'corrections' ? t.examplesFromTopic : t.examples}</div>
              <div class="examples" lang={lang} dir={dir}>
                {exp.examples.map((x, i) => <p key={i} class="tl-block"><T text={x} lang={lang} dir={dir} base="t" /></p>)}
              </div>
            </div>
          )}
          {(exp.tips || []).map((x, i) => <div key={i} class="alert info" style={{ marginTop: 8 }}><b>{t.tip}: </b><T text={x} lang={lang} dir={dir} /></div>)}
          {(exp.mistakes || []).map((m, i) => (
            <div key={i} class="alert warn" style={{ marginTop: 8 }}>
              <b>{t.commonMistake}: </b><T text={m.text} lang={lang} dir={dir} />
              {m.pairs.map((p, j) => (
                <div class="mistake-pair" key={j} lang={lang} dir={dir}>
                  <span class="bad tl"><span class="sr-only">שגוי: </span>{p.bad}</span>
                  <span aria-hidden="true">{dir === 'rtl' ? '←' : '→'}</span>
                  <span class="good tl"><span class="sr-only">נכון: </span>{p.good}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>

      {topic.vocab.length > 0 && (
        <details class="fold" style={{ marginTop: 12 }}>
          <summary>{t.vocabTitle(topic.vocab.length)}</summary>
          <div class="fold-body">
            <VocabList vocab={topic.vocab} level={level} student={student} saved={savedWords} setSaved={setSavedWords} />
          </div>
        </details>
      )}

      <div class="section-title"><h2>{t.practice}</h2></div>
      <p class="muted" style={{ marginTop: -6 }}>{t.practiceLead}</p>
      {SECTION_ORDER.filter(s => sections[s]).map(s => (
        <div class="activity-group" key={s}>
          <h3>{t.sections[s]}</h3>
          <div class="activities">
            {sections[s].map(e => (
              <a key={e.id} class="activity" href={`${base}/a/${e.id}`}>
                <span class="type">{t.kind[e.kind] || e.kind}{e.items ? ` · ${t.items(e.items)}` : ''}</span>
                <b>{e.title}</b>
                {preview && e.status === 'draft' && <span class="pill warm">טיוטה</span>}
                {e.progress && e.progress.completed ? (
                  <span class="done">✓ {t.done}{e.mode === 'self' ? ` · ${t.selfReviewed}` : ` · ${t.score(e.progress.last_correct, e.progress.total)}`}</span>
                ) : e.progress || e.state ? <span class="muted small">{t.inProgress}</span> : null}
              </a>
            ))}
          </div>
        </div>
      ))}

      {topic.links.length > 0 && (
        <div class="card flat" style={{ marginTop: 22 }}>
          <h3>{t.externalLinks}</h3>
          {topic.links.map((l, i) => <p key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a> <span class="muted small">({t.external})</span></p>)}
        </div>
      )}
      {!preview && (
        <div class="row" style={{ marginTop: 22 }}>
          <a class="btn ghost" href={`${levelHref}/topics`}>{t.exploreOther}</a>
        </div>
      )}
    </div>
  );
}

function VocabList({ vocab, level, student, saved, setSaved }) {
  const lang = level.lang.id, dir = level.lang.dir;
  const g = useApi(student ? `/api/learn/levels/${level.id}/glossary` : null, []);
  const set = saved || new Set((g.data && g.data.saved) || []);
  async function toggle(term) {
    const on = set.has(term);
    const next = new Set(set);
    on ? next.delete(term) : next.add(term);
    setSaved(next);
    try { await api('/api/learn/saved', { method: 'POST', body: { kind: 'word', ref: term, level_id: level.id, remove: on } }); }
    catch { setSaved(set); }
  }
  return (
    <ul class="vocab-list">
      {vocab.map(v => (
        <li key={v.term}>
          <bdi class="tl" lang={lang} dir={dir}>{v.term}</bdi>
          <span class="row" style={{ gap: 4 }}>
            <span class="muted">{v.he}</span>
            {student && <button class="star" aria-pressed={set.has(v.term)} aria-label={(set.has(v.term) ? t.unsaveWord : t.saveWord) + ': ' + v.term} onClick={() => toggle(v.term)}>{set.has(v.term) ? '★' : '☆'}</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Recap({ topicId }) {
  const q = useApi(`/api/learn/topics/${topicId}`, [topicId]);
  const rev = useApi(q.data ? `/api/learn/levels/${q.data.level.id}/review` : null, [q.data && q.data.level.id]);
  useTitle(t.recapTitle);
  return (
    <View q={q}>{d => {
      const done = d.exercises.filter(e => e.progress && e.progress.completed);
      const open = rev.data ? rev.data.mistakes.filter(m => m.topic_id === topicId) : [];
      const bySkill = {};
      done.forEach(e => { bySkill[e.skill] = (bySkill[e.skill] || 0) + 1; });
      return (
        <div class="stack">
          <Crumbs items={[{ href: `#/l/${d.level.id}`, label: d.level.name_he }, { href: `#/t/${topicId}`, label: d.topic.title_he }, { label: t.recapTitle }]} />
          <h1>{t.recapTitle}: {d.topic.title_he}</h1>
          <p class="lead">{t.recapLead}</p>
          <div class="grid two">
            <div class="card">
              <h2>{t.recapDone} ({done.length}/{d.exercises.length})</h2>
              {done.length ? (
                <ul class="list-plain">
                  {done.map(e => <li key={e.id} class="row between"><span>{e.title}</span><span class="muted small">{t.skill[e.skill] || ''} · {dateHe(e.progress.last_at)}</span></li>)}
                </ul>
              ) : <p class="muted">{t.recapNone}</p>}
              {Object.keys(bySkill).length > 0 && (
                <p class="small">{Object.entries(bySkill).map(([k, n]) => `${t.skill[k] || k}: ${n}`).join(' · ')}</p>
              )}
            </div>
            <div class="card">
              <h2>{t.recapOpen} ({open.length})</h2>
              {open.length ? (
                <>
                  <ul class="list-plain">{open.slice(0, 8).map((m, i) => <li key={i}><span class="muted small">{m.title}</span><br /><T text={m.prompt} lang={d.level.lang.id} dir={d.level.lang.dir} /></li>)}</ul>
                  <a class="btn warm" href={`#/l/${d.level.id}/review/session?source=mistakes&topic=${topicId}`}>{t.recapRetry}</a>
                </>
              ) : <p class="muted">{t.noMistakes}</p>}
            </div>
          </div>
          {d.topic.self_check.length > 0 && (
            <div class="card">
              <h2>{t.selfCheck}</h2>
              <p class="hint">{t.selfCheckNote}</p>
              {d.topic.self_check.map((s, i) => (
                <label class="check" key={i} style={{ marginBottom: 8 }}><input type="checkbox" /><span>{s}</span></label>
              ))}
            </div>
          )}
          <div class="row">
            <a class="btn secondary" href={`#/t/${topicId}`}>{t.otherActivity}</a>
            <a class="btn ghost" href={`#/l/${d.level.id}/topics`}>{t.exploreOther}</a>
          </div>
        </div>
      );
    }}</View>
  );
}
