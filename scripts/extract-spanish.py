#!/usr/bin/env python3
"""Extract the Spanish course from the New School workbook pages into
structured JSON the platform loads into D1.

    python3 scripts/extract-spanish.py

Reads  content/source/spanish-practice/dist/practice/level-{1,2,3}/index.html
Writes content/spanish/level-{1,2,3}.json

The workbooks are the only source of truth: titles, objectives, exercises,
answer keys, examples and glossary are copied, not written. The few places
where the platform had to add something are marked in the output:

  - topic groups ("cycles") do not exist in the workbook; the grouping below is
    an editorial proposal, stored with "proposed": true so staff can regroup;
  - Level 2/3 topics carry no stated objective, so one is composed from the
    topic title and its stated grammar focus ("objective_source": "derived");
  - instructions that pointed at page or unit numbers ("see page 3") are
    rewritten without the reference, because the platform has no order;
  - no audio exists in the source, so no listening activity is created.

Requires beautifulsoup4 (pip install beautifulsoup4).
"""
import json
import os
import re
import sys

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'content', 'source', 'spanish-practice', 'dist', 'practice')
OUT = os.path.join(ROOT, 'content', 'spanish')

HEB = re.compile(r'[֐-׿]')
GAP = re.compile(r'_{3,}')

LEVELS = {
    1: dict(cefr='A1', title_he='ספרדית רמה 1', title_target='Español · Nivel 1 · Fundamentos',
            description='בסיס ותקשורת יומיומית: משפטים שימושיים, הווה ואוצר מילים בסיסי.'),
    2: dict(cefr='A2', title_he='ספרדית רמה 2', title_target='Español · Nivel 2 · Intermedio',
            description='הרחבת השיחה והביטחון: עבר, עתיד, חוויות ותיאור מצבים יומיומיים.'),
    3: dict(cefr='B1', title_he='ספרדית רמה 3', title_target='Español · Nivel 3 · B1',
            description='ספרדית עצמאית: טקסטים ארוכים, הבעת דעה, תנאים, סבילות וסובחונטיבו.'),
}

# Editorial proposal — the workbook has no groups. Staff can regroup in the admin.
CYCLES = {
    1: [
        ('people', 'אנשים וקשרים', 'Personas y relaciones', [1, 2, 3]),
        ('daily', 'היום־יום שלי', 'La vida diaria', [4, 5, 6, 7, 8, 15]),
        ('out', 'בחוץ ובעולם', 'Fuera de casa', [9, 16, 18]),
        ('leisure', 'פנאי ותרבות', 'Tiempo libre y cultura', [10, 11, 12, 13, 14, 17, 19]),
    ],
    2: [
        ('memories', 'חוויות וזיכרונות', 'Experiencias y recuerdos', [1, 2, 10, 14, 21]),
        ('plans', 'נסיעות ותוכניות', 'Viajes y planes', [3, 4, 8, 15]),
        ('celebrations', 'אירועים וחגיגות', 'Celebraciones', [5, 6, 9]),
        ('goals', 'מטרות ורווחה', 'Metas y bienestar', [7, 11, 12, 13]),
        ('society', 'חברה ומדיה', 'Sociedad y medios', [16, 17, 18, 19, 20]),
    ],
    3: [
        ('stories', 'חוויות וסיפור', 'Experiencias y narración', [1, 5, 6, 8, 19]),
        ('work', 'עבודה, כסף ולימודים', 'Trabajo, dinero y educación', [2, 3, 7, 11]),
        ('society', 'חברה, מדיה וטכנולוגיה', 'Sociedad, medios y tecnología', [4, 9, 13, 14, 16]),
        ('people', 'אנשים, תרבות ורגש', 'Personas, cultura y emociones', [10, 12, 15, 17, 18, 20]),
        ('review', 'חזרה משולבת', 'Repaso mixto', []),
    ],
}

SUBJECT_PRONOUNS = ['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras',
                    'vosotros', 'vosotras', 'ellos', 'ellas', 'ustedes']


def slugify(s):
    s = s.lower()
    for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('ñ', 'n'), ('ü', 'u')):
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:48]


# ── text ────────────────────────────────────────────────────────────────

def tidy(s):
    s = s.replace('\xa0', ' ')
    s = re.sub(r'_{3,}', '___', s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r' *\n *', '\n', s)
    return s.strip()


def text_of(el, gaps=True, drop=('opt',)):
    """Plain text with the platform's light markup: **bold**, \n, ___ for a gap.
    Direction is not stored: the renderer splits runs by script, so a Spanish
    word inside a Hebrew sentence is isolated and set LTR automatically."""
    if el is None:
        return ''
    out = []

    def walk(node):
        if isinstance(node, NavigableString):
            out.append(str(node))
            return
        if not isinstance(node, Tag):
            return
        cls = node.get('class') or []
        if any(c in drop for c in cls):
            return
        if node.name == 'br':
            out.append('\n')
            return
        if any(c in ('slot', 'match-slot', 'conj-slot') for c in cls):
            if gaps:
                out.append(' ___ ')
            return
        if 'ns-lines' in cls or 'ln' in cls:
            return
        if node.name in ('b', 'strong') and node.get_text(strip=True):
            out.append('**' + node.get_text() + '**')
            return
        if node.name in ('p', 'div', 'li') and out and not out[-1].endswith('\n'):
            out.append('\n')
        for c in node.children:
            walk(c)
        if node.name in ('p', 'div'):
            out.append('\n')

    walk(el)
    s = tidy(''.join(out))
    s = re.sub(r'\*\*\s*\*\*', '', s)
    s = re.sub(r'(___\s*)+', '___ ', s)
    s = re.sub(r'([¿¡(])\s*___', r'\1___', s)
    s = re.sub(r'___\s+([?.,;:!)])', r'___\1', s)
    return s.strip()


