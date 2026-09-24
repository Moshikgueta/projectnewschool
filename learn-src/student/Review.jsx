import { useState, useRef, useEffect } from 'preact/hooks';
import { t, pct, dateHe } from '../i18n.js';
import { api, clientId } from '../api.js';
import { useApi, View, useTitle, Crumbs } from '../ui.jsx';
import { T, baseOf } from '../text.jsx';

const RIGHT = s => s === 'correct' || s === 'accepted_accent';

export function Review({ levelId, level }) {
  const q = useApi(`/api/learn/levels/${levelId}/review`, [levelId]);
  useTitle(t.reviewTitle);
  return (
    <View q={q}>{d => {
      const lang = d.level.lang.id, dir = d.level.lang.dir;
      const byTopic = {};
      d.mistakes.forEach(m => (byTopic[m.topic_id] ||= { title: m.topic_title, list: [] }).list.push(m));
      const maxA = Math.max(1, ...d.weeks.map(w => w.fixed));
      return (
        <div class="stack">
          <div>
            <h1>{t.reviewTitle}</h1>
            <p class="lead">{t.reviewLead}</p>
            <div class="row">
              <a class="btn warm" href={`#/l/${levelId}/review/session?source=mixed`}>{t.sessionMixed}</a>
              <a class="btn secondary" href={`#/l/${levelId}/review/session?source=mistakes`} aria-disabled={!d.mistakes.length}>{t.sessionMistakes}</a>
              <a class="btn ghost" href={`#/l/${levelId}/review/session?source=saved`}>{t.sessionSaved}</a>
            </div>
          </div>
          <div class="grid two">
            <div class="card">
              <h2>{t.openMistakes} ({d.mistakes.length})</h2>
              {!d.mistakes.length && <p class="muted">{t.noMistakes}</p>}
              {Object.entries(byTopic).map(([id, g]) => (
                <div key={id} style={{ marginBottom: 14 }}>
                  <div class="row between">
                    <h3 style={{ margin: 0 }}><a href={`#/t/${id}`}>{g.title}</a></h3>
                    <a class="btn ghost small" href={`#/l/${levelId}/review/session?source=mistakes&topic=${id}`}>{t.recapRetry}</a>
                  </div>
                  <ul class="list-plain">
                    {g.list.slice(0, 6).map((m, i) => (
                      <li key={i}>
                        <span class="muted small">{m.title} · {t.wrongTimes(m.wrong_count)} · {dateHe(m.last_wrong_at)}</span>
                        {m.prompt && <div><T text={m.prompt.replace(/___/g, '_____')} lang={lang} dir={dir} /></div>}
                      </li>
                    ))}
                    {g.list.length > 6 && <li class="muted small">+{g.list.length - 6}</li>}
                  </ul>
                </div>
              ))}
            </div>
            <div class="card">
              <h2>{t.improvement}</h2>
              <p class="muted small">{t.improvementLead}</p>
              <div class="bars" role="img" aria-label={d.weeks.map(w => `${dateHe(Date.parse(w.week))}: ${w.fixed} ${t.fixedInReview}, ${t.correctRate} ${w.answered ? pct(w.correct / w.answered) : '—'}`).join('; ')}>
                {d.weeks.map(w => (
                  <div class="bar" key={w.week}>
                    <span>{w.fixed || ''}</span>
                    <span class="v good" style={{ height: `${(w.fixed / maxA) * 80}%` }} />
                    <span>{dateHe(Date.parse(w.week))}</span>
                  </div>
                ))}
              </div>
              <table class="data" style={{ marginTop: 10 }}>
                <thead><tr><th>שבוע</th><th>{t.fixedInReview}</th><th>{t.correctRate}</th></tr></thead>
                <tbody>{d.weeks.filter(w => w.answered || w.fixed).map(w => (
                  <tr key={w.week}><td>{dateHe(Date.parse(w.week))}</td><td>{w.fixed}</td><td>{w.answered ? pct(w.correct / w.answered) : '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }}</View>
  );
}

export function ReviewSession({ levelId, route }) {
  const source = route.query.get('source') || 'mixed';
  const topic = route.query.get('topic') || '';
  const [round, setRound] = useState(0);
  const q = useApi(`/api/learn/levels/${levelId}/review/session?source=${source}&size=8${topic ? '&topic=' + topic : ''}`, [levelId, source, topic, round]);
  useTitle(t.sessionTitle);
  return (
    <View q={q}>{d => <Session key={round} d={d} levelId={levelId} onAgain={() => setRound(r => r + 1)} />}</View>
  );
}

function Session({ d, levelId, onAgain }) {
  const lang = d.level.lang.id, dir = d.level.lang.dir;
  const [k, setK] = useState(0);
  const [value, setValue] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [score, setScore] = useState({ right: 0, improved: 0 });
  const pending = useRef(null);
  const headRef = useRef();
  const items = d.items;
  useEffect(() => { headRef.current && headRef.current.focus(); }, [k]);

  if (!items.length) return (
    <div class="card"><h1>{t.sessionTitle}</h1><p class="muted">{t.sessionEmpty}</p><a class="btn primary" href={`#/l/${levelId}/topics`}>{t.choose}</a></div>
  );
  if (k >= items.length) return (
    <div class="card" role="status">
      <h1>{t.sessionDone}</h1>
      <p class="lead">{t.sessionScore(score.right, items.length)}</p>
      {score.improved > 0 && <p>{t.sessionImproved(score.improved)}</p>}
      <div class="row">
        <button class="btn warm" onClick={onAgain}>{t.anotherSession}</button>
        <a class="btn ghost" href={`#/l/${levelId}/review`}>{t.reviewTitle}</a>
        <a class="btn ghost" href={`#/l/${levelId}`}>{t.navHome}</a>
      </div>
    </div>
  );

  const it = items[k];
  async function check(reveal) {
    if (busy || res) return;
    if (!reveal && (value === '' || value === null)) { setErr(t.feedback.not_answered()); return; }
    setBusy(true); setErr('');
    if (!pending.current) pending.current = clientId();
    try {
      const r = await api('/api/learn/items/check', { method: 'POST', body: { client_id: pending.current, exercise_id: it.exercise_id, item_idx: it.item_idx, value, reveal: !!reveal } });
      pending.current = null;
      const x = r.results[0] || { status: 'empty' };
      setRes(x);
      if (RIGHT(x.status)) setScore(s => ({ right: s.right + 1, improved: s.improved + (x.improved ? 1 : 0) }));
    } catch (e) { setErr(t.submitFailed + ` (${e.message})`); } finally { setBusy(false); }
  }
  function next() { setK(k + 1); setValue(''); setRes(null); setErr(''); }

  const prompt = it.prompt || '';
  const base = baseOf(prompt);
  const inputProps = {
    value, lang, dir, readOnly: !!res, autoComplete: 'off', spellcheck: false, 'aria-label': t.openWrite,
    onInput: e => setValue(e.target.value), onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); res ? next() : check(); } }
  };
  let control;
  if (it.input === 'choice' || it.input === 'match') {
    const opts = it.input === 'match' ? it.options.map(o => ({ v: o.id, label: o.text })) : it.options.map((o, i) => ({ v: i, label: o }));
    control = (
      <div class="options" role="radiogroup" dir={it.input === 'match' ? 'rtl' : dir}>
        {opts.map(o => (
          <label class="option" key={o.v}>
            <input type="radio" name="rv" disabled={!!res} checked={String(value) === String(o.v)} onChange={() => setValue(o.v)} />
            <span class={it.input === 'match' ? '' : 'tl'} lang={it.input === 'match' ? 'he' : lang}>{o.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (it.input === 'tokens') {
    const built = value ? String(value).split(' ') : [];
    const used = {};
    built.forEach(w => { used[w] = (used[w] || 0) + 1; });
    control = (
      <div>
        <div class="built" lang={lang} dir={dir}>{built.map((w, j) => <button key={j} type="button" class="token" disabled={!!res} onClick={() => setValue(built.filter((_, x) => x !== j).join(' '))}>{w}</button>)}</div>
        <div class="token-bank" lang={lang} dir={dir}>
          {it.tokens.map((w, j) => {
            const before = it.tokens.slice(0, j).filter(x => x === w).length;
            return <button key={j} type="button" class="token" disabled={!!res || before < (used[w] || 0)} onClick={() => setValue([...built, w].join(' '))}>{w}</button>;
          })}
        </div>
      </div>
    );
  } else {
    control = <input type="text" class="answer-input" {...inputProps} />;
  }

  return (
    <div class="player">
      <Crumbs items={[{ href: `#/l/${levelId}/review`, label: t.reviewTitle }, { label: t.itemOf(k + 1, items.length) }]} />
      <div class="card">
        <p class="eyebrow" tabIndex={-1} ref={headRef}>{t.itemOf(k + 1, items.length)} · {t.fromTopic} „{it.topic_title}“ · {it.title}</p>
        {it.instructions && <div class="instructions small"><T text={it.instructions} lang={lang} dir={dir} /></div>}
        {it.wordbank && it.wordbank.length > 0 && <div class="wordbank" lang={lang} dir={dir}>{it.wordbank.map(w => <span class="w" key={w}>{w}</span>)}</div>}
        {it.text && <details style={{ margin: '10px 0' }}><summary class="label">הטקסט</summary><div class="context-text tl-block" lang={lang} dir={dir}><T text={it.text} lang={lang} dir={dir} base="t" /></div></details>}
        <div class="item" style={{ marginTop: 12 }}>
          {(it.cue || it.hint) && <div class="row" style={{ gap: 6 }}>{it.cue && <span class="cue">[<T text={it.cue} lang={lang} dir={dir} />]</span>}{it.hint && <span class="hint">(<bdi class="tl" lang={lang}>{it.hint}</bdi>)</span>}</div>}
          {prompt && <div class="prompt" dir={base === 'he' ? 'rtl' : dir} lang={base === 'he' ? 'he' : lang}><T text={prompt.replace(/___/g, '_____')} lang={lang} dir={dir} base={base} /></div>}
          {control}
          {res && (
            <div class={'result ' + res.status} role="status">
              <span class="mark" aria-hidden="true">{t.resultMark[res.status]}</span><b>{t.resultLabel[res.status]}</b>
              {res.feedback && res.feedback.length > 0 && <ul>{res.feedback.map((f, i) => <li key={i}>{(t.feedback[f.code] || (() => ''))(f)}</li>)}</ul>}
              {res.expected && <div class="expected"><b>{t.expected} </b><bdi class="tl" lang={lang} dir={dir}>{res.expected}</bdi></div>}
              {res.note && <div class="expected"><b>{t.noteLabel} </b>{res.note}</div>}
            </div>
          )}
        </div>
        {it.input !== 'choice' && it.input !== 'match' && it.input !== 'tokens' && !res && (
          <div class="chars">{(d.level.lang.chars || []).map(c => <button type="button" key={c} onClick={() => setValue(v => v + c)}>{c}</button>)}</div>
        )}
        {err && <div class="alert error" role="alert">{err}</div>}
        <div class="row" style={{ marginTop: 12 }}>
          {!res ? (
            <>
              <button class="btn primary" disabled={busy} onClick={() => check(false)}>{busy ? t.checking : t.check}</button>
              <button class="link-btn" disabled={busy} onClick={() => check(true)}>{t.reveal}</button>
            </>
          ) : (
            <button class="btn primary" onClick={next} autoFocus>{k + 1 < items.length ? t.nextItem : t.finish}</button>
          )}
        </div>
      </div>
    </div>
  );
}
