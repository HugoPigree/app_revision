import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, typeOf, useCategories, useTypes } from '../db';
import { fmtDuration, relativeDay, todayKey } from '../lib/dates';
import { describeRecurrence, nextOccurrence } from '../lib/recurrence';
import { Icon, useUI } from '../ui';
export function TasksView() {
    const types = useTypes();
    const ui = useUI();
    const cats = useCategories();
    const [filter, setFilter] = useState('all');
    const [showPast, setShowPast] = useState(false);
    const data = useLiveQuery(async () => {
        const [tasks, skipped] = await Promise.all([db.tasks.toArray(), db.occStates.where('date').aboveOrEqual(todayKey()).toArray()]);
        return { tasks, skipped: new Set(skipped.map((s) => s.key)) };
    }, []);
    if (!data)
        return _jsx("div", { className: "screen" });
    const tasks = data.tasks.filter((t) => filter === 'all' || typeOf(t.type, types).id === filter);
    const withNext = tasks.map((t) => ({ t, next: nextOccurrence(t, data.skipped) }));
    const recurring = withNext.filter(({ t, next }) => t.recurrence.kind !== 'none' && next).sort((a, b) => a.t.title.localeCompare(b.t.title));
    const upcoming = withNext.filter(({ t, next }) => t.recurrence.kind === 'none' && next).sort((a, b) => (a.next < b.next ? -1 : 1));
    const past = withNext.filter(({ next }) => !next).sort((a, b) => (a.t.startDate < b.t.startDate ? 1 : -1));
    const review = (t, next) => ui.startReview({
        taskId: t.id,
        occKey: next === todayKey() ? `${t.id}_${next}` : null,
        date: todayKey(),
        title: t.title,
        categoryId: t.categoryId,
    });
    const Row = ({ t, next }) => {
        const cat = cats.get(t.categoryId ?? '');
        return (_jsxs("li", { className: "task-row", style: { ['--c']: cat?.color ?? 'var(--muted)' }, children: [_jsxs("button", { className: "task-main", onClick: () => ui.openEditor(t), children: [_jsx("i", { className: "bar" }), _jsxs("span", { className: "task-text", children: [_jsx("strong", { children: t.title }), _jsxs("span", { className: "muted small", children: [t.recurrence.kind !== 'none' ? describeRecurrence(t) : null, t.recurrence.kind !== 'none' && next ? ' · ' : '', next ? `${t.recurrence.kind !== 'none' ? 'prochaine ' : ''}${relativeDay(next)} à ${t.startTime}` : `${relativeDay(t.startDate)} à ${t.startTime}`, ' · ', fmtDuration(t.durationMin)] })] })] }), typeOf(t.type, types).pomodoro && (_jsx("button", { className: "round-play", onClick: () => review(t, next), "aria-label": `Réviser ${t.title}`, children: _jsx(Icon, { name: "play", size: 16 }) }))] }));
    };
    const empty = data.tasks.length === 0;
    return (_jsxs("div", { className: "screen tasks", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { children: "T\u00E2ches" }), _jsxs("div", { className: "seg scroll-x", children: [_jsx("button", { className: filter === 'all' ? 'on' : '', onClick: () => setFilter('all'), children: "Toutes" }), types.map((o) => (_jsx("button", { className: filter === o.id ? 'on' : '', onClick: () => setFilter(o.id), children: o.name }, o.id)))] })] }), _jsxs("div", { className: "scroll-body", children: [empty && (_jsxs("div", { className: "empty", children: [_jsx("h3", { children: "Aucune t\u00E2che pour l\u2019instant" }), _jsx("p", { children: "Ajoute tes r\u00E9visions (un chapitre = une t\u00E2che) et tes activit\u00E9s r\u00E9currentes : sport, cours, boulot\u2026" }), _jsxs("button", { className: "btn primary", onClick: () => ui.openEditor(), children: [_jsx(Icon, { name: "plus", size: 18 }), " Cr\u00E9er ma premi\u00E8re t\u00E2che"] })] })), recurring.length > 0 && (_jsxs("section", { children: [_jsx("h2", { className: "section-title", children: "R\u00E9currentes" }), _jsx("ul", { className: "task-list", children: recurring.map(({ t, next }) => _jsx(Row, { t: t, next: next }, t.id)) })] })), upcoming.length > 0 && (_jsxs("section", { children: [_jsx("h2", { className: "section-title", children: "\u00C0 venir" }), _jsx("ul", { className: "task-list", children: upcoming.map(({ t, next }) => _jsx(Row, { t: t, next: next }, t.id)) })] })), past.length > 0 && (_jsxs("section", { children: [_jsxs("button", { className: "section-title as-btn", onClick: () => setShowPast(!showPast), children: ["Pass\u00E9es (", past.length, ") ", _jsx(Icon, { name: showPast ? 'left' : 'right', size: 14 })] }), showPast && _jsx("ul", { className: "task-list past", children: past.map(({ t, next }) => _jsx(Row, { t: t, next: next }, t.id)) })] })), !empty && tasks.length === 0 && _jsx("p", { className: "muted center", children: "Rien dans ce filtre." })] }), _jsx("button", { className: "fab", onClick: () => ui.openEditor(undefined, filter !== 'all' ? { type: filter } : undefined), "aria-label": "Nouvelle t\u00E2che", children: _jsx(Icon, { name: "plus", size: 26 }) })] }));
}
