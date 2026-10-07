import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setOccStatus, useCategories } from '../db';
import { addDays, fmtDuration, minToTime, nowMin, relativeDay, todayKey } from '../lib/dates';
import { expand } from '../lib/recurrence';
import { postponeOccurrence } from '../lib/move';
import { loadRun } from './Review';
import { Icon, Sheet, useUI } from '../ui';
/* ——— Mémoire des tâches déjà traitées (sur cet appareil) ——— */
const ASKED = 'cadence.endAsked';
function readAsked() {
    try {
        return new Set(JSON.parse(localStorage.getItem(ASKED) ?? '[]'));
    }
    catch {
        return new Set();
    }
}
function markAsked(key) {
    const min = addDays(todayKey(), -2);
    const keep = [...readAsked()].filter((k) => k.slice(-10) >= min);
    keep.push(key);
    localStorage.setItem(ASKED, JSON.stringify(keep));
}
/** Fin d'une occurrence en timestamp (heure locale) */
function endTime(o) {
    const [y, m, d] = o.date.split('-').map(Number);
    return new Date(y, m - 1, d, 0, o.start + o.task.durationMin).getTime();
}
/* ——— Choix d'un nouveau créneau ——— */
const ceil15 = (m) => Math.ceil(m / 15) * 15;
export function PostponePicker({ occ, onDone, onBack }) {
    const today = todayKey();
    const dur = occ.task.durationMin;
    const inOneHour = ceil15(nowMin() + 60);
    const tomorrow = addDays(today, 1);
    const [custom, setCustom] = useState(false);
    const [date, setDate] = useState(today);
    const [time, setTime] = useState(minToTime(Math.min(ceil15(nowMin() + 30), 23 * 60)));
    const go = async (d, start) => onDone(await postponeOccurrence(occ, d, start));
    const options = [];
    if (inOneHour + dur <= 24 * 60)
        options.push({ label: 'Dans 1 h', sub: `aujourd'hui ${minToTime(inOneHour)}`, date: today, start: inOneHour });
    if (nowMin() < 19 * 60 && 20 * 60 + dur <= 24 * 60)
        options.push({ label: 'Ce soir', sub: '20:00', date: today, start: 20 * 60 });
    options.push({ label: 'Demain', sub: `même heure, ${minToTime(occ.start)}`, date: tomorrow, start: occ.start });
    return (_jsxs("div", { className: "postpone", children: [_jsxs("div", { className: "postpone-opts", children: [options.map((o) => (_jsxs("button", { className: "postpone-opt", onClick: () => void go(o.date, o.start), children: [_jsx("strong", { children: o.label }), _jsx("span", { children: o.sub })] }, o.label))), _jsxs("button", { className: `postpone-opt ${custom ? 'on' : ''}`, onClick: () => setCustom(true), children: [_jsx("strong", { children: "Choisir" }), _jsx("span", { children: "jour et heure" })] })] }), custom && (_jsxs("div", { className: "postpone-custom", children: [_jsx("input", { type: "date", value: date, min: today, onChange: (e) => e.target.value && setDate(e.target.value), "aria-label": "Jour" }), _jsx("input", { type: "time", value: time, step: 300, onChange: (e) => e.target.value && setTime(e.target.value), "aria-label": "Heure" }), _jsx("button", { className: "btn primary", onClick: () => { const [h, m] = time.split(':').map(Number); void go(date, h * 60 + m); }, children: "OK" })] })), onBack && _jsx("button", { className: "btn ghost", onClick: onBack, children: "Retour" })] }));
}
/* ——— Fenêtre « c'est fait ? » à la fin d'une tâche ——— */
/** Clé d'occurrence demandée depuis une notification (?fin=…) */
function readFocusFromUrl() {
    const p = new URLSearchParams(location.search);
    const k = p.get('fin');
    if (k)
        history.replaceState(null, '', location.pathname);
    return k;
}
export function EndCheck({ paused }) {
    const ui = useUI();
    const cats = useCategories();
    const [tick, setTick] = useState(0);
    const [focus, setFocus] = useState(readFocusFromUrl);
    const [later, setLater] = useState(() => new Set()); // « plus tard » : jusqu'à la prochaine ouverture
    const [mode, setMode] = useState('ask');
    // Vérifie régulièrement, et à chaque retour sur l'app
    useEffect(() => {
        const again = () => setTick((t) => t + 1);
        const id = setInterval(again, 30000);
        const onVis = () => document.visibilityState === 'visible' && again();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', again);
        const onMsg = (e) => {
            const url = e.data?.type === 'open' ? e.data.url : null;
            const k = url ? new URL(url, location.origin).searchParams.get('fin') : null;
            if (k) {
                setFocus(k);
                setMode('ask');
                again();
            }
        };
        navigator.serviceWorker?.addEventListener('message', onMsg);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('focus', again);
            navigator.serviceWorker?.removeEventListener('message', onMsg);
        };
    }, []);
    const today = todayKey();
    const yesterday = addDays(today, -1);
    const occs = useLiveQuery(async () => {
        const [tasks, states] = await Promise.all([
            db.tasks.toArray(),
            db.occStates.where('date').between(yesterday, today, true, true).toArray(),
        ]);
        return expand(tasks, states, yesterday, today);
    }, [yesterday, today]);
    const current = useMemo(() => {
        if (!occs)
            return null;
        void tick;
        const now = Date.now();
        const asked = readAsked();
        const run = loadRun();
        const running = run && run.phase !== 'finished' ? run.ctx.occKey : null;
        const open = occs.filter((o) => o.status !== 'done' && o.key !== running);
        // Depuis une notification : celle-là d'abord, même si déjà vue
        const focused = focus ? open.find((o) => o.key === focus) : undefined;
        if (focused)
            return { occ: focused, left: 0 };
        const due = open.filter((o) => o.date === today &&
            endTime(o) <= now &&
            (o.task.createdAt ?? 0) < endTime(o) && // ajoutée après coup : rien à demander
            !asked.has(o.key) &&
            !later.has(o.key));
        return due.length ? { occ: due[due.length - 1], left: due.length - 1 } : null;
    }, [occs, tick, focus, later, today]);
    useEffect(() => { setMode('ask'); }, [current?.occ.key]);
    if (!current || paused)
        return null;
    const { occ, left } = current;
    const cat = cats.get(occ.task.categoryId ?? '');
    const finish = (msg, remember = true) => {
        if (remember)
            markAsked(occ.key);
        if (focus === occ.key)
            setFocus(null);
        setTick((t) => t + 1);
        ui.toast(msg);
    };
    const done = async () => { await setOccStatus(occ.task.id, occ.date, 'done'); finish('Bien joué ✓'); };
    const notDone = () => finish('Notée comme pas faite');
    const close = () => {
        if (focus === occ.key)
            setFocus(null);
        setLater((s) => new Set(s).add(occ.key));
    };
    return (_jsx(Sheet, { onClose: close, children: _jsxs("div", { className: "endcheck", children: [_jsxs("div", { className: "occ-tag", style: { ['--c']: cat?.color ?? 'var(--muted)' }, children: [_jsx("i", { className: "dot" }), " ", occ.date === today ? 'Terminée' : `Terminée ${relativeDay(occ.date)}`, " \u00B7 ", minToTime(occ.start), " \u2013 ", minToTime(occ.start + occ.task.durationMin)] }), _jsx("h2", { className: "occ-title", children: occ.task.title }), mode === 'ask' ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "endcheck-q", children: "C\u2019est fait ?" }), _jsxs("div", { className: "actions", children: [_jsxs("button", { className: "btn primary big", onClick: () => void done(), children: [_jsx(Icon, { name: "check", size: 18 }), " Oui, c\u2019est fait"] }), _jsxs("button", { className: "btn secondary big", onClick: () => setMode('postpone'), children: [_jsx(Icon, { name: "clock", size: 18 }), " D\u00E9caler"] }), _jsx("button", { className: "btn ghost", onClick: notDone, children: "Pas fait, tant pis" })] }), left > 0 && _jsxs("p", { className: "hint center", children: ["Encore ", left, " t\u00E2che", left > 1 ? 's' : '', " termin\u00E9e", left > 1 ? 's' : '', " \u00E0 v\u00E9rifier"] })] })) : (_jsxs(_Fragment, { children: [_jsxs("p", { className: "endcheck-q", children: ["\u00C0 quand la d\u00E9caler ? ", _jsxs("span", { className: "muted", children: ["(", fmtDuration(occ.task.durationMin), ")"] })] }), _jsx(PostponePicker, { occ: occ, onBack: () => setMode('ask'), onDone: (where) => finish(`Décalée ${where}`, false) })] }))] }) }, occ.key));
}
