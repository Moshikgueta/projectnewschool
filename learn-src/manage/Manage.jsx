import { useState, useEffect } from 'preact/hooks';
import { t, pct, dateHe } from '../i18n.js';
import { api } from '../api.js';
import { useApi, useRoute, View, Loading, ErrorBox, Footer, Modal, Status, Crumbs, useTitle, go, ensureFont } from '../ui.jsx';
import { TopicView } from '../student/Topic.jsx';
import { Activity } from '../student/Player.jsx';
import { ExerciseEditor } from './ExerciseEditor.jsx';

const STATUS_HE = { draft: 'טיוטה', published: 'מפורסם' };
function Pub({ s }) { return <span class={'pill ' + (s === 'published' ? 'good' : 'warm')}>{STATUS_HE[s] || s}</span>; }

export function ManageApp({ config, who, onOut, logo }) {
  const route = useRoute();
  const me = useApi('/api/manage/me', []);
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);
  if (me.error) return <main id="main"><ErrorBox error={me.error} onRetry={me.reload} /></main>;
  if (!me.data) return <main id="main"><Loading /></main>;
  const P = me.data.perms;
  const p = route.parts.slice(1);             // after 'm'
  let page;
  if (route.parts[0] !== 'm') page = <Courses P={P} me={me.data} />;
  else if (p[0] === 'level') page = <LevelPage id={p[1]} tab={p[2] || 'topics'} P={P} />;
  else if (p[0] === 'topic') page = <TopicEditor id={p[1]} P={P} />;
  else if (p[0] === 'preview' && p[2] === 'a') page = <PreviewActivity topicId={p[1]} exId={p[3]} />;
  else if (p[0] === 'preview') page = <Preview topicId={p[1]} />;
  else if (p[0] === 'students' && p[1]) page = <StudentReport id={p[1]} />;
  else if (p[0] === 'students') page = <Students P={P} />;
  else if (p[0] === 'teachers' && P['teachers.assign']) page = <Teachers />;
  else page = <Courses P={P} me={me.data} />;
  const sec = route.parts[1] || '';
  const nav = [['', 'קורסים ותוכן'], ['students', 'תלמידים והרשמה']].concat(P['teachers.assign'] ? [['teachers', 'מורים ורמות']] : []);
  return (
    <>
      {config.demo && <div class="demo-banner" role="note">{t.demoBanner}</div>}
      <header class="top">
        <div class="top-in">
          <a class="brand" href="#/m"><img src={logo} alt="" width="44" height="44" /><span class="brand-name"><b lang="en">NEW SCHOOL CYCLES</b><span>אזור הצוות</span></span></a>
          <span class="top-spacer" />
          <div class="user-chip">
            <span class="name">{me.data.user.name} · {me.data.user.role}</span>
            <a class="btn ghost small" href="/dashboard">חדר המורים</a>
            <button class="btn ghost small" onClick={onOut}>{t.signOut}</button>
          </div>
        </div>
        <nav class="nav" aria-label="ניווט ניהול">
          {nav.map(([k, l]) => <a key={k} href={`#/m${k ? '/' + k : ''}`} aria-current={(sec === k || (k === '' && ['level', 'topic', 'preview'].includes(sec))) ? 'page' : undefined}>{l}</a>)}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {me.data.user.mustChange && <div class="alert warn" style={{ marginBottom: 14 }}>{t.mustChange}</div>}
        {page}
      </main>
      <Footer year={config.year} />
    </>
  );
}

/* ── courses ─────────────────────────────────────────────────────────── */

function Courses({ P, me }) {
  const q = useApi('/api/manage/courses', []);
  const [newLevel, setNewLevel] = useState(null);
  const [langEdit, setLangEdit] = useState(null);
  const [msg, setMsg] = useState('');
  useTitle('ניהול קורסים');
  async function setLangStatus(l, status) {
    setMsg('');
    try { await api(`/api/manage/languages/${l.id}`, { method: 'PATCH', body: { status } }); q.reload(); }
    catch (e) { setMsg(e.message); }
  }
  return (
    <View q={q}>{d => (
      <div class="stack">
        <div>
          <h1>קורסים ותוכן</h1>
          <p class="lead">כל שפה נבנית מאותם רכיבים: רמות, קבוצות נושאים, נושאים ופעילויות. שפה או רמה בטיוטה לא נראות לתלמידים בשום דרך — לא בתפריט, לא בקישור ולא ב־API.</p>
          {me.teacher_levels && P['content.edit'] && !P['course.structure'] && <p class="hint">כמורה/ה אתם רואים את הרמות שהוקצו לכם. פרסום נעשה על ידי המנהל הפדגוגי.</p>}
        </div>
        {msg && <div class="alert error" role="alert">{msg}</div>}
        <div class="lang-grid">
          {d.languages.map(l => (
            <div class="card lang-card" key={l.id}>
              <h3><span>{l.name_he} <bdi class="tl muted" lang={l.id} dir={l.dir}>{l.name_native}</bdi></span><Pub s={l.status} /></h3>
              <p class="small muted">כיוון תוכן: {l.dir === 'rtl' ? 'מימין לשמאל' : 'משמאל לימין'} · {l.levels.length} רמות</p>
              {l.levels.map(lv => (
                <div class="level-row" key={lv.id}>
                  <a href={`#/m/level/${lv.id}`}><b>{lv.name_he}</b>{lv.cefr ? ` · ${lv.cefr}` : ''}</a>
                  <span class="row" style={{ gap: 6 }}>
                    <Pub s={lv.status} />
                    <span class="small muted">{lv.topics.published} מפורסמים · {lv.topics.draft} בטיוטה · {lv.enrolled} רשומים</span>
                  </span>
                </div>
              ))}
              {!l.levels.length && <p class="muted small">אין עדיין רמות. {P['course.structure'] ? 'צרו רמה ראשונה כדי להתחיל.' : ''}</p>}
              <div class="row" style={{ marginTop: 10 }}>
                {P['course.structure'] && <button class="btn secondary small" onClick={() => setNewLevel(l)}>רמה חדשה</button>}
                {P['course.structure'] && <button class="btn ghost small" onClick={() => setLangEdit(l)}>הגדרות שפה</button>}
                {P['content.publish'] && (l.status === 'draft'
                  ? <button class="btn primary small" onClick={() => setLangStatus(l, 'published')}>פרסום השפה</button>
                  : <button class="btn danger small" onClick={() => setLangStatus(l, 'draft')}>החזרה לטיוטה</button>)}
              </div>
            </div>
          ))}
        </div>
        {newLevel && <NewLevel lang={newLevel} onClose={() => setNewLevel(null)} onDone={id => { setNewLevel(null); go(`/m/level/${id}`); }} />}
        {langEdit && <LangSettings lang={langEdit} onClose={() => setLangEdit(null)} onDone={() => { setLangEdit(null); q.reload(); }} />}
      </div>
    )}</View>
  );
}

