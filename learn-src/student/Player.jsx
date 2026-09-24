import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { t } from '../i18n.js';
import { api, clientId } from '../api.js';
import { useApi, View, Crumbs, useTitle, ensureFont } from '../ui.jsx';
import { T, TL, baseOf } from '../text.jsx';

const RIGHT = s => s === 'correct' || s === 'accepted_accent';

export function PlayerPage({ topicId, exId, me }) {
  const q = useApi(`/api/learn/topics/${topicId}`, [topicId]);
  return (
    <View q={q}>{d => {
      const ex = d.exercises.find(e => e.id === exId);
      if (!ex) return <div class="alert error">{t.notFound}</div>;
      return (
        <Activity key={ex.id} ex={ex} level={d.level} topic={d.topic} showXp={!!(me && me.prefs.gamification && d.level.challenge_enabled)}
          endpoints={{
            check: `/api/learn/exercises/${ex.id}/check`, self: `/api/learn/exercises/${ex.id}/self`,
            state: `/api/learn/exercises/${ex.id}/state`, flag: `/api/learn/exercises/${ex.id}/flag`, save: true
          }}
          crumbs={[{ href: `#/l/${d.level.id}`, label: d.level.name_he }, { href: `#/t/${topicId}`, label: d.topic.title_he }, { label: ex.title }]}
          back={`#/t/${topicId}`} levelHref={`#/l/${d.level.id}`} />
      );
    }}</View>
  );
}

/* ── the activity frame ─────────────────────────────────────────────── */

export function Activity({ ex, level, topic, endpoints, crumbs, back, levelHref, preview, showXp }) {
  const lang = level.lang.id, dir = level.lang.dir;
  ensureFont(lang);
  useTitle(ex.title);
  const [saved, setSaved] = useState(!!ex.saved);
  async function toggleSave() {
    const on = saved;
    setSaved(!on);
    try { await api('/api/learn/saved', { method: 'POST', body: { kind: 'exercise', ref: ex.id, level_id: level.id, remove: on } }); }
    catch { setSaved(on); }
  }
  const Comp = ex.mode === 'self' ? OpenActivity : ex.kind === 'match' ? MatchActivity : ex.kind === 'order' ? OrderActivity : ItemsActivity;
  return (
    <div class="player">
      <Crumbs items={crumbs} />
      <div class="player-head">
        <div class="row between">
          <span class="pill gray">{t.kind[ex.kind] || ex.kind} · {t.skill[ex.skill] || ''}</span>
          {!preview && <button class="btn ghost small" aria-pressed={saved} onClick={toggleSave}>{saved ? '★ ' + t.unsaveActivity : '☆ ' + t.saveActivity}</button>}
        </div>
        <h1 style={{ marginTop: 10 }}>{ex.title}</h1>
        {ex.instructions && <div class="instructions"><T text={ex.instructions} lang={lang} dir={dir} /></div>}
      </div>
      {ex.body.audio && <Audio id={ex.body.audio} preview={preview} />}
      <Comp ex={ex} level={level} topic={topic} endpoints={endpoints} lang={lang} dir={dir} preview={preview} back={back} showXp={showXp} />
      <div class="row" style={{ marginTop: 18 }}>
        <a class="btn ghost" href={back}>{t.otherActivity}</a>
        {levelHref && !preview && <a class="btn ghost" href={`${levelHref}/topics`}>{t.exploreOther}</a>}
      </div>
    </div>
  );
}

/* Real audio only: the player appears when the file exists and says so
   plainly when it does not. There is no placeholder control. */
function Audio({ id, preview }) {
  const [missing, setMissing] = useState(false);
  if (preview) return <div class="alert info">קובץ שמע מצורף ({id}). בתצוגה המקדימה הוא מושמע רק לתלמידים רשומים.</div>;
  if (missing) return <div class="alert warn">{t.audioMissing}</div>;
  return <audio controls preload="none" src={`/api/learn/media/${id}`} onError={() => setMissing(true)} style={{ width: '100%', margin: '10px 0' }} />;
}

/* ── state, saving and checking shared by the auto-graded activities ── */