def split_numbered(val):
    """'1. a · 2. b' or '1. a<br>2. b' -> ['a', 'b']."""
    t = val.replace('\r', '')
    out = []
    for m in re.finditer(r'(?:^|\n|·)\s*(\d+)\.\s*([\s\S]*?)(?=(?:\n|·)\s*\d+\.\s|$)', t):
        out.append(tidy(m.group(2)).strip(' ·'))
    return out


def key_text(val_el):
    """Answer-key value as text; <br> and <div> become newlines."""
    return text_of(val_el, gaps=False, drop=())


# ── answer alternatives ──────────────────────────────────────────────────

def alternatives(ans, recall=False):
    """Every form of an answer the key itself allows. Only what the key's own
    notation states: 'a / b' lists, 'o/a' gender pairs, '(infinitive)' notes.
    Nothing is guessed."""
    ans = ans.strip()
    alts = [ans]
    base = re.sub(r'\s*\([^)]*\)\s*$', '', ans).strip()
    if base and base != ans:
        alts.append(base)
    if recall and ' / ' in base:
        parts = [p.strip() for p in base.split(' / ') if p.strip()]
        alts += parts
    for a in list(alts):
        m = re.match(r'^(.*?)(\w+)o/\s?a\b(.*)$', a)
        if m:
            alts.append(m.group(1) + m.group(2) + 'o' + m.group(3))
            alts.append(m.group(1) + m.group(2) + 'a' + m.group(3))
    seen, res = set(), []
    for a in alts:
        a = a.strip()
        if a and a.lower() not in seen:
            seen.add(a.lower())
            res.append(a)
    return res


def clean_answer(ans):
    """Split a key entry into (answer, extra accepted answers, Hebrew note).
    The keys annotate in Hebrew: '(גם: …)' lists another accepted answer and a
    trailing Hebrew sentence explains the item — both kept, neither graded."""
    ans = ans.strip()
    extra, notes = [], []
    for m in re.finditer(r'\((?:גם|או)\s*:?\s*([^)]*)\)', ans):
        extra += [x.strip() for x in re.split(r'\s*/\s*|\s*;\s*', m.group(1)) if x.strip()]
    ans = re.sub(r'\s*\((?:גם|או)\s*:?[^)]*\)', '', ans).strip()
    m = re.search(r'[\u0590-\u05FF]', ans)
    if m:
        # the note starts at the sentence boundary before the first Hebrew letter
        cut = m.start()
        head = ans[:cut]
        b = max(head.rfind('. '), head.rfind('; '), head.rfind(' · '), head.rfind(' ('))
        if b >= 0:
            notes.append(ans[b + 1:].strip(' .;·(').strip(')'))
            ans = ans[:b + 1].strip(' ;·(')
        else:
            notes.append(ans)
            ans = ''
    return ans, extra, ' '.join(n for n in notes if n)


def parse_options(opt_el):
    txt = opt_el.get_text('\n').replace('\xa0', ' ')
    txt = tidy(txt)
    found = re.findall(r'([A-D])\.\s*(.*?)(?=\s+[A-D]\.\s|\n[A-D]\.\s|$)', txt, flags=re.S)
    if len(found) >= 2:
        return [(k, tidy(v)) for k, v in found]
    inner = txt.strip().strip('()').strip()
    if '/' in inner:
        parts = [p.strip() for p in inner.split('/') if p.strip()]
        if len(parts) > 1:
            return [(chr(65 + i), p) for i, p in enumerate(parts)]
    return []


def option_cue(choices):
    """'(תמיד: Siempre / Nunca)' carries a Hebrew cue on its first option."""
    if choices and HEB.search(choices[0][1]) and ':' in choices[0][1]:
        cue, first = choices[0][1].split(':', 1)
        return cue.strip(), [(choices[0][0], first.strip())] + choices[1:]
    return '', choices


def letter_of(ans):
    m = re.match(r'^([A-H])(?:\s*[-–:]|\s*$)', ans.strip())
    return m.group(1) if m else None


def order_seq(txt):
    return re.findall(r'\b([A-H])\b', txt)


# ── exercise builders ────────────────────────────────────────────────────

class Ctx:
    def __init__(self, level, unit):
        self.level = level
        self.unit = unit
        self.problems = []

    def warn(self, msg):
        self.problems.append(f'L{self.level} U{self.unit}: {msg}')


def item_prompt(li):
    """Prompt text of one <li>, with the cue split out."""
    cue_el = li.find(class_='he-cue')
    change = li.find(class_='change-cue')
    cue = ''
    if change:
        cue = change.get_text(strip=True)
    prompt = text_of(li)
    if change:
        prompt = prompt.replace(cue, '').strip()
    prompt = prompt.replace('חזרה מתוך היחידה:', '').strip()
    prompt = re.sub(r'^יחידה\s*\d+\s*:\s*', '', prompt)
    return prompt, cue


POLICY = {
    'recall': {'accents': 'lenient'},
    'strict': {'accents': 'strict'},
    'pron': {'accents': 'strict', 'optionalLeading': SUBJECT_PRONOUNS},
    'content': {'accents': 'lenient', 'match': 'content'},
}


