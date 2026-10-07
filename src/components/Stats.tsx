import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { catType, db, useCategories, useTypes, type Session, type TypeDef } from '../db';
import { addDays, addMonths, dateRange, DAY_LETTERS, endOfMonth, fmtDuration, fmtMonth, fmtShort, fromKey, nowMin, relativeDay, startOfMonth, startOfWeek, todayKey, weekday } from '../lib/dates';
import { expand } from '../lib/recurrence';
import { Icon } from '../ui';

type Mode = 'week' | 'month';

/** Couleur de chaque grande catégorie, dans l'ordre de la liste */
const TYPE_COLORS = ['#2a4fc4', '#8a5cd6', '#2f9e6b', '#e09a1a', '#1f9bb3', '#d64f8c', '#7a5c48', '#5b6577'];

function range(mode: Mode, anchor: string) {
  if (mode === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6), prevFrom: addDays(from, -7), prevTo: addDays(from, -1) };
  }
  const from = startOfMonth(anchor);
  const prevFrom = addMonths(from, -1);
  return { from, to: endOfMonth(from), prevFrom, prevTo: endOfMonth(prevFrom) };
}

/** Temps réellement passé : une séance Pomodoro, ou une tâche cochée « faite » (sa durée prévue) */
interface Entry { date: string; minutes: number; type: string; categoryId: string | null; title: string }
/** Tâche prévue dont l'heure est passée (ou déjà cochée) : sert au taux de réussite */
interface Planned { date: string; type: string; minutes: number; done: boolean }

const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);
const plural = (n: number, s: string, p = s + 's') => (n > 1 ? p : s);

