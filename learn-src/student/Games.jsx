import { useState, useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { useApi, View, useTitle } from '../ui.jsx';

/* Challenge Mode. Optional, calm, adult: no leaderboard, no loss messages,
   no timers anywhere except the one challenge that says it is timed. XP is
   earned for first-time correct items, fixing mistakes on a later day and
   self-reviewing open tasks (server rules), and games are capped per day. */

export function GameCard({ game, levelId }) {
  const earned = game.badges.filter(b => b.earned);
  return (
    <div class="card">
      <div class="row between"><h2>{t.challengeMode}</h2><a class="btn warm small" href={`#/l/${levelId}/games`}>{t.gamesTitle}</a></div>
      <div class="tiles">
        <div class="tile stat"><b>{game.xp}</b><span>{t.xp}</span></div>
        <div class="tile stat"><b>{game.week_days}/{game.weekly_goal}</b><span>{t.weekProgress(game.week_days, game.weekly_goal)}</span></div>
        <div class="tile stat"><b>{earned.length}/{game.badges.length}</b><span>{t.badgesTitle}</span></div>
      </div>
      <p class="small" style={{ marginTop: 10 }}>{t.streak(game.streak)}</p>
    </div>
  );
}

export function Games({ levelId, me, level }) {
  const dash = useApi(`/api/learn/levels/${levelId}/dashboard`, [levelId]);
  const [which, setWhich] = useState(null);
  useTitle(t.gamesTitle);
  if (!me.prefs.gamification) return <div class="card"><h1>{t.gamesTitle}</h1><p>{t.practiceModeLead}</p><a class="btn secondary" href="#/settings">{t.settings}</a></div>;
  if (level && !level.challenge_enabled) return <div class="alert info">{t.challengeOff}</div>;
  return (
    <View q={dash}>{d => {
      const g = d.game;
      if (!g) return <div class="alert info">{t.challengeOff}</div>;
      return (
        <div class="stack">
          <div><h1>{t.gamesTitle}</h1><p class="lead">{t.gamesLead}</p></div>
          {which === 'memory' ? <Memory levelId={levelId} lang={level.lang} onBack={() => { setWhich(null); dash.reload(); }} best={g.best.memory} />
            : which === 'sprint' ? <Sprint levelId={levelId} lang={level.lang} onBack={() => { setWhich(null); dash.reload(); }} best={g.best.sprint} />
            : (
              <div class="grid two">
                <div class="card feature">
                  <h2>{t.memory}</h2><p class="muted grow">{t.memoryLead}</p>
                  {g.best.memory !== undefined && <p class="small">{t.personalBest(g.best.memory)}</p>}
                  <button class="btn primary" onClick={() => setWhich('memory')}>{t.play}</button>
                </div>
                <div class="card feature warm">
                  <h2>{t.sprint}</h2><p class="muted grow">{t.sprintLead}</p>
                  {g.best.sprint !== undefined && <p class="small">{t.personalBest(g.best.sprint)}</p>}
                  <button class="btn warm" onClick={() => setWhich('sprint')}>{t.play}</button>
                </div>
              </div>
            )}
          <GameCard game={g} levelId={levelId} />
          <div class="card">
            <h2>{t.badgesTitle}</h2>
            <div class="badges">
              {g.badges.map(b => (
                <div key={b.id} class={'badge' + (b.earned ? '' : ' locked')}>
                  <b>{b.earned ? '✓ ' : ''}{t.badge[b.id][0]}</b>
                  <span class="small muted">{t.badge[b.id][1]}</span>
                  <span class="sr-only">{b.earned ? 'הושג' : 'עוד לא הושג'}</span>
                </div>
              ))}
            </div>
            <p class="hint" style={{ marginTop: 10 }}>{t.xpNote}</p>
          </div>
        </div>
      );
    }}</View>
  );
}

async function sendResult(levelId, game, score, total, duration) {
  try { return await api(`/api/learn/levels/${levelId}/game`, { method: 'POST', body: { game, score, total, duration_ms: duration } }); }
  catch { return null; }
}

function Memory({ levelId, lang, onBack, best }) {
  const q = useApi(`/api/learn/levels/${levelId}/game?game=memory`, [levelId]);
  return <View q={q}>{d => <MemoryBoard key={d.pairs.map(p => p.term).join()} d={d} levelId={levelId} lang={lang} onBack={onBack} again={q.reload} />}</View>;
}

function MemoryBoard({ d, levelId, lang, onBack, again }) {
  const [cards] = useState(() => d.pairs.flatMap((p, i) => [
    { id: i + 't', pair: i, text: p.term, tl: true }, { id: i + 'h', pair: i, text: p.he, tl: false }
  ]).sort(() => Math.random() - .5));
  const [open, setOpen] = useState([]);
  const [done, setDone] = useState(new Set());
  const [moves, setMoves] = useState(0);
  const [result, setResult] = useState(null);
  const started = useRef(Date.now());
  const lock = useRef(false);
  function flip(c) {
    if (lock.current || done.has(c.pair) || open.find(o => o.id === c.id)) return;
    const next = [...open, c];
    setOpen(next);
    if (next.length === 2) {
      setMoves(m => m + 1);
      lock.current = true;
      const match = next[0].pair === next[1].pair;
      setTimeout(() => {
        if (match) {
          const nd = new Set(done); nd.add(c.pair); setDone(nd);
          if (nd.size === d.pairs.length) {
            const score = Math.max(0, 20 - Math.max(0, moves + 1 - d.pairs.length));
            sendResult(levelId, 'memory', score, 20, Date.now() - started.current).then(setResult);
          }
        }
        setOpen([]); lock.current = false;
      }, match ? 350 : 1100);
    }
  }
  const finished = done.size === d.pairs.length;
  return (
    <div class="card">
      <div class="row between"><h2>{t.memory}</h2><span aria-live="polite">{t.found(done.size, d.pairs.length)} · {moves} צעדים</span></div>
      <p class="hint">{d.from_practiced ? t.fromPracticed : t.fromLevel}</p>
      <div class="memory">
        {cards.map(c => {
          const isOpen = open.find(o => o.id === c.id) || done.has(c.pair);
          return (
            <button key={c.id} class={done.has(c.pair) ? 'done' : isOpen ? 'open' : ''} onClick={() => flip(c)}
              aria-label={isOpen ? c.text : 'קלף סגור'} aria-disabled={done.has(c.pair)}>
              {isOpen ? (c.tl ? <bdi class="tl" lang={lang.id} dir={lang.dir}>{c.text}</bdi> : c.text) : '?'}
            </button>
          );
        })}
      </div>
      {finished && (
        <div class="complete" role="status">
          <h3>{t.gameOver}</h3>
          {result && <p>{result.new_best ? t.newBest + ' ' : ''}{t.personalBest(result.personal_best)}{result.xp_gained ? ` · ${t.xpGained(result.xp_gained)}` : ''}</p>}
          <div class="row"><button class="btn primary" onClick={again}>{t.playAgain}</button><button class="btn ghost" onClick={onBack}>{t.back}</button></div>
        </div>
      )}
      {!finished && <button class="btn ghost" style={{ marginTop: 12 }} onClick={onBack}>{t.back}</button>}
    </div>
  );
}

/* The one timed activity. Start, pause, resume and reset all do what they
   say; the clock is computed from timestamps, so a background tab or a slow
   device cannot bend it. */
function Sprint({ levelId, lang, onBack }) {
  const q = useApi(`/api/learn/levels/${levelId}/game?game=sprint`, [levelId]);
  return <View q={q}>{d => <SprintRun key={d.questions.map(x => x.he).join()} d={d} levelId={levelId} lang={lang} onBack={onBack} again={q.reload} />}</View>;
}

function SprintRun({ d, levelId, lang, onBack, again }) {
  const total = d.seconds * 1000;
  const [phase, setPhase] = useState('ready');        // ready | running | paused | over
  const [left, setLeft] = useState(total);
  const [k, setK] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const endAt = useRef(0);
  const tick = useRef(null);
  const sent = useRef(false);
  const tally = useRef({ score: 0, answered: 0 });

  const stopTick = () => { clearInterval(tick.current); tick.current = null; };
  function run() {
    endAt.current = Date.now() + left;
    setPhase('running');
    stopTick();
    tick.current = setInterval(() => {
      const l = Math.max(0, endAt.current - Date.now());
      setLeft(l);
      if (l <= 0) finish();
    }, 200);
  }
  function pause() { stopTick(); setLeft(Math.max(0, endAt.current - Date.now())); setPhase('paused'); }
  function reset() { stopTick(); setPhase('ready'); setLeft(total); setK(0); setScore(0); setAnswered(0); setPicked(null); setResult(null); tally.current = { score: 0, answered: 0 }; sent.current = false; }
  function finish() {
    stopTick(); setPhase('over');
    if (sent.current) return;
    sent.current = true;
    const { score: sc, answered: an } = tally.current;
    sendResult(levelId, 'sprint', sc, Math.max(an, sc), total - Math.max(0, endAt.current - Date.now())).then(setResult);
  }
  useEffect(() => stopTick, []);
  function choose(i) {
    if (phase !== 'running' || picked !== null) return;
    const q = d.questions[k];
    const ok = i === q.answer;
    setPicked(i);
    const ns = score + (ok ? 1 : 0), na = answered + 1;
    setScore(ns); setAnswered(na);
    tally.current = { score: ns, answered: na };
    setTimeout(() => {
      setPicked(null);
      if (k + 1 >= d.questions.length) finish(); else setK(k + 1);
    }, ok ? 400 : 1100);
  }
  const secs = Math.ceil(left / 1000);
  const q = d.questions[k];
  return (
    <div class="card">
      <div class="row between">
        <h2>{t.sprint}</h2>
        <span class="timer" role="timer" aria-live="off" aria-label={`${t.timeLeft}: ${secs}`}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      <p class="hint">{d.from_practiced ? t.fromPracticed : t.fromLevel}</p>
      {phase === 'ready' && <button class="btn warm" onClick={run}>{t.play}</button>}
      {(phase === 'running' || phase === 'paused') && (
        <>
          <p class="muted small" aria-live="polite">{score} נכונות מתוך {answered}</p>
          {phase === 'paused' ? <div class="alert info">{t.pause} — {t.resumeGame}?</div> : (
            <>
              <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{q.he}</p>
              <div class="options">
                {q.options.map((o, i) => (
                  <button key={i} class={'option' + (picked !== null && i === q.answer ? ' right' : '')} onClick={() => choose(i)} disabled={picked !== null}>
                    <bdi class="tl" lang={lang.id} dir={lang.dir}>{o}</bdi>
                    {picked === i && <span>{i === q.answer ? ' ✓' : ' ✗'}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          <div class="row" style={{ marginTop: 12 }}>
            {phase === 'running' ? <button class="btn ghost" onClick={pause}>{t.pause}</button> : <button class="btn primary" onClick={run}>{t.resumeGame}</button>}
            <button class="btn ghost" onClick={reset}>{t.reset}</button>
          </div>
        </>
      )}
      {phase === 'over' && (
        <div class="complete" role="status">
          <h3>{t.gameOver}</h3>
          <p>{score} נכונות מתוך {answered}.</p>
          {result && <p>{result.new_best ? t.newBest + ' ' : ''}{t.personalBest(result.personal_best)}{result.xp_gained ? ` · ${t.xpGained(result.xp_gained)}` : ''}</p>}
          <div class="row"><button class="btn primary" onClick={again}>{t.playAgain}</button><button class="btn ghost" onClick={onBack}>{t.back}</button></div>
        </div>
      )}
      {phase !== 'over' && <button class="link-btn" style={{ marginTop: 12 }} onClick={() => { stopTick(); onBack(); }}>{t.back}</button>}
    </div>
  );
}

export function Settings({ me, setPrefs, level }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useTitle(t.settings);
  async function save(p) {
    setBusy(true); setMsg('');
    try {
      const r = await api('/api/learn/prefs', { method: 'PATCH', body: p });
      setPrefs(r.prefs); setMsg(t.prefsSaved);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  const g = me.prefs.gamification;
  return (
    <div class="stack" style={{ maxWidth: 760 }}>
      <h1>{t.settings}</h1>
      <div class="card">
        <h2>{t.modeTitle}</h2>
        <fieldset>
          <legend class="sr-only">{t.modeTitle}</legend>
          <label class="check" style={{ marginBottom: 12 }}>
            <input type="radio" name="mode" checked={!g} disabled={busy} onChange={() => save({ gamification: false })} />
            <span><b>{t.practiceMode}</b><br /><span class="muted">{t.practiceModeLead}</span></span>
          </label>
          <label class="check">
            <input type="radio" name="mode" checked={g} disabled={busy} onChange={() => save({ gamification: true })} />
            <span><b>{t.challengeMode}</b><br /><span class="muted">{t.challengeModeLead}</span></span>
          </label>
        </fieldset>
        {g && level && !level.challenge_enabled && <div class="alert info">{t.challengeOff}</div>}
        {g && (
          <div class="field">
            <label for="goal">{t.weeklyGoal}</label>
            <select id="goal" value={me.prefs.weekly_goal} disabled={busy} onChange={e => save({ weekly_goal: Number(e.target.value) })} style={{ maxWidth: 160 }}>
              {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        {msg && <p role="status" class="small">{msg}</p>}
        <p class="hint">{t.xpNote}</p>
      </div>
    </div>
  );
}
