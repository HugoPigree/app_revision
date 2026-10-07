import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { db, setOccStatus, uid, useCategories, useSettings } from '../db';
import { fmtDuration, todayKey } from '../lib/dates';
import { cancelPush, schedulePush } from '../lib/push';
import { Icon, useUI } from '../ui';
const KEY = 'cadence.activeRun';
export function loadRun() {
    try {
        const r = localStorage.getItem(KEY);
        return r ? JSON.parse(r) : null;
    }
    catch {
        return null;
    }
}
function saveRun(r) {
    try {
        if (r)
            localStorage.setItem(KEY, JSON.stringify(r));
        else
            localStorage.removeItem(KEY);
    }
    catch { /* stockage indisponible */ }
}
const cfgFrom = (s) => ({ work: s.workMin, short: s.shortBreakMin, long: s.longBreakMin, every: Math.max(1, s.blocksBeforeLong) });
function newRun(ctx, s) {
    return { ctx, startedAt: Date.now(), cfg: cfgFrom(s), phase: 'ready', phaseDur: 0, phaseEnd: 0, pausedLeft: null, blocks: 0, workMs: 0 };
}
const timed = (p) => p === 'work' || p === 'short' || p === 'long';
/** Fait avancer le minuteur jusqu'à `now` (gère le cas où l'app était en arrière-plan). */
function advance(r, now) {
    let run = r;
    let event = null;
    while (timed(run.phase) && run.pausedLeft === null && now >= run.phaseEnd) {
        if (run.phase === 'work') {
            const blocks = run.blocks + 1;
            const long = blocks % run.cfg.every === 0;
            const dur = (long ? run.cfg.long : run.cfg.short) * 60000;
            run = { ...run, blocks, workMs: run.workMs + run.phaseDur, phase: long ? 'long' : 'short', phaseDur: dur, phaseEnd: run.phaseEnd + dur };
            event = 'workEnd';
        }
        else {
            // Fin de pause : on attend que tu relances toi-même le bloc suivant
            run = { ...run, phase: 'ready' };
            event = 'breakEnd';
        }
    }
    return { run, event };
}
let audio = null;
function unlockAudio() {
    try {
        if (!audio) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audio = new AC();
        }
        void audio.resume();
    }
    catch { /* pas d'audio */ }
}
function chime(kind) {
    navigator.vibrate?.([200, 100, 200]);
    if (!audio)
        return;
    const notes = kind === 'workEnd' ? [784, 659, 523] : [523, 659, 784];
    notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const t = audio.currentTime + i * 0.2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.55);
    });
}
const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export function Review({ ctx, onMinimize, onDone }) {
    const settings = useSettings();
    const ui = useUI();
    const cat = useCategories().get(ctx.categoryId ?? '');
    const [run, setRun] = useState(() => {
        const existing = loadRun();
        return existing && existing.ctx.occKey === ctx.occKey && existing.ctx.taskId === ctx.taskId ? existing : newRun(ctx, settings);
    });
    const [now, setNow] = useState(Date.now());
    const [saving, setSaving] = useState(false);
    // Horloge
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 250);
        const onVis = () => setNow(Date.now());
        document.addEventListener('visibilitychange', onVis);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
    }, []);
    useEffect(() => {
        const { run: next, event } = advance(run, now);
        if (event) {
            setRun(next);
            chime(event);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now]);
    useEffect(() => {
        saveRun(run);
    }, [run]);
    // Notifications push de fin de pomodoro / de pause (utiles quand l'app est en arrière-plan)
    const running = timed(run.phase) && run.pausedLeft === null;
    useEffect(() => {
        if (!settings.notifyPomodoro || !running) {
            void cancelPush('pomo-work', 'pomo-break');
            return;
        }
        const subject = ctx.title;
        if (run.phase === 'work') {
            const blocks = run.blocks + 1;
            const long = blocks % run.cfg.every === 0;
            const breakMin = long ? run.cfg.long : run.cfg.short;
            void schedulePush('pomo-work', run.phaseEnd, 'Pomodoro terminé ✓', `${subject} · ${long ? 'Grande pause' : 'Pause'} de ${breakMin} min`);
            void schedulePush('pomo-break', run.phaseEnd + breakMin * 60000, 'Pause terminée', `Lance le pomodoro ${blocks + 1} quand tu es prêt`);
        }
        else {
            void cancelPush('pomo-work');
            void schedulePush('pomo-break', run.phaseEnd, 'Pause terminée', `Lance le pomodoro ${run.blocks + 1} quand tu es prêt`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run.phase, run.phaseEnd, running, settings.notifyPomodoro]);
    // Empêche l'écran de se mettre en veille pendant un bloc
    useEffect(() => {
        if (!timed(run.phase) || run.pausedLeft !== null)
            return;
        let lock = null;
        const nav = navigator;
        nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => { });
        return () => { lock?.release().catch(() => { }); };
    }, [run.phase, run.pausedLeft]);
    const remaining = run.pausedLeft ?? Math.max(0, run.phaseEnd - now);
    const progress = timed(run.phase) && run.phaseDur ? 1 - remaining / run.phaseDur : 0;
    const currentWorkMs = run.phase === 'work' ? run.phaseDur - remaining : 0;
    const totalWorkMin = (run.workMs + currentWorkMs) / 60000;
    const startBlock = () => {
        unlockAudio();
        const fresh = run.blocks === 0 && run.workMs === 0;
        const cfg = fresh ? cfgFrom(settings) : run.cfg;
        const dur = cfg.work * 60000;
        const t = Date.now();
        setRun({ ...run, cfg, startedAt: fresh ? t : run.startedAt, phase: 'work', phaseDur: dur, phaseEnd: t + dur, pausedLeft: null });
    };
    const pause = () => setRun({ ...run, pausedLeft: Math.max(0, run.phaseEnd - Date.now()) });
    const resume = () => {
        unlockAudio();
        setRun({ ...run, phaseEnd: Date.now() + (run.pausedLeft ?? 0), pausedLeft: null });
    };
    const skipBreak = () => setRun({ ...run, phase: 'ready', pausedLeft: null });
    const finish = async () => {
        const extra = run.phase === 'work' ? run.phaseDur - remaining : 0;
        const workMs = run.workMs + extra;
        if (workMs < 60000) {
            const ok = await ui.ask({
                title: 'Abandonner la séance ?',
                message: 'Moins d’une minute de travail : rien ne sera enregistré.',
                confirmLabel: 'Abandonner',
                cancelLabel: 'Continuer',
                danger: true,
            });
            if (!ok)
                return;
            saveRun(null);
            void cancelPush('pomo-work', 'pomo-break');
            onDone();
            return;
        }
        if (run.phase === 'work') {
            const ok = await ui.ask({
                title: 'Terminer la séance ?',
                message: 'Le pomodoro en cours sera compté au prorata du temps passé.',
                confirmLabel: 'Terminer',
                cancelLabel: 'Continuer',
            });
            if (!ok)
                return;
        }
        setRun({ ...run, workMs: run.workMs + (run.phase === 'work' ? run.phaseDur - (run.pausedLeft ?? Math.max(0, run.phaseEnd - Date.now())) : 0), phase: 'finished', pausedLeft: null });
    };
    const save = async () => {
        if (saving)
            return;
        setSaving(true);
        const workMinutes = Math.round(run.workMs / 60000);
        await db.sessions.add({
            id: uid(),
            taskId: ctx.taskId,
            occKey: ctx.occKey,
            categoryId: ctx.categoryId,
            title: ctx.title,
            date: todayKey(),
            startedAt: run.startedAt,
            endedAt: Date.now(),
            workMinutes,
            blocks: run.blocks,
            mastery: null,
        });
        if (ctx.taskId && ctx.occKey)
            await setOccStatus(ctx.taskId, ctx.date, 'done');
        saveRun(null);
        void cancelPush('pomo-work', 'pomo-break');
        ui.toast(`Séance enregistrée : ${fmtDuration(workMinutes)}`);
        onDone();
    };
    const discard = async () => {
        const ok = await ui.ask({ title: 'Supprimer cette séance ?', message: 'Elle ne comptera pas dans ton bilan.', confirmLabel: 'Supprimer', danger: true });
        if (!ok)
            return;
        saveRun(null);
        void cancelPush('pomo-work', 'pomo-break');
        onDone();
    };
    // ——— Écran de fin ———
    if (run.phase === 'finished') {
        const workMinutes = Math.round(run.workMs / 60000);
        return (_jsx("div", { className: "review finished", children: _jsxs("div", { className: "review-inner", children: [_jsx("p", { className: "eyebrow", children: "S\u00E9ance termin\u00E9e" }), _jsx("h1", { className: "big-num", children: fmtDuration(workMinutes) }), _jsxs("p", { className: "muted center", children: ["de travail effectif sur ", _jsx("strong", { children: ctx.title })] }), _jsxs("div", { className: "finish-stats", children: [_jsxs("div", { children: [_jsx("b", { children: run.blocks }), _jsxs("span", { children: ["pomodoro", run.blocks > 1 ? 's' : '', " complet", run.blocks > 1 ? 's' : ''] })] }), _jsxs("div", { children: [_jsxs("b", { children: [Math.max(0, Math.round((Date.now() - run.startedAt) / 60000)), _jsx("small", { children: " min" })] }), _jsx("span", { children: "dur\u00E9e totale, pauses comprises" })] })] }), _jsxs("div", { className: "controls", children: [_jsx("button", { className: "btn primary big", onClick: save, disabled: saving, children: "Enregistrer la s\u00E9ance" }), _jsx("button", { className: "btn danger-ghost", onClick: discard, children: "Ne pas enregistrer" })] })] }) }));
    }
    // ——— Minuteur ———
    const isBreak = run.phase === 'short' || run.phase === 'long';
    const nextBlock = run.blocks + 1;
    const label = run.phase === 'work' ? `Pomodoro ${nextBlock}`
        : run.phase === 'short' ? 'Pause courte'
            : run.phase === 'long' ? 'Grande pause'
                : run.blocks === 0 ? 'Prêt à démarrer' : `Prêt pour le pomodoro ${nextBlock}`;
    const R = 118, C = 2 * Math.PI * R;
    const fresh = run.blocks === 0 && run.workMs === 0 && run.phase === 'ready';
    const cfg = fresh ? cfgFrom(settings) : run.cfg;
    const shownTime = run.phase === 'ready' ? mmss(cfg.work * 60000) : mmss(remaining);
    const inCycle = run.blocks % cfg.every;
    return (_jsxs("div", { className: `review phase-${run.phase} ${run.pausedLeft !== null ? 'paused' : ''}`, children: [_jsxs("div", { className: "review-top", children: [_jsx("button", { className: "icon-btn", onClick: onMinimize, "aria-label": "R\u00E9duire", children: _jsx(Icon, { name: "close" }) }), _jsxs("div", { className: "review-title", children: [_jsxs("span", { className: "occ-tag", style: { ['--c']: cat?.color ?? 'var(--muted)' }, children: [_jsx("i", { className: "dot" }), " ", cat?.name ?? 'Révision'] }), _jsx("strong", { children: ctx.title })] }), _jsx("span", { style: { width: 40 } })] }), _jsxs("div", { className: "review-inner", children: [_jsxs("p", { className: "phase-label", children: [label, run.pausedLeft !== null ? ' · en pause' : ''] }), _jsxs("div", { className: "ring", children: [_jsxs("svg", { viewBox: "0 0 260 260", children: [_jsx("circle", { cx: "130", cy: "130", r: R, className: "ring-bg" }), _jsx("circle", { cx: "130", cy: "130", r: R, className: "ring-fg", strokeDasharray: C, strokeDashoffset: C * (1 - progress), transform: "rotate(-90 130 130)" })] }), _jsxs("div", { className: "ring-text", children: [_jsx("span", { className: "time", children: shownTime }), _jsx("span", { className: "cycle", children: Array.from({ length: cfg.every }, (_, i) => (_jsx("i", { className: i < inCycle || (inCycle === 0 && run.blocks > 0 && isBreak) ? 'on' : i === inCycle && run.phase === 'work' ? 'cur' : '' }, i))) })] })] }), _jsxs("p", { className: "muted center small", children: ["Travail effectif : ", fmtDuration(totalWorkMin)] }), _jsxs("div", { className: "controls", children: [run.phase === 'ready' && (_jsxs("button", { className: "btn primary big", onClick: startBlock, children: [_jsx(Icon, { name: "play", size: 18 }), " ", run.blocks === 0 ? 'Commencer' : `Lancer le pomodoro ${nextBlock}`, " (", cfg.work, " min)"] })), timed(run.phase) && (run.pausedLeft === null
                                ? _jsxs("button", { className: "btn secondary big", onClick: pause, children: [_jsx(Icon, { name: "pause", size: 18 }), " Pause"] })
                                : _jsxs("button", { className: "btn primary big", onClick: resume, children: [_jsx(Icon, { name: "play", size: 18 }), " Reprendre"] })), isBreak && _jsxs("button", { className: "btn ghost", onClick: skipBreak, children: [_jsx(Icon, { name: "skip", size: 16 }), " Passer la pause"] }), (run.blocks > 0 || run.phase === 'work') && (_jsxs("button", { className: "btn ghost", onClick: finish, children: [_jsx(Icon, { name: "stop", size: 16 }), " Terminer la s\u00E9ance"] })), run.phase === 'ready' && run.blocks === 0 && (_jsxs("p", { className: "hint center", children: [cfg.work, " min de travail, ", cfg.short, " min de pause, grande pause de ", cfg.long, " min tous les ", cfg.every, " pomodoros."] }))] })] })] }));
}
/** Bandeau affiché quand une séance tourne mais que l'écran révision est réduit */
export function ReviewBanner({ onOpen }) {
    const [, setT] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setT((x) => x + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const r = loadRun();
    if (!r || r.phase === 'finished')
        return null;
    const { run } = advance(r, Date.now());
    const rem = run.pausedLeft ?? Math.max(0, run.phaseEnd - Date.now());
    const txt = run.phase === 'ready' ? 'en attente' : `${run.phase === 'work' ? 'travail' : 'pause'} ${mmss(rem)}${run.pausedLeft !== null ? ' (pause)' : ''}`;
    return (_jsxs("button", { className: `review-banner phase-${run.phase}`, onClick: () => onOpen(run.ctx), children: [_jsx("span", { className: "pulse" }), " ", _jsx("strong", { children: run.ctx.title }), " ", _jsxs("span", { children: ["\u00B7 ", txt] })] }));
}