function useActivityState(ex, endpoints, preview) {
  const init = ex.state || {};
  const [values, setValues] = useState(init.values || {});
  const [results, setResults] = useState(init.results || {});
  const [summary, setSummary] = useState(init.summary || null);
  const [xp, setXp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('');
  const pending = useRef(null);            // client id kept across a failed submit → idempotent retry
  const timer = useRef(null);
  const latest = useRef({ values, results, summary });
  latest.current = { values, results, summary };

  async function persist(v = latest.current) {
    if (preview || !endpoints.save) return;
    setSaveState('saving');
    try {
      await api(endpoints.state, { method: 'PUT', body: { state: { values: v.values, results: v.results, summary: v.summary } } });
      setSaveState('saved');
    } catch { setSaveState('error'); }
  }
  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(), 900);
  }
  useEffect(() => () => {
    // leaving the page: flush unsaved typing
    if (timer.current) { clearTimeout(timer.current); persist(); }
  }, []);

  function setValue(i, v) {
    setValues(prev => ({ ...prev, [i]: v }));
    setResults(prev => {
      if (!prev[i] || RIGHT(prev[i].status)) return prev;
      const n = { ...prev }; delete n[i]; return n;       // edited after a wrong answer: ready to re-check
    });
    schedule();
  }

  async function submit(answers, reveal = []) {
    if (busy) return null;
    setBusy(true); setErr('');
    if (!pending.current) pending.current = clientId();
    try {
      const r = await api(endpoints.check, { method: 'POST', body: { client_id: pending.current, answers, reveal } });
      pending.current = null;
      const next = { ...latest.current.results };
      for (const x of r.results) next[x.i] = { ...(next[x.i] || {}), ...x };
      setResults(next);
      setSummary(r.summary);
      if (r.xp_gained) setXp(n => n + r.xp_gained);
      const v = { values: latest.current.values, results: next, summary: r.summary };
      clearTimeout(timer.current); timer.current = null;
      persist(v);
      return r;
    } catch (e) {
      setErr(e.code === 'outside_enrollment' ? e.message : t.submitFailed + (e.message ? ` (${e.message})` : ''));
      return null;
    } finally { setBusy(false); }
  }

  function resetAll() {
    setValues({}); setResults({}); setSummary(null); setErr('');
    persist({ values: {}, results: {}, summary: null });
  }
  return { values, results, summary, xp, busy, err, saveState, setValue, submit, resetAll, persist };
}

function SaveIndicator({ s, onRetry }) {
  if (s === 'saving') return <span class="save-state" role="status">{t.saving}</span>;
  if (s === 'saved') return <span class="save-state" role="status">✓ {t.saved}</span>;
  if (s === 'error') return <span class="save-state err" role="alert">{t.saveFailed} <button class="link-btn" onClick={onRetry}>{t.saveRetry}</button></span>;
  return null;
}

function Feedback({ r, lang, dir, onReveal, onFlag, flagged, canFlag, busy }) {
  if (!r) return null;
  const st = r.status;
  return (
    <div class={'result ' + st} role="status">
      <span class="mark" aria-hidden="true">{t.resultMark[st]}</span>
      <b>{t.resultLabel[st]}</b>
      {r.feedback && r.feedback.length > 0 && (
        <ul>{r.feedback.map((f, i) => <li key={i}><T text={(t.feedback[f.code] || (() => ''))(f)} lang={lang} dir={dir} /></li>)}</ul>
      )}
      {r.expected && (
        <div class="expected"><b>{t.expected} </b><bdi class="tl" lang={lang} dir={dir} style={{ whiteSpace: 'pre-line' }}>{r.expected}</bdi></div>
      )}
      {r.note && <div class="expected"><b>{t.noteLabel} </b><T text={r.note} lang={lang} dir={dir} /></div>}
      <div class="row" style={{ marginTop: 6 }}>
        {r.can_reveal && !r.expected && onReveal && (
          <button class="link-btn small" onClick={onReveal} disabled={busy} title={t.revealNote}>{t.reveal}</button>
        )}
        {canFlag && !RIGHT(st) && st !== 'empty' && st !== 'revealed' && onFlag && (
          flagged ? <span class="small">{t.flagSent}</span> : <button class="link-btn small" onClick={onFlag}>{t.flagAlt}</button>
        )}
      </div>
    </div>
  );
}