function NewLevel({ lang, onClose, onDone }) {
  const next = (lang.levels.reduce((m, l) => Math.max(m, l.number), 0) || 0) + 1;
  const [f, setF] = useState({ number: next, name_he: `${lang.name_he} רמה ${next}`, name_target: '', cefr: '', description: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/api/manage/levels', { method: 'POST', body: { ...f, language_id: lang.id, number: Number(f.number) } }); onDone(r.id); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={`רמה חדשה · ${lang.name_he}`} onClose={onClose}>
      <form onSubmit={save}>
        <p class="hint">מספר הרמה קובע את ההרשמה (למשל „{lang.name_he} רמה 1“). כל שפה יכולה להגדיר מספר רמות ותוכנית משלה. הרמה נוצרת כטיוטה.</p>
        <div class="editor-row">
          <div class="field"><label for="ln">מספר רמה</label><input id="ln" type="number" min="1" max="20" value={f.number} onInput={e => setF({ ...f, number: e.target.value })} /></div>
          <div class="field"><label for="lc">CEFR (רשות)</label><input id="lc" type="text" value={f.cefr} onInput={e => setF({ ...f, cefr: e.target.value })} dir="ltr" /></div>
        </div>
        <div class="field"><label for="lh">שם בעברית</label><input id="lh" type="text" value={f.name_he} onInput={e => setF({ ...f, name_he: e.target.value })} /></div>
        <div class="field"><label for="lt">שם בשפת היעד</label><input id="lt" type="text" lang={lang.id} dir={lang.dir} value={f.name_target} onInput={e => setF({ ...f, name_target: e.target.value })} /></div>
        <div class="field"><label for="ld">תיאור קצר</label><textarea id="ld" rows={3} value={f.description} onInput={e => setF({ ...f, description: e.target.value })} /></div>
        {err && <div class="alert error" role="alert">{err}</div>}
        <button class="btn primary" disabled={busy}>{t.save}</button>
      </form>
    </Modal>
  );
}

function LangSettings({ lang, onClose, onDone }) {
  const [f, setF] = useState({
    name_he: lang.name_he, name_native: lang.name_native, dir: lang.dir, font_stack: lang.font_stack,
    chars: lang.special_chars.join(' '), accents: lang.normalize.accents || 'strict', harakat: lang.normalize.harakat || 'ignore',
    alef: lang.normalize.alef || 'strict', eszett: lang.normalize.eszett || 'strict', kase: lang.normalize.case || 'ignore',
    stop: (lang.normalize.stopwords || []).join(' ')
  });
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    const normalize = { accents: f.accents, case: f.kase, stopwords: f.stop.split(/\s+/).filter(Boolean) };
    if (lang.id === 'ar') Object.assign(normalize, { harakat: f.harakat, tatweel: 'ignore', alef: f.alef });
    if (lang.id === 'de') normalize.eszett = f.eszett;
    try {
      await api(`/api/manage/languages/${lang.id}`, { method: 'PATCH', body: {
        name_he: f.name_he, name_native: f.name_native, dir: f.dir, font_stack: f.font_stack,
        special_chars: f.chars.split(/\s+/).filter(Boolean), normalize
      } });
      onDone();
    } catch (x) { setErr(x.message); }
  }
  const sel = (k, opts) => <select value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  return (
    <Modal title={`הגדרות שפה · ${lang.name_he}`} onClose={onClose}>
      <form onSubmit={save}>
        <div class="editor-row">
          <div class="field"><label>שם בעברית</label><input type="text" value={f.name_he} onInput={e => setF({ ...f, name_he: e.target.value })} /></div>
          <div class="field"><label>שם בשפה</label><input type="text" value={f.name_native} lang={lang.id} dir={f.dir} onInput={e => setF({ ...f, name_native: e.target.value })} /></div>
        </div>
        <div class="editor-row">
          <div class="field"><label>כיוון תוכן הלימוד</label>{sel('dir', [['ltr', 'משמאל לימין (LTR)'], ['rtl', 'מימין לשמאל (RTL)']])}</div>
          <div class="field"><label>גופן לתוכן</label><input type="text" dir="ltr" value={f.font_stack} onInput={e => setF({ ...f, font_stack: e.target.value })} /></div>
        </div>
        <div class="field"><label>תווים מיוחדים במקלדת שעל המסך (מופרדים ברווח)</label><input type="text" dir={f.dir} value={f.chars} onInput={e => setF({ ...f, chars: e.target.value })} /></div>
        <fieldset>
          <legend>בדיקת תשובות — ברירת מחדל לשפה</legend>
          <p class="hint">רווחים, סימני פיסוק ואותיות רישיות אינם נבדקים. אפשר לשנות כל הגדרה ברמת הפעילות או הסעיף. אל תבטלו הבחנה שהתלמידים אמורים ללמוד.</p>
          <div class="editor-row">
            <div class="field"><label>סימני הטעמה / ניקוד לטיני</label>{sel('accents', [['strict', 'מחייב — הבדל בהטעמה = טעות, עם משוב'], ['lenient', 'מקל — מתקבל עם הערה']])}</div>
            <div class="field"><label>אותיות רישיות</label>{sel('kase', [['ignore', 'לא נבדקות'], ['strict', 'נבדקות (למשל שמות עצם בגרמנית)']])}</div>
          </div>
          {lang.id === 'ar' && <div class="editor-row">
            <div class="field"><label>חרכאת (תנועות)</label>{sel('harakat', [['ignore', 'לא נבדקות'], ['strict', 'נבדקות']])}</div>
            <div class="field"><label>אליף עם המזה</label>{sel('alef', [['strict', 'מבחינים (أ ≠ ا)'], ['lenient', 'לא מבחינים']])}</div>
          </div>}
          {lang.id === 'de' && <div class="field"><label>ß / ss</label>{sel('eszett', [['strict', 'מבחינים'], ['lenient', 'ss מתקבל במקום ß']])}</div>}
          <div class="field"><label>מילות תפקיד (לבדיקת תוכן בשאלות הבנה, מופרדות ברווח)</label><input type="text" dir={f.dir} value={f.stop} onInput={e => setF({ ...f, stop: e.target.value })} /></div>
        </fieldset>
        {err && <div class="alert error" role="alert">{err}</div>}
        <button class="btn primary">{t.save}</button>
      </form>
    </Modal>
  );
}

