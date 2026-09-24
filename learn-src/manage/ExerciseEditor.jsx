import { useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { Modal } from '../ui.jsx';

/* One editor for every activity type. Staff fill forms; the server
   validates (functions/learn/manage.js → validateExercise) so nothing that
   cannot be rendered or graded is ever stored. Matching and ordering are
   entered in their correct order and shuffled here on save. */

const ITEM_KINDS = ['recall', 'gap', 'choice', 'bank', 'correction', 'transform', 'translate', 'conjugation', 'reading', 'wordorder', 'selftest'];
const ALL_KINDS = [...ITEM_KINDS, 'match', 'order', 'open'];
const SKILLS = ['vocab', 'grammar', 'reading', 'writing', 'speaking', 'production', 'communication', 'mixed'];
const INPUT_HE = { text: 'מילה או ביטוי', sentence: 'משפט שלם', choice: 'בחירה מאפשרויות', bank: 'ממחסן מילים', tokens: 'סידור מילים' };

const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const L = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

function fromExercise(ex) {
  if (!ex) return { kind: 'gap', title: '', instructions: '', skill: 'grammar', text: '', wordbank: '', items: [blankItem()], rows: [['', ''], ['', '']], lines: ['', ''], prompt: '', brief: '', note: '', models: '', criteria: '', accents: '', match: '', optional: '' };
  const b = ex.body || {}, k = ex.key || {};
  const pol = k.policy || {};
  const base = { kind: ex.kind, title: ex.title, instructions: ex.instructions, skill: ex.skill, accents: pol.accents || '', match: pol.match || '', optional: (pol.optionalLeading || []).join(' ') };
  if (ex.kind === 'match') {
    return { ...base, rows: b.left.map((l, i) => [l, ((b.right || []).find(r => r.id === k.pairs[i]) || {}).text || '']) };
  }
  if (ex.kind === 'order') {
    const byId = Object.fromEntries(b.lines.map(l => [l.id, l.text]));
    return { ...base, lines: (k.order || []).map(id => byId[id]) };
  }
  if (ex.mode === 'self' || ex.kind === 'open') {
    return { ...base, kind: 'open', prompt: b.prompt || '', brief: b.brief || '', note: b.note || '', models: (k.models || []).join('\n---\n'), criteria: k.criteria || '' };
  }
  return {
    ...base, text: b.text || '', wordbank: (b.wordbank || []).join(' · '),
    items: (b.items || []).map((it, i) => {
      const kk = (k.items || [])[i] || {};
      return {
        prompt: it.prompt || '', input: it.input || 'text', cue: it.cue || '', hint: it.hint || '', inText: !!it.inText,
        options: (it.options || []).join('\n'), choice: kk.choice ?? 0, answers: (kk.answers || []).join('\n'),
        tokens: (it.tokens || []).join(' / '), note: kk.note || '', itemAccents: (kk.policy || {}).accents || ''
      };
    })
  };
}

function blankItem() { return { prompt: '', input: 'text', cue: '', hint: '', inText: false, options: '', choice: 0, answers: '', tokens: '', note: '', itemAccents: '' }; }

function toPayload(f) {
  const policy = {};
  if (f.accents) policy.accents = f.accents;
  if (f.match) policy.match = f.match;
  if (f.optional.trim()) policy.optionalLeading = f.optional.split(/[\s,]+/).filter(Boolean);
  const common = { kind: f.kind, title: f.title, instructions: f.instructions, skill: f.skill };
  if (f.kind === 'match') {
    const rows = f.rows.filter(r => r[0].trim() && r[1].trim());
    const right = shuffle(rows.map((r, i) => ({ i, text: r[1].trim() }))).map((r, j) => ({ ...r, id: String.fromCharCode(65 + j) }));
    return { ...common, body: { left: rows.map(r => r[0].trim()), right: right.map(r => ({ text: r.text })) },
      key: { pairs: rows.map((_, i) => right.find(r => r.i === i).id), policy } };
  }
  if (f.kind === 'order') {
    const correct = f.lines.map(x => x.trim()).filter(Boolean);
    const shown = shuffle(correct.map((text, i) => ({ text, i })));
    const ids = shown.map((_, j) => String.fromCharCode(65 + j));
    return { ...common, body: { lines: shown.map(s => ({ text: s.text })) },
      key: { order: correct.map((_, i) => ids[shown.findIndex(s => s.i === i)]), policy } };
  }
  if (f.kind === 'open') {
    return { ...common, body: { prompt: f.prompt, brief: f.brief, note: f.note },
      key: { models: f.models.split(/\n-{3,}\n/).map(s => s.trim()).filter(Boolean), criteria: f.criteria } };
  }
  const items = [], keys = [];
  for (const it of f.items) {
    const o = { prompt: it.prompt, input: it.input };
    if (it.cue) o.cue = it.cue;
    if (it.hint) o.hint = it.hint;
    if (it.inText) o.inText = true;
    const k = {};
    if (it.note) k.note = it.note;
    if (it.itemAccents) k.policy = { accents: it.itemAccents };
    if (it.input === 'choice') { o.options = L(it.options); k.choice = Number(it.choice) || 0; }
    else {
      if (it.input === 'tokens') o.tokens = it.tokens.split('/').map(x => x.trim()).filter(Boolean);
      k.answers = L(it.answers); k.display = k.answers[0] || '';
    }
    items.push(o); keys.push(k);
  }
  const body = { items };
  if (f.text.trim()) body.text = f.text;
  if (f.wordbank.trim()) body.wordbank = f.wordbank.split(/\s*·\s*|\n/).map(x => x.trim()).filter(Boolean);
  return { ...common, body, key: { items: keys, policy } };
}

export function ExerciseEditor({ ex, topicId, level, onClose, onSaved }) {
  const [f, setF] = useState(() => fromExercise(ex));
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const lang = level.lang.id, dir = level.lang.dir;
  const set = patch => setF(prev => ({ ...prev, ...patch }));
  const setItem = (i, patch) => set({ items: f.items.map((it, j) => j === i ? { ...it, ...patch } : it) });

  async function save(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    let payload;
    try { payload = raw !== null ? JSON.parse(raw) : toPayload(f); }
    catch { setErr('ה־JSON לא תקין.'); setBusy(false); return; }
    try {
      if (ex) await api(`/api/manage/exercises/${ex.id}`, { method: 'PATCH', body: payload });
      else await api(`/api/manage/topics/${topicId}/exercises`, { method: 'POST', body: payload });
      onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  const isItems = ITEM_KINDS.includes(f.kind);
  return (
    <Modal title={ex ? `עריכת פעילות · ${ex.title}` : 'פעילות חדשה'} onClose={onClose}>
      <form onSubmit={save}>
        <div class="row between" style={{ marginBottom: 10 }}>
          <span class="hint">{raw === null ? 'טופס' : 'עריכת JSON (למשתמשים מתקדמים)'}</span>
          <button type="button" class="btn ghost small" onClick={() => setRaw(raw === null ? JSON.stringify(toPayload(f), null, 2) : null)}>{raw === null ? 'מעבר ל־JSON' : 'חזרה לטופס'}</button>
        </div>
        {raw !== null ? (
          <textarea dir="ltr" rows={22} value={raw} onInput={e => setRaw(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' }} />
        ) : (
          <>
            <div class="editor-row">
              <div class="field"><label>סוג פעילות</label>
                <select value={f.kind} onChange={e => set({ kind: e.target.value, ...(ITEM_KINDS.includes(e.target.value) && !f.items ? { items: [blankItem()] } : {}) })} disabled={!!ex && (f.kind === 'open') !== (ex.mode === 'self')}>
                  {ALL_KINDS.map(k => <option key={k} value={k}>{t.kind[k]}</option>)}
                </select></div>
              <div class="field"><label>מיומנות</label>
                <select value={f.skill} onChange={e => set({ skill: e.target.value })}>{SKILLS.map(s => <option key={s} value={s}>{t.skill[s]}</option>)}</select></div>
            </div>
            <div class="field"><label>כותרת (בלי מספר)</label><input type="text" value={f.title} onInput={e => set({ title: e.target.value })} required /></div>
            <div class="field"><label>הנחיה לתלמידים</label><textarea rows={2} value={f.instructions} onInput={e => set({ instructions: e.target.value })} /></div>

            {isItems && (
              <>
                <div class="field"><label>טקסט (לקריאה, או להשלמה בתוך טקסט עם {'{{1}}'}, {'{{2}}'}…)</label>
                  <textarea rows={3} lang={lang} dir={dir} value={f.text} onInput={e => set({ text: e.target.value })} /></div>
                <div class="field"><label>מחסן מילים (מופרד ב־·)</label><input type="text" lang={lang} dir={dir} value={f.wordbank} onInput={e => set({ wordbank: e.target.value })} /></div>
                <fieldset><legend>בדיקת תשובות בפעילות</legend>
                  <div class="editor-row">
                    <div class="field"><label>סימני הטעמה</label>
                      <select value={f.accents} onChange={e => set({ accents: e.target.value })}><option value="">לפי ברירת המחדל של השפה</option><option value="strict">מחייב (עם משוב)</option><option value="lenient">מקל (מתקבל עם הערה)</option></select></div>
                    <div class="field"><label>סוג התאמה</label>
                      <select value={f.match} onChange={e => set({ match: e.target.value })}><option value="">מדויקת (אחרי נרמול)</option><option value="content">תוכן מרכזי — לשאלות הבנה</option></select></div>
                  </div>
                  <div class="field"><label>מילים שמותר להשמיט בתחילת תשובה (למשל כינויי גוף)</label><input type="text" lang={lang} dir={dir} value={f.optional} onInput={e => set({ optional: e.target.value })} /></div>
                </fieldset>
                <h3>סעיפים</h3>
                {f.items.map((it, i) => (
                  <div class="item-editor" key={i}>
                    <div class="row between"><b>סעיף {i + 1}</b>
                      <span class="row">
                        <select value={it.input} onChange={e => setItem(i, { input: e.target.value })} aria-label="סוג תשובה">{Object.entries(INPUT_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        {f.items.length > 1 && <button type="button" class="btn danger small" onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}>הסרה</button>}
                      </span></div>
                    {it.input !== 'tokens' && <div class="field"><label>שאלה / משפט (סמנו מקום להשלמה ב־___)</label><input type="text" dir="auto" value={it.prompt} onInput={e => setItem(i, { prompt: e.target.value })} /></div>}
                    {it.input === 'tokens' && <div class="field"><label>המילים לסידור (מופרדות ב־/)</label><input type="text" lang={lang} dir={dir} value={it.tokens} onInput={e => setItem(i, { tokens: e.target.value })} /></div>}
                    <div class="editor-row">
                      <div class="field"><label>רמז בעברית (רשות)</label><input type="text" value={it.cue} onInput={e => setItem(i, { cue: e.target.value })} /></div>
                      <div class="field"><label>רמז בשפת היעד (רשות, למשל שם הפועל)</label><input type="text" lang={lang} dir={dir} value={it.hint} onInput={e => setItem(i, { hint: e.target.value })} /></div>
                    </div>
                    {it.input === 'choice' ? (
                      <div class="editor-row">
                        <div class="field"><label>אפשרויות (שורה לכל אפשרות)</label><textarea rows={3} lang={lang} dir={dir} value={it.options} onInput={e => setItem(i, { options: e.target.value })} /></div>
                        <div class="field"><label>האפשרות הנכונה</label>
                          <select value={it.choice} onChange={e => setItem(i, { choice: Number(e.target.value) })}>{L(it.options).map((o, k) => <option key={k} value={k}>{o}</option>)}</select></div>
                      </div>
                    ) : (
                      <div class="field"><label>תשובות מתקבלות (שורה לכל תשובה; הראשונה מוצגת כתשובה)</label><textarea rows={2} lang={lang} dir={dir} value={it.answers} onInput={e => setItem(i, { answers: e.target.value })} /></div>
                    )}
                    <div class="editor-row">
                      <div class="field"><label>הסבר שיוצג במשוב (רשות)</label><input type="text" value={it.note} onInput={e => setItem(i, { note: e.target.value })} /></div>
                      <div class="field"><label>הטעמה בסעיף הזה</label>
                        <select value={it.itemAccents} onChange={e => setItem(i, { itemAccents: e.target.value })}><option value="">כמו בפעילות</option><option value="strict">מחייב</option><option value="lenient">מקל</option></select></div>
                    </div>
                    <label class="check small"><input type="checkbox" checked={it.inText} onChange={e => setItem(i, { inText: e.target.checked })} /><span>השלמה בתוך הטקסט (מקום {'{{' + (i + 1) + '}}'})</span></label>
                  </div>
                ))}
                <button type="button" class="btn secondary small" onClick={() => set({ items: [...f.items, blankItem()] })}>הוספת סעיף</button>
              </>
            )}

            {f.kind === 'match' && (
              <fieldset><legend>זוגות להתאמה (בסדר הנכון — הערבוב נעשה בשמירה)</legend>
                {f.rows.map((r, i) => (
                  <div class="editor-row" key={i} style={{ marginBottom: 6 }}>
                    <input type="text" lang={lang} dir={dir} placeholder="פריט" value={r[0]} onInput={e => set({ rows: f.rows.map((x, j) => j === i ? [e.target.value, x[1]] : x) })} />
                    <input type="text" dir="auto" placeholder="המשמעות המתאימה" value={r[1]} onInput={e => set({ rows: f.rows.map((x, j) => j === i ? [x[0], e.target.value] : x) })} />
                  </div>
                ))}
                <button type="button" class="btn secondary small" onClick={() => set({ rows: [...f.rows, ['', '']] })}>הוספת זוג</button>
              </fieldset>
            )}

            {f.kind === 'order' && (
              <fieldset><legend>השורות בסדר הנכון (הערבוב נעשה בשמירה)</legend>
                {f.lines.map((l, i) => (
                  <input key={i} type="text" lang={lang} dir={dir} style={{ marginBottom: 6 }} value={l} placeholder={`שורה ${i + 1}`}
                    onInput={e => set({ lines: f.lines.map((x, j) => j === i ? e.target.value : x) })} />
                ))}
                <button type="button" class="btn secondary small" onClick={() => set({ lines: [...f.lines, ''] })}>הוספת שורה</button>
              </fieldset>
            )}

            {f.kind === 'open' && (
              <>
                <div class="alert info">משימה פתוחה נבדקת בבדיקה עצמית מול מודל וקריטריונים. אין בדיקה אוטומטית של כתיבה או דיבור חופשיים.</div>
                <div class="field"><label>שאלות או הנחיות (שורה לכל אחת)</label><textarea rows={3} lang={lang} dir={dir} value={f.prompt} onInput={e => set({ prompt: e.target.value })} /></div>
                <div class="field"><label>תקציר / נושא (רשות)</label><textarea rows={2} dir="auto" value={f.brief} onInput={e => set({ brief: e.target.value })} /></div>
                <div class="field"><label>הערה לתלמידים (רשות)</label><input type="text" value={f.note} onInput={e => set({ note: e.target.value })} /></div>
                <div class="field"><label>מודל לדוגמה (כמה מודלים — מפרידים בשורה ---)</label><textarea rows={5} lang={lang} dir={dir} value={f.models} onInput={e => set({ models: e.target.value })} /></div>
                <div class="field"><label>קריטריונים לבדיקה עצמית</label><textarea rows={3} value={f.criteria} onInput={e => set({ criteria: e.target.value })} /></div>
              </>
            )}
          </>
        )}
        {err && <div class="alert error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
        <div class="row" style={{ marginTop: 14 }}>
          <button class="btn primary" disabled={busy}>{busy ? t.loading : t.save}</button>
          <button type="button" class="btn ghost" onClick={onClose}>{t.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}
