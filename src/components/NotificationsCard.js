import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { db, useSettings } from '../db';
import { disablePush, enablePush, getPushState, sendTestPush } from '../lib/push';
import { useSync } from '../lib/sync';
import { useUI } from '../ui';
const BEFORE_OPTIONS = [
    { v: null, label: 'Désactivé' },
    { v: 0, label: 'À l’heure' },
    { v: 5, label: '5 min avant' },
    { v: 10, label: '10 min avant' },
    { v: 15, label: '15 min avant' },
    { v: 30, label: '30 min avant' },
    { v: 60, label: '1 h avant' },
];
function Switch({ checked, onChange, label }) {
    return (_jsxs("label", { className: "switch", "aria-label": label, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked) }), _jsx("span", { className: "switch-track", children: _jsx("span", {}) })] }));
}
export function NotificationsCard() {
    const s = useSettings();
    const sync = useSync();
    const ui = useUI();
    const [state, setState] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        getPushState().then(setState).catch(() => setState('unsupported'));
    }, [sync.session?.user.id]);
    const update = (patch) => db.settings.put({ ...s, ...patch });
    const turnOn = async () => {
        setBusy(true);
        try {
            const st = await enablePush();
            setState(st);
            if (st === 'on') {
                await sendTestPush();
                ui.toast('Notifications activées : une notif de test arrive dans moins d’une minute');
            }
            else if (st === 'denied') {
                ui.toast('Notifications refusées');
            }
        }
        catch (e) {
            console.warn(e);
            ui.toast('Impossible d’activer les notifications');
        }
        finally {
            setBusy(false);
        }
    };
    const turnOff = async () => {
        setBusy(true);
        await disablePush().catch(() => { });
        setState('off');
        setBusy(false);
        ui.toast('Notifications désactivées sur cet appareil');
    };
    return (_jsxs("section", { className: "card notifs", children: [_jsx("h2", { className: "section-title", children: "Notifications" }), state === 'ios-install' && (_jsxs("p", { className: "notice", children: ["Sur iPhone, les notifications ne marchent que dans l\u2019app install\u00E9e : dans Safari, touche ", _jsx("b", { children: "Partager" }), " puis ", _jsx("b", { children: "Sur l\u2019\u00E9cran d\u2019accueil" }), ", et ouvre Cadence depuis l\u2019ic\u00F4ne."] })), state === 'unsupported' && _jsx("p", { className: "notice", children: "Ce navigateur ne g\u00E8re pas les notifications push." }), state === 'signed-out' && _jsx("p", { className: "notice", children: "Connecte-toi \u00E0 ton compte pour recevoir des notifications (c\u2019est le serveur qui les envoie, m\u00EAme app ferm\u00E9e)." }), state === 'denied' && (_jsxs("p", { className: "notice", children: ["Les notifications sont bloqu\u00E9es. R\u00E9active-les dans les r\u00E9glages du t\u00E9l\u00E9phone (iPhone : ", _jsx("b", { children: "R\u00E9glages \u2192 Notifications \u2192 Cadence" }), "), puis reviens ici."] })), (state === 'off' || state === 'on') && (_jsxs("div", { className: "notif-device", children: [_jsxs("div", { children: [_jsx("strong", { children: "Sur cet appareil" }), _jsx("span", { className: "muted small", children: state === 'on' ? 'Activées' : 'Désactivées' })] }), state === 'on' ? (_jsxs("div", { className: "notif-actions", children: [_jsx("button", { className: "btn ghost", onClick: async () => { await sendTestPush(); ui.toast('Notif de test envoyée : elle arrive dans moins d’une minute'); }, children: "Tester" }), _jsx("button", { className: "btn secondary", onClick: turnOff, disabled: busy, children: "D\u00E9sactiver" })] })) : (_jsx("button", { className: "btn primary", onClick: turnOn, disabled: busy, children: busy ? '…' : 'Activer' }))] })), _jsxs("div", { className: `notif-prefs ${state === 'on' ? '' : 'dim'}`, children: [_jsxs("div", { className: "notif-row", children: [_jsx("span", { children: "Rappel avant une t\u00E2che" }), _jsx("select", { className: "cat-move", value: s.notifyBefore === null ? 'off' : String(s.notifyBefore), onChange: (e) => update({ notifyBefore: e.target.value === 'off' ? null : Number(e.target.value) }), children: BEFORE_OPTIONS.map((o) => _jsx("option", { value: o.v === null ? 'off' : String(o.v), children: o.label }, String(o.v))) })] }), _jsxs("div", { className: "notif-row", children: [_jsx("span", { children: "Fin de t\u00E2che : \u00AB c\u2019est fait ? \u00BB" }), _jsx(Switch, { checked: s.notifyEnd, onChange: (v) => update({ notifyEnd: v }), label: "Fin de t\u00E2che" })] }), _jsxs("div", { className: "notif-row", children: [_jsx("span", { children: "Fin de pomodoro et de pause" }), _jsx(Switch, { checked: s.notifyPomodoro, onChange: (v) => update({ notifyPomodoro: v }), label: "Fin de pomodoro et de pause" })] }), _jsxs("div", { className: "notif-row", children: [_jsx("span", { children: "R\u00E9cap du matin" }), _jsxs("div", { className: "notif-time", children: [s.notifyMorning && _jsx("input", { type: "time", value: s.notifyMorning, onChange: (e) => e.target.value && update({ notifyMorning: e.target.value }) }), _jsx(Switch, { checked: !!s.notifyMorning, onChange: (v) => update({ notifyMorning: v ? '08:00' : null }), label: "R\u00E9cap du matin" })] })] }), _jsxs("div", { className: "notif-row", children: [_jsx("span", { children: "T\u00E2ches pas coch\u00E9es le soir" }), _jsxs("div", { className: "notif-time", children: [s.notifyEvening && _jsx("input", { type: "time", value: s.notifyEvening, onChange: (e) => e.target.value && update({ notifyEvening: e.target.value }) }), _jsx(Switch, { checked: !!s.notifyEvening, onChange: (v) => update({ notifyEvening: v ? '21:00' : null }), label: "T\u00E2ches pas coch\u00E9es le soir" })] })] }), _jsx("p", { className: "muted small", children: "Ces r\u00E9glages valent pour tous tes appareils. Les notifs arrivent m\u00EAme quand l\u2019app est ferm\u00E9e (\u00E0 la minute pr\u00E8s)." })] })] }));
}