/* ── level workspace ─────────────────────────────────────────────────── */

function LevelPage({ id, tab, P }) {
  const q = useApi(`/api/manage/levels/${id}`, [id]);
  const [msg, setMsg] = useState('');
  useTitle('רמה');
  async function patch(body) {
    setMsg('');
    try { await api(`/api/manage/levels/${id}`, { method: 'PATCH', body }); q.reload(); } catch (e) { setMsg(e.message); }
  }
  return (
    <View q={q}>{d => {
      const L = d.level;
      ensureFont(L.lang.id);
      const tabs = [['topics', 'נושאים ותוכן'], ['report', 'התקדמות התלמידים'], ['assign', 'הצעות תרגול'], ['flags', 'תשובות חלופיות']];
      return (
        <div class="stack">
          <Crumbs items={[{ href: '#/m', label: 'קורסים' }, { label: `${L.lang.name_he} · ${L.name_he}` }]} />
          <div class="row between">
            <div>
              <h1 style={{ marginBottom: 4 }}>{L.name_he} {L.cefr && <span class="pill gray">{L.cefr}</span>}</h1>
              <div class="row"><span>רמה: <Pub s={L.status} /></span><span>שפה: <Pub s={L.lang_status} /></span></div>
            </div>
            <div class="row">
              {P['content.publish'] && (L.status === 'draft'
                ? <button class="btn primary" onClick={() => patch({ status: 'published' })}>פרסום הרמה</button>
                : <button class="btn danger" onClick={() => patch({ status: 'draft' })}>החזרה לטיוטה</button>)}
              {P['content.publish'] && (
                <label class="check"><input type="checkbox" checked={L.challenge_enabled} onChange={e => patch({ challenge_enabled: e.target.checked })} /><span>מצב אתגר זמין לתלמידי הרמה</span></label>
              )}
            </div>
          </div>
          {L.status === 'published' && L.lang_status !== 'published' && <div class="alert warn">הרמה מפורסמת אבל השפה עדיין בטיוטה — תלמידים לא יראו אותה עד שהשפה תפורסם.</div>}
          {msg && <div class="alert error" role="alert">{msg}</div>}
          <nav class="tabs" role="tablist" aria-label="לשוניות רמה" style={{ maxWidth: 720 }}>
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(`/m/level/${id}/${k}`)}>{l}</button>)}
          </nav>
          {tab === 'topics' && <LevelTopics d={d} P={P} reload={q.reload} />}
          {tab === 'report' && <LevelReport id={id} />}
          {tab === 'assign' && <Assignments id={id} topics={d.topics} />}
          {tab === 'flags' && <Flags id={id} />}
        </div>
      );
    }}</View>
  );
}

function LevelTopics({ d, P, reload }) {
  const [newCycle, setNewCycle] = useState('');
  const [newTopic, setNewTopic] = useState(null);
  const [err, setErr] = useState('');
  const L = d.level;
  async function addCycle(e) {
    e.preventDefault(); setErr('');
    try { await api(`/api/manage/levels/${L.id}/cycles`, { method: 'POST', body: { title_he: newCycle } }); setNewCycle(''); reload(); } catch (x) { setErr(x.message); }
  }
  async function renameCycle(c) {
    const name = prompt('שם חדש לקבוצת הנושאים', c.title_he);
    if (!name) return;
    try { await api(`/api/manage/cycles/${c.id}`, { method: 'PATCH', body: { title_he: name } }); reload(); } catch (x) { setErr(x.message); }
  }
  async function delCycle(c) {
    if (!confirm(`למחוק את הקבוצה „${c.title_he}“? הנושאים שבה יישארו, בלי קבוצה.`)) return;
    try { await api(`/api/manage/cycles/${c.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr(x.message); }
  }
  const groups = d.cycles.map(c => ({ c, topics: d.topics.filter(x => x.cycle_id === c.id) }));
  const rest = d.topics.filter(x => !d.cycles.some(c => c.id === x.cycle_id));
  return (
    <div class="stack">
      <p class="muted">נושאים מוצגים לתלמידים לפי קבוצה ובסדר אלפביתי, בלי מספור ובלי רצף מחייב. כל נושא מפורסם ברמה פתוח לכל תלמיד רשום.</p>
      {err && <div class="alert error" role="alert">{err}</div>}
      <div class="row">
        {P['content.edit'] && <button class="btn primary" onClick={() => setNewTopic({})}>נושא חדש</button>}
        {P['content.edit'] && (
          <form class="row" onSubmit={addCycle}>
            <label class="sr-only" for="nc">קבוצת נושאים חדשה</label>
            <input id="nc" type="text" placeholder="קבוצת נושאים חדשה (למשל: בעיר)" value={newCycle} onInput={e => setNewCycle(e.target.value)} style={{ width: 260 }} />
            <button class="btn secondary" disabled={!newCycle.trim()}>הוספה</button>
          </form>
        )}
      </div>
      {groups.concat(rest.length ? [{ c: null, topics: rest }] : []).map(({ c, topics }) => (
        <div class="card" key={c ? c.id : '_'}>
          <div class="row between">
            <h2 style={{ margin: 0 }}>{c ? c.title_he : 'ללא קבוצה'} {c && c.title_target && <bdi class="tl muted" lang={L.lang.id} dir={L.lang.dir} style={{ fontWeight: 400, fontSize: '1rem' }}>{c.title_target}</bdi>}</h2>
            {c && P['content.edit'] && <span class="row"><button class="btn ghost small" onClick={() => renameCycle(c)}>שינוי שם</button><button class="btn danger small" onClick={() => delCycle(c)}>{t.delete}</button></span>}
          </div>
          {c && c.description && <p class="hint">{c.description}</p>}
          <div class="table-wrap" style={{ marginTop: 10 }}>
            <table class="data">
              <thead><tr><th>נושא</th><th>סטטוס</th><th>פעילויות</th><th>מקור</th><th></th></tr></thead>
              <tbody>
                {topics.map(x => (
                  <tr key={x.id}>
                    <td><b>{x.title_he}</b><br /><bdi class="tl small muted" lang={L.lang.id} dir={L.lang.dir}>{x.title_target}</bdi></td>
                    <td><Pub s={x.status} /></td>
                    <td class="small">{x.exercises.published} פעילות · {x.exercises.self} פתוחות{x.exercises.draft ? ` · ${x.exercises.draft} מוסתרות` : ''}</td>
                    <td class="small muted">{x.source_ref || 'נוצר בממשק'}{x.objective_source === 'derived' ? ' · מטרה נוסחה אוטומטית' : ''}</td>
                    <td class="row" style={{ gap: 6 }}>
                      <a class="btn ghost small" href={`#/m/topic/${x.id}`}>{t.edit}</a>
                      <a class="btn ghost small" href={`#/m/preview/${x.id}`}>תצוגה מקדימה</a>
                    </td>
                  </tr>
                ))}
                {!topics.length && <tr><td colSpan={5} class="muted">אין נושאים בקבוצה.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {newTopic && <NewTopic level={L} cycles={d.cycles} onClose={() => setNewTopic(null)} onDone={id => go(`/m/topic/${id}`)} />}
    </div>
  );
}

