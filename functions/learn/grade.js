/* Answer checking. Pure functions — no D1, no request — so the same code runs
   in the Worker and in the unit tests (scripts/test-grade.mjs).

   The rules, in order of how forgiving they are:

   1. Always ignored: letter case, surrounding/extra spaces, sentence
      punctuation (¿ ? ¡ ! . , ; : quotes, Arabic ، ؛ ؟), curly vs straight
      apostrophes. None of these is what an item tests.
   2. Configurable per language, then per exercise, then per item
      (the later one wins):
        accents   'strict'  — á vs a (and ñ vs n) makes the answer wrong, with
                              feedback naming the words to check. The default:
                              in Spanish 'esta'/'está' and 'hablo'/'habló' are
                              different words.
                  'lenient' — accepted, with a note showing the accented form.
                              Used for vocabulary recall and matching.
        harakat   'ignore' (Arabic default) — short-vowel marks are optional.
        tatweel   'ignore'   alef 'strict' | 'lenient' (أ إ آ → ا)
        eszett    'strict' | 'lenient' (ß ↔ ss)       case 'ignore' | 'strict'
        optionalLeading — words that may be left out at the start of an answer
                  (Spanish subject pronouns, which the workbook's key allows to
                  be dropped when the verb form is clear).
        match     'exact' (default) | 'content' — for reading answers: the
                  answer is right when it contains every content word of the
                  model answer that is not already in the question. "En
                  Madrid", "Vive en Madrid" and "Lucía vive en Madrid" are all
                  right for "¿Dónde vive Lucía?".
   3. Several accepted answers per item come from the answer key itself.

   Feedback is returned as codes with parameters; the page turns them into
   Hebrew. That keeps interface language out of the grading code. */

