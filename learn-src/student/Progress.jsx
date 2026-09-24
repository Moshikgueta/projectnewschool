import { t, pct, dateHe } from '../i18n.js';
import { useApi, View, Status, Meter, useTitle } from '../ui.jsx';

export function Progress({ levelId, me }) {
  const q = useApi(`/api/learn/levels/${levelId}/progress`, [levelId]);
  useTitle(t.navProgress);
  return (
    <View q={q}>{d => {
      const groups = d.cycles.map(c => ({ ...c, topics: d.topics.filter(x => x.cycle_id === c.id) })).filter(g => g.topics.length);
      const rest = d.topics.filter(x => !d.cycles.some(c => c.id === x.cycle_id));
      if (rest.length) groups.push({ id: '_', title_he: t.ungrouped, topics: rest });
      const maxA = Math.max(1, ...d.weeks.map(w => w.answered));
      return (
        <div class="stack">
          <div><h1>{t.navProgress} · {d.level.name_he}</h1><p class="lead">{t.progressLead}</p></div>
          <div class="grid three">
            <div class="card flat"><h3>השלמה</h3><p class="hint">{t.completionHelp}</p></div>
            <div class="card flat"><h3>{t.accuracy}</h3><p class="hint">אחוז הסעיפים שעניתם עליהם נכון בפעם הראשונה.</p></div>
            <div class="card flat"><h3>{t.evidence}</h3><p class="hint">{t.evidenceHelp}</p></div>
          </div>
          <div class="card">
            <h2>{t.byTopic}</h2>
            {groups.map(g => (
              <div key={g.id} style={{ marginBottom: 16 }}>
                <h3>{g.title_he}</h3>
                <div class="table-wrap">
                  <table class="data">
                    <thead><tr><th>{t.col.topic}</th><th>{t.col.status}</th><th>{t.col.done}</th><th>{t.col.acc}</th><th>{t.col.ev}</th><th>{t.col.open}</th></tr></thead>
                    <tbody>
                      {g.topics.sort((a, b) => a.title_he.localeCompare(b.title_he, 'he')).map(x => (
                        <tr key={x.id}>
                          <td><a href={`#/t/${x.id}`}>{x.title_he}</a></td>
                          <td><Status s={x.status} /></td>
                          <td>{x.completed}/{x.activities}</td>
                          <td>{pct(x.accuracy)}</td>
                          <td>{x.retained}/{x.auto_items}</td>
                          <td>{x.open_mistakes || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <div class="grid two">
            <div class="card">
              <h2>{t.bySkill}</h2>
              {!d.skills.length && <p class="muted">{t.skillsNeedNone}</p>}
              {d.skills.map(s => (
                <div key={s.skill} style={{ marginBottom: 12 }}>
                  <div class="row between small"><b>{t.skill[s.skill] || s.skill}</b><span class="muted">{t.accuracy}: {pct(s.accuracy)} · {s.seen} סעיפים · {t.evidence}: {s.retained}</span></div>
                  <Meter value={s.accuracy} label={`${t.skill[s.skill]}: ${pct(s.accuracy)}`} />
                </div>
              ))}
            </div>
            <div class="card">
              <h2>{t.improvement}</h2>
              <p class="muted small">סעיפים שנענו בכל שבוע, ואחוז התשובות הנכונות מתוכם.</p>
              <div class="bars" role="img" aria-label={d.weeks.map(w => `${dateHe(Date.parse(w.week))}: ${w.answered}, ${w.answered ? pct(w.correct / w.answered) : '—'}`).join('; ')}>
                {d.weeks.map(w => (
                  <div class="bar" key={w.week}>
                    <span>{w.answered ? pct(w.correct / w.answered) : ''}</span>
                    <span class="v" style={{ height: `${(w.answered / maxA) * 80}%` }} />
                    <span>{dateHe(Date.parse(w.week))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }}</View>
  );
}
