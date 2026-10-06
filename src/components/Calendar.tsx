import { useEffect, useMemo, useRef, useState } from 'react';
import { useCategories, useSettings } from '../db';
import { addDays, dateRange, DAY_LETTERS, DAY_SHORT, fmtLongDay, fmtMonth, fromKey, minToTime, nowMin, startOfWeek, todayKey, weekday } from '../lib/dates';
import { useOccurrences, type Occurrence } from '../lib/recurrence';
import { moveOccurrence } from '../lib/move';
import { DESKTOP, Icon, useMedia, useUI } from '../ui';

interface Placed { occ: Occurrence; lane: number; lanes: number }

interface DragInfo {
  occ: Occurrence;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  grabMin: number; // décalage (min) entre le haut de l'événement et le point saisi
  active: boolean;
  timer?: number;
}
interface DragView { key: string; date: string; start: number; viaStrip: boolean }

const SNAP = 15; // minutes

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
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const desktop = useMedia(DESKTOP);

  const today = todayKey();
  const weekStart = startOfWeek(date);
  const weekDays = dateRange(weekStart, addDays(weekStart, 6));
  const occs = useOccurrences(weekStart, addDays(weekStart, 6)) ?? [];
  const shown = view === 'week' ? weekDays : [date];
  const H = desktop ? (view === 'week' ? 54 : 64) : view === 'week' ? 46 : 60;

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

  // Bloque le défilement pendant un glisser-déposer au doigt (écouteur non passif obligatoire)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragRef.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const slotAt = (info: DragInfo, x: number, y: number): DragView => {
    const dur = info.occ.end - info.occ.start;
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.day-cell[data-date]');
    if (hit) return { key: info.occ.key, date: hit.dataset.date!, start: info.occ.start, viaStrip: true };
    const cols = [...(gridRef.current?.querySelectorAll<HTMLElement>('.col') ?? [])];
    let idx = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
    if (idx === -1) idx = cols.length && x < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1;
    const top = cols[0]?.getBoundingClientRect().top ?? 0;
    let start = startH * 60 + ((y - top) / H) * 60 - info.grabMin;
    start = Math.round(start / SNAP) * SNAP;
    start = Math.max(0, Math.min(24 * 60 - dur, start));
    return { key: info.occ.key, date: shown[Math.max(0, idx)], start, viaStrip: false };
  };

  const endDrag = () => {
    const info = dragRef.current;
    if (info?.timer) clearTimeout(info.timer);
    dragRef.current = null;
    setDrag(null);
  };

  const onEvDown = (occ: Occurrence, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const info: DragInfo = {
      occ, pointerId: e.pointerId, touch: e.pointerType !== 'mouse',
      x0: e.clientX, y0: e.clientY, grabMin: ((e.clientY - r.top) / H) * 60, active: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (info.touch) {
      // Au doigt : appui long pour attraper, sinon on laisse défiler
      info.timer = window.setTimeout(() => {
        if (dragRef.current !== info) return;
        info.active = true;
        navigator.vibrate?.(25);
        setDrag(slotAt(info, info.x0, info.y0));
      }, 380);
    }
    dragRef.current = info;
  };

  const onEvMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const info = dragRef.current;
    if (!info || info.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - info.x0, e.clientY - info.y0);
    if (!info.active) {
      if (info.touch) { if (dist > 8) endDrag(); return; }
      if (dist < 5) return;
      info.active = true;
    }
    // Défilement automatique près des bords
    const sc = scrollRef.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + 40) sc.scrollTop -= 14;
      else if (e.clientY > r.bottom - 40) sc.scrollTop += 14;
    }
    setDrag(slotAt(info, e.clientX, e.clientY));
  };

  const onEvUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const info = dragRef.current;
    if (!info || info.pointerId !== e.pointerId) return;
    if (info.active) {
      const target = slotAt(info, e.clientX, e.clientY);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      endDrag();
      void moveOccurrence(ui, info.occ, target.date, target.start);
    } else endDrag();
  };

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
                data-date={d}
                className={`day-cell ${active ? 'active' : ''} ${d === today ? 'is-today' : ''} ${drag?.viaStrip && drag.date === d ? 'drop-target' : ''}`}
                onClick={() => { setDate(d); setView('day'); }}
              >
                <span className="dl">{desktop ? DAY_SHORT[weekday(d)] : DAY_LETTERS[weekday(d)]}</span>
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
        <div className={`cal-grid ${drag ? 'dragging' : ''}`} ref={gridRef} style={{ height: hours.length * H }}>
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
                      className={`event ${occ.status} ${view} ${occ.task.type} ${view === 'week' && !desktop && lanes > 1 ? 'narrow' : ''} ${drag?.key === occ.key ? 'drag-src' : ''}`}
                      style={{
                        top, height,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 2px)`,
                        ['--c' as string]: cat?.color ?? '#7b808a',
                      }}
                      onClick={() => { if (!suppressClick.current) ui.openOccurrence(occ); }}
                      onPointerDown={(e) => onEvDown(occ, e)}
                      onPointerMove={onEvMove}
                      onPointerUp={onEvUp}
                      onPointerCancel={endDrag}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <span className="ev-title">
                        {occ.status === 'done' && <Icon name="check" size={12} />}
                        {occ.task.title}
                      </span>
                      {(view === 'day' || desktop) && height > 34 && (
                        <span className="ev-meta">
                          {minToTime(occ.start)} – {minToTime(occ.end)}
                          {cat && view === 'day' ? ` · ${cat.name}` : ''}
                          {occ.status === 'missed' ? ' · non fait' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
                {drag && !drag.viaStrip && drag.date === d && (() => {
                  const o = occs.find((x) => x.key === drag.key);
                  if (!o) return null;
                  const dur = o.end - o.start;
                  return (
                    <div
                      className={`event ghost ${view}`}
                      style={{ top: ((drag.start - startH * 60) / 60) * H, height: Math.max((dur / 60) * H, 22), left: 1, width: 'calc(100% - 2px)', ['--c' as string]: cats.get(o.task.categoryId ?? -1)?.color ?? '#7b808a' }}
                    >
                      <span className="ev-title">{o.task.title}</span>
                      <span className="ev-meta">{minToTime(drag.start)} – {minToTime(drag.start + dur)}</span>
                    </div>
                  );
                })()}
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
