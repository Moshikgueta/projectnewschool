import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t, pct } from './i18n.js';
import { api } from './api.js';
import { T } from './text.jsx';

/* ── routing (hash based: the Worker serves one page) ─────────────────── */

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
}

export function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const on = () => { setR(parseHash()); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(to) { location.hash = to; }

/* ── data loading with loading / error / restricted states ───────────── */

export function useApi(path, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    set(s => ({ ...s, loading: true, error: null }));
    api(path).then(d => { if (n === seq.current) set({ loading: false, data: d, error: null }); })
      .catch(e => { if (n === seq.current) set({ loading: false, data: null, error: e }); });
  }, [path, ...deps]);
  useEffect(load, [load]);
  return { ...state, reload: load, setData: d => set(s => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function Loading({ label }) {
  return <div class="card flat muted" role="status" aria-live="polite">{label || t.loading}</div>;
}

export function Restricted() {
  return (
    <div class="card" role="alert">
      <h1>{t.restrictedTitle}</h1>
      <p class="lead">{t.restrictedBody}</p>
      <a class="btn primary" href="#/">{t.toDashboard}</a>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  if (error.code === 'outside_enrollment') return <Restricted />;
  return (
    <div class="alert error" role="alert">
      <b>{t.errorTitle}.</b> {error.message}
      {onRetry && <> <button class="link-btn" onClick={onRetry}>{t.retry}</button></>}
    </div>
  );
}

export function View({ q, children }) {
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (q.loading && !q.data) return <Loading />;
  return children(q.data);
}

/* ── small pieces ────────────────────────────────────────────────────── */

export function Status({ s }) {
  return <span class={'status ' + s}><span class="dot" aria-hidden="true" />{t.status[s]}</span>;
}

export function Meter({ value, good, label }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div class={'meter' + (good ? ' good' : '')} role="img" aria-label={label || pct(v)}>
      <span style={{ width: (v * 100).toFixed(1) + '%' }} />
    </div>
  );
}

export function Crumbs({ items }) {
  return (
    <nav class="crumbs" aria-label="ניווט">
      {items.map((it, i) => (
        <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}</span>
      ))}
    </nav>
  );
}

export function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current && ref.current.focus();
    const key = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => { removeEventListener('keydown', key); prev && prev.focus && prev.focus(); };
  }, []);
  return (
    <div class="modal-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div class="row between"><h2>{title}</h2><button class="btn ghost small" onClick={onClose}>{t.close}</button></div>
        {children}
      </div>
    </div>
  );
}

export function Footer({ year }) {
  const [show, setShow] = useState(false);
  return (
    <footer class="site">
      <div class="in">
        <div class="copy" dir="ltr" lang="en">{t.copyright(year || new Date().getFullYear())}</div>
        <div><T text={t.rightsHe} lang="en" dir="ltr" /></div>
        <div>
          <button class="link-btn small" onClick={() => setShow(!show)} aria-expanded={show}>{t.thirdParty}</button>
          {show && <p class="small" style={{ marginTop: 6 }}>{t.thirdPartyNote} <a href="THIRD-PARTY-NOTICES.txt">THIRD-PARTY-NOTICES.txt</a></p>}
        </div>
      </div>
    </footer>
  );
}

export function useTitle(s) {
  useEffect(() => { document.title = s ? `${s} · New School Cycles` : 'New School Cycles'; }, [s]);
}

/* Loads a Google font for a target language the first time it is needed. */
const loadedFonts = new Set();
export function ensureFont(langId) {
  const map = { ar: 'Noto+Naskh+Arabic:wght@400;600', el: 'Noto+Serif:wght@400;600' };
  if (!map[langId] || loadedFonts.has(langId)) return;
  loadedFonts.add(langId);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${map[langId]}&display=swap`;
  document.head.appendChild(l);
}