function Completion({ summary, xp, total, onRetryAll, back, showXp }) {
  if (!summary || !summary.completed) return null;
  const all = summary.score === total;
  return (
    <div class="complete" role="status" tabIndex={-1}>
      <h2 style={{ margin: 0 }}>{all ? `✓ ${t.completeTitle}` : t.answeredAll}</h2>
      <p style={{ margin: '6px 0' }}>{all ? t.completeAll : t.completeSome(summary.score, total)}</p>
      {showXp && xp > 0 && <p class="small" style={{ margin: 0 }}>{t.xpGained(xp)}</p>}
      <div class="row" style={{ marginTop: 10 }}>
        <a class="btn primary" href={back}>{t.otherActivity}</a>
        <button class="btn ghost" onClick={onRetryAll}>{t.retryAll}</button>
      </div>
    </div>
  );
}

/* On-screen keys for letters a Hebrew keyboard does not have. */
function CharKeys({ chars, onChar }) {
  if (!chars || !chars.length) return null;
  return (
    <div class="chars" aria-label={t.chars}>
      {chars.map(c => <button type="button" key={c} onMouseDown={e => e.preventDefault()} onClick={() => onChar(c)} aria-label={`הוספת ${c}`}>{c}</button>)}
    </div>
  );
}

function useCharInsert(values, setValue) {
  const last = useRef(null);
  const onFocus = e => { last.current = e.target; };
  function insert(c) {
    const el = (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.idx !== undefined)
      ? document.activeElement : last.current;
    if (!el || el.dataset.idx === undefined) return;
    const i = el.dataset.idx;
    const cur = String(values[i] || '');
    const s = el.selectionStart ?? cur.length, e2 = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, s) + c + cur.slice(e2);
    setValue(i, next);
    requestAnimationFrame(() => { el.focus(); try { el.setSelectionRange(s + c.length, s + c.length); } catch { } });
  }
  return { onFocus, insert };
}

/* ── item-based activities (gap, recall, choice, bank, typed, reading…) ─ */