def build_items(ctx, chunk, answers, *, kind, skill, policy, title, instr, input_type='text',
                extra=None):
    ol = chunk.find('ol', class_='ns-items')
    lis = ol.find_all('li', recursive=False) if ol else []
    items, keys = [], []
    for i, li in enumerate(lis):
        opt = li.find(class_='opt')
        choices = parse_options(opt) if opt else []
        opt_cue, choices = option_cue(choices)
        prompt, cue = item_prompt(li)
        cue = cue or opt_cue
        raw = answers[i] if i < len(answers) else ''
        ans, extra_alts, note = clean_answer(raw)
        if not ans and not note:
            ctx.warn(f'{title}: missing key for item {i + 1}')
        item = {'prompt': prompt}
        if opt and not choices:
            item['hint'] = opt.get_text(strip=True).strip('()').strip()
        if cue:
            item['cue'] = cue
        k = {'display': ans}
        if note:
            k['note'] = note
        if choices:
            item['input'] = 'choice'
            item['options'] = [c[1] for c in choices]
            let = letter_of(ans)
            idx = None
            if let:
                idx = ord(let) - 65
            else:
                norm = lambda s: re.sub(r'[\s.¿?¡!]+', ' ', s).strip().lower()
                for j, (_, t) in enumerate(choices):
                    if norm(t) == norm(ans):
                        idx = j
            if idx is None or idx >= len(choices):
                ctx.warn(f'{title}: option not found for item {i + 1}: {ans!r} in {choices}')
                idx = 0
            k['choice'] = idx
            k['display'] = choices[idx][1]
        else:
            it = input_type
            if li.find(class_='ns-lines') and input_type == 'text':
                it = 'sentence'
            item['input'] = it
            k['answers'] = alternatives(ans, recall=(policy is POLICY['recall']))
            for a in extra_alts:
                k['answers'] += [x for x in alternatives(a) if x not in k['answers']]
            if not ans:
                ctx.warn(f'{title}: key item {i + 1} is only a note: {note!r}')
        items.append(item)
        keys.append(k)
    ex = {'kind': kind, 'skill': skill, 'title': title, 'instructions': instr,
          'mode': 'auto', 'body': {'items': items}, 'key': {'items': keys, 'policy': policy}}
    if extra:
        ex['body'].update(extra)
    return ex


def build_match(ctx, chunk, answers, title, instr, skill='vocab'):
    ol = chunk.find('ol', class_='ns-items')
    left = [text_of(li).replace('___', '').strip() for li in ol.find_all('li', recursive=False)]
    right = []
    for p in chunk.find(class_='match-meanings').find_all('p'):
        b = p.find('b')
        letter = b.get_text(strip=True)
        b.extract()
        right.append({'id': letter, 'text': tidy(p.get_text())})
    letters = [re.sub(r'[^A-H]', '', a) for a in answers]
    if len(letters) != len(left):
        ctx.warn(f'{title}: {len(letters)} keys for {len(left)} rows')
    return {'kind': 'match', 'skill': skill, 'title': title, 'instructions': instr, 'mode': 'auto',
            'body': {'left': left, 'right': right},
            'key': {'pairs': letters, 'policy': POLICY['recall']}}


def build_order(ctx, chunk, keytxt, title, instr, container_cls, skill='communication'):
    box = chunk.find(class_=container_cls)
    lines = []
    for p in box.find_all('p'):
        b = p.find('b')
        letter = b.get_text(strip=True).strip('.')
        b.extract()
        lines.append({'id': letter, 'text': tidy(p.get_text())})
    seq = order_seq(keytxt)
    if sorted(seq) != sorted(l['id'] for l in lines):
        ctx.warn(f'{title}: order key {seq} vs lines {[l["id"] for l in lines]}')
    return {'kind': 'order', 'skill': skill, 'title': title, 'instructions': instr, 'mode': 'auto',
            'body': {'lines': lines}, 'key': {'order': seq, 'policy': POLICY['strict']}}


def build_open(title, instr, skill, *, prompt='', brief='', models=None, criteria='', note=''):
    body = {'prompt': prompt, 'brief': brief}
    if note:
        body['note'] = note
    return {'kind': 'open', 'skill': skill, 'title': title, 'instructions': instr, 'mode': 'self',
            'body': body, 'key': {'models': [m for m in (models or []) if m], 'criteria': criteria}}


def instr_of(chunk):
    return '\n'.join(text_of(p) for p in chunk.find_all('p', class_='instr', recursive=False))


def sec_title(chunk):
    h = chunk.find('h2', class_='sec')
    if not h:
        return ''
    n = h.find(class_='n')
    t = h.get_text()
    if n:
        t = t.replace(n.get_text(), '', 1)
    return tidy(t)


def text_block(chunk):
    t = chunk.find(class_='ns-text')
    return text_of(t) if t else ''


# ── keys ─────────────────────────────────────────────────────────────────

def read_keys(soup):
    """{(unit, label_number_or_tag): val_element} across all key pages."""
    keys = {}
    for ku in soup.select('.key-unit'):
        h = ku.find('h3')
        ht = h.get_text() if h else ''
        m = re.search(r'יחידה\s*(\d+)', ht)
        unit = int(m.group(1)) if m else None
        for line in ku.select('.key-line'):
            lbl = line.find(class_='lbl').get_text(strip=True)
            val = line.find(class_='val')
            mm = re.match(r'^(\d+)\s', lbl)
            if unit and mm:
                keys[(unit, int(mm.group(1)), lbl)] = val
    return keys


def key_for(keys, unit, n):
    for (u, num, lbl), v in keys.items():
        if u == unit and num == n:
            return lbl, v
    return None, None


# ── level 1 ─────────────────────────────────────────────────────────────

def unit_pages(soup, unit):
    return [p for p in soup.select('section.page') if p.get('data-unit') == str(unit)]


def chunks_of(pages):
    out = []
    for p in pages:
        out += p.select('.flow > .chunk')
    return out