export function StatsView() {
  const cats = useCategories();
  const types = useTypes();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(todayKey());
  const [filter, setFilter] = useState<string>('all');
  const { from, to, prevFrom, prevTo } = range(mode, anchor);
  const today = todayKey();

  const data = useLiveQuery(async () => {
    const [sessions, tasks, states] = await Promise.all([
      db.sessions.where('date').between(prevFrom, to, true, true).toArray(),
      db.tasks.toArray(),
      db.occStates.where('date').between(prevFrom, to, true, true).toArray(),
    ]);
    const end = to < today ? to : today;
    const occs = expand(tasks, states, prevFrom, end);
    return { sessions, tasks, occs };
  }, [from, to, prevFrom, today]);

  const pomodoroType = types.find((t) => t.pomodoro)?.id ?? types[0]?.id ?? 'revision';
  const colorOf = (id: string) => TYPE_COLORS[Math.max(0, types.findIndex((t) => t.id === id)) % TYPE_COLORS.length];

  // ——— Calcul des entrées ———
  const entries: Entry[] = [];
  const planned: Planned[] = [];
  const sessions: (Session & { type: string })[] = [];
  if (data) {
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const withSession = new Set<string>();
    for (const s of data.sessions) {
      const task = s.taskId ? taskById.get(s.taskId) : undefined;
      const cat = cats.get(s.categoryId ?? '');
      const type = task?.type ?? (cat ? catType(cat) : pomodoroType);
      if (s.occKey) withSession.add(s.occKey);
      sessions.push({ ...s, type });
      entries.push({ date: s.date, minutes: s.workMinutes, type, categoryId: s.categoryId, title: s.title });
    }
    const now = nowMin();
    for (const o of data.occs) {
      const done = o.status === 'done';
      if (done && !withSession.has(o.key)) {
        entries.push({ date: o.date, minutes: o.task.durationMin, type: o.task.type, categoryId: o.task.categoryId, title: o.task.title });
      }
      if (done || o.date < today || (o.date === today && o.end <= now)) {
        planned.push({ date: o.date, type: o.task.type, minutes: o.task.durationMin, done });
      }
    }
  }

  const inCur = (d: string) => d >= from && d <= to;
  const inPrev = (d: string) => d >= prevFrom && d <= prevTo;
  const ofType = <T extends { type: string }>(x: T) => filter === 'all' || x.type === filter;
  const cur = entries.filter((e) => inCur(e.date) && ofType(e));
  const prev = entries.filter((e) => inPrev(e.date) && ofType(e));
  const curPlanned = planned.filter((p) => inCur(p.date) && ofType(p));
  const curSessions = sessions.filter((s) => inCur(s.date) && ofType(s));

  const total = sum(cur, (e) => e.minutes);
  const delta = total - sum(prev, (e) => e.minutes);
  const doneCount = curPlanned.filter((p) => p.done).length;
  const rate = curPlanned.length ? Math.round((doneCount / curPlanned.length) * 100) : null;

  const selected: TypeDef | undefined = filter === 'all' ? undefined : types.find((t) => t.id === filter);
  const isPomodoro = !!selected?.pomodoro;

  const step = (dir: number) => setAnchor(mode === 'week' ? addDays(from, 7 * dir) : addMonths(from, dir));
  const isCurrent = today >= from && today <= to;
  const periodWord = mode === 'week' ? 'la semaine d’avant' : 'le mois d’avant';

  // ——— Par grande catégorie (vue « Tout ») ———
  const typeRows = types
    .map((t) => {
      const mins = sum(entries.filter((e) => inCur(e.date) && e.type === t.id), (e) => e.minutes);
      const pl = planned.filter((p) => inCur(p.date) && p.type === t.id);
      return { t, mins, done: pl.filter((p) => p.done).length, planned: pl.length };
    })
    .filter((r) => r.mins > 0 || r.planned > 0);
  const maxType = Math.max(1, ...typeRows.map((r) => r.mins));

  // ——— Par jour (barres empilées par grande catégorie) ———
  const days = dateRange(from, to);
  const stackTypes = filter === 'all' ? types.map((t) => t.id) : [filter];
  const perDay = days.map((d) => stackTypes.map((id) => sum(cur.filter((e) => e.date === d && e.type === id), (e) => e.minutes)));
  const maxDay = Math.max(60, ...perDay.map((p) => sum(p, (x) => x)));
  const stepH = maxDay <= 120 ? 30 : maxDay <= 300 ? 60 : 120;
  const top = Math.ceil(maxDay / stepH) * stepH;
  const activeDays = perDay.filter((p) => sum(p, (x) => x) > 0).length;

  // ——— Par catégorie et par sujet ———
  const perCat = new Map<string, number>();
  cur.forEach((e) => perCat.set(e.categoryId ?? '', (perCat.get(e.categoryId ?? '') ?? 0) + e.minutes));
  const catRows = [...perCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map((r) => r[1]));

  const perTitle = new Map<string, { minutes: number; categoryId: string | null }>();
  cur.forEach((e) => {
    const x = perTitle.get(e.title) ?? { minutes: 0, categoryId: e.categoryId };
    x.minutes += e.minutes;
    perTitle.set(e.title, x);
  });
  const topics = [...perTitle.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 8);
  const maxTopic = Math.max(1, ...topics.map((t) => t[1].minutes));

  const W = 340, CH = 150, padL = 30, padB = 22, chartH = CH - padB - 8;
  const bw = (W - padL) / days.length;

  const emptyHint = !selected
    ? 'Rien pour l’instant : coche tes tâches faites ou lance un pomodoro'
    : isPomodoro ? 'Rien pour l’instant, lance ta première séance' : 'Coche tes tâches faites pour les compter ici';

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
          <span>{mode === 'week' ? `Semaine du ${fmtShort(from)}` : fmtMonth(from)}</span>
          <button className="icon-btn" onClick={() => step(1)} disabled={isCurrent} aria-label="Période suivante"><Icon name="right" /></button>
        </div>

        <div className="type-filter" role="tablist" aria-label="Grande catégorie">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Tout</button>
          {types.map((t) => (
            <button key={t.id} role="tab" aria-selected={filter === t.id} className={filter === t.id ? 'on' : ''} style={{ ['--c' as string]: colorOf(t.id) }} onClick={() => setFilter(t.id)}>
              <i className="dot" />{t.name}
            </button>
          ))}
        </div>

        <div className="hero-card" style={selected ? { ['--c' as string]: colorOf(selected.id) } : undefined}>
          <span className="eyebrow">{selected ? <><i className="dot" /> Temps · {selected.name}</> : 'Temps total'}</span>
          <span className="big-num">{fmtDuration(total)}</span>
          <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
            {delta === 0
              ? total === 0 ? emptyHint : `Autant que ${periodWord}`
              : `${delta > 0 ? '+' : '−'}${fmtDuration(Math.abs(delta))} vs ${periodWord}`}
          </span>
        </div>

        <div className="kpis">
          <div className="kpi">
            <b>{rate === null ? '–' : `${rate}%`}</b>
            <span>{curPlanned.length ? `${plural(doneCount, 'tâche faite', 'tâches faites')} : ${doneCount} sur ${curPlanned.length}` : 'tâches faites'}</span>
          </div>
          {isPomodoro ? (
            <>
              <div className="kpi"><b>{curSessions.length}</b><span>{plural(curSessions.length, 'séance')}</span></div>
              <div className="kpi"><b>{sum(curSessions, (s) => s.blocks)}</b><span>{plural(sum(curSessions, (s) => s.blocks), 'pomodoro complet', 'pomodoros complets')}</span></div>
              <div className="kpi"><b>{curSessions.length ? fmtDuration(sum(curSessions, (s) => s.workMinutes) / curSessions.length) : '–'}</b><span>par séance en moyenne</span></div>
            </>
          ) : (
            <>
              <div className="kpi"><b>{fmtDuration(sum(curPlanned, (p) => p.minutes))}</b><span>prévu jusqu’ici</span></div>
              <div className="kpi"><b>{activeDays}<small>/{days.length}</small></b><span>{plural(activeDays, 'jour actif', 'jours actifs')}</span></div>
              <div className="kpi"><b>{activeDays ? fmtDuration(total / activeDays) : '–'}</b><span>par jour actif</span></div>
            </>
          )}
        </div>

        {filter === 'all' && (
          <section className="card types-card">
            <h2 className="section-title">Par grande catégorie</h2>
            {typeRows.length === 0 && <p className="muted small">Rien sur cette période.</p>}
            {typeRows.map(({ t, mins, done, planned: pl }) => (
              <button key={t.id} className="type-row" style={{ ['--c' as string]: colorOf(t.id) }} onClick={() => setFilter(t.id)}>
                <span className="type-row-head">
                  <span className="hbar-label"><i className="dot" />{t.name}</span>
                  <span className="type-row-val">{fmtDuration(mins)}</span>
                </span>
                <span className="hbar-track"><span style={{ width: `${(mins / maxType) * 100}%` }} /></span>
                <span className="type-row-sub">
                  {pl ? `${done} ${plural(done, 'faite')} sur ${pl}` : 'Aucune tâche prévue'}
                  {pl > 0 && <span className="type-row-rate">{Math.round((done / pl) * 100)}%</span>}
                  <Icon name="right" size={16} />
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="card">
          <h2 className="section-title">Par jour</h2>
          <svg viewBox={`0 0 ${W} ${CH}`} className="bars" role="img" aria-label="Temps par jour">
            {Array.from({ length: top / stepH + 1 }, (_, i) => {
              const y = 8 + chartH - (i * stepH / top) * chartH;
              return (
                <g key={i}>
                  <line x1={padL} x2={W} y1={y} y2={y} className="grid" />
                  <text x={padL - 6} y={y + 3} className="axis" textAnchor="end">{i * stepH / 60}h</text>
                </g>
              );
            })}
            {perDay.map((parts, i) => {
              const x = padL + i * bw + bw * 0.18;
              const w = bw * 0.64;
              const d = days[i];
              let y = 8 + chartH;
              const label = parts.map((m, j) => (m ? `${types.find((t) => t.id === stackTypes[j])?.name ?? ''} ${fmtDuration(m)}` : '')).filter(Boolean).join(' · ');
              return (
                <g key={d} className={d === today ? 'today' : ''}>
                  <title>{`${fmtShort(d)} : ${label || 'rien'}`}</title>
                  {parts.map((m, j) => {
                    if (!m) return null;
                    const h = (m / top) * chartH;
                    y -= h;
                    return <rect key={j} x={x} y={y} width={w} height={Math.max(1, h - 1)} rx={Math.min(3, w / 2)} style={{ fill: colorOf(stackTypes[j]) }} className="bar-seg" />;
                  })}
                  {(mode === 'week' || fromKey(d).getDate() % 5 === 1 || fromKey(d).getDate() === 1) && (
                    <text x={x + w / 2} y={CH - 6} className={`axis ${d === today ? 'strong' : ''}`} textAnchor="middle">
                      {mode === 'week' ? DAY_LETTERS[weekday(d)] : fromKey(d).getDate()}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {filter === 'all' && typeRows.length > 1 && (
            <div className="legend">
              {typeRows.map(({ t }) => <span key={t.id} style={{ ['--c' as string]: colorOf(t.id) }}><i className="dot" />{t.name}</span>)}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Par catégorie</h2>
          {catRows.length === 0 && <p className="muted small">Rien sur cette période.</p>}
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

        {curSessions.length > 0 && (filter === 'all' || isPomodoro) && (
          <section className="card">
            <h2 className="section-title">Séances Pomodoro</h2>
            <ul className="session-list">
              {[...curSessions].sort((a, b) => b.endedAt - a.endedAt).slice(0, 15).map((s) => (
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
