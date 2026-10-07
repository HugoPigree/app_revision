import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, useCategories } from '../db';
import { addDays, addMonths, dateRange, DAY_LETTERS, endOfMonth, fmtDuration, fmtMonth, fmtShort, fromKey, relativeDay, startOfMonth, startOfWeek, todayKey, weekday } from '../lib/dates';
import { expand } from '../lib/recurrence';
import { Icon } from '../ui';
function range(mode, anchor) {
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
    const [mode, setMode] = useState('week');
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
    const step = (dir) => setAnchor(mode === 'week' ? addDays(from, 7 * dir) : addMonths(from, dir));
    const isCurrent = today >= from && today <= to;
    const cur = data?.sessions.filter((s) => s.date >= from && s.date <= to) ?? [];
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
    const perCat = new Map();
    cur.forEach((s) => perCat.set(s.categoryId ?? '', (perCat.get(s.categoryId ?? '') ?? 0) + s.workMinutes));
    const catRows = [...perCat.entries()].sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(1, ...catRows.map((r) => r[1]));
    // Temps par sujet (titre de la tâche)
    const perTitle = new Map();
    cur.forEach((s) => {
        const e = perTitle.get(s.title) ?? { minutes: 0, categoryId: s.categoryId };
        e.minutes += s.workMinutes;
        perTitle.set(s.title, e);
    });
    const topics = [...perTitle.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 8);
    const maxTopic = Math.max(1, ...topics.map((t) => t[1].minutes));
    const W = 340, CH = 150, padL = 30, padB = 22, chartH = CH - padB - 8;
    const bw = (W - padL) / days.length;
    return (_jsxs("div", { className: "screen stats", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { children: "Bilan" }), _jsxs("div", { className: "seg", children: [_jsx("button", { className: mode === 'week' ? 'on' : '', onClick: () => { setMode('week'); setAnchor(today); }, children: "Semaine" }), _jsx("button", { className: mode === 'month' ? 'on' : '', onClick: () => { setMode('month'); setAnchor(today); }, children: "Mois" })] })] }), _jsxs("div", { className: "scroll-body", children: [_jsxs("div", { className: "period-nav", children: [_jsx("button", { className: "icon-btn", onClick: () => step(-1), "aria-label": "P\u00E9riode pr\u00E9c\u00E9dente", children: _jsx(Icon, { name: "left" }) }), _jsxs("span", { children: [mode === 'week' ? `Semaine du ${fmtShort(from)}` : fmtMonth(from), isCurrent ? '' : ''] }), _jsx("button", { className: "icon-btn", onClick: () => step(1), disabled: isCurrent, "aria-label": "P\u00E9riode suivante", children: _jsx(Icon, { name: "right" }) })] }), _jsxs("div", { className: "hero-card", children: [_jsx("span", { className: "eyebrow", children: "Temps de r\u00E9vision" }), _jsx("span", { className: "big-num", children: fmtDuration(total) }), _jsx("span", { className: `delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`, children: delta === 0
                                    ? total === 0 ? 'Rien pour l’instant, lance ta première séance' : `Autant que ${mode === 'week' ? 'la semaine d’avant' : 'le mois d’avant'}`
                                    : `${delta > 0 ? '+' : '−'}${fmtDuration(Math.abs(delta))} vs ${mode === 'week' ? 'la semaine d’avant' : 'le mois d’avant'}` })] }), _jsxs("div", { className: "kpis", children: [_jsxs("div", { className: "kpi", children: [_jsx("b", { children: cur.length }), _jsxs("span", { children: ["s\u00E9ance", cur.length > 1 ? 's' : ''] })] }), _jsxs("div", { className: "kpi", children: [_jsx("b", { children: blocks }), _jsxs("span", { children: ["pomodoro", blocks > 1 ? 's' : '', " complet", blocks > 1 ? 's' : ''] })] }), _jsxs("div", { className: "kpi", children: [_jsx("b", { children: avgSession ? fmtDuration(avgSession) : '–' }), _jsx("span", { children: "par s\u00E9ance en moyenne" })] }), _jsxs("div", { className: "kpi", children: [_jsx("b", { children: planned ? `${Math.round((done / planned) * 100)}%` : '–' }), _jsx("span", { children: planned ? `${done}/${planned} révisions faites` : 'révisions faites' })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "Par jour" }), _jsxs("svg", { viewBox: `0 0 ${W} ${CH}`, className: "bars", role: "img", "aria-label": "Minutes de r\u00E9vision par jour", children: [Array.from({ length: top / stepH + 1 }, (_, i) => {
                                        const y = 8 + chartH - (i * stepH / top) * chartH;
                                        return (_jsxs("g", { children: [_jsx("line", { x1: padL, x2: W, y1: y, y2: y, className: "grid" }), _jsxs("text", { x: padL - 6, y: y + 3, className: "axis", textAnchor: "end", children: [i * stepH / 60, "h"] })] }, i));
                                    }), perDay.map((m, i) => {
                                        const h = (m / top) * chartH;
                                        const x = padL + i * bw + bw * 0.18;
                                        const w = bw * 0.64;
                                        const d = days[i];
                                        return (_jsxs("g", { children: [_jsx("title", { children: `${fmtShort(d)} : ${fmtDuration(m)}` }), m > 0 && _jsx("rect", { x: x, y: 8 + chartH - h, width: w, height: h, rx: Math.min(4, w / 2), className: `bar ${d === today ? 'today' : ''}` }), (mode === 'week' || fromKey(d).getDate() % 5 === 1 || fromKey(d).getDate() === 1) && (_jsx("text", { x: x + w / 2, y: CH - 6, className: `axis ${d === today ? 'strong' : ''}`, textAnchor: "middle", children: mode === 'week' ? DAY_LETTERS[weekday(d)] : fromKey(d).getDate() }))] }, d));
                                    })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "Par cat\u00E9gorie" }), catRows.length === 0 && _jsx("p", { className: "muted small", children: "Aucune s\u00E9ance sur cette p\u00E9riode. Lance une r\u00E9vision depuis le calendrier ou l\u2019onglet T\u00E2ches." }), catRows.map(([id, m]) => {
                                const c = cats.get(id);
                                return (_jsxs("div", { className: "hbar", style: { ['--c']: c?.color ?? 'var(--muted)' }, children: [_jsxs("span", { className: "hbar-label", children: [_jsx("i", { className: "dot" }), c?.name ?? 'Sans catégorie'] }), _jsx("span", { className: "hbar-track", children: _jsx("span", { style: { width: `${(m / maxCat) * 100}%` } }) }), _jsx("span", { className: "hbar-val", children: fmtDuration(m) })] }, id));
                            })] }), topics.length > 0 && (_jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "Par sujet" }), topics.map(([title, t]) => (_jsxs("div", { className: "hbar topic", style: { ['--c']: cats.get(t.categoryId ?? '')?.color ?? 'var(--muted)' }, children: [_jsxs("span", { className: "hbar-label", title: title, children: [_jsx("i", { className: "dot" }), title] }), _jsx("span", { className: "hbar-track", children: _jsx("span", { style: { width: `${(t.minutes / maxTopic) * 100}%` } }) }), _jsx("span", { className: "hbar-val", children: fmtDuration(t.minutes) })] }, title)))] })), cur.length > 0 && (_jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "S\u00E9ances" }), _jsx("ul", { className: "session-list", children: [...cur].sort((a, b) => b.endedAt - a.endedAt).slice(0, 15).map((s) => (_jsxs("li", { style: { ['--c']: cats.get(s.categoryId ?? '')?.color ?? 'var(--muted)' }, children: [_jsx("i", { className: "dot" }), _jsxs("span", { className: "sl-title", children: [s.title, _jsx("span", { className: "muted small", children: relativeDay(s.date) })] }), _jsx("span", { className: "sl-val", children: fmtDuration(s.workMinutes) })] }, s.id))) })] }))] })] }));
}