function ItemsActivity({ ex, level, endpoints, lang, dir, preview, back, showXp }) {
  const A = useActivityState(ex, endpoints, preview);
  const items = ex.body.items || [];
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [flagged, setFlagged] = useState({});
  const { onFocus, insert } = useCharInsert(A.values, A.setValue);
  const bank = ex.body.wordbank || [];
  const usedWords = useMemo(() => new Set(Object.values(A.values).map(v => String(v).trim().toLowerCase())), [A.values]);
  const hasTyping = items.some(it => it.input !== 'choice');

  const pendingIdx = items.map((_, i) => i).filter(i => !(A.results[i] && RIGHT(A.results[i].status)));
  const empty = pendingIdx.filter(i => A.values[i] === undefined || A.values[i] === '' || A.values[i] === null);

  async function check(force) {
    if (empty.length && !force && empty.length < pendingIdx.length) { setConfirmEmpty(true); return; }
    setConfirmEmpty(false);
    const answers = {};
    for (const i of pendingIdx) {
      const v = A.values[i];
      if (v === undefined || v === '' || v === null) continue;
      answers[i] = v;
    }
    if (!Object.keys(answers).length) { setConfirmEmpty(true); return; }
    const r = await A.submit(answers);
    if (r) {
      const firstWrong = r.results.find(x => !RIGHT(x.status));
      requestAnimationFrame(() => {
        const el = document.querySelector(firstWrong ? `[data-item="${firstWrong.i}"]` : '.complete');
        el && el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    }
  }
  async function flag(i) {
    try { await api(endpoints.flag, { method: 'POST', body: { item_idx: i, answer: String(A.values[i] || '') } }); setFlagged(f => ({ ...f, [i]: true })); } catch { }
  }

  const inputFor = (i, it, inline) => {
    const r = A.results[i];
    const locked = r && RIGHT(r.status);
    const common = {
      'data-idx': i, id: `${ex.id}-i${i}`, value: A.values[i] ?? '', readOnly: locked, onFocus,
      onInput: e => A.setValue(i, e.target.value), autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellcheck: false,
      lang, dir, 'aria-label': `${t.openWrite} — סעיף ${i + 1}`,
      'aria-invalid': r && !RIGHT(r.status) ? 'true' : undefined,
      onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); check(); } }
    };
    if (inline) return <input type="text" class="gap-input" size={Math.max(8, String(A.values[i] || '').length + 2)} {...common} />;
    return <input type="text" class="answer-input" {...common} />;
  };

  const renderContext = () => {
    const text = ex.body.text;
    if (!text) return null;
    if (!/\{\{\d+\}\}/.test(text)) return <TL class="context-text" text={text} lang={lang} dir={dir} />;
    const parts = text.split(/(\{\{\d+\}\})/);
    return (
      <div class="context-text tl-block" lang={lang} dir={dir}>
        {parts.map((p, k) => {
          const m = p.match(/^\{\{(\d+)\}\}$/);
          if (!m) return <T key={k} text={p} lang={lang} dir={dir} base="t" />;
          const i = Number(m[1]) - 1;
          return <span key={k}><sup class="item-num">{i + 1}</sup>{inputFor(i, items[i], true)}</span>;
        })}
      </div>
    );
  };

  return (
    <div>
      {bank.length > 0 && (
        <div class="wordbank" lang={lang} dir={dir} aria-label="מחסן מילים">
          {bank.map(w => <span key={w} class={'w' + (usedWords.has(w.trim().toLowerCase()) ? ' used' : '')}>{w}</span>)}
        </div>
      )}
      {renderContext()}
      {ex.body.text && items.some(it => it.inText) && (
        <ol class="items">{items.map((it, i) => it.inText && A.results[i] ? (
          <li class={'item ' + A.results[i].status} key={i} data-item={i}><span class="item-num">{i + 1}.</span>
            <Feedback r={A.results[i]} lang={lang} dir={dir} busy={A.busy} onReveal={() => A.submit({}, [i])} />
          </li>) : null)}
        </ol>
      )}
      <ol class="items">
        {items.map((it, i) => it.inText ? null : (
          <Item key={i} i={i} it={it} ex={ex} A={A} lang={lang} dir={dir} inputFor={inputFor}
            flagged={flagged[i]} onFlag={preview ? null : () => flag(i)} />
        ))}
      </ol>
      {hasTyping && <CharKeys chars={level.lang.chars} onChar={insert} />}
      {A.err && <div class="alert error" role="alert">{A.err}</div>}
      {confirmEmpty && (
        <div class="alert warn" role="alert">
          {t.emptyWarn(empty.length)}{' '}
          <button class="btn small secondary" onClick={() => check(true)}>{t.checkAnyway}</button>{' '}
          <button class="btn small ghost" onClick={() => { setConfirmEmpty(false); const el = document.querySelector(`[data-idx="${empty[0]}"]`); el && el.focus(); }}>{t.fillFirst}</button>
        </div>
      )}
      <Completion summary={A.summary} xp={A.xp} total={items.length} onRetryAll={A.resetAll} back={back} showXp={showXp} />
      <div class="player-actions">
        {pendingIdx.length > 0 && (
          <button class="btn primary" onClick={() => check()} disabled={A.busy} aria-busy={A.busy}>
            {A.busy ? t.checking : Object.keys(A.results).length ? t.checkAgain : t.check}
          </button>
        )}
        <SaveIndicator s={A.saveState} onRetry={() => A.persist()} />
      </div>
    </div>
  );
}

