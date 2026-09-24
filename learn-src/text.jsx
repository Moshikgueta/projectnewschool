/* Mixed-direction text.

   Course text mixes Hebrew and the target language inside one sentence
   ("משתמשים ב־ser לזהות"). Storing direction markup in the content would tie
   every lesson to one interface, so the content is plain text with two
   marks — **bold** and line breaks — and direction is worked out here, by
   script: each run of target-language text inside Hebrew (or Hebrew inside
   target-language text) is isolated in a <bdi> with the right dir and lang.
   That also keeps punctuation where readers expect it: a Spanish ¿…? stays
   with its words, while a Hebrew sentence's final period stays Hebrew. */

const HEB = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const ARAB = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LETTER = /[\p{L}\p{N}]/u;
const OPENERS = /[¿¡«"“(]/;

function kindOf(ch) {
  if (HEB.test(ch)) return 'he';
  if (LETTER.test(ch)) return 't';
  return 'n';
}

/* Split into runs of 'he' and 't'; neutrals join the run they sit inside.
   Trailing neutrals of a target run go back to the outer (Hebrew) text,
   except closing marks that match an opener inside the run. */
export function runs(text, base) {
  const chars = [...text];
  const out = [];
  let cur = null;
  for (const ch of chars) {
    const k = kindOf(ch);
    if (k === 'n') {
      if (cur) cur.s += ch; else cur = { k: base, s: ch };
      continue;
    }
    if (!cur) { cur = { k, s: ch }; continue; }
    if (cur.k === k) { cur.s += ch; continue; }
    // direction change: move trailing neutrals of `cur` according to rules
    let tail = '';
    if (cur.k !== base) {
      const m = cur.s.match(/[^\p{L}\p{N}]*$/u)[0];
      const keep = keepClosers(cur.s, m);
      tail = m.slice(keep.length);
      cur.s = cur.s.slice(0, cur.s.length - tail.length);
    }
    // openers like ¿ belong to the target run that follows
    let lead = '';
    if (k !== base) {
      const m = (cur.s + tail).match(/[¿¡«"“(]+\s*$/);
      if (m && OPENERS.test(m[0][0])) lead = m[0].trim();
    }
    if (lead) {
      const all = cur.s + tail;
      const cut = all.lastIndexOf(lead);
      out.push({ k: cur.k, s: all.slice(0, cut) });
      if (all.slice(cut + lead.length)) out.push({ k: base, s: all.slice(cut + lead.length) });
      cur = { k, s: lead + ch };
      continue;
    }
    out.push(cur);
    if (tail) out.push({ k: base, s: tail });
    cur = { k, s: ch };
  }
  if (cur) {
    if (cur.k !== base) {
      const m = cur.s.match(/[^\p{L}\p{N}]*$/u)[0];
      const keep = keepClosers(cur.s, m);
      const tail = m.slice(keep.length);
      cur.s = cur.s.slice(0, cur.s.length - tail.length);
      out.push(cur);
      if (tail) out.push({ k: base, s: tail });
    } else out.push(cur);
  }
  // merge adjacent same-kind runs
  const merged = [];
  for (const r of out) {
    if (!r.s) continue;
    const last = merged[merged.length - 1];
    if (last && last.k === r.k) last.s += r.s; else merged.push({ ...r });
  }
  return merged;
}

function keepClosers(s, trailing) {
  let keep = '';
  for (const ch of trailing) {
    if ((ch === '?' && s.includes('¿')) || (ch === '!' && s.includes('¡')) || (ch === ')' && s.includes('(')) ||
      (ch === '»' && s.includes('«')) || (ch === '”' && s.includes('“')) || (ch === '"' && (s.match(/"/g) || []).length % 2 === 0)) {
      keep += ch;
    } else break;
  }
  return keep;
}

/* The base direction of a string: Hebrew if its first strong letter is. */
export function baseOf(text) {
  for (const ch of String(text || '')) {
    const k = kindOf(ch);
    if (k !== 'n') return k;
  }
  return 'he';
}

/* <T text lang="es" dir="ltr"/> — renders course text safely (no HTML is
   ever injected) with bold, line breaks and direction isolation. */
export function T({ text, lang = 'es', dir = 'ltr', base, gap }) {
  const s = String(text ?? '');
  if (!s) return null;
  const b = base || (lang === 'ar' && ARAB.test(s) && !HEB.test(s) ? 't' : baseOf(s));
  const lines = s.split('\n');
  const out = [];
  lines.forEach((line, li) => {
    if (li) out.push(<br key={'br' + li} />);
    line.split(/(\*\*[^*]+\*\*)/).forEach((part, pi) => {
      if (!part) return;
      const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
      const body = bold ? part.slice(2, -2) : part;
      const segs = gap ? body.split(/(___)/) : [body];
      segs.forEach((seg, si) => {
        if (seg === '___' && gap) { out.push(gap(`${li}-${pi}-${si}`)); return; }
        runs(seg, b).forEach((r, ri) => {
          const key = `${li}-${pi}-${si}-${ri}`;
          let node;
          if (r.k === b) node = r.s;
          else if (r.k === 't') node = <bdi class="tl" lang={lang} dir={dir}>{r.s}</bdi>;
          else node = <bdi lang="he" dir="rtl">{r.s}</bdi>;
          out.push(bold ? <b key={key}>{node}</b> : <span key={key}>{node}</span>);
        });
      });
    });
  });
  return out;
}

/* A whole block in the target language (a reading text, an item prompt). */
export function TL({ text, lang, dir, as: Tag = 'div', class: cls = '', gap }) {
  return (
    <Tag class={'tl-block ' + cls} lang={lang} dir={dir}>
      <T text={text} lang={lang} dir={dir} base="t" gap={gap} />
    </Tag>
  );
}
