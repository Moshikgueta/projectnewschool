import { useState, useMemo } from 'preact/hooks';
import { t, dateHe } from '../i18n.js';
import { api } from '../api.js';
import { useApi, View, useTitle } from '../ui.jsx';

export function Saved({ levelId }) {
  const q = useApi(`/api/learn/levels/${levelId}/saved`, [levelId]);
  const [cards, setCards] = useState(false);
  useTitle(t.savedTitle);
  async function remove(x) {
    q.setData(d => ({ ...d, items: d.items.filter(i => !(i.kind === x.kind && i.ref === x.ref)) }));
    try { await api('/api/learn/saved', { method: 'POST', body: { kind: x.kind, ref: x.ref, level_id: levelId, remove: true } }); }
    catch { q.reload(); }
  }
  return (
    <View q={q}>{d => {
      const lang = d.level.lang.id, dir = d.level.lang.dir;
      const words = d.items.filter(i => i.kind === 'word');
      const acts = d.items.filter(i => i.kind === 'exercise');
      return (
        <div class="stack">
          <div><h1>{t.savedTitle}</h1><p class="lead">{t.savedLead}</p></div>
          {!d.items.length && <div class="alert info">{t.savedNone}</div>}
          {cards && <Flashcards words={words} lang={lang} dir={dir} onClose={() => setCards(false)} />}
          <div class="grid two">
            <div class="card">
              <div class="row between"><h2>{t.savedWords} ({words.length})</h2>
                {words.length > 1 && !cards && <button class="btn warm small" onClick={() => setCards(true)}>{t.flashcards}</button>}</div>
              <ul class="list-plain">
                {words.map(w => (
                  <li key={w.ref} class="row between">
                    <span><bdi class="tl" lang={lang} dir={dir}>{w.ref}</bdi> — <span class="muted">{w.meaning}</span></span>
                    <button class="star" aria-pressed="true" aria-label={`${t.unsaveWord}: ${w.ref}`} onClick={() => remove(w)}>★</button>
                  </li>
                ))}
              </ul>
            </div>
            <div class="card">
              <h2>{t.savedActivities} ({acts.length})</h2>
              <ul class="list-plain">
                {acts.map(a => (
                  <li key={a.ref} class="row between">
                    <span><a href={`#/t/${a.topic_id}/a/${a.ref}`}>{a.ex_title}</a><br /><span class="muted small">{a.topic_title} · {dateHe(a.created_at)}</span></span>
                    <button class="star" aria-pressed="true" aria-label={`${t.unsaveActivity}: ${a.ex_title}`} onClick={() => remove(a)}>★</button>
                  </li>
                ))}
              </ul>
              {acts.length > 0 && <a class="btn secondary small" href={`#/l/${levelId}/review/session?source=saved`}>{t.sessionSaved}</a>}
            </div>
          </div>
        </div>
      );
    }}</View>
  );
}

/* Self-check cards: meaning first, then the word. Honest about what it is —
   the student says whether they knew it; nothing is auto-graded here. */
function Flashcards({ words, lang, dir, onClose }) {
  const deck = useMemo(() => words.slice().sort(() => Math.random() - .5), [words]);
  const [k, setK] = useState(0);
  const [open, setOpen] = useState(false);
  const [knew, setKnew] = useState(0);
  if (k >= deck.length) return (
    <div class="card" role="status"><h2>{t.cardsDone(knew, deck.length)}</h2><button class="btn ghost" onClick={onClose}>{t.close}</button></div>
  );
  const w = deck[k];
  const next = ok => { if (ok) setKnew(n => n + 1); setOpen(false); setK(k + 1); };
  return (
    <div class="card" aria-live="polite">
      <p class="eyebrow">{k + 1} / {deck.length}</p>
      <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{w.meaning}</p>
      {open ? (
        <>
          <p class="tl-block" lang={lang} dir={dir} style={{ fontSize: '1.4rem', color: 'var(--warm)' }}>{w.ref}</p>
          <div class="row"><button class="btn primary" onClick={() => next(true)}>{t.knewIt}</button><button class="btn ghost" onClick={() => next(false)}>{t.notYet}</button></div>
        </>
      ) : <button class="btn secondary" onClick={() => setOpen(true)} autoFocus>{t.showWord}</button>}
    </div>
  );
}

export function Glossary({ levelId }) {
  const q = useApi(`/api/learn/levels/${levelId}/glossary`, [levelId]);
  const [s, setS] = useState('');
  const [saved, setSaved] = useState(null);
  const [limit, setLimit] = useState(150);
  useTitle(t.glossaryTitle);
  return (
    <View q={q}>{d => {
      const lang = d.level.lang.id, dir = d.level.lang.dir;
      const set = saved || new Set(d.saved);
      const f = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const needle = f(s.trim());
      const list = needle ? d.words.filter(w => f(w.term).includes(needle) || f(w.he).includes(needle)) : d.words;
      async function toggle(term) {
        const on = set.has(term);
        const n = new Set(set); on ? n.delete(term) : n.add(term);
        setSaved(n);
        try { await api('/api/learn/saved', { method: 'POST', body: { kind: 'word', ref: term, level_id: levelId, remove: on } }); } catch { setSaved(set); }
      }
      return (
        <div>
          <h1>{t.glossaryTitle}</h1>
          <p class="lead">{t.glossaryLead(d.words.length)}</p>
          <label><span class="sr-only">{t.search}</span>
            <input type="search" placeholder={t.glossaryPh} value={s} onInput={e => { setS(e.target.value); setLimit(150); }} dir="auto" style={{ marginBottom: 14 }} />
          </label>
          <p class="muted small" aria-live="polite">{list.length}</p>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>{d.level.lang.name_native}</th><th>עברית</th><th>{t.inTopics}</th><th><span class="sr-only">שמירה</span></th></tr></thead>
              <tbody>
                {list.slice(0, limit).map(w => (
                  <tr key={w.term}>
                    <td><bdi class="tl" lang={lang} dir={dir}>{w.term}</bdi></td>
                    <td>{w.he}</td>
                    <td class="small">{w.topics.map((tp, i) => <span key={tp.id}>{i > 0 && ', '}<a href={`#/t/${tp.id}`}>{tp.title_he}</a></span>)}</td>
                    <td><button class="star" aria-pressed={set.has(w.term)} aria-label={(set.has(w.term) ? t.unsaveWord : t.saveWord) + ': ' + w.term} onClick={() => toggle(w.term)}>{set.has(w.term) ? '★' : '☆'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > limit && <button class="btn ghost" style={{ marginTop: 12 }} onClick={() => setLimit(limit + 300)}>עוד ערכים</button>}
        </div>
      );
    }}</View>
  );
}
