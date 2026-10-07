import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarView } from './components/Calendar';
import { OccurrenceSheet } from './components/OccurrenceSheet';
import { loadRun, Review, ReviewBanner } from './components/Review';
import { SettingsView } from './components/SettingsView';
import { StatsView } from './components/Stats';
import { TaskEditor } from './components/TaskEditor';
import { TasksView } from './components/Tasks';
import { AuthScreen } from './components/AuthScreen';
import { EndCheck } from './components/EndCheck';
import { cancelPush, refreshPushSubscription } from './lib/push';
import { cloudEnabled, useSync } from './lib/sync';
import { ConfirmDialog, Icon, UIContext } from './ui';
const TABS = [
    { id: 'calendar', label: 'Planning', icon: 'calendar' },
    { id: 'tasks', label: 'Tâches', icon: 'tasks' },
    { id: 'stats', label: 'Bilan', icon: 'stats' },
    { id: 'settings', label: 'Réglages', icon: 'settings' },
];
export default function App() {
    const [tab, setTab] = useState('calendar');
    const [editor, setEditor] = useState(null);
    const [occ, setOcc] = useState(null);
    // Si une séance tournait quand l'app a été fermée, on la rouvre directement
    const [review, setReview] = useState(() => loadRun()?.ctx ?? null);
    const [toast, setToast] = useState(null);
    const [asking, setAsking] = useState(null);
    const resolver = useRef(null);
    const [, bump] = useState(0);
    const sync = useSync();
    const [skipAuth, setSkipAuth] = useState(() => localStorage.getItem('cadence.skipAuth') === '1');
    const [authOpen, setAuthOpen] = useState(false);
    useEffect(() => {
        if (!toast)
            return;
        const id = setTimeout(() => setToast(null), toast.action ? 4500 : 2200);
        return () => clearTimeout(id);
    }, [toast]);
    useEffect(() => {
        navigator.storage?.persist?.().catch(() => { });
    }, []);
    // Notifications : on renvoie l'abonnement de cet appareil à chaque connexion / ouverture
    const userId = sync.session?.user.id;
    useEffect(() => {
        if (userId)
            void refreshPushSubscription();
    }, [userId]);
    const choose = useCallback((opts) => {
        resolver.current?.(null);
        setAsking(opts);
        return new Promise((resolve) => { resolver.current = resolve; });
    }, []);
    const ask = useCallback((opts) => choose(opts).then((v) => v === 'ok'), [choose]);
    const answer = useCallback((value) => {
        resolver.current?.(value);
        resolver.current = null;
        setAsking(null);
    }, []);
    const startReview = useCallback(async (ctx) => {
        const running = loadRun();
        if (running && running.phase !== 'finished' && (running.ctx.taskId !== ctx.taskId || running.ctx.occKey !== ctx.occKey)) {
            const ok = await ask({
                title: 'Une séance est déjà en cours',
                message: `« ${running.ctx.title} » n’est pas terminée. L’abandonner pour démarrer celle-ci ?`,
                confirmLabel: 'Abandonner et démarrer',
                cancelLabel: 'Reprendre l’autre',
                danger: true,
            });
            if (!ok) {
                setReview(running.ctx);
                return;
            }
            localStorage.removeItem('cadence.activeRun');
            void cancelPush('pomo-work', 'pomo-break');
        }
        setReview(ctx);
    }, [ask]);
    const ui = useMemo(() => ({
        openEditor: (task, defaults) => setEditor({ task, defaults, n: Date.now() }),
        openOccurrence: setOcc,
        startReview: (ctx) => { void startReview(ctx); },
        toast: (msg, action) => setToast({ msg, n: Date.now(), action }),
        ask,
        choose,
        openAuth: () => setAuthOpen(true),
    }), [startReview, ask, choose]);
    if (cloudEnabled && !sync.ready)
        return _jsx("div", { className: "app splash" });
    if (sync.recovery) {
        return _jsx(UIContext.Provider, { value: ui, children: _jsx(AuthScreen, { initialMode: "newpass", onDone: () => ui.toast('Mot de passe modifié') }) });
    }
    if (cloudEnabled && !sync.session && (!skipAuth || authOpen)) {
        return (_jsxs(UIContext.Provider, { value: ui, children: [_jsx(AuthScreen, { onSkip: () => { localStorage.setItem('cadence.skipAuth', '1'); setSkipAuth(true); setAuthOpen(false); }, onDone: () => { setAuthOpen(false); setTab('calendar'); ui.toast('Connecté ✓ Tes données sont synchronisées'); } }), toast && (_jsxs("div", { className: `toast ${toast.action ? 'has-action' : ''}`, children: [_jsx("span", { children: toast.msg }), toast.action && _jsx("button", { onClick: () => { toast.action.run(); setToast(null); }, children: toast.action.label })] }, toast.n))] }));
    }
    return (_jsx(UIContext.Provider, { value: ui, children: _jsxs("div", { className: "app", children: [_jsxs("nav", { className: "tabbar", children: [_jsxs("div", { className: "brand", children: [_jsx("img", { src: "/icons/icon-192.png", alt: "", width: 30, height: 30 }), _jsx("span", { children: "Cadence" })] }), TABS.map((t) => (_jsxs("button", { className: tab === t.id ? 'on' : '', onClick: () => setTab(t.id), "aria-current": tab === t.id ? 'page' : undefined, children: [_jsx(Icon, { name: t.icon, size: 24 }), _jsx("span", { children: t.label })] }, t.id)))] }), _jsxs("div", { className: "main-col", children: [_jsxs("main", { children: [tab === 'calendar' && _jsx(CalendarView, {}), tab === 'tasks' && _jsx(TasksView, {}), tab === 'stats' && _jsx(StatsView, {}), tab === 'settings' && _jsx(SettingsView, {})] }), !review && _jsx(ReviewBanner, { onOpen: setReview })] }), editor && _jsx(TaskEditor, { task: editor.task, defaults: editor.defaults, onClose: () => setEditor(null) }, editor.n), occ && _jsx(OccurrenceSheet, { occ: occ, onClose: () => setOcc(null) }), review && (_jsx(Review, { ctx: review, onMinimize: () => { setReview(null); bump((x) => x + 1); }, onDone: () => setReview(null) }, `${review.taskId}_${review.occKey}`)), _jsx(EndCheck, { paused: !!(editor || occ || review || asking) }), asking && _jsx(ConfirmDialog, { opts: asking, onAnswer: answer }), toast && (_jsxs("div", { className: `toast ${toast.action ? 'has-action' : ''}`, children: [_jsx("span", { children: toast.msg }), toast.action && _jsx("button", { onClick: () => { toast.action.run(); setToast(null); }, children: toast.action.label })] }, toast.n))] }) }));
}