function NewTopic({ level, cycles, onClose, onDone }) {
  const [f, setF] = useState({ title_he: '', title_target: '', cycle_id: cycles[0] ? cycles[0].id : '', objective: '' });
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    try { const r = await api(`/api/manage/levels/${level.id}/topics`, { method: 'POST', body: f }); onDone(r.id); } catch (x) { setErr(x.message); }
  }
  return (
    <Modal title="נושא חדש" onClose={onClose}>
      <form onSubmit={save}>
        <p class="hint">שם שמתאר את הנושא, לא מספר שיעור. למשל: „במסעדה“, „מכירים אנשים חדשים“.</p>
        <div class="field"><label for="th">כותרת בעברית</label><input id="th" type="text" required value={f.title_he} onInput={e => setF({ ...f, title_he: e.target.value })} /></div>
        <div class="field"><label for="tt">כותרת בשפת היעד</label><input id="tt" type="text" lang={level.lang.id} dir={level.lang.dir} value={f.title_target} onInput={e => setF({ ...f, title_target: e.target.value })} /></div>
        <div class="field"><label for="tc">קבוצת נושאים</label>
          <select id="tc" value={f.cycle_id} onChange={e => setF({ ...f, cycle_id: e.target.value })}>
            <option value="">ללא קבוצה</option>{cycles.map(c => <option key={c.id} value={c.id}>{c.title_he}</option>)}
          </select></div>
        <div class="field"><label for="to">מטרה תקשורתית</label><textarea id="to" rows={2} value={f.objective} onInput={e => setF({ ...f, objective: e.target.value })} /></div>
        {err && <div class="alert error" role="alert">{err}</div>}
        <button class="btn primary">יצירה כטיוטה</button>
      </form>
    </Modal>
  );
}

/* ── topic editor ────────────────────────────────────────────────────── */

const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

