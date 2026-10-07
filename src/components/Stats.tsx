import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, useCategories, type Session } from '../db';
import { addDays, addMonths, dateRange, DAY_LETTERS, endOfMonth, fmtDuration, fmtMonth, fmtShort, fromKey, relativeDay, startOfMonth, startOfWeek, todayKey, weekday } from '../lib/dates';
import { expand } from '../lib/recurrence';
import { Icon } from '../ui';

type Mode = 'week' | 'month';

function range(mode: Mode, anchor: string) {
  if (mode === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6), prevFrom: addDays(from, -7), prevTo: addDays(from, -1) };
  }
  const from = startOfMonth(anchor);
  const prevFrom = addMonths(from, -1);
  return { from, to: endOfMonth(from), prevFrom, prevTo: endOfMonth(prevFrom) };
}

export function StatsView() {
  const cats = useCategories();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(todayKey());
  const { from, to, prevFrom, prevTo } = range(mode, anchor);
  const today = todayKey();

  const data = useLiveQuery(async () => {
    const pomodoroTypes = (await db.types.toArray()).filter((t) => t.pomodoro).map((t) => t.id);
    const [sessions, tasks, states] = await Promise.all([
      db.sessions.where('date').between(prevFrom, to, true, true).toArray(),
      db.tasks.where('type').anyOf(pomodoroTypes).toArray(),
      db.occStates.where('date').between(from, to, true, true).toArray(),
    ]);
    const end = to < today ? to : today;
    const occs = from <= end ? expand(tasks, states, from, end) : [];
    return { sessions, occs };
  }, [from, to, prevFrom, today]);

  const step = (dir: number) => setAnchor(mode === 'week' ? addDays(from, 7 * dir) : addMonths(from, dir));
  const isCurrent = today >= from && today <= to;

  const cur: Session[] = data?.sessions.filter((s) => s.date >= from && s.date <= to) ?? [];
  const prev = data?.sessions.filter((s) => s.date >= prevFrom && s.date <= prevTo) ?? [];
  const total = cur.reduce((a, s) => a + s.workMinutes, 0);
  const prevTotal = prev.reduce((a, s) => a + s.workMinutes, 0);
  const delta = total - prevTotal;
  const blocks = cur.reduce((a, s) => a + s.blocks, 0);
  const avgSession = cur.length ? total / cur.length : null;

  const occs = data?.occs ?? [];
  const done = occs.filter((o) => o.status === 'done').length;
  const missed = occs.filter((o) => o.status === 'missed').length;
  const planned = done + missed;

  // Temps par jour
  const days = dateRange(from, to);
  const perDay = days.map((d) => cur.filter((s) => s.date === d).reduce((a, s) => a + s.workMinutes, 0));
  const maxDay = Math.max(60, ...perDay);
  const stepH = maxDay <= 120 ? 30 : maxDay <= 300 ? 60 : 120;
  const top = Math.ceil(maxDay / stepH) * stepH;

  // Par catégorie
  const perCat = new Map<string, number>();
  cur.forEach((s) => perCat.set(s.categoryId ?? '', (perCat.get(s.categoryId ?? '') ?? 0) + s.workMinutes));
  const catRows = [...perCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map((r) => r[1]));

  // Temps par sujet (titre de la tâche)
  const perTitle = new Map<string, { minutes: number; categoryId: string | null }>();
  cur.forEach((s) => {
    const e = perTitle.get(s.title) ?? { minutes: 0, categoryId: s.categoryId };
    e.minutes += s.workMinutes;
    perTitle.set(s.title, e);
  });
  const topics = [...perTitle.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 8);
  const maxTopic = Math.max(1, ...topics.map((t) => t[1].minutes));

  const W = 340, CH = 150, padL = 30, padB = 22, chartH = CH - padB - 8;
  const bw = (W - padL) / days.length;

  return (
    <div className="screen stats">
      <header className="page-head">
        <h1>Bilan</h1>
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => { setMode('week'); setAnchor(today); }}>Semaine</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => { setMode('month'); setAnchor(today); }}>Mois</button>
        </div>
      </header>
      <div className="scroll-body">
        <div className="period-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Période précédente"><Icon name="left" /></button>
          <span>{mode === 'week' ? `Semaine du ${fmtShort(from)}` : fmtMonth(from)}{isCurrent ? '' : ''}</span>
          <button className="icon-btn" onClick={() => step(1)} disabled={isCurrent} aria-label="Période suivante"><Icon name="right" /></button>
        </div>

        <div className="hero-card">
          <span className="eyebrow">Temps de révision</span>
          <span className="big-num">{fmtDuration(total)}</span>
          <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
            {delta === 0
              ? total === 0 ? 'Rien pour l’instant, lance ta première séance' : `Autant que ${mode === 'week' ? 'la semaine d’avant' : 'le mois d’avant'}`
              : `${delta > 0 ? '+' : '−'}${fmtDuration(Math.abs(delta))} vs ${mode === 'week' ? 'la semaine d’avant' : 'le mois d’avant'}`}
          </span>
        </div>

        <div className="kpis">
          <div className="kpi"><b>{cur.length}</b><span>séance{cur.length > 1 ? 's' : ''}</span></div>
          <div className="kpi"><b>{blocks}</b><span>pomodoro{blocks > 1 ? 's' : ''} complet{blocks > 1 ? 's' : ''}</span></div>
          <div className="kpi"><b>{avgSession ? fmtDuration(avgSession) : '–'}</b><span>par séance en moyenne</span></div>
          <div className="kpi"><b>{planned ? `${Math.round((done / planned) * 100)}%` : '–'}</b><span>{planned ? `${done}/${planned} révisions faites` : 'révisions faites'}</span></div>
        </div>

        <section className="card">
          <h2 className="section-title">Par jour</h2>
          <svg viewBox={`0 0 ${W} ${CH}`} className="bars" role="img" aria-label="Minutes de révision par jour">
            {Array.from({ length: top / stepH + 1 }, (_, i) => {
              const y = 8 + chartH - (i * stepH / top) * chartH;
              return (
                <g key={i}>
                  <line x1={padL} x2={W} y1={y} y2={y} className="grid" />
                  <text x={padL - 6} y={y + 3} className="axis" textAnchor="end">{i * stepH / 60}h</text>
                </g>
              );
            })}
            {perDay.map((m, i) => {
              const h = (m / top) * chartH;
              const x = padL + i * bw + bw * 0.18;
              const w = bw * 0.64;
              const d = days[i];
              return (
                <g key={d}>
                  <title>{`${fmtShort(d)} : ${fmtDuration(m)}`}</title>
                  {m > 0 && <rect x={x} y={8 + chartH - h} width={w} height={h} rx={Math.min(4, w / 2)} className={`bar ${d === today ? 'today' : ''}`} />}
                  {(mode === 'week' || fromKey(d).getDate() % 5 === 1 || fromKey(d).getDate() === 1) && (
                    <text x={x + w / 2} y={CH - 6} className={`axis ${d === today ? 'strong' : ''}`} textAnchor="middle">
                      {mode === 'week' ? DAY_LETTERS[weekday(d)] : fromKey(d).getDate()}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </section>

        <section className="card">
          <h2 className="section-title">Par catégorie</h2>
          {catRows.length === 0 && <p className="muted small">Aucune séance sur cette période. Lance une révision depuis le calendrier ou l’onglet Tâches.</p>}
          {catRows.map(([id, m]) => {
            const c = cats.get(id);
            return (
              <div key={id} className="hbar" style={{ ['--c' as string]: c?.color ?? 'var(--muted)' }}>
                <span className="hbar-label"><i className="dot" />{c?.name ?? 'Sans catégorie'}</span>
                <span className="hbar-track"><span style={{ width: `${(m / maxCat) * 100}%` }} /></span>
                <span className="hbar-val">{fmtDuration(m)}</span>
              </div>
            );
          })}
        </section>

        {topics.length > 0 && (
          <section className="card">
            <h2 className="section-title">Par sujet</h2>
            {topics.map(([title, t]) => (
              <div key={title} className="hbar topic" style={{ ['--c' as string]: cats.get(t.categoryId ?? '')?.color ?? 'var(--muted)' }}>
                <span className="hbar-label" title={title}><i className="dot" />{title}</span>
                <span className="hbar-track"><span style={{ width: `${(t.minutes / maxTopic) * 100}%` }} /></span>
                <span className="hbar-val">{fmtDuration(t.minutes)}</span>
              </div>
            ))}
          </section>
        )}

        {cur.length > 0 && (
          <section className="card">
            <h2 className="section-title">Séances</h2>
            <ul className="session-list">
              {[...cur].sort((a, b) => b.endedAt - a.endedAt).slice(0, 15).map((s) => (
                <li key={s.id} style={{ ['--c' as string]: cats.get(s.categoryId ?? '')?.color ?? 'var(--muted)' }}>
                  <i className="dot" />
                  <span className="sl-title">{s.title}<span className="muted small">{relativeDay(s.date)}</span></span>
                  <span className="sl-val">{fmtDuration(s.workMinutes)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
