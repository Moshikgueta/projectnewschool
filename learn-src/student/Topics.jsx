import { useState, useMemo } from 'preact/hooks';
import { t } from '../i18n.js';
import { useApi, View, Status, useTitle } from '../ui.jsx';
import { T } from '../text.jsx';

const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f\u0591-\u05C7]/g, '').toLowerCase();

/* Groups of topics as clusters — no numbers, no arrows, no path. Topics sit
   in alphabetical order inside a group only so they are easy to find. */
export function TopicMap({ cycles, topics, lang = 'es', dir = 'ltr' }) {
  const groups = groupTopics(cycles, topics);
  return (
    <div class="grid two">
      {groups.map(g => (
        <section class="cluster" key={g.id} aria-label={g.title_he}>
          <h3>{g.title_he} {g.title_target && <bdi class="tl" lang={lang} dir={dir}>{g.title_target}</bdi>}</h3>
          <div class="topic-cloud">
            {g.topics.map(tp => (
              <a key={tp.id} class="topic-chip" href={`#/t/${tp.id}`}>
                <Status s={tp.stats.status} />
                <span>{tp.title_he}</span>
                <span class="sr-only">— {t.status[tp.stats.status]}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupTopics(cycles, topics) {
  const byCycle = cycles.map(c => ({ ...c, topics: topics.filter(tp => tp.cycle_id === c.id) })).filter(g => g.topics.length);
  const rest = topics.filter(tp => !cycles.some(c => c.id === tp.cycle_id));
  if (rest.length) byCycle.push({ id: '_rest', title_he: t.ungrouped, title_target: '', topics: rest });
  byCycle.forEach(g => g.topics.sort((a, b) => a.title_he.localeCompare(b.title_he, 'he')));
  return byCycle;
}

export function Topics({ levelId, route }) {
  const q = useApi(`/api/learn/levels/${levelId}/topics`, [levelId]);
  const [text, setText] = useState(route.query.get('q') || '');
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('');
  const [cycle, setCycle] = useState('');
  const [view, setView] = useState('cards');
  useTitle(t.topicsTitle);

  return (
    <View q={q}>{d => {
      const lang = d.level.lang.id, dir = d.level.lang.dir;
      const needle = fold(text.trim());
      const hit = tp => {
        if (!needle) return true;
        const fields = {
          topic: [tp.title_he, tp.title_target],
          goal: [tp.objective],
          grammar: [...tp.grammar, ...tp.skills.map(s => s.target + ' ' + s.he)],
          vocab: tp.vocab
        };
        const pool = scope === 'all' ? Object.values(fields).flat() : fields[scope];
        return pool.some(v => fold(v).includes(needle));
      };
      const list = d.topics.filter(tp => hit(tp) && (!status || tp.stats.status === status) && (!cycle || tp.cycle_id === cycle));
      return (
        <div>
          <div class="section-title" style={{ marginTop: 0 }}>
            <div>
              <h1>{t.topicsTitle}</h1>
              <p class="lead" style={{ margin: 0 }}>{t.topicsLead}</p>
            </div>
            <div class="view-toggle" role="group" aria-label="תצוגה">
              <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>{t.viewCards}</button>
              <button aria-pressed={view === 'map'} onClick={() => setView('map')}>{t.viewMap}</button>
            </div>
          </div>
          <div class="filters" role="search">
            <label><span class="sr-only">{t.search}</span>
              <input type="search" placeholder={t.searchPh} value={text} onInput={e => setText(e.target.value)} dir="auto" />
            </label>
            <label><span class="sr-only">תחום החיפוש</span>
              <select value={scope} onChange={e => setScope(e.target.value)}>
                {Object.entries(t.scope).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label><span class="sr-only">{t.allGroups}</span>
              <select value={cycle} onChange={e => setCycle(e.target.value)}>
                <option value="">{t.allGroups}</option>
                {d.cycles.map(c => <option key={c.id} value={c.id}>{c.title_he}</option>)}
              </select>
            </label>
            <label><span class="sr-only">{t.statusAll}</span>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">{t.statusAll}</option>
                {Object.entries(t.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <p class="muted small" aria-live="polite">{t.resultsCount(list.length)}</p>
          {!list.length && <div class="alert info">{t.noResults}</div>}
          {view === 'map' ? <TopicMap cycles={d.cycles} topics={list} lang={lang} dir={dir} /> : (
            groupTopics(d.cycles, list).map(g => (
              <section key={g.id} style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: '1.1rem' }}>{g.title_he} {g.title_target && <bdi class="tl muted" lang={lang} dir={dir} style={{ fontWeight: 400 }}>{g.title_target}</bdi>}</h2>
                <div class="topic-cards">
                  {g.topics.map(tp => (
                    <a key={tp.id} class="topic-card" href={`#/t/${tp.id}`}>
                      <h3>{tp.title_he}</h3>
                      <bdi class="tl" lang={lang} dir={dir}>{tp.title_target}</bdi>
                      <p class="obj"><T text={tp.objective} lang={lang} dir={dir} /></p>
                      <div class="foot">
                        <Status s={tp.stats.status} />
                        <span class="muted small">{t.activitiesCount(tp.stats.activities)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      );
    }}</View>
  );
}
