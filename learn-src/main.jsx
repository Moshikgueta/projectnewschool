import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { t } from './i18n.js';
import { api } from './api.js';
import { useRoute, go, Footer, Loading, ErrorBox, Restricted, ensureFont } from './ui.jsx';
import { Dashboard, PastCourses } from './student/Dashboard.jsx';
import { Topics } from './student/Topics.jsx';
import { TopicPage, Recap } from './student/Topic.jsx';
import { PlayerPage } from './student/Player.jsx';
import { Review, ReviewSession } from './student/Review.jsx';
import { Saved, Glossary } from './student/Saved.jsx';
import { Progress } from './student/Progress.jsx';
import { Games, Settings } from './student/Games.jsx';
import { ManageApp } from './manage/Manage.jsx';

const LOGO = 'assets/new-school-logo.jpeg';

function Login({ config, onIn }) {
  const [tab, setTab] = useState('student');
  const [code, setCode] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = tab === 'student'
        ? await api('/api/staff/auth/code', { method: 'POST', body: { code } })
        : await api('/api/staff/auth/login', { method: 'POST', body: { user, pass } });
      onIn(r.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div class="login-wrap">
      {config.demo && <div class="demo-banner" role="note">{t.demoBanner}</div>}
      <div class="login">
        <div class="login-hero">
          <img src={LOGO} alt="New School" width="96" height="96" />
          <h1>{t.loginTitle}</h1>
          <p class="lead">{t.loginLead}</p>
          <p class="tl-line" lang="es">{t.loginTarget}</p>
        </div>
        <div class="card">
          <div class="tabs" role="tablist" aria-label="סוג כניסה">
            <button role="tab" aria-selected={tab === 'student'} onClick={() => { setTab('student'); setErr(''); }}>{t.tabStudent}</button>
            <button role="tab" aria-selected={tab === 'staff'} onClick={() => { setTab('staff'); setErr(''); }}>{t.tabStaff}</button>
          </div>
          <form onSubmit={submit} noValidate>
            {tab === 'student' ? (
              <div class="field">
                <label for="code">{t.codeLabel}</label>
                <input id="code" class="code-input" type="text" autoComplete="one-time-code" inputMode="text" autoCapitalize="characters"
                  spellcheck={false} value={code} onInput={e => setCode(e.target.value)} maxLength={14} dir="ltr" />
                <span class="hint">{config.codeLogin ? t.codeHint : t.codeOff}</span>
              </div>
            ) : (
              <>
                <div class="field">
                  <label for="user">{t.userLabel}</label>
                  <input id="user" type="text" autoComplete="username" dir="ltr" value={user} onInput={e => setUser(e.target.value)} />
                </div>
                <div class="field">
                  <label for="pass">{t.passLabel}</label>
                  <input id="pass" type="password" autoComplete="current-password" dir="ltr" value={pass} onInput={e => setPass(e.target.value)} />
                  <span class="hint">{t.staffHint}</span>
                </div>
              </>
            )}
            {err && <div class="alert error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
            <button class="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? t.loading : t.enter}</button>
          </form>
        </div>
      </div>
      <Footer year={config.year} />
    </div>
  );
}

const NAV = [
  ['', 'navHome'], ['topics', 'navTopics'], ['review', 'navReview'], ['saved', 'navSaved'],
  ['glossary', 'navGlossary'], ['progress', 'navProgress']
];

function StudentShell({ me, config, route, children, levelId, onLevel, onOut }) {
  const game = me.prefs.gamification;
  const cur = me.enrollments.find(e => e.id === levelId);
  const nav = NAV.concat(game && cur && cur.challenge_enabled ? [['games', 'navGames']] : []);
  const section = route.parts[0] === 'l' ? (route.parts[2] || '') : route.parts[0] === 't' ? 'topics' : route.parts[0] || '';
  return (
    <>
      <a class="skip" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main').focus(); }}>{t.skip}</a>
      {config.demo && <div class="demo-banner" role="note">{t.demoBanner}</div>}
      <header class="top">
        <div class="top-in">
          <a class="brand" href="#/" aria-label="New School Cycles — הלוח שלי">
            <img src={LOGO} alt="" width="44" height="44" />
            <span class="brand-name"><b lang="en">NEW SCHOOL CYCLES</b><span>{t.tagline}</span></span>
          </a>
          <span class="top-spacer" />
          {me.enrollments.length > 1 && (
            <label class="course-switch">
              <span class="sr-only">{t.course}</span>
              <select value={levelId} onChange={e => onLevel(e.target.value)}>
                {me.enrollments.map(e => <option key={e.id} value={e.id}>{e.name_he}{e.cefr ? ` · ${e.cefr}` : ''}</option>)}
              </select>
            </label>
          )}
          <div class="user-chip">
            <span class="name">{me.user.name}</span>
            <a class="btn ghost small" href="#/settings">{t.settings}</a>
            <button class="btn ghost small" onClick={onOut}>{t.signOut}</button>
          </div>
        </div>
        {levelId && (
          <nav class="nav" aria-label="ניווט ראשי">
            {nav.map(([k, label]) => (
              <a key={k} href={`#/l/${levelId}${k ? '/' + k : ''}`} aria-current={section === k ? 'page' : undefined}>{t[label]}</a>
            ))}
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <Footer year={config.year} />
    </>
  );
}

function StudentApp({ config, onOut }) {
  const route = useRoute();
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('/api/learn/me').then(setMe).catch(setErr);
  useEffect(() => { load(); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);
  if (err) return <main id="main"><ErrorBox error={err} onRetry={load} /></main>;
  if (!me) return <main id="main"><Loading /></main>;

  const ids = me.enrollments.map(e => e.id);
  const p = route.parts;
  let levelId = p[0] === 'l' ? p[1] : null;
  const pref = me.prefs.current_level && ids.includes(me.prefs.current_level) ? me.prefs.current_level : ids[0];
  /* The last level the student looked at — only ever one they are enrolled
     in, so a stray link to another level cannot stick to the dashboard. */
  const remembered = ids.includes(window.__nsLevel) ? window.__nsLevel : pref;
  const setLast = v => { if (ids.includes(v)) window.__nsLevel = v; };
  if (!levelId) levelId = remembered;
  else setLast(levelId);
  const lvl = me.enrollments.find(e => e.id === levelId);
  if (lvl) ensureFont(lvl.language);

  const setPrefs = prefs => setMe({ ...me, prefs: { ...me.prefs, ...prefs } });
  const onLevel = id => {
    setLast(id);
    api('/api/learn/prefs', { method: 'PATCH', body: { current_level: id } }).catch(() => {});
    go(`/l/${id}`);
  };

  let page;
  const inLevel = p[0] === 'l';
  if (!ids.length && !['settings'].includes(p[0])) {
    page = (
      <div class="card"><h1>{t.hello(me.user.name)}</h1><p class="lead">{t.noCourses}</p>
        {me.past.length > 0 && <PastCourses past={me.past} />}</div>
    );
  } else if (inLevel && !ids.includes(p[1])) {
    page = <Restricted />;
  } else if (p[0] === 'settings') {
    page = <Settings me={me} setPrefs={setPrefs} level={lvl} />;
  } else if (p[0] === 't' && p[2] === 'a') {
    page = <PlayerPage topicId={p[1]} exId={p[3]} me={me} />;
  } else if (p[0] === 't' && p[2] === 'recap') {
    page = <Recap topicId={p[1]} />;
  } else if (p[0] === 't') {
    page = <TopicPage topicId={p[1]} me={me} />;
  } else {
    const sub = inLevel ? p[2] || '' : '';
    const props = { levelId, me, level: lvl, route };
    page = sub === 'topics' ? <Topics {...props} />
      : sub === 'review' && p[3] === 'session' ? <ReviewSession {...props} />
      : sub === 'review' ? <Review {...props} />
      : sub === 'saved' ? <Saved {...props} />
      : sub === 'glossary' ? <Glossary {...props} />
      : sub === 'progress' ? <Progress {...props} />
      : sub === 'games' ? <Games {...props} setPrefs={setPrefs} />
      : <Dashboard {...props} onLevel={onLevel} />;
  }
  return <StudentShell me={me} config={config} route={route} levelId={ids.length ? levelId : null} onLevel={onLevel} onOut={onOut}>{page}</StudentShell>;
}

function App() {
  const [config, setConfig] = useState(null);
  const [who, setWho] = useState(undefined);   // undefined = checking, null = signed out
  const [err, setErr] = useState(null);
  const boot = () => {
    setErr(null);
    Promise.all([api('/api/learn/config'), api('/api/staff/auth/me')])
      .then(([c, me]) => { setConfig(c); setWho(me.ok ? me.user : null); })
      .catch(setErr);
  };
  useEffect(() => {
    boot();
    const lost = () => setWho(null);
    addEventListener('ns-auth-lost', lost);
    return () => removeEventListener('ns-auth-lost', lost);
  }, []);
  const out = async () => {
    try { await api('/api/staff/auth/logout', { method: 'POST' }); } catch { }
    window.__nsLevel = null;
    setWho(null); go('/');
  };
  if (err) return <main id="main" style={{ padding: 24 }}><ErrorBox error={err} onRetry={boot} /></main>;
  if (!config || who === undefined) return <div class="boot" role="status">{t.loading}</div>;
  if (!who) return <Login config={config} onIn={u => { setWho(u); go(u.role === 'תלמיד' ? '/' : '/m'); }} />;
  if (who.role === 'תלמיד') return <StudentApp config={config} onOut={out} />;
  return <ManageApp config={config} who={who} onOut={out} logo={LOGO} />;
}

render(<App />, document.getElementById('app'));