def numbered_chunks(chunks):
    res = {}
    for c in chunks:
        h = c.find('h2', class_='sec')
        if h and h.find(class_='n'):
            n = h.find(class_='n').get_text(strip=True)
            if n.isdigit():
                res.setdefault(int(n), c)
    return res


def lesson_header(chunks):
    first = chunks[0]
    title = first.find('h1', class_='unit-title').get_text(strip=True)
    es = first.find(class_='unit-es').get_text(strip=True)
    skills = [s.get_text(strip=True) for s in first.select('.skill-row .skill')]
    lead = first.find('p', class_='lead')
    lead = text_of(lead) if lead else ''
    quizlet = ''
    a = first.find('a', href=re.compile('quizlet'))
    if a:
        quizlet = a['href']
    home = ''
    for p in first.find_all('p', class_='instr'):
        t = text_of(p)
        if t.startswith('לחיזוק בבית'):
            home = t.split(':', 1)[1].strip()
    return title, es, skills, lead, quizlet, home


def l1_explanation(chunks):
    exp = {'rules': [], 'examples': [], 'tips': [], 'mistakes': []}
    for c in chunks:
        for r in c.select('.ns-rule p'):
            exp['rules'].append(text_of(r))
        for e in c.select('.ns-example'):
            exp['examples'] += [x.replace('**', '') for x in text_of(e).split('\n') if x.strip()]
        for t in c.select('.ns-tip'):
            tag = t.find(class_='tag')
            if tag:
                tag.extract()
            exp['tips'].append(text_of(t))
        for m in c.select('.ns-mistake'):
            p = m.find('p')
            pairs = []
            pair = m.find(class_='pair')
            if pair:
                for bad, good in zip(pair.select('.bad'), pair.select('.good')):
                    pairs.append({'bad': bad.get_text(strip=True), 'good': good.get_text(strip=True)})
            exp['mistakes'].append({'text': text_of(p) if p else '', 'pairs': pairs})
    return exp