function Item({ i, it, ex, A, lang, dir, inputFor, flagged, onFlag }) {
  const r = A.results[i];
  const prompt = it.prompt || '';
  const base = baseOf(prompt);
  const pdir = base === 'he' ? 'rtl' : dir;
  const hasGap = prompt.includes('___');
  let body;
  if (it.input === 'choice') {
    const locked = r && RIGHT(r.status);
    body = (
      <>
        {prompt && <div class={'prompt' + (base === 'he' ? '' : ' tl-block')} dir={pdir} lang={base === 'he' ? 'he' : lang}><T text={prompt.replace(/___/g, '_____')} lang={lang} dir={dir} base={base} /></div>}
        <div class="options" role="radiogroup" aria-label={`סעיף ${i + 1}`} dir={dir}>
          {it.options.map((o, k) => (
            <label key={k} class={'option' + (locked && Number(A.values[i]) === k ? ' right' : '')}>
              <input type="radio" name={`${ex.id}-${i}`} checked={String(A.values[i]) === String(k)} disabled={locked}
                onChange={() => A.setValue(i, k)} />
              <span class="tl" lang={lang} dir={dir}>{o}</span>
            </label>
          ))}
        </div>
      </>
    );
  } else if (it.input === 'tokens') {
    body = <Tokens i={i} it={it} A={A} lang={lang} dir={dir} />;
  } else if (hasGap) {
    body = <div class={'prompt' + (base === 'he' ? '' : ' tl-block')} dir={pdir} lang={base === 'he' ? 'he' : lang}><T text={prompt} lang={lang} dir={dir} base={base} gap={() => inputFor(i, it, true)} /></div>;
  } else {
    body = (
      <>
        {prompt && <div class={'prompt' + (base === 'he' ? '' : ' tl-block')} dir={pdir} lang={base === 'he' ? 'he' : lang}><T text={prompt} lang={lang} dir={dir} base={base} /></div>}
        {inputFor(i, it, false)}
      </>
    );
  }
  return (
    <li class={'item ' + (r ? r.status : '')} data-item={i}>
      <div class="row" style={{ gap: 6, alignItems: 'baseline' }}>
        <span class="item-num">{i + 1}.</span>
        {it.cue && <span class="cue">[<T text={it.cue} lang={lang} dir={dir} />]</span>}
        {it.hint && <span class="hint">(<bdi class="tl" lang={lang} dir={dir}>{it.hint}</bdi>)</span>}
      </div>
      {body}
      <Feedback r={r} lang={lang} dir={dir} busy={A.busy} onReveal={() => A.submit({}, [i])}
        canFlag={it.input === 'sentence' || it.input === 'text'} flagged={flagged} onFlag={onFlag} />
    </li>
  );
}

/* Word order: tap words to build the sentence; tap a built word to return
   it. Buttons all the way down — no drag and drop needed. */
function Tokens({ i, it, A, lang, dir }) {
  const r = A.results[i];
  const locked = r && RIGHT(r.status);
  const built = A.values[i] ? String(A.values[i]).split(' ').filter(Boolean) : [];
  const counts = {};
  built.forEach(w => { counts[w] = (counts[w] || 0) + 1; });
  const avail = it.tokens.map((w, k) => {
    const usedBefore = it.tokens.slice(0, k).filter(x => x === w).length;
    return { w, k, used: usedBefore < (counts[w] || 0) };
  });
  return (
    <div>
      <p class="hint">{t.tokensHint}</p>
      <div class="built" lang={lang} dir={dir} aria-label="המשפט שנבנה" aria-live="polite">
        {built.map((w, k) => (
          <button type="button" key={k} class="token" disabled={locked}
            onClick={() => A.setValue(i, built.filter((_, j) => j !== k).join(' '))}>{w}</button>
        ))}
      </div>
      <div class="token-bank" lang={lang} dir={dir}>
        {avail.map(a => (
          <button type="button" key={a.k} class="token" disabled={a.used || locked}
            onClick={() => A.setValue(i, [...built, a.w].join(' '))}>{a.w}</button>
        ))}
        {built.length > 0 && !locked && <button type="button" class="btn ghost small" onClick={() => A.setValue(i, '')}>{t.clear}</button>}
      </div>
    </div>
  );
}

/* ── matching: a select per row is the accessible way to match ──────── */

