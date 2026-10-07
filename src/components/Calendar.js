import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCategories, useSettings, typeOf, useTypes } from '../db';
import { addDays, dateRange, DAY_LETTERS, DAY_SHORT, fmtLongDay, fmtMonth, fromKey, minToTime, nowMin, startOfWeek, todayKey, weekday } from '../lib/dates';
import { useOccurrences } from '../lib/recurrence';
import { dayColors, NO_CAT_COLOR } from '../lib/colors';
import { moveOccurrence } from '../lib/move';
import { DESKTOP, Icon, useMedia, useUI } from '../ui';
const SNAP = 15; // minutes
function layout(occs) {
    const sorted = [...occs].sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let cluster = [];
    let laneEnds = [];
    let clusterEnd = -1;
    const flush = () => {
        cluster.forEach((p) => (p.lanes = laneEnds.length));
        out.push(...cluster);
        cluster = [];
        laneEnds = [];
    };
    for (const occ of sorted) {
        const end = Math.max(occ.end, occ.start + 20);
        if (occ.start >= clusterEnd)
            flush();
        let lane = laneEnds.findIndex((e) => e <= occ.start);
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(end);
        }
        else
            laneEnds[lane] = end;
        cluster.push({ occ, lane, lanes: 1 });
        clusterEnd = Math.max(clusterEnd, end);
    }
    flush();
    return out;
}
export function CalendarView() {
    const settings = useSettings();
    const cats = useCategories();
    const types = useTypes();
    const ui = useUI();
    const [view, setView] = useState('week');
    const [date, setDate] = useState(todayKey());
    const [, setTick] = useState(0);
    const scrollRef = useRef(null);
    const gridRef = useRef(null);
    const dragRef = useRef(null);
    const suppressClick = useRef(false);
    const [drag, setDrag] = useState(null);
    const desktop = useMedia(DESKTOP);
    const today = todayKey();
    const weekStart = startOfWeek(date);
    const weekDays = dateRange(weekStart, addDays(weekStart, 6));
    const occs = useOccurrences(weekStart, addDays(weekStart, 6)) ?? [];
    const shown = view === 'week' ? weekDays : [date];
    // Couleur d'affichage de chaque tâche : jamais deux fois la même dans une journée
    const colorOf = useMemo(() => {
        const m = new Map();
        for (const d of weekDays) {
            const dayItems = occs.filter((o) => o.date === d);
            dayColors(dayItems, (o) => cats.get(o.task.categoryId ?? '')?.color ?? NO_CAT_COLOR).forEach((c, k) => m.set(k, c));
        }
        return (o) => m.get(o.key) ?? cats.get(o.task.categoryId ?? '')?.color ?? NO_CAT_COLOR;
    }, [occs, cats, weekDays.join()]);
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
        const id = setInterval(() => setTick((t) => t + 1), 60000);
        return () => clearInterval(id);
    }, []);
    useEffect(() => {
        const el = scrollRef.current;
        if (el)
            el.scrollTop = Math.max(0, (Math.floor(nowMin() / 60) - 1 - startH) * H);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);
    // Bloque le défilement pendant un glisser-déposer au doigt (écouteur non passif obligatoire)
    useEffect(() => {
        const el = scrollRef.current;
        if (!el)
            return;
        const block = (e) => { if (dragRef.current?.active)
            e.preventDefault(); };
        el.addEventListener('touchmove', block, { passive: false });
        return () => el.removeEventListener('touchmove', block);
    }, []);
    const slotAt = (info, x, y) => {
        const dur = info.occ.end - info.occ.start;
        const hit = document.elementFromPoint(x, y)?.closest('.day-cell[data-date]');
        if (hit)
            return { key: info.occ.key, date: hit.dataset.date, start: info.occ.start, viaStrip: true };
        const cols = [...(gridRef.current?.querySelectorAll('.col') ?? [])];
        let idx = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
        if (idx === -1)
            idx = cols.length && x < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1;
        const top = cols[0]?.getBoundingClientRect().top ?? 0;
        let start = startH * 60 + ((y - top) / H) * 60 - info.grabMin;
        start = Math.round(start / SNAP) * SNAP;
        start = Math.max(0, Math.min(24 * 60 - dur, start));
        return { key: info.occ.key, date: shown[Math.max(0, idx)], start, viaStrip: false };
    };
    const endDrag = () => {
        const info = dragRef.current;
        if (info?.timer)
            clearTimeout(info.timer);
        dragRef.current = null;
        setDrag(null);
    };
    const onEvDown = (occ, e) => {
        if (e.button !== 0)
            return;
        const r = e.currentTarget.getBoundingClientRect();
        const info = {
            occ, pointerId: e.pointerId, touch: e.pointerType !== 'mouse',
            x0: e.clientX, y0: e.clientY, grabMin: ((e.clientY - r.top) / H) * 60, active: false,
        };
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        catch { /* ignore */ }
        if (info.touch) {
            // Au doigt : appui long pour attraper, sinon on laisse défiler
            info.timer = window.setTimeout(() => {
                if (dragRef.current !== info)
                    return;
                info.active = true;
                navigator.vibrate?.(25);
                setDrag(slotAt(info, info.x0, info.y0));
            }, 380);
        }
        dragRef.current = info;
    };
    const onEvMove = (e) => {
        const info = dragRef.current;
        if (!info || info.pointerId !== e.pointerId)
            return;
        const dist = Math.hypot(e.clientX - info.x0, e.clientY - info.y0);
        if (!info.active) {
            if (info.touch) {
                if (dist > 8)
                    endDrag();
                return;
            }
            if (dist < 5)
                return;
            info.active = true;
        }
        // Défilement automatique près des bords
        const sc = scrollRef.current;
        if (sc) {
            const r = sc.getBoundingClientRect();
            if (e.clientY < r.top + 40)
                sc.scrollTop -= 14;
            else if (e.clientY > r.bottom - 40)
                sc.scrollTop += 14;
        }
        setDrag(slotAt(info, e.clientX, e.clientY));
    };
    const onEvUp = (e) => {
        const info = dragRef.current;
        if (!info || info.pointerId !== e.pointerId)
            return;
        if (info.active) {
            const target = slotAt(info, e.clientX, e.clientY);
            suppressClick.current = true;
            setTimeout(() => (suppressClick.current = false), 50);
            endDrag();
            void moveOccurrence(ui, info.occ, target.date, target.start);
        }
        else
            endDrag();
    };
    const step = (dir) => setDate(addDays(date, view === 'week' ? 7 * dir : dir));
    const onGridTap = (d, e) => {
        if (e.target !== e.currentTarget)
            return;
        const y = e.nativeEvent.offsetY;
        const min = Math.floor(((y / H) * 60 + startH * 60) / 30) * 30;
        ui.openEditor(undefined, { startDate: d, startTime: minToTime(min) });
    };
    const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
    return (_jsxs("div", { className: "screen calendar", children: [_jsxs("header", { className: "cal-head", children: [_jsxs("div", { className: "cal-title", children: [_jsx("h1", { children: view === 'week' ? fmtMonth(weekStart) : capitalize(fmtLongDay(date)) }), _jsxs("div", { className: "seg small", children: [_jsx("button", { className: view === 'week' ? 'on' : '', onClick: () => setView('week'), children: "Semaine" }), _jsx("button", { className: view === 'day' ? 'on' : '', onClick: () => setView('day'), children: "Jour" })] })] }), _jsxs("div", { className: "cal-nav", children: [_jsx("button", { className: "icon-btn", onClick: () => step(-1), "aria-label": "Pr\u00E9c\u00E9dent", children: _jsx(Icon, { name: "left" }) }), _jsx("button", { className: "pill", onClick: () => setDate(today), disabled: view === 'day' ? date === today : weekStart === startOfWeek(today), children: "Aujourd'hui" }), _jsx("button", { className: "icon-btn", onClick: () => step(1), "aria-label": "Suivant", children: _jsx(Icon, { name: "right" }) })] }), _jsx("div", { className: "day-strip", children: weekDays.map((d) => {
                            const dots = occs.filter((o) => o.date === d);
                            const active = view === 'day' ? d === date : d === today;
                            return (_jsxs("button", { "data-date": d, className: `day-cell ${active ? 'active' : ''} ${d === today ? 'is-today' : ''} ${drag?.viaStrip && drag.date === d ? 'drop-target' : ''}`, onClick: () => { setDate(d); setView('day'); }, children: [_jsx("span", { className: "dl", children: desktop ? DAY_SHORT[weekday(d)] : DAY_LETTERS[weekday(d)] }), _jsx("span", { className: "dn", children: fromKey(d).getDate() }), _jsx("span", { className: "dots", children: dots.slice(0, 3).map((o) => (_jsx("i", { style: { background: colorOf(o) } }, o.key))) })] }, d));
                        }) })] }), _jsx("div", { className: "cal-scroll", ref: scrollRef, children: _jsxs("div", { className: `cal-grid ${drag ? 'dragging' : ''}`, ref: gridRef, style: { height: hours.length * H }, children: [_jsx("div", { className: "hours", children: hours.map((h) => (_jsx("div", { style: { height: H }, children: _jsxs("span", { children: [h, "h"] }) }, h))) }), shown.map((d) => {
                            const dayOccs = layout(occs.filter((o) => o.date === d));
                            return (_jsxs("div", { className: `col ${d === today ? 'today' : ''}`, style: { backgroundSize: `100% ${H}px` }, onClick: (e) => onGridTap(d, e), children: [dayOccs.map(({ occ, lane, lanes }) => {
                                        const cat = cats.get(occ.task.categoryId ?? '');
                                        const color = colorOf(occ);
                                        const top = ((occ.start - startH * 60) / 60) * H;
                                        const height = Math.max(((occ.end - occ.start) / 60) * H, 22);
                                        return (_jsxs("button", { className: `event ${occ.status} ${view} ${occ.task.type} ${typeOf(occ.task.type, types).pomodoro ? '' : 'check'} ${view === 'week' && !desktop && lanes > 1 ? 'narrow' : ''} ${drag?.key === occ.key ? 'drag-src' : ''}`, style: {
                                                top, height,
                                                left: `calc(${(lane / lanes) * 100}% + 1px)`,
                                                width: `calc(${100 / lanes}% - 2px)`,
                                                ['--c']: color,
                                            }, onClick: () => { if (!suppressClick.current)
                                                ui.openOccurrence(occ); }, onPointerDown: (e) => onEvDown(occ, e), onPointerMove: onEvMove, onPointerUp: onEvUp, onPointerCancel: endDrag, onContextMenu: (e) => e.preventDefault(), children: [_jsxs("span", { className: "ev-title", children: [occ.status === 'done' && _jsx(Icon, { name: "check", size: 12 }), occ.task.title] }), (view === 'day' || desktop) && height > 34 && (_jsxs("span", { className: "ev-meta", children: [minToTime(occ.start), " \u2013 ", minToTime(occ.end), cat && view === 'day' ? ` · ${cat.name}` : '', occ.status === 'missed' ? ' · non fait' : ''] }))] }, occ.key));
                                    }), drag && !drag.viaStrip && drag.date === d && (() => {
                                        const o = occs.find((x) => x.key === drag.key);
                                        if (!o)
                                            return null;
                                        const dur = o.end - o.start;
                                        return (_jsxs("div", { className: `event ghost ${view}`, style: { top: ((drag.start - startH * 60) / 60) * H, height: Math.max((dur / 60) * H, 22), left: 1, width: 'calc(100% - 2px)', ['--c']: colorOf(o) }, children: [_jsx("span", { className: "ev-title", children: o.task.title }), _jsxs("span", { className: "ev-meta", children: [minToTime(drag.start), " \u2013 ", minToTime(drag.start + dur)] })] }));
                                    })(), d === today && nowMin() >= startH * 60 && nowMin() <= endH * 60 && (_jsx("div", { className: "now-line", style: { top: ((nowMin() - startH * 60) / 60) * H } }))] }, d));
                        })] }) }), _jsx("button", { className: "fab", onClick: () => ui.openEditor(undefined, { startDate: view === 'day' ? date : weekDays.includes(today) ? today : weekStart }), "aria-label": "Nouvelle t\u00E2che", children: _jsx(Icon, { name: "plus", size: 26 }) })] }));
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