def build_level1(soup, glossary):
    keys = read_keys(soup)
    topics = []
    for unit in range(1, 20):
        ctx = Ctx(1, unit)
        chunks = chunks_of(unit_pages(soup, unit))
        title, es, skills, lead, quizlet, home = lesson_header(chunks)
        num = numbered_chunks(chunks)
        # skill-row alternates Hebrew label / Spanish label
        pairs = [{'he': skills[i], 'target': skills[i + 1] if i + 1 < len(skills) else ''}
                 for i in range(0, len(skills), 2)]
        self_check = []
        for c in chunks:
            tbl = c.find('table', class_='ns-check')
            if tbl:
                self_check = [tr.find('td').get_text(strip=True) for tr in tbl.find_all('tr')]

        def K(n):
            lbl, v = key_for(keys, unit, n)
            return (lbl or ''), (key_text(v) if v is not None else '')

        exs = []

        def add(ex, n):
            ex['source_ref'] = f'L1-U{unit:02d}-E{n}'
            exs.append(ex)

        # 1 vocabulary recall (key "1 חזרה ממוקדת")
        c = num[1]
        add(build_items(ctx, c, split_numbered(K(1)[1]), kind='recall', skill='vocab',
                        policy=POLICY['recall'], title='שליפת מילים מהזיכרון',
                        instr='כתבו בספרדית את המילה המתאימה לכל מילה בעברית, בלי להציץ.'), 1)
        c = num[2]
        add(build_items(ctx, c, split_numbered(K(2)[1]), kind='gap', skill='grammar',
                        policy=POLICY['strict'], title=sec_title(c), instr=instr_of(c)), 2)
        c = num[3]
        add(build_items(ctx, c, split_numbered(K(3)[1]), kind='correction', skill='grammar',
                        policy=POLICY['strict'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence'), 3)
        c = num[4]
        add(build_items(ctx, c, split_numbered(K(4)[1]), kind='transform', skill='grammar',
                        policy=POLICY['pron'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence'), 4)
        c = num[5]
        add(build_items(ctx, c, split_numbered(K(5)[1]), kind='translate', skill='production',
                        policy=POLICY['pron'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence'), 5)
        c = num[6]
        add(build_items(ctx, c, split_numbered(K(6)[1]), kind='reading', skill='reading',
                        policy=POLICY['content'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence', extra={'text': text_block(c)}), 6)
        c = num[7]
        qs = [text_of(li) for li in c.select('ol.ns-items > li')]
        add(build_open(sec_title(c), instr_of(c), 'speaking', prompt='\n'.join(qs),
                       note='משימה אישית: אין תשובה אחת נכונה. בדקו את עצמכם לפי ההנחיה.'), 7)
        c = num[8]
        add(build_open(sec_title(c), instr_of(c), 'writing', models=[K(8)[1]]), 8)
        c = num[9]
        k9, _, challenge = K(9)[1].partition('האתגר:')
        k9 = k9.strip().rstrip('·').strip()
        add(build_items(ctx, c, split_numbered(k9), kind='gap', skill='grammar',
                        policy=POLICY['strict'], title='חזרה משולבת',
                        instr='השלימו או בחרו את הצורה הנכונה. התרגיל חוזר על מבנים מנושאים אחרים ברמה.'), 9)
        c = num[10]
        if challenge.strip():
            add(build_open(sec_title(c), instr_of(c), 'production', models=[challenge.strip()]), 10)
        else:
            add(build_open(sec_title(c), instr_of(c), 'speaking',
                           note='משימה פתוחה לבחירה: אין מפתח. אפשר להביא את הניסוח לשיעור.'), 10)
        c = num[11]
        add(build_match(ctx, c, split_numbered(K(11)[1]), sec_title(c), instr_of(c)), 11)
        c = num[12]
        bank = [w.strip() for w in c.find(class_='wordbank').get_text().split('·') if w.strip()]
        add(build_items(ctx, c, split_numbered(K(12)[1]), kind='bank', skill='vocab',
                        policy=POLICY['strict'], title=sec_title(c), instr=instr_of(c),
                        input_type='bank', extra={'wordbank': bank}), 12)
        c = num[13]
        k13 = K(13)[1]
        add(build_items(ctx, c, split_numbered(k13), kind='transform', skill='grammar',
                        policy=POLICY['pron'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence'), 13)
        c = num[14]
        add(build_order(ctx, c, K(14)[1], sec_title(c),
                        'סדרו את השורות לשיחה הגיונית, ואחר כך קראו אותה בקול.', 'dialog-lines'), 14)
        c = num[15]
        add(build_items(ctx, c, split_numbered(K(15)[1]), kind='reading', skill='reading',
                        policy=POLICY['content'], title=sec_title(c), instr=instr_of(c),
                        input_type='sentence', extra={'text': text_block(c)}), 15)
        c = num[16]
        crit = ''
        for (u, n, lbl), v in keys.items():
            if u == unit and n == 16 and 'בדיקת' in lbl:
                crit = key_text(v)
        model = ''
        for (u, n, lbl), v in keys.items():
            if u == unit and n == 16 and 'דוגמת' in lbl:
                model = key_text(v)
        add(build_open(sec_title(c), instr_of(c), 'writing', models=[model], criteria=crit), 16)

        # examples from the topic: the corrected sentences of "find the mistake"
        exp = l1_explanation(chunks)
        tags = []
        toc = soup.select_one('#front-2')
        for tr in toc.select('tr'):
            tds = tr.find_all('td')
            if len(tds) >= 4 and tds[0].get_text(strip=True) == f'{unit:02d}':
                tags = [t.strip() for t in tds[3].get_text().split('·') if t.strip()]
        topics.append(dict(
            unit=unit, title_he=title, title_target=es, objective=lead,
            objective_source='workbook', home_focus=home, skills=pairs[:2],
            grammar=tags, explanation=exp, quizlet=quizlet, self_check=self_check,
            exercises=exs, problems=ctx.problems))
    return topics


# ── levels 2 and 3 ───────────────────────────────────────────────────────

def conj_prompt(li):
    cp = li.find(class_='conj-prompt')
    if cp:
        b = cp.find('b').get_text(strip=True)
        spans = [s for s in cp.find_all('span') if 'conj-slot' not in (s.get('class') or [])]
        verb = spans[0].get_text(strip=True) if spans else ''
        cue = cp.find('i').get_text(strip=True) if cp.find('i') else ''
        return f'**{b}** · {verb} · {cue}', (b, verb, cue)
    t = text_of(li)
    m = re.match(r'^\*\*(.+?)\*\*\s*·\s*(.+?)\s*·\s*(.+?)\s*→\s*___', t)
    if m:
        return f'**{m.group(1)}** · {m.group(2)} · {m.group(3)}', (m.group(1), m.group(2), m.group(3))
    return t, None


def build_conj(ctx, lis, answers, title, instr):
    items, keys = [], []
    for i, li in enumerate(lis):
        p, _ = conj_prompt(li)
        ans = answers[i] if i < len(answers) else ''
        if not ans:
            ctx.warn(f'{title}: missing key {i + 1}')
        items.append({'prompt': p, 'input': 'text'})
        keys.append({'display': ans, 'answers': alternatives(ans)})
    return {'kind': 'conjugation', 'skill': 'grammar', 'title': title, 'instructions': instr,
            'mode': 'auto', 'body': {'items': items}, 'key': {'items': keys, 'policy': POLICY['strict']}}


def model_and_criteria(val):
    """Level 2/3 open-task keys: a model text (.key-model) and a checklist."""
    if val is None:
        return [], ''
    models = [text_of(m) for m in val.select('.key-model')]
    for m in val.select('.key-model'):
        m.extract()
    crit = text_of(val)
    crit = crit.replace('**', '')
    for label in ('טקסט לדוגמה:', 'מודל מבני:', 'מודל לתוכן המרכזי:', 'בדיקה עצמית:'):
        crit = crit.replace(label, '')
    crit = crit.strip()
    return models, crit


def split_parts(val):
    """'א · זיהוי' / 'ב · הטיה' key -> (partA answers, partB answers)."""
    t = key_text(val)
    parts = re.split(r'\*\*[אב] · [^*]+\*\*', t)
    parts = [p for p in parts if p.strip()]
    return [split_numbered(p) for p in parts]


def build_level23(level, soup, conj_index):
    keys = read_keys(soup)
    topics = []
    units = sorted({int(p['data-unit']) for p in soup.select('section.page[data-unit]')
                    if (p.get('data-unit') or '').isdigit()})
    for unit in units:
        ctx = Ctx(level, unit)
        chunks = chunks_of(unit_pages(soup, unit))
        title, es, skills, lead, quizlet, home = lesson_header(chunks)
        num = numbered_chunks(chunks)
        exs = []

        def K(n):
            return key_for(keys, unit, n)

        def add(ex, n):
            ex['source_ref'] = f'L{level}-U{unit:02d}-E{n}'
            exs.append(ex)

        def ans(n):
            return split_numbered(key_text(K(n)[1]))

        c = num[1]
        add(build_items(ctx, c, ans(1), kind='recall', skill='vocab', policy=POLICY['recall'],
                        title=sec_title(c), instr=instr_of(c)), 1)
        c = num[2]
        add(build_match(ctx, c, ans(2), sec_title(c), instr_of(c)), 2)
        c = num[3]
        add(build_items(ctx, c, ans(3), kind='choice', skill='vocab', policy=POLICY['recall'],
                        title=sec_title(c), instr=instr_of(c)), 3)
        # 4: bank with (n) gaps in the text plus extra cue items
        c = num[4]
        bank = [w.strip() for w in c.find(class_='wordbank').get_text().split('·') if w.strip()]
        a4 = ans(4)
        text = text_block(c)
        n_text = len(re.findall(r'___', text))
        text_items = []
        idx = [0]

        def repl(m):
            idx[0] += 1
            return '{{%d}}' % idx[0]
        text = re.sub(r'___\s*\(\d+\)', repl, text)
        text = re.sub(r'___', repl, text)
        for i in range(idx[0]):
            text_items.append({'prompt': '', 'input': 'bank', 'inText': True})
        ex4 = build_items(ctx, c, a4[idx[0]:], kind='bank', skill='vocab', policy=POLICY['strict'],
                          title=sec_title(c), instr=instr_of(c), input_type='bank',
                          extra={'wordbank': bank, 'text': text})
        ex4['body']['items'] = text_items + ex4['body']['items']
        ex4['key']['items'] = [{'display': a, 'answers': alternatives(a, recall=True)} for a in a4[:idx[0]]] \
            + ex4['key']['items']
        if len(ex4['key']['items']) != len(a4):
            ctx.warn('ex4 key count mismatch')
        add(ex4, 4)
        # 5 word order
        c = num[5]
        lis = c.select('ol.ns-items > li')
        items, kk = [], []
        a5 = ans(5)
        for i, li in enumerate(lis):
            toks = [t.strip() for t in li.find('span').get_text().split('/') if t.strip()]
            items.append({'prompt': '', 'input': 'tokens', 'tokens': toks})
            a = a5[i] if i < len(a5) else ''
            kk.append({'display': a, 'answers': [a]})
        add({'kind': 'wordorder', 'skill': 'grammar', 'title': sec_title(c), 'instructions': instr_of(c),
             'mode': 'auto', 'body': {'items': items},
             'key': {'items': kk, 'policy': POLICY['strict']}}, 5)
        c = num[6]
        add(build_items(ctx, c, ans(6), kind='correction', skill='grammar', policy=POLICY['strict'],
                        title=sec_title(c), instr=instr_of(c), input_type='sentence'), 6)
        # 7: two parts
        c = num[7]
        lbl, v = K(7)
        pa, pb = split_parts(v)
        ols = c.find_all('ol', class_='ns-items')
        heads = [h.get_text(strip=True) for h in c.find_all('h3', class_='subexercise')]
        fake = BeautifulSoup('<div></div>', 'html.parser').div
        fake.append(ols[0])
        exa = build_items(ctx, fake, pa, kind='choice', skill='grammar', policy=POLICY['strict'],
                          title='מזהים את המשפט התקין', instr='בכל זוג בחרו את המשפט התקין.')
        add(exa, 7)
        add(build_conj(ctx, ols[1].find_all('li', recursive=False), pb, 'מטים את הפועל',
                       'כתבו בעצמכם את צורת הפועל המתאימה לנושא ולרמז הזמן.'), 7)
        for (s, it) in zip([li for li in ols[1].find_all('li', recursive=False)], pb):
            p, parts = conj_prompt(s)
            if parts:
                conj_index.setdefault(it.strip().lower(), parts)
        c = num[8]
        qs = [text_of(li) for li in c.select('ol.ns-items > li')]
        m8, c8 = model_and_criteria(K(8)[1])
        add(build_open(sec_title(c), instr_of(c), 'speaking', prompt='\n'.join(qs), models=m8, criteria=c8), 8)
        c = num[9]
        lis9 = c.select('ol.ns-items > li')
        a9 = ans(9)
        add(build_conj(ctx, lis9, a9, sec_title(c), instr_of(c)), 9)
        for li, a in zip(lis9, a9):
            _, parts = conj_prompt(li)
            if parts:
                conj_index.setdefault(a.strip().lower(), parts)
        c = num[10]
        add(build_items(ctx, c, ans(10), kind='reading', skill='reading', policy=POLICY['content'],
                        title=sec_title(c), instr=instr_of(c), input_type='sentence',
                        extra={'text': text_block(c)}), 10)
        c = num[11]
        m11, c11 = model_and_criteria(K(11)[1])
        brief = text_of(c.find(class_='writing-brief')) if c.find(class_='writing-brief') else ''
        add(build_open(sec_title(c), instr_of(c), 'writing', brief=brief, models=m11, criteria=c11), 11)
        c = num[12]
        add(build_order(ctx, c, key_text(K(12)[1]), sec_title(c), instr_of(c), 'dialogue-order'), 12)
        c = num[13]
        add(build_order(ctx, c, key_text(K(13)[1]), sec_title(c), instr_of(c), 'timeline-order',
                        skill='reading'), 13)
        c = num[14]
        m14, c14 = model_and_criteria(K(14)[1])
        brief = text_of(c.find(class_='writing-brief')) if c.find(class_='writing-brief') else ''
        add(build_open(sec_title(c), instr_of(c), 'writing', brief=brief, models=m14, criteria=c14), 14)
        # 15: mixed self-test; vocabulary items lenient, verb items strict
        c = num[15]
        a15 = ans(15)
        lis = c.select('ol.ns-items > li')
        items, kk = [], []
        for i, li in enumerate(lis):
            a = a15[i] if i < len(a15) else ''
            if li.find(class_='he-cue'):
                p, cue = item_prompt(li)
                items.append({'prompt': p, 'input': 'text'})
                kk.append({'display': a, 'answers': alternatives(a, recall=True),
                           'policy': POLICY['recall']})
            else:
                p, _ = conj_prompt(li)
                items.append({'prompt': p, 'input': 'text'})
                kk.append({'display': a, 'answers': alternatives(a)})
        add({'kind': 'selftest', 'skill': 'mixed', 'title': sec_title(c),
             'instructions': 'פתרו בלי מילון: השלמות אוצר מילים והטיות פעלים. '
                             'אם פחות משמונה תשובות נכונות, כדאי לחזור לשליפת המילים, לתיקון הטעויות ולהטיית הפעלים בנושא הזה.',
             'mode': 'auto', 'body': {'items': items},
             'key': {'items': kk, 'policy': POLICY['strict']}}, 15)
        c = num[16]
        m16, c16 = model_and_criteria(K(16)[1])
        add(build_open(sec_title(c), instr_of(c), 'writing', models=m16, criteria=c16), 16)

        if level == 3:
            c = num[17]
            bank = [w.strip() for w in c.find(class_='wordbank').get_text().split('·') if w.strip()]
            add(build_items(ctx, c, ans(17), kind='bank', skill='vocab', policy=POLICY['strict'],
                            title=sec_title(c), instr=instr_of(c), input_type='bank',
                            extra={'wordbank': bank}), 17)
            c = num[18]
            ex18 = build_items(ctx, c, ans(18), kind='conjugation', skill='grammar',
                               policy=POLICY['strict'], title=sec_title(c), instr=instr_of(c))
            add(ex18, 18)
            # 19: comprehension of the final reading text in the preceding chunk
            c = num[19]
            reading = ''
            for ch in chunks:
                fr = ch.find(class_='final-reading-copy')
                if fr:
                    reading = '\n\n'.join(text_of(p) for p in fr.find_all('p')) or text_of(fr)
            add(build_items(ctx, c, ans(19), kind='reading', skill='reading', policy=POLICY['content'],
                            title='קריאה מסכמת · שאלות הבנה',
                            instr='קראו את הטקסט וענו בספרדית במשפט קצר.', input_type='sentence',
                            extra={'text': reading}), 19)

        focus = lead
        vocab_n = ''
        for s in skills:
            if 'ערכי מילון' in s:
                vocab_n = s
        topics.append(dict(
            unit=unit, title_he=title, title_target=es,
            objective=f'לדבר ולכתוב על הנושא „{title}“ בספרדית, תוך שימוש במבנים: {focus}.',
            objective_source='derived', home_focus='', grammar=[focus],
            skills=[{'he': 'דקדוק בשימוש', 'target': focus},
                    {'he': 'אוצר מילים: ' + title, 'target': es}],
            explanation={'rules': [], 'examples': [], 'tips': [], 'mistakes': []},
            quizlet=quizlet, self_check=[], exercises=exs, problems=ctx.problems))
    return topics


def add_conj_hints(topics, conj_index):
    """Level 3 'verbs in context' items give no infinitive. The same answer
    appears in a conjugation drill of the level with its infinitive, so that
    infinitive is attached as a hint — taken from the workbook, not guessed."""
    for t in topics:
        for ex in t['exercises']:
            if ex['kind'] != 'conjugation' or 'בתוך הקשר' not in ex['title'] and 'בהקשר' not in ex['title']:
                continue
            for it, k in zip(ex['body']['items'], ex['key']['items']):
                parts = conj_index.get(k['display'].strip().lower())
                if parts and '·' not in it['prompt']:
                    it['hint'] = parts[1]


def build_checkpoints(soup, topics_by_unit, conj_index):
    """Level 3 review stations and the final review, as mixed-review topics.
    Their workbook titles are numbered ('תחנת חזרה 1', 'unidades 01-04'); here
    they are named by the topics they cover instead."""
    res = []
    specials = [p for p in soup.select('section.page') if (p.get('id') or '').startswith('checkpoint-')
                or p.get('id') == 'final-diagnostic']
    for start in specials:
        sid = start['id']
        pages = [p for p in soup.select('section.page') if p.get('data-group') == sid or p is start]
        parts = []
        for p in pages:
            parts += p.select('.checkpoint-part')
        head = start.find(class_='unit-es').get_text(strip=True)
        m = re.search(r'(\d+)-(\d+)', head)
        if m:
            covered = list(range(int(m.group(1)), int(m.group(2)) + 1))
            names = [topics_by_unit[u]['title_he'] for u in covered if u in topics_by_unit]
            title = 'חזרה משולבת: ' + ' · '.join(names)
            target = 'Repaso mixto: ' + ' · '.join(topics_by_unit[u]['title_target'] for u in covered)
        else:
            covered = sorted(topics_by_unit)
            title = 'חזרה מסכמת על כל נושאי הרמה'
            target = 'Repaso general · Nivel 3'
        ctx = Ctx(3, sid)
        exs = []
        for part in parts:
            answers = json.loads(part['data-answers'])
            h = part.find('h2')
            n = h.find(class_='n')
            ptitle = tidy(h.get_text().replace(n.get_text(), '', 1) if n else h.get_text())
            ptitle = re.sub(r'^(חלק )?[אבגד] · ', '', ptitle)
            instr = instr_of(part)
            if part.find(class_='ns-text'):
                ex = build_items(ctx, part, answers, kind='reading', skill='reading',
                                 policy=POLICY['content'], title=ptitle, instr=instr,
                                 input_type='sentence', extra={'text': text_block(part)})
            elif part.find(class_='he-cue'):
                ex = build_items(ctx, part, answers, kind='recall', skill='vocab',
                                 policy=POLICY['recall'], title=ptitle, instr=instr)
            elif 'תיקון' in ptitle:
                ex = build_items(ctx, part, answers, kind='correction', skill='grammar',
                                 policy=POLICY['strict'], title=ptitle, instr=instr, input_type='sentence')
            else:
                ex = build_items(ctx, part, answers, kind='conjugation', skill='grammar',
                                 policy=POLICY['strict'], title=ptitle, instr=instr)
                for it, k in zip(ex['body']['items'], ex['key']['items']):
                    parts_ = conj_index.get(k['display'].strip().lower())
                    if parts_:
                        it['hint'] = parts_[1]
            ex['source_ref'] = f'L3-{sid}'
            exs.append(ex)
        res.append(dict(unit=None, special=sid, title_he=title, title_target=target,
                        objective='לחזור בערבוביה על אוצר מילים, פעלים וקריאה מכמה נושאים ברמה.',
                        objective_source='derived', home_focus='', grammar=[],
                        skills=[{'he': 'שליפת אוצר מילים', 'target': 'Vocabulario'},
                                {'he': 'פעלים בהקשר', 'target': 'Verbos en contexto'}],
                        explanation={'rules': [], 'examples': [], 'tips': [], 'mistakes': []},
                        quizlet='', self_check=[], exercises=exs, problems=ctx.problems,
                        covers=covered))
    return res


def glossary_of(soup):
    out = []
    for tr in soup.select('table.glossary-table tbody tr'):
        tds = tr.find_all('td')
        if len(tds) < 3:
            continue
        units = [int(u) for u in re.findall(r'\d+', tds[2].get_text())]
        out.append({'term': tds[0].get_text(strip=True), 'he': tds[1].get_text(strip=True), 'units': units})
    return out


def rubric_of(soup):
    t = soup.select_one('table.rubric-table')
    if not t:
        return None
    rows = [[td.get_text(strip=True) for td in tr.find_all(['td', 'th'])] for tr in t.find_all('tr')]
    return rows


def examples_from_corrections(topic):
    """The corrected sentences of the error-correction activity are the
    workbook's own correct examples of the topic's grammar."""
    for ex in topic['exercises']:
        if ex['kind'] == 'correction':
            return [k['display'] for k in ex['key']['items'] if k.get('display')][:4]
    return []


WORDING = [
    # The platform has topics, not numbered units, and feedback instead of a
    # key page at the back of the book.
    ('ליחידה הבאה', 'לנושא אחר'), ('של היחידה', 'של הנושא'), ('מהיחידה', 'מהנושא'),
    ('מן היחידה', 'מן הנושא'), ('ביחידה', 'בנושא'), ('היחידה', 'הנושא'),
    ('שבמפתח', 'שבמשוב'), ('מול המפתח', 'מול המשוב'), ('במפתח', 'במשוב'), ('למפתח', 'למשוב'),
    ('שבסוף החוברת', 'שבפלטפורמה'), ('בחוברת', 'בתרגול'),
]
WORDED = {'title', 'instructions', 'criteria', 'note', 'self_check', 'home_focus'}


def platform_wording(node, key=None):
    if isinstance(node, dict):
        return {k: platform_wording(v, k) for k, v in node.items()}
    if isinstance(node, list):
        return [platform_wording(v, key) for v in node]
    if isinstance(node, str) and key in WORDED:
        for a, b in WORDING:
            node = node.replace(a, b)
    return node


def main():
    os.makedirs(OUT, exist_ok=True)
    problems = []
    for level in (1, 2, 3):
        path = os.path.join(SRC, f'level-{level}', 'index.html')
        soup = BeautifulSoup(open(path, encoding='utf-8').read(), 'html.parser')
        glossary = glossary_of(soup)
        conj_index = {}
        if level == 1:
            topics = build_level1(soup, glossary)
        else:
            topics = build_level23(level, soup, conj_index)
            add_conj_hints(topics, conj_index)
        by_unit = {t['unit']: t for t in topics}
        specials = build_checkpoints(soup, by_unit, conj_index) if level == 3 else []

        for t in topics:
            t['slug'] = f'es{level}-' + slugify(t['title_target'])
            t['vocab'] = [{'term': g['term'], 'he': g['he']} for g in glossary if t['unit'] in g['units']]
            if not t['explanation']['examples']:
                t['explanation']['examples'] = examples_from_corrections(t)
                t['explanation']['examples_source'] = 'corrections'
        for s in specials:
            s['slug'] = f'es{level}-' + s['special']
            s['vocab'] = []

        cycles = []
        for key, he, tgt, units in CYCLES[level]:
            members = [by_unit[u]['slug'] for u in units]
            if key == 'review':
                members = [s['slug'] for s in specials]
            cycles.append({'key': key, 'title_he': he, 'title_target': tgt, 'topics': members,
                           'proposed': True})
        grouped = {s for c in cycles for s in c['topics']}
        missing = [t['slug'] for t in topics + specials if t['slug'] not in grouped]
        if missing:
            problems.append(f'L{level}: ungrouped topics {missing}')

        all_topics = topics + specials
        n_ex = sum(len(t['exercises']) for t in all_topics)
        for t in all_topics:
            problems += t.pop('problems')
        data = {
            'language': 'es', 'level': level, **LEVELS[level],
            'source': f'content/source/spanish-practice/dist/practice/level-{level}/index.html',
            'rubric': rubric_of(soup),
            'cycles': cycles, 'topics': platform_wording(all_topics), 'glossary': glossary,
        }
        with open(os.path.join(OUT, f'level-{level}.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print(f'level {level}: {len(topics)} topics, {len(specials)} review sets, '
              f'{n_ex} activities, {len(glossary)} glossary entries')
    if problems:
        print('\nProblems:')
        for p in problems:
            print('  ' + p)
        sys.exit(1)


if __name__ == '__main__':
    main()