function MatchActivity({ ex, endpoints, lang, dir, preview, back, showXp }) {
  const A = useActivityState(ex, endpoints, preview);
  const { left, right } = ex.body;
  const pending = left.map((_, i) => i).filter(i => !(A.results[i] && RIGHT(A.results[i].status)));
  const [warn, setWarn] = useState(false);
  async function check(force) {
    const empty = pending.filter(i => !A.values[i]);
    if (empty.length && !force && empty.length < pending.length) { setWarn(true); return; }
    setWarn(false);
    const answers = {};
    pending.forEach(i => { if (A.values[i]) answers[i] = A.values[i]; });
    if (!Object.keys(answers).length) { setWarn(true); return; }
    await A.submit(answers);
  }
  return (
    <div>
      <div class="match-table">
        {left.map((l, i) => {
          const r = A.results[i];
          const locked = r && RIGHT(r.status);
          return (
            <div key={i} data-item={i}>
              <div class="match-row">
                <label for={`${ex.id}-m${i}`} class="tl" lang={lang} dir={dir}><span class="item-num">{i + 1}.</span> {l}</label>
                <select id={`${ex.id}-m${i}`} value={A.values[i] || ''} disabled={locked} onChange={e => A.setValue(i, e.target.value)}>
                  <option value="">{t.matchPick}</option>
                  {right.map(o => <option key={o.id} value={o.id}>{o.id} · {o.text}</option>)}
                </select>
              </div>
              <Feedback r={r && { ...r, expected: r.expected || r.expectedText }} lang={lang} dir={dir} />
            </div>
          );
        })}
      </div>
      {A.err && <div class="alert error" role="alert">{A.err}</div>}
      {warn && <div class="alert warn" role="alert">{t.emptyWarn(pending.filter(i => !A.values[i]).length)} <button class="btn small secondary" onClick={() => check(true)}>{t.checkAnyway}</button></div>}
      <Completion summary={A.summary} xp={A.xp} total={left.length} onRetryAll={A.resetAll} back={back} showXp={showXp} />
      <div class="player-actions">
        {pending.length > 0 && <button class="btn primary" disabled={A.busy} onClick={() => check()}>{A.busy ? t.checking : t.check}</button>}
        <SaveIndicator s={A.saveState} onRetry={() => A.persist()} />
      </div>
    </div>
  );
}

/* ── ordering a dialogue or a sequence ──────────────────────────────── */

