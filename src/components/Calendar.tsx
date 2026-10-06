import { useEffect, useMemo, useRef, useState } from 'react';
import { useCategories, useSettings } from '../db';
import { addDays, dateRange, DAY_LETTERS, fmtLongDay, fmtMonth, fromKey, minToTime, nowMin, startOfWeek, todayKey, weekday } from '../lib/dates';
import { useOccurrences, type Occurrence } from '../lib/recurrence';
import { Icon, useUI } from '../ui';

interface Placed { occ: Occurrence; lane: number; lanes: number }

function layout(occs: Occurrence[]): Placed[] {
  const sorted = [...occs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((p) => (p.lanes = laneEnds.length));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const occ of sorted) {
    const end = Math.max(occ.end, occ.start + 20);
    if (occ.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= occ.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    cluster.push({ occ, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export function CalendarView() {
  const settings = useSettings();
  const cats = useCategories();
  const ui = useUI();
  const [view, setView] = useState<'week' | 'day'>('week');
  const [date, setDate] = useState(todayKey());
  const [, setTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = todayKey();
  const weekStart = startOfWeek(date);
  const weekDays = dateRange(weekStart, addDays(weekStart, 6));
  const occs = useOccurrences(weekStart, addDays(weekStart, 6)) ?? [];
  const shown = view === 'week' ? weekDays : [date];
  const H = view === 'week' ? 46 : 60;

  const { startH, endH } = useMemo(() => {
    let s = settings.dayStartHour, e = settings.dayEndHour;
    for (const o of occs) {
      s = Math.min(s, Math.floor(o.start / 60));
      e = Math.max(e, Math.ceil(o.end / 60));
    }
    return { startH: s, endH: Math.max(e, s + 1) };
  }, [occs, settings.dayStartHour, settings.dayEndHour]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (Math.floor(nowMin() / 60) - 1 - startH) * H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const step = (dir: number) => setDate(addDays(date, view === 'week' ? 7 * dir : dir));

  const onGridTap = (d: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const y = e.nativeEvent.offsetY;
    const min = Math.floor(((y / H) * 60 + startH * 60) / 30) * 30;
    ui.openEditor(undefined, { startDate: d, startTime: minToTime(min) });
  };

  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);

  return (
    <div className="screen calendar">
      <header className="cal-head">
        <div className="cal-title">
          <h1>{view === 'week' ? fmtMonth(weekStart) : capitalize(fmtLongDay(date))}</h1>
          <div className="seg small">
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Semaine</button>
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Jour</button>
          </div>
        </div>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Précédent"><Icon name="left" /></button>
          <button className="pill" onClick={() => setDate(today)} disabled={view === 'day' ? date === today : weekStart === startOfWeek(today)}>Aujourd'hui</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Suivant"><Icon name="right" /></button>
        </div>
        <div className="day-strip">
          {weekDays.map((d) => {
            const dots = occs.filter((o) => o.date === d);
            const active = view === 'day' ? d === date : d === today;
            return (
              <button
                key={d}
                className={`day-cell ${active ? 'active' : ''} ${d === today ? 'is-today' : ''}`}
                onClick={() => { setDate(d); setView('day'); }}
              >
                <span className="dl">{DAY_LETTERS[weekday(d)]}</span>
                <span className="dn">{fromKey(d).getDate()}</span>
                <span className="dots">
                  {dots.slice(0, 3).map((o) => (
                    <i key={o.key} style={{ background: cats.get(o.task.categoryId ?? -1)?.color ?? 'var(--muted)' }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-grid" style={{ height: hours.length * H }}>
          <div className="hours">
            {hours.map((h) => (
              <div key={h} style={{ height: H }}><span>{h}h</span></div>
            ))}
          </div>
          {shown.map((d) => {
            const dayOccs = layout(occs.filter((o) => o.date === d));
            return (
              <div
                key={d}
                className={`col ${d === today ? 'today' : ''}`}
                style={{ backgroundSize: `100% ${H}px` }}
                onClick={(e) => onGridTap(d, e)}
              >
                {dayOccs.map(({ occ, lane, lanes }) => {
                  const cat = cats.get(occ.task.categoryId ?? -1);
                  const top = ((occ.start - startH * 60) / 60) * H;
                  const height = Math.max(((occ.end - occ.start) / 60) * H, 22);
                  return (
                    <button
                      key={occ.key}
                      className={`event ${occ.status} ${view} ${occ.task.type}`}
                      style={{
                        top, height,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 2px)`,
                        ['--c' as string]: cat?.color ?? '#7b808a',
                      }}
                      onClick={() => ui.openOccurrence(occ)}
                    >
                      <span className="ev-title">
                        {occ.status === 'done' && <Icon name="check" size={12} />}
                        {occ.task.title}
                      </span>
                      {view === 'day' && height > 34 && (
                        <span className="ev-meta">
                          {minToTime(occ.start)} – {minToTime(occ.end)}
                          {cat ? ` · ${cat.name}` : ''}
                          {occ.status === 'missed' ? ' · non fait' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
                {d === today && nowMin() >= startH * 60 && nowMin() <= endH * 60 && (
                  <div className="now-line" style={{ top: ((nowMin() - startH * 60) / 60) * H }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button className="fab" onClick={() => ui.openEditor(undefined, { startDate: view === 'day' ? date : weekDays.includes(today) ? today : weekStart })} aria-label="Nouvelle tâche">
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