const PUNCT = /[¿?¡!.,;:()[\]{}"«»“”„…·\u060C\u061B\u061F\u037E\u0387]/g;
const APOS = /[’‘`´ʼ]/g;
const DASH_SPACED = /\s[-–—]\s/g;
const COMBINING = /[\u0300-\u036f]/g;
const HARAKAT = /[\u064B-\u065F\u0670]/g;
const TATWEEL = /\u0640/g;

export function normalize(s, cfg = {}) {
  let t = String(s ?? '').normalize('NFC');
  t = t.replace(APOS, "'").replace(DASH_SPACED, ' ').replace(PUNCT, ' ');
  if (cfg.harakat !== 'strict') t = t.replace(HARAKAT, '');
  if (cfg.tatweel !== 'strict') t = t.replace(TATWEEL, '');
  if (cfg.alef === 'lenient') t = t.replace(/[أإآ]/g, 'ا');
  if (cfg.case !== 'strict') t = t.toLowerCase();
  if (cfg.eszett === 'lenient') t = t.replace(/ß/g, 'ss');
  if (cfg.finalSigma === 'fold') t = t.replace(/ς/g, 'σ');
  return t.replace(/\s+/g, ' ').trim();
}

/* Diacritics off — used to tell "only the accents differ" apart from "wrong". */
export function fold(s) {
  return String(s).normalize('NFD').replace(COMBINING, '').normalize('NFC');
}

const tokens = s => (s ? s.split(' ').filter(Boolean) : []);

function stripLeading(toks, words) {
  if (!words || !words.length || !toks.length) return toks;
  const set = new Set(words.map(w => fold(w.toLowerCase())));
  return set.has(fold(toks[0])) ? toks.slice(1) : toks;
}

function multisetMinus(a, b) {
  const counts = new Map();
  for (const x of b) counts.set(x, (counts.get(x) || 0) + 1);
  const out = [];
  for (const x of a) {
    const n = counts.get(x) || 0;
    if (n > 0) counts.set(x, n - 1); else out.push(x);
  }
  return out;
}

function similarity(a, b) {
  const fa = a.map(fold), fb = b.map(fold);
  const common = fa.length - multisetMinus(fa, fb).length;
  return common / Math.max(1, Math.max(fa.length, fb.length));
}

/* Grade one typed answer against the accepted answers of an item.
   Returns {status, feedback, matched}. status is one of
     correct | accepted_accent | almost | incorrect | empty */
export function gradeText(given, answers, policy = {}, question = '') {
  const cfg = policy;
  const g = normalize(given, cfg);
  if (!g) return { status: 'empty', feedback: [{ code: 'not_answered' }] };
  const alts = (answers || []).filter(a => String(a).trim());
  if (!alts.length) return { status: 'incorrect', feedback: [{ code: 'no_key' }] };

  const gt = stripLeading(tokens(g), cfg.optionalLeading);
  let best = null, bestSim = -1;
  for (const a of alts) {
    const na = normalize(a, cfg);
    const at = stripLeading(tokens(na), cfg.optionalLeading);
    if (gt.join(' ') === at.join(' ')) {
      const fb = [];
      if (tokens(g).length !== gt.length || tokens(na).length !== at.length) fb.push({ code: 'pronoun_optional' });
      return { status: 'correct', feedback: fb, matched: a };
    }
    if (fold(gt.join(' ')) === fold(at.join(' '))) {
      const words = gt.filter((w, i) => w !== at[i]);
      if (cfg.accents === 'lenient') {
        return { status: 'accepted_accent', feedback: [{ code: 'accent_accepted', form: a }], matched: a };
      }
      return { status: 'almost', feedback: [{ code: 'accent_only', words }] };
    }
    const sim = similarity(gt, at);
    if (sim > bestSim) { bestSim = sim; best = { a, at }; }
  }

  if (cfg.match === 'content') {
    const stop = new Set((cfg.stopwords || []).map(w => fold(w.toLowerCase())));
    const qt = new Set(tokens(fold(normalize(question, cfg))));
    const gset = new Set(tokens(fold(g)));
    for (const a of alts) {
      const key = tokens(fold(normalize(a, cfg))).filter(w => !stop.has(w) && !qt.has(w));
      if (key.length && key.every(w => gset.has(w))) {
        return { status: 'correct', feedback: [{ code: 'content_match' }], matched: a };
      }
    }
  }

  /* Specific feedback without giving the answer away: which of the
     student's own words do not belong, how many are missing, whether it is
     only the order, and which words differ only in accents. */
  const fb = [];
  const at = best.at;
  const fg = gt.map(fold), fa = at.map(fold);
  if (gt.length === 1 && at.length === 1) {
    const d = distance(fg[0], fa[0]);
    fb.push({ code: d <= Math.max(1, Math.floor(fa[0].length / 4)) ? 'close_spelling' : 'wrong_word' });
    return { status: d <= 2 ? 'almost' : 'incorrect', feedback: fb };
  }
  if (fg.length === fa.length && !multisetMinus(fg, fa).length) {
    fb.push({ code: 'word_order' });
  } else {
    const extraFolded = new Set(multisetMinus(fg, fa));
    const extra = gt.filter(w => extraFolded.has(fold(w)));
    const accentWords = gt.filter(w => fa.includes(fold(w)) && !at.includes(w));
    const missing = multisetMinus(fa, fg).length;
    if (accentWords.length && cfg.accents !== 'lenient') fb.push({ code: 'accent_words', words: accentWords });
    if (extra.length) fb.push({ code: 'extra_words', words: extra.slice(0, 5) });
    if (missing) fb.push({ code: 'missing_words', count: missing });
  }
  const status = bestSim >= 0.6 ? 'almost' : 'incorrect';
  return { status, feedback: fb };
}

function distance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const RIGHT = new Set(['correct', 'accepted_accent']);
export const isRight = s => RIGHT.has(s);

export function mergePolicy(langCfg, keyPolicy, itemPolicy) {
  return { ...(langCfg || {}), ...(keyPolicy || {}), ...(itemPolicy || {}) };
}

/* Number of gradable items an exercise has. */
export function itemCount(ex) {
  if (ex.mode === 'self') return 0;
  if (ex.kind === 'match') return (ex.body.left || []).length;
  if (ex.kind === 'order') return 1;
  return (ex.body.items || []).length;
}

/* Grade one item of an exercise. `value` is what the page sent for it. */
export function gradeItem(ex, idx, value, langCfg) {
  const key = ex.key || {};
  if (ex.kind === 'match') {
    const want = (key.pairs || [])[idx];
    const got = String(value ?? '').trim().toUpperCase();
    if (!got) return { status: 'empty', feedback: [{ code: 'not_answered' }], expected: null };
    return got === want
      ? { status: 'correct', feedback: [], expectedText: matchText(ex, want) }
      : { status: 'incorrect', feedback: [{ code: 'match_wrong' }], expectedText: matchText(ex, want) };
  }
  if (ex.kind === 'order') {
    const want = key.order || [];
    const got = Array.isArray(value) ? value.map(v => String(v).toUpperCase()) : [];
    if (!got.length) return { status: 'empty', feedback: [{ code: 'not_answered' }] };
    const placed = want.filter((w, i) => got[i] === w).length;
    const ok = placed === want.length && got.length === want.length;
    return {
      status: ok ? 'correct' : 'incorrect',
      feedback: ok ? [] : [{ code: 'order_placed', placed, total: want.length }],
      expectedText: want.map(id => (ex.body.lines.find(l => l.id === id) || {}).text || id).join('\n')
    };
  }
  const item = (ex.body.items || [])[idx];
  const k = (key.items || [])[idx];
  if (!item || !k) return { status: 'incorrect', feedback: [{ code: 'no_key' }] };
  if (item.input === 'choice') {
    if (value === null || value === undefined || value === '') {
      return { status: 'empty', feedback: [{ code: 'not_answered' }] };
    }
    const ok = Number(value) === Number(k.choice);
    return { status: ok ? 'correct' : 'incorrect', feedback: ok ? [] : [{ code: 'choice_wrong' }],
      expectedText: item.options[k.choice] };
  }
  const policy = mergePolicy(langCfg, key.policy, k.policy);
  const r = gradeText(value, k.answers || [k.display], policy, item.prompt || '');
  r.expectedText = k.display;
  return r;
}

function matchText(ex, letter) {
  const r = (ex.body.right || []).find(x => x.id === letter);
  return r ? `${letter} · ${r.text}` : letter;
}