function OrderActivity({ ex, endpoints, lang, dir, preview, back, showXp }) {
  const A = useActivityState(ex, endpoints, preview);
  const lines = ex.body.lines;
  const order = Array.isArray(A.values[0]) && A.values[0].length === lines.length ? A.values[0] : lines.map(l => l.id);
  const r = A.results[0];
  const locked = r && RIGHT(r.status);
  const byId = Object.fromEntries(lines.map(l => [l.id, l]));
  const listRef = useRef();
  function move(k, d) {
    const j = k + d;
    if (j < 0 || j >= order.length) return;
    const n = order.slice();
    [n[k], n[j]] = [n[j], n[k]];
    A.setValue(0, n);
    requestAnimationFrame(() => {
      const btn = listRef.current && listRef.current.querySelectorAll('li')[j].querySelector(d < 0 ? '[data-up]' : '[data-down]');
      btn && !btn.disabled ? btn.focus() : listRef.current.querySelectorAll('li')[j].querySelector('button').focus();
    });
  }
  return (
    <div>
      <p class="hint">{t.orderHint}</p>
      <ol class="order-list" ref={listRef}>
        {order.map((id, k) => (
          <li key={id} onKeyDown={e => { if (locked) return; if (e.key === 'ArrowUp') { e.preventDefault(); move(k, -1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(k, 1); } }}>
            <span class="pos">{k + 1}</span>
            <span class="txt tl" lang={lang} dir={dir}>{byId[id].text}</span>
            <span class="moves">
              <button data-up type="button" disabled={locked || k === 0} onClick={() => move(k, -1)} aria-label={`${t.moveUp}: ${byId[id].text}`}>▲</button>
              <button data-down type="button" disabled={locked || k === order.length - 1} onClick={() => move(k, 1)} aria-label={`${t.moveDown}: ${byId[id].text}`}>▼</button>
            </span>
          </li>
        ))}
      </ol>
      <Feedback r={r} lang={lang} dir={dir} busy={A.busy} onReveal={() => A.submit({}, [0])} />
      {A.err && <div class="alert error" role="alert">{A.err}</div>}
      <Completion summary={A.summary} xp={A.xp} total={1} onRetryAll={A.resetAll} back={back} showXp={showXp} />
      <div class="player-actions">
        {!locked && <button class="btn primary" disabled={A.busy} onClick={() => A.submit({ 0: order })}>{A.busy ? t.checking : r ? t.checkAgain : t.check}</button>}
        <SaveIndicator s={A.saveState} onRetry={() => A.persist()} />
      </div>
    </div>
  );
}

/* ── open writing / speaking: model answer and self-review ──────────── */

function OpenActivity({ ex, level, endpoints, lang, dir, preview, back, showXp }) {
  const init = ex.state || {};
  const [text, setText] = useState(init.text || '');
  const [model, setModel] = useState(init.model || null);
  const [rating, setRating] = useState((ex.progress && ex.progress.self_rating) || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('');
  const [xp, setXp] = useState(0);
  const pending = useRef(null);
  const timer = useRef(null);
  const speaking = ex.skill === 'speaking';

  async function persist(state) {
    if (preview) return;
    setSaveState('saving');
    try { await api(endpoints.state, { method: 'PUT', body: { state } }); setSaveState('saved'); } catch { setSaveState('error'); }
  }
  function onText(v) {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist({ text: v, model }), 900);
  }
  async function send(r) {
    if (busy) return;
    setBusy(true); setErr('');
    if (!pending.current) pending.current = clientId();
    try {
      const res = await api(preview ? endpoints.check : endpoints.self, { method: 'POST', body: { client_id: pending.current, text, rating: r || undefined } });
      pending.current = null;
      const m = { models: res.models || [], criteria: res.criteria || '' };
      setModel(m);
      if (r) setRating(r);
      if (res.xp_gained) setXp(res.xp_gained);
      persist({ text, model: m });
    } catch (e) { setErr(t.submitFailed + ` (${e.message})`); } finally { setBusy(false); }
  }
  const prompt = ex.body.prompt || '';
  return (
    <div>
      {prompt && (
        <ol class="items">
          {prompt.split('\n').filter(Boolean).map((p, i) => <li class="item" key={i}><span class="item-num">{i + 1}.</span> <TL as="span" text={p} lang={lang} dir={dir} /></li>)}
        </ol>
      )}
      {ex.body.brief && <TL class="context-text" text={ex.body.brief} lang={lang} dir={dir} />}
      {ex.body.note && <p class="hint">{ex.body.note}</p>}
      <div class="alert info" style={{ margin: '12px 0' }}>{speaking ? t.openSpeak : t.openNote}</div>
      <label class="label" for={`${ex.id}-text`}>{t.openWrite}</label>
      <textarea id={`${ex.id}-text`} lang={lang} dir={dir} class="answer-input" value={text} onInput={e => onText(e.target.value)} rows={7} spellcheck={false} />
      <CharKeys chars={level.lang.chars} onChar={c => onText(text + c)} />
      {err && <div class="alert error" role="alert">{err}</div>}
      <div class="player-actions">
        <button class="btn primary" disabled={busy || (!speaking && !text.trim())} onClick={() => send()}>{busy ? t.checking : t.openSubmit}</button>
        <SaveIndicator s={saveState} onRetry={() => persist({ text, model })} />
      </div>
      {model && (
        <div class="card" style={{ marginTop: 14 }} role="region" aria-label={t.models}>
          {model.models.length ? model.models.map((m, i) => (
            <div key={i}><h3>{t.models}</h3><div class="model tl-block" lang={lang} dir={dir}><T text={m} lang={lang} dir={dir} base="t" /></div></div>
          )) : <p class="muted">{t.noModel}</p>}
          {model.criteria && <><h3 style={{ marginTop: 12 }}>{t.criteria}</h3><p style={{ whiteSpace: 'pre-line' }}><T text={model.criteria} lang={lang} dir={dir} /></p></>}
          {level.rubric && level.rubric.length > 1 && (
            <details style={{ marginTop: 8 }}>
              <summary class="label">{t.rubric}</summary>
              <div class="table-wrap"><table class="rubric">
                <thead><tr>{level.rubric[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>{level.rubric.slice(1).map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table></div>
            </details>
          )}
          {!preview && (
            <>
              <h3 style={{ marginTop: 14 }}>{t.rateYourself}</h3>
              <div class="rating" role="group" aria-label={t.rateYourself}>
                {Object.entries(t.rate).map(([k, v]) => (
                  <button key={k} class="btn ghost" aria-pressed={rating === k} disabled={busy} onClick={() => send(k)}>{v}</button>
                ))}
              </div>
              {rating && <p class="small" role="status" style={{ marginTop: 8 }}>✓ {t.rated}{showXp && xp ? ` ${t.xpGained(xp)}` : ''}</p>}
              {rating && <a class="btn secondary" style={{ marginTop: 8 }} href={back}>{t.otherActivity}</a>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