function TopicEditor({ id, P }) {
  const q = useApi(`/api/manage/topics/${id}`, [id]);
  const lvl = useApi(q.data ? `/api/manage/levels/${q.data.topic.level_id}` : null, [q.data && q.data.topic.level_id]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  useTitle('עריכת נושא');
  return (
    <View q={q}>{d => {
      if (!lvl.data) return <Loading />;
      const L = lvl.data.level;
      return (
        <div class="stack">
          <Crumbs items={[{ href: '#/m', label: 'קורסים' }, { href: `#/m/level/${L.id}`, label: L.name_he }, { label: d.topic.title_he }]} />
          <TopicForm key={d.topic.id + (d.topic.updated || '')} topic={d.topic} level={L} cycles={lvl.data.cycles} P={P} onSaved={m => { setMsg(m); q.reload(); }} />
          {msg && <div class="alert good" role="status">{msg}</div>}
          <div class="card">
            <div class="row between">
              <h2 style={{ margin: 0 }}>פעילויות ({d.exercises.length})</h2>
              <div class="row">
                <a class="btn ghost" href={`#/m/preview/${id}`}>תצוגה מקדימה כתלמיד</a>
                {P['content.edit'] && <button class="btn primary" onClick={() => setEdit({})}>פעילות חדשה</button>}
              </div>
            </div>
            <div class="table-wrap" style={{ marginTop: 12 }}>
              <table class="data">
                <thead><tr><th>פעילות</th><th>סוג</th><th>מיומנות</th><th>מצב</th><th></th></tr></thead>
                <tbody>
                  {d.exercises.map(e => (
                    <tr key={e.id}>
                      <td><b>{e.title}</b>{e.source_ref && <div class="small muted" dir="ltr">{e.source_ref}</div>}</td>
                      <td class="small">{t.kind[e.kind] || e.kind}{e.body.items ? ` · ${e.body.items.length}` : ''}</td>
                      <td class="small">{t.skill[e.skill] || e.skill}</td>
                      <td>{e.status === 'published' ? <span class="pill good">מוצג</span> : <span class="pill warm">מוסתר</span>}</td>
                      <td class="row" style={{ gap: 6 }}>
                        {P['content.edit'] && <button class="btn ghost small" onClick={() => setEdit(e)}>{t.edit}</button>}
                        <a class="btn ghost small" href={`#/m/preview/${id}/a/${e.id}`}>תצוגה</a>
                        {P['content.edit'] && <ExStatus e={e} reload={q.reload} setMsg={setMsg} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {edit && <ExerciseEditor ex={edit.id ? edit : null} topicId={id} level={L} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); setMsg('הפעילות נשמרה.'); }} />}
        </div>
      );
    }}</View>
  );
}

function ExStatus({ e, reload, setMsg }) {
  async function toggle() {
    try { await api(`/api/manage/exercises/${e.id}`, { method: 'PATCH', body: { status: e.status === 'published' ? 'draft' : 'published' } }); reload(); }
    catch (x) { setMsg(x.message); }
  }
  async function del() {
    if (!confirm(`למחוק את „${e.title}“?`)) return;
    try { await api(`/api/manage/exercises/${e.id}`, { method: 'DELETE' }); reload(); } catch (x) { setMsg(x.message); }
  }
  return <><button class="btn ghost small" onClick={toggle}>{e.status === 'published' ? 'הסתרה' : 'הצגה'}</button><button class="btn danger small" onClick={del}>{t.delete}</button></>;
}

function TopicForm({ topic, level, cycles, P, onSaved }) {
  const exp = topic.explanation || {};
  const [f, setF] = useState({
    title_he: topic.title_he, title_target: topic.title_target, cycle_id: topic.cycle_id || '', objective: topic.objective,
    skill1: (topic.skills[0] || {}).he || '', skill1t: (topic.skills[0] || {}).target || '',
    skill2: (topic.skills[1] || {}).he || '', skill2t: (topic.skills[1] || {}).target || '',
    grammar: topic.grammar.join('\n'), rules: (exp.rules || []).join('\n'), examples: (exp.examples || []).join('\n'),
    tips: (exp.tips || []).join('\n'), vocab: topic.vocab.map(v => `${v.term} = ${v.he}`).join('\n'),
    self_check: topic.self_check.join('\n'), links: topic.links.map(l => `${l.label} | ${l.url}`).join('\n')
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const lang = level.lang.id, dir = level.lang.dir;
  const inp = (k, props = {}) => <input type="text" value={f[k]} onInput={e => setF({ ...f, [k]: e.target.value })} {...props} />;
  const area = (k, props = {}) => <textarea value={f[k]} onInput={e => setF({ ...f, [k]: e.target.value })} rows={4} {...props} />;
  async function save(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = {
      title_he: f.title_he, title_target: f.title_target, cycle_id: f.cycle_id || null, objective: f.objective,
      skills: [{ he: f.skill1, target: f.skill1t }, { he: f.skill2, target: f.skill2t }].filter(s => s.he || s.target),
      grammar: lines(f.grammar),
      explanation: { ...exp, rules: lines(f.rules), examples: lines(f.examples), tips: lines(f.tips) },
      vocab: lines(f.vocab).map(l => { const [a, ...b] = l.split('='); return { term: a.trim(), he: b.join('=').trim() }; }).filter(v => v.term),
      self_check: lines(f.self_check),
      links: lines(f.links).map(l => { const [a, b] = l.split('|'); return { label: (a || '').trim(), url: (b || '').trim() }; })
    };
    try { await api(`/api/manage/topics/${topic.id}`, { method: 'PATCH', body }); onSaved('הנושא נשמר.'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function setStatus(s) {
    setErr('');
    try { await api(`/api/manage/topics/${topic.id}`, { method: 'PATCH', body: { status: s } }); onSaved(s === 'published' ? 'הנושא פורסם.' : 'הנושא הוחזר לטיוטה.'); }
    catch (x) { setErr(x.message); }
  }
  async function del() {
    if (!confirm('למחוק את הנושא? אפשרי רק לנושא בטיוטה שאף תלמיד לא תרגל.')) return;
    try { await api(`/api/manage/topics/${topic.id}`, { method: 'DELETE' }); go(`/m/level/${level.id}`); } catch (x) { setErr(x.message); }
  }
  return (
    <form class="card" onSubmit={save}>
      <div class="row between">
        <h1 style={{ margin: 0 }}>{topic.title_he}</h1>
        <div class="row">
          <Pub s={topic.status} />
          {P['content.publish'] && (topic.status === 'draft'
            ? <button type="button" class="btn primary small" onClick={() => setStatus('published')}>פרסום הנושא</button>
            : <button type="button" class="btn danger small" onClick={() => setStatus('draft')}>החזרה לטיוטה</button>)}
          {topic.status === 'draft' && P['content.edit'] && <button type="button" class="btn danger small" onClick={del}>{t.delete}</button>}
        </div>
      </div>
      {topic.objective_source === 'derived' && <div class="alert warn" style={{ margin: '10px 0' }}>המטרה התקשורתית נוסחה אוטומטית מכותרת הנושא ומהמוקד הדקדוקי שבחוברת. כדאי לבדוק ולנסח מחדש.</div>}
      <div class="editor-row" style={{ marginTop: 12 }}>
        <div class="field"><label>כותרת בעברית (בלי מספר)</label>{inp('title_he')}</div>
        <div class="field"><label>כותרת בשפת היעד</label>{inp('title_target', { lang, dir })}</div>
      </div>
      <div class="editor-row">
        <div class="field"><label>קבוצת נושאים</label>
          <select value={f.cycle_id} onChange={e => setF({ ...f, cycle_id: e.target.value })}><option value="">ללא קבוצה</option>{cycles.map(c => <option key={c.id} value={c.id}>{c.title_he}</option>)}</select></div>
        <div class="field"><label>מטרה תקשורתית</label>{inp('objective')}</div>
      </div>
      <fieldset><legend>שתי המיומנויות המרכזיות</legend>
        <div class="editor-row">{inp('skill1', { placeholder: 'מיומנות 1 בעברית' })}{inp('skill1t', { placeholder: 'בשפת היעד', lang, dir })}</div>
        <div class="editor-row" style={{ marginTop: 8 }}>{inp('skill2', { placeholder: 'מיומנות 2 בעברית' })}{inp('skill2t', { placeholder: 'בשפת היעד', lang, dir })}</div>
      </fieldset>
      <div class="editor-row">
        <div class="field"><label>מוקד דקדוקי (שורה לכל פריט)</label>{area('grammar', { rows: 2 })}</div>
        <div class="field"><label>הסבר קצר (שורה לכל כלל)</label>{area('rules')}<span class="hint">אפשר **הדגשה**. מילים בשפת היעד מזוהות ומוצגות בכיוון הנכון אוטומטית.</span></div>
      </div>
      <div class="editor-row">
        <div class="field"><label>דוגמאות (שורה לכל דוגמה)</label>{area('examples', { lang, dir })}</div>
        <div class="field"><label>טיפים</label>{area('tips', { rows: 2 })}</div>
      </div>
      <div class="field"><label>אוצר מילים — „מילה = פירוש“, שורה לכל ערך</label>{area('vocab', { rows: 6, dir: 'auto' })}<span class="hint">המילון של הרמה נבנה מאוצר המילים של הנושאים המפורסמים.</span></div>
      <div class="editor-row">
        <div class="field"><label>בדיקה עצמית (משפטים לרפלקציה)</label>{area('self_check', { rows: 3 })}</div>
        <div class="field"><label>קישורים חיצוניים — „תיאור | https://…“</label>{area('links', { rows: 3, dir: 'auto' })}</div>
      </div>
      {err && <div class="alert error" role="alert">{err}</div>}
      {P['content.edit'] && <button class="btn primary" disabled={busy}>{busy ? t.loading : 'שמירת הנושא'}</button>}
    </form>
  );
}

/* ── preview ─────────────────────────────────────────────────────────── */

function Preview({ topicId }) {
  const q = useApi(`/api/manage/preview/topics/${topicId}`, [topicId]);
  return (
    <View q={q}>{d => (
      <div>
        <div class="preview-banner" role="note">תצוגה מקדימה כתלמיד/ה · {d.level.name_he} ({STATUS_HE[d.level.status]}) · נושא {STATUS_HE[d.topic.status]}. תשובות שתבדקו כאן לא נשמרות. <a href={`#/m/topic/${topicId}`}>חזרה לעריכה</a></div>
        <TopicView d={d} base={`#/m/preview/${topicId}`} levelHref={`#/m/level/${d.level.id}`} preview />
      </div>
    )}</View>
  );
}

function PreviewActivity({ topicId, exId }) {
  const q = useApi(`/api/manage/preview/topics/${topicId}`, [topicId]);
  return (
    <View q={q}>{d => {
      const ex = d.exercises.find(e => e.id === exId);
      if (!ex) return <div class="alert error">{t.notFound}</div>;
      return (
        <div>
          <div class="preview-banner" role="note">תצוגה מקדימה · התשובה המלאה מוצגת אחרי כל בדיקה, והתשובות לא נשמרות.</div>
          <Activity ex={ex} level={d.level} topic={d.topic} preview
            endpoints={{ check: `/api/manage/preview/exercises/${ex.id}/check` }}
            crumbs={[{ href: `#/m/topic/${topicId}`, label: d.topic.title_he }, { label: ex.title }]}
            back={`#/m/preview/${topicId}`} />
        </div>
      );
    }}</View>
  );
}

/* ── reports ─────────────────────────────────────────────────────────── */

function LevelReport({ id }) {
  const q = useApi(`/api/manage/levels/${id}/report`, [id]);
  return (
    <View q={q}>{d => (
      <div class="stack">
        <div class="alert info">השלמה (פעילויות שנענו), דיוק (נכון בניסיון ראשון) ועדות ללמידה (נכון ביום מאוחר יותר, בלי הצצה) נמדדים בנפרד. נקודות תרגול אינן חלק מהדוח.</div>
        <div class="card">
          <h2>תלמידים ברמה ({d.students.length})</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>תלמיד/ה</th><th>תורגלו</th><th>בתהליך</th><th>פעילויות</th><th>דיוק</th><th>עדות ללמידה</th><th>טעויות פתוחות</th><th>פעילות אחרונה</th></tr></thead>
            <tbody>{d.students.map(s => (
              <tr key={s.id}><td><a href={`#/m/students/${s.id}`}>{s.name}</a></td><td>{s.practiced}/{s.topics_total}</td><td>{s.in_progress}</td>
                <td>{s.activities_completed}/{s.activities_total}</td><td>{pct(s.accuracy)}</td><td>{pct(s.evidence)}</td><td>{s.open_mistakes}</td><td>{dateHe(s.last_activity)}</td></tr>
            ))}{!d.students.length && <tr><td colSpan={8} class="muted">אין תלמידים רשומים לרמה.</td></tr>}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h2>לפי נושא</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>נושא</th><th>התחילו</th><th>תרגלו</th><th>דיוק</th><th>עדות ללמידה</th><th>טעויות פתוחות</th></tr></thead>
            <tbody>{d.topics.map(x => (
              <tr key={x.id}><td>{x.title_he}</td><td>{x.started}</td><td>{x.practiced}</td><td>{pct(x.accuracy)}</td><td>{pct(x.evidence)}</td><td>{x.open}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h2>סעיפים שכדאי לחזור עליהם בכיתה</h2>
          <p class="hint">הסעיפים שבהם נרשמו הכי הרבה טעויות ברמה. {d.open_flags ? `יש ${d.open_flags} הצעות לתשובה חלופית שממתינות לבדיקה.` : ''}</p>
          <ul class="list-plain">{d.hard_items.map((h, i) => (
            <li key={i}><b>{h.topic_title}</b> · {h.title}<br /><span class="small">{h.prompt}</span><br /><span class="muted small">{h.wrong} טעויות · {h.students} תלמידים · עדיין פתוח אצל {h.still_open}</span></li>
          ))}{!d.hard_items.length && <li class="muted">אין עדיין נתונים.</li>}</ul>
        </div>
      </div>
    )}</View>
  );
}

function StudentReport({ id }) {
  const q = useApi(`/api/manage/students/${id}/progress`, [id]);
  useTitle('התקדמות תלמיד/ה');
  return (
    <View q={q}>{d => (
      <div class="stack">
        <Crumbs items={[{ href: '#/m/students', label: 'תלמידים' }, { label: d.student.name }]} />
        <h1>{d.student.name}</h1>
        {!d.levels.length && <p class="muted">אין נתוני התקדמות ברמות שבהרשאתכם.</p>}
        {d.levels.map(L => (
          <div class="card" key={L.level_id}>
            <div class="row between">
              <h2 style={{ margin: 0 }}>{L.name_he}</h2>
              <span class="row">{L.enrollment.map(e => <span key={e.id} class={'pill ' + (e.status === 'active' ? 'good' : 'gray')}>{e.status === 'active' ? 'רשום/ה' : 'ההרשמה הסתיימה'} · {dateHe(e.started_at)}{e.ended_at ? '–' + dateHe(e.ended_at) : ''}</span>)}</span>
            </div>
            <div class="tiles" style={{ margin: '12px 0' }}>
              <div class="tile stat"><b>{L.summary.practiced}/{L.summary.topics_total}</b><span>נושאים שתורגלו</span></div>
              <div class="tile stat"><b>{L.summary.activities_completed}/{L.summary.activities_total}</b><span>פעילויות שהושלמו</span></div>
              <div class="tile stat"><b>{pct(L.summary.accuracy)}</b><span>{t.accuracy}</span></div>
              <div class="tile stat"><b>{pct(L.summary.evidence)}</b><span>{t.evidence}</span></div>
              <div class="tile stat"><b>{L.summary.open_mistakes}</b><span>טעויות פתוחות</span></div>
            </div>
            <details><summary class="label">לפי נושא</summary>
              <div class="table-wrap"><table class="data">
                <thead><tr><th>נושא</th><th>מצב</th><th>פעילויות</th><th>דיוק</th><th>עדות</th><th>טעויות</th></tr></thead>
                <tbody>{L.topics.map(x => (
                  <tr key={x.id}><td>{x.title_he}{x.topic_status === 'draft' ? ' (טיוטה)' : ''}</td><td><Status s={x.status} /></td><td>{x.completed}/{x.activities}</td><td>{pct(x.accuracy)}</td><td>{x.retained}/{x.auto_items}</td><td>{x.open_mistakes}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
            <p class="small" style={{ marginTop: 10 }}>לפי מיומנות: {L.skills.map(s => `${t.skill[s.skill] || s.skill} ${pct(s.accuracy)}`).join(' · ') || '—'}</p>
          </div>
        ))}
        {d.writing.length > 0 && (
          <div class="card">
            <h2>משימות פתוחות אחרונות</h2>
            <p class="hint">הטקסטים שהתלמיד/ה כתב/ה והבדיקה העצמית שלהם. אין בדיקה אוטומטית של כתיבה חופשית.</p>
            <ul class="list-plain">{d.writing.map((w, i) => (
              <li key={i}><b>{w.topic_title}</b> · {w.title} · <span class="muted small">{dateHe(w.at)}{w.rating ? ` · בדיקה עצמית: ${t.rate[w.rating]}` : ''}</span>
                {w.text && <div class="model tl-block" dir="auto" style={{ marginTop: 6 }}>{w.text}</div>}</li>
            ))}</ul>
          </div>
        )}
      </div>
    )}</View>
  );
}

/* ── assignments & flags ─────────────────────────────────────────────── */

function Assignments({ id, topics }) {
  const q = useApi(`/api/manage/levels/${id}/assignments`, [id]);
  const studs = useApi(`/api/manage/students?level=${id}`, [id]);
  const [sel, setSel] = useState([]);
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const pub = topics.filter(x => x.status === 'published').sort((a, b) => a.title_he.localeCompare(b.title_he, 'he'));
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api(`/api/manage/levels/${id}/assignments`, { method: 'POST', body: { topic_ids: sel, student_id: who || null, note } }); setSel([]); setNote(''); q.reload(); }
    catch (x) { setErr(x.message); }
  }
  async function archive(a) { try { await api(`/api/manage/assignments/${a.id}/archive`, { method: 'POST' }); q.reload(); } catch (x) { setErr(x.message); } }
  const title = tid => (topics.find(x => x.id === tid) || {}).title_he || tid;
  return (
    <div class="grid two">
      <form class="card" onSubmit={save}>
        <h2>הצעת תרגול חדשה</h2>
        <p class="hint">בחרו נושאים שכדאי לתרגל. התלמידים רואים אותם כהצעה בלוח האישי — בלי סדר מחייב ובלי לנעול נושאים אחרים.</p>
        <fieldset><legend>נושאים</legend>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {pub.map(x => <label class="check" key={x.id}><input type="checkbox" checked={sel.includes(x.id)} onChange={e => setSel(e.target.checked ? [...sel, x.id] : sel.filter(s => s !== x.id))} /><span>{x.title_he}</span></label>)}
          </div>
        </fieldset>
        <div class="field"><label for="aw">למי</label>
          <select id="aw" value={who} onChange={e => setWho(e.target.value)}>
            <option value="">כל התלמידים הרשומים לרמה</option>
            {(studs.data ? studs.data.students : []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div class="field"><label for="an">הערה לתלמידים (רשות)</label><input id="an" type="text" value={note} onInput={e => setNote(e.target.value)} /></div>
        {err && <div class="alert error" role="alert">{err}</div>}
        <button class="btn primary" disabled={!sel.length}>שליחה</button>
      </form>
      <View q={q}>{d => (
        <div class="card">
          <h2>הצעות פעילות</h2>
          <ul class="list-plain">{d.assignments.map(a => (
            <li key={a.id}><div class="row between"><b>{a.student_name || 'כל הרמה'}</b><button class="btn ghost small" onClick={() => archive(a)}>הסרה</button></div>
              <div class="small">{a.topic_ids.map(title).join(' · ')}</div>
              <div class="muted small">{a.note} · {a.author} · {dateHe(a.created_at)}</div></li>
          ))}{!d.assignments.length && <li class="muted">אין הצעות פעילות.</li>}</ul>
        </div>
      )}</View>
    </div>
  );
}

function Flags({ id }) {
  const q = useApi(`/api/manage/levels/${id}/flags`, [id]);
  async function decide(f, decision) {
    try { await api(`/api/manage/flags/${f.id}`, { method: 'POST', body: { decision } }); q.reload(); } catch { }
  }
  return (
    <View q={q}>{d => (
      <div class="card">
        <h2>תשובות חלופיות שהציעו תלמידים</h2>
        <p class="hint">כשתלמיד/ה חושב/ת שגם התשובה שלו/ה נכונה, היא מגיעה לכאן. אישור מוסיף אותה למפתח, והיא תתקבל מעכשיו אצל כולם. ההצעה עצמה לא נספרת כתשובה נכונה.</p>
        <ul class="list-plain">{d.flags.map(f => (
          <li key={f.id}>
            <b>{f.topic_title}</b> · {f.title} · <span class="muted small">{f.student} · {dateHe(f.created_at)}</span>
            <div class="small">{f.prompt}</div>
            <div class="kv small"><span>במפתח:</span><bdi class="tl">{f.expected}</bdi><span>הוצע:</span><bdi class="tl">{f.answer}</bdi></div>
            <div class="row" style={{ marginTop: 6 }}><button class="btn primary small" onClick={() => decide(f, 'accept')}>אישור והוספה למפתח</button><button class="btn ghost small" onClick={() => decide(f, 'reject')}>דחייה</button></div>
          </li>
        ))}{!d.flags.length && <li class="muted">אין הצעות ממתינות.</li>}</ul>
      </div>
    )}</View>
  );
}

/* ── students & enrollments ──────────────────────────────────────────── */

function Students({ P }) {
  const [qs, setQs] = useState('');
  const q = useApi('/api/manage/students', []);
  const courses = useApi('/api/manage/courses', []);
  const [name, setName] = useState('');
  const [code, setCode] = useState(null);
  const [err, setErr] = useState('');
  const [enrollFor, setEnrollFor] = useState(null);
  useTitle('תלמידים');
  const levels = courses.data ? courses.data.languages.flatMap(l => l.levels.map(lv => ({ ...lv, lang: l.name_he, langStatus: l.status }))) : [];
  async function create(e) {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/manage/students', { method: 'POST', body: { name } }); setName(''); setCode({ name, code: r.code }); q.reload(); }
    catch (x) { setErr(x.message); }
  }
  async function newCode(s) {
    if (!confirm(`להנפיק קוד חדש ל${s.name}? הקוד הקודם יפסיק לעבוד.`)) return;
    try { const r = await api(`/api/manage/students/${s.id}/code`, { method: 'POST' }); setCode({ name: s.name, code: r.code }); q.reload(); } catch (x) { setErr(x.message); }
  }
  async function end(e, s) {
    if (!confirm(`לסיים את ההרשמה של ${s.name} ל${e.name_he}? ההיסטוריה נשמרת, אבל הגישה לתוכן תיחסם מיד.`)) return;
    try { await api(`/api/manage/enrollments/${e.id}/end`, { method: 'POST' }); q.reload(); } catch (x) { setErr(x.message); }
  }
  return (
    <div class="stack">
      <h1>תלמידים והרשמה</h1>
      <p class="lead">כל תלמיד/ה רואה רק את הרמות שהוא/היא רשום/ה אליהן. אפשר לרשום לכמה רמות ושפות. סיום הרשמה חוסם גישה אבל שומר את ההיסטוריה.</p>
      {code && <div class="alert good" role="status">קוד כניסה ל{code.name}: <b dir="ltr" style={{ fontSize: '1.2rem', letterSpacing: '.1em' }}>{code.code || '— (כניסה בקוד לא הופעלה)'}</b>. הקוד מוצג רק עכשיו — מסרו אותו לתלמיד/ה. <button class="link-btn" onClick={() => setCode(null)}>{t.close}</button></div>}
      {err && <div class="alert error" role="alert">{err}</div>}
      {P['students.create'] && (
        <form class="card row" onSubmit={create}>
          <label for="sn" class="label">תלמיד/ה חדש/ה</label>
          <input id="sn" type="text" placeholder="שם מלא" value={name} onInput={e => setName(e.target.value)} style={{ maxWidth: 320 }} />
          <button class="btn primary" disabled={name.trim().length < 2}>יצירה והנפקת קוד</button>
        </form>
      )}
      <input type="search" placeholder="חיפוש לפי שם" value={qs} onInput={e => setQs(e.target.value)} aria-label="חיפוש תלמידים" style={{ maxWidth: 360 }} />
      <View q={q}>{d => (
        <div class="table-wrap"><table class="data">
          <thead><tr><th>שם</th><th>הרשמות</th><th>קוד</th><th>פעילות אחרונה</th><th></th></tr></thead>
          <tbody>{d.students.filter(s => s.name.includes(qs.trim())).map(s => (
            <tr key={s.id}>
              <td><a href={`#/m/students/${s.id}`}><b>{s.name}</b></a>{!s.active && <span class="pill gray">מושבת</span>}</td>
              <td>
                {s.enrollments.map(e => (
                  <div key={e.id} class="row" style={{ gap: 6, marginBottom: 4 }}>
                    <span class={'pill ' + (e.status === 'active' ? 'good' : 'gray')}>{e.name_he}{e.status !== 'active' ? ' · הסתיים' : ''}</span>
                    {e.status === 'active' && P['enroll'] && <button class="link-btn small" onClick={() => end(e, s)}>סיום הרשמה</button>}
                  </div>
                ))}
                {P['enroll'] && <button class="btn ghost small" onClick={() => setEnrollFor(s)}>הרשמה לרמה</button>}
              </td>
              <td>{s.has_code ? <span class="pill good">פעיל</span> : <span class="pill gray">אין</span>}{P['students.code'] && <> <button class="link-btn small" onClick={() => newCode(s)}>קוד חדש</button></>}</td>
              <td class="small">{dateHe(s.last_activity)}</td>
              <td><a class="btn ghost small" href={`#/m/students/${s.id}`}>התקדמות</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}</View>
      {enrollFor && <EnrollModal s={enrollFor} levels={levels} onClose={() => setEnrollFor(null)} onDone={() => { setEnrollFor(null); q.reload(); }} />}
    </div>
  );
}

function EnrollModal({ s, levels, onClose, onDone }) {
  const active = new Set(s.enrollments.filter(e => e.status === 'active').map(e => e.level_id));
  const [lv, setLv] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/manage/enrollments', { method: 'POST', body: { user_id: s.id, level_id: lv } }); if (r.note) { setNote(r.note); setTimeout(onDone, 1800); } else onDone(); }
    catch (x) { setErr(x.message); }
  }
  return (
    <Modal title={`הרשמה לרמה · ${s.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div class="field"><label for="el">רמה</label>
          <select id="el" value={lv} onChange={e => setLv(e.target.value)}>
            <option value="">בחרו רמה</option>
            {levels.filter(l => !active.has(l.id)).map(l => <option key={l.id} value={l.id}>{l.name_he}{l.status !== 'published' || l.langStatus !== 'published' ? ' (טיוטה)' : ''}</option>)}
          </select></div>
        {note && <div class="alert warn">{note}</div>}
        {err && <div class="alert error" role="alert">{err}</div>}
        <button class="btn primary" disabled={!lv}>הרשמה</button>
      </form>
    </Modal>
  );
}

function Teachers() {
  const q = useApi('/api/manage/teachers', []);
  const courses = useApi('/api/manage/courses', []);
  const [err, setErr] = useState('');
  const levels = courses.data ? courses.data.languages.flatMap(l => l.levels) : [];
  async function toggle(tch, lv, on) {
    const next = on ? [...tch.levels, lv] : tch.levels.filter(x => x !== lv);
    try { await api(`/api/manage/teachers/${tch.id}/levels`, { method: 'PUT', body: { level_ids: next } }); q.reload(); } catch (x) { setErr(x.message); }
  }
  return (
    <div class="stack">
      <h1>מורים ורמות</h1>
      <p class="lead">מורה רואה ועורך/ת רק את הרמות שמסומנות כאן, ורק את התלמידים שרשומים (או היו רשומים) אליהן.</p>
      {err && <div class="alert error" role="alert">{err}</div>}
      <View q={q}>{d => (
        <div class="table-wrap"><table class="data">
          <thead><tr><th>מורה</th>{levels.map(l => <th key={l.id}>{l.name_he}</th>)}</tr></thead>
          <tbody>{d.teachers.map(tch => (
            <tr key={tch.id}><td>{tch.name}</td>{levels.map(l => (
              <td key={l.id}><input type="checkbox" aria-label={`${tch.name} · ${l.name_he}`} checked={tch.levels.includes(l.id)} onChange={e => toggle(tch, l.id, e.target.checked)} /></td>
            ))}</tr>
          ))}{!d.teachers.length && <tr><td class="muted">אין חשבונות מורה. חשבונות צוות נפתחים בחדר המורים.</td></tr>}</tbody>
        </table></div>
      )}</View>
    </div>
  );
}
