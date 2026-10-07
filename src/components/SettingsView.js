import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { catType, db, deleteCategory, resetLocalDB, typeOf, uid, useSettings, useTypes } from '../db';
import { exportData, importData } from '../lib/backup';
import { cloudEnabled, signOutAndClear, syncNow, useSync } from '../lib/sync';
import { pickDistinctColor } from '../lib/colors';
import { createType, removeTypeWithUndo } from '../lib/types';
import { Icon, LiveInput, useUI } from '../ui';
import { NotificationsCard } from './NotificationsCard';
function Stepper({ label, value, min, max, step = 1, unit, onChange }) {
    return (_jsxs("div", { className: "stepper", children: [_jsx("span", { children: label }), _jsxs("div", { children: [_jsx("button", { onClick: () => onChange(Math.max(min, value - step)), disabled: value <= min, "aria-label": `Diminuer ${label}`, children: "\u2212" }), _jsxs("b", { children: [value, unit ? _jsxs("small", { children: [" ", unit] }) : null] }), _jsx("button", { onClick: () => onChange(Math.min(max, value + step)), disabled: value >= max, "aria-label": `Augmenter ${label}`, children: "+" })] })] }));
}
const PRESETS = [
    { name: 'Classique', sub: '25 / 5', workMin: 25, shortBreakMin: 5, longBreakMin: 20, blocksBeforeLong: 4 },
    { name: 'Long', sub: '50 / 10', workMin: 50, shortBreakMin: 10, longBreakMin: 30, blocksBeforeLong: 3 },
    { name: 'Court', sub: '15 / 3', workMin: 15, shortBreakMin: 3, longBreakMin: 15, blocksBeforeLong: 4 },
];
export function SettingsView() {
    const s = useSettings();
    const ui = useUI();
    // Ordre stable ici (pas de tri par nom) pour que la ligne ne bouge pas pendant qu'on la renomme
    const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
    const fileRef = useRef(null);
    const [persisted, setPersisted] = useState(null);
    useEffect(() => {
        navigator.storage?.persisted?.().then(setPersisted).catch(() => { });
    }, []);
    const sync = useSync();
    const signOut = async () => {
        await syncNow();
        const left = sync.pending;
        const ok = await ui.ask({
            title: 'Se déconnecter ?',
            message: left
                ? `${left} modification(s) n’ont pas encore pu être envoyées et seront perdues. Les données de cet appareil seront effacées.`
                : 'Tes données restent dans ton compte. Elles seront effacées de cet appareil et reviendront à la prochaine connexion.',
            confirmLabel: 'Se déconnecter',
            danger: true,
        });
        if (!ok)
            return;
        await signOutAndClear(resetLocalDB);
        ui.toast('Déconnecté');
    };
    const syncLabel = () => {
        if (sync.status === 'syncing')
            return 'Synchronisation…';
        if (sync.status === 'offline')
            return sync.pending ? `Hors ligne · ${sync.pending} modif. en attente` : 'Hors ligne';
        if (sync.status === 'error')
            return 'Erreur de synchro, nouvel essai bientôt';
        if (!sync.lastSyncedAt)
            return 'Pas encore synchronisé';
        const min = Math.round((Date.now() - sync.lastSyncedAt) / 60000);
        return `Synchronisé ${min < 1 ? 'à l’instant' : `il y a ${min} min`}${sync.pending ? ` · ${sync.pending} en attente` : ''}`;
    };
    const update = (patch) => db.settings.put({ ...s, ...patch });
    const onImport = async (f) => {
        if (!f)
            return;
        const ok = await ui.ask({ title: 'Restaurer cette sauvegarde ?', message: 'Toutes tes données actuelles seront remplacées.', confirmLabel: 'Remplacer', danger: true });
        if (!ok) {
            if (fileRef.current)
                fileRef.current.value = '';
            return;
        }
        try {
            await importData(f);
            ui.toast('Sauvegarde restaurée');
        }
        catch (e) {
            await ui.ask({ title: 'Import impossible', message: e.message, confirmLabel: 'OK', cancelLabel: null });
        }
        if (fileRef.current)
            fileRef.current.value = '';
    };
    const types = useTypes();
    const addType = async () => {
        await createType(types, 'Nouvelle catégorie');
        setTimeout(() => {
            const inputs = document.querySelectorAll('.type-name');
            const last = inputs[inputs.length - 1];
            last?.focus();
            last?.select();
        }, 50);
    };
    const removeType = (id) => void removeTypeWithUndo(ui, types, id);
    const removeCat = async (id, name) => {
        const undo = await deleteCategory(id);
        ui.toast(`« ${name} » supprimée`, { label: 'Annuler', run: () => void undo() });
    };
    const activePreset = PRESETS.find((p) => p.workMin === s.workMin && p.shortBreakMin === s.shortBreakMin && p.longBreakMin === s.longBreakMin && p.blocksBeforeLong === s.blocksBeforeLong);
    return (_jsxs("div", { className: "screen settings", children: [_jsx("header", { className: "page-head", children: _jsx("h1", { children: "R\u00E9glages" }) }), _jsxs("div", { className: "scroll-body", children: [cloudEnabled && (_jsxs("section", { className: "card account", children: [_jsx("h2", { className: "section-title", children: "Compte" }), sync.session ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "account-row", children: [_jsx("div", { className: "avatar", children: (sync.session.user.email ?? '?').charAt(0).toUpperCase() }), _jsxs("div", { className: "account-text", children: [_jsx("strong", { children: sync.session.user.email }), _jsxs("span", { className: `sync-state ${sync.status}`, children: [_jsx("i", {}), syncLabel()] })] })] }), _jsxs("div", { className: "row2", children: [_jsx("button", { className: "btn secondary", onClick: () => void syncNow(), disabled: sync.status === 'syncing', children: "Synchroniser" }), _jsx("button", { className: "btn danger-ghost", onClick: signOut, children: "Se d\u00E9connecter" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "muted small", children: "Tu n\u2019es pas connect\u00E9 : tes donn\u00E9es restent uniquement sur cet appareil. Cr\u00E9e un compte pour les sauvegarder et les retrouver sur ton t\u00E9l\u00E9phone et ton PC." }), _jsx("button", { className: "btn primary", onClick: ui.openAuth, children: "Se connecter / cr\u00E9er un compte" })] }))] })), _jsx(NotificationsCard, {}), _jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "M\u00E9thode de travail" }), _jsx("div", { className: "presets", children: PRESETS.map((p) => (_jsxs("button", { className: activePreset === p ? 'on' : '', onClick: () => update({ workMin: p.workMin, shortBreakMin: p.shortBreakMin, longBreakMin: p.longBreakMin, blocksBeforeLong: p.blocksBeforeLong }), children: [_jsx("b", { children: p.name }), _jsx("span", { children: p.sub })] }, p.name))) }), _jsx(Stepper, { label: "Pomodoro (travail)", value: s.workMin, min: 5, max: 90, step: 5, unit: "min", onChange: (v) => update({ workMin: v }) }), _jsx(Stepper, { label: "Pause courte", value: s.shortBreakMin, min: 1, max: 30, unit: "min", onChange: (v) => update({ shortBreakMin: v }) }), _jsx(Stepper, { label: "Grande pause", value: s.longBreakMin, min: 5, max: 60, step: 5, unit: "min", onChange: (v) => update({ longBreakMin: v }) }), _jsx(Stepper, { label: "Grande pause tous les", value: s.blocksBeforeLong, min: 2, max: 8, unit: "pomodoros", onChange: (v) => update({ blocksBeforeLong: v }) })] }), _jsxs("section", { className: "card method", children: [_jsx("h2", { className: "section-title", children: "La m\u00E9thode Pomodoro" }), _jsxs("p", { children: [_jsx("b", { children: "1. Un pomodoro." }), " Tu travailles sur une seule chose pendant un bloc (25 min par d\u00E9faut), sans distraction."] }), _jsxs("p", { children: [_jsx("b", { children: "2. Une pause courte." }), " \u00C0 la fin du bloc, l\u2019app sonne et lance la pause (5 min par d\u00E9faut). L\u00E8ve-toi, d\u00E9croche de l\u2019\u00E9cran."] }), _jsxs("p", { children: [_jsx("b", { children: "3. Une grande pause." }), " Apr\u00E8s plusieurs pomodoros (4 par d\u00E9faut), une pause plus longue. Le pomodoro suivant ne d\u00E9marre que quand tu le relances, pour que seul le vrai temps de travail compte dans ton bilan."] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "Calendrier" }), _jsx(Stepper, { label: "D\u00E9but de journ\u00E9e", value: s.dayStartHour, min: 0, max: s.dayEndHour - 1, unit: "h", onChange: (v) => update({ dayStartHour: v }) }), _jsx(Stepper, { label: "Fin de journ\u00E9e", value: s.dayEndHour, min: s.dayStartHour + 1, max: 24, unit: "h", onChange: (v) => update({ dayEndHour: v }) })] }), _jsxs("section", { className: "card cats-card", children: [_jsx("h2", { className: "section-title", children: "Types et cat\u00E9gories" }), _jsx("p", { className: "muted small", children: "Les grandes cat\u00E9gories regroupent tes t\u00E2ches. Active le Pomodoro pour celles que tu veux chronom\u00E9trer (elles comptent alors dans ton bilan)." }), types.map((ty) => {
                                const list = cats.filter((c) => typeOf(catType(c), types).id === ty.id);
                                return (_jsxs("div", { className: "cat-group", children: [_jsxs("div", { className: "type-head", children: [_jsx(LiveInput, { className: "type-name", value: ty.name, fallback: "Sans nom", onSave: (name) => void db.types.update(ty.id, { name }), "aria-label": "Nom de la grande cat\u00E9gorie" }), _jsxs("label", { className: "switch", title: "Mode Pomodoro", children: [_jsx("input", { type: "checkbox", checked: ty.pomodoro, onChange: (e) => db.types.update(ty.id, { pomodoro: e.target.checked }) }), _jsx("span", { className: "switch-track", children: _jsx("span", {}) }), _jsx("span", { className: "switch-label", children: "Pomodoro" })] }), types.length > 1 && (_jsx("button", { className: "icon-btn", onClick: () => removeType(ty.id), "aria-label": `Supprimer la grande catégorie ${ty.name}`, children: _jsx(Icon, { name: "trash", size: 18 }) }))] }), _jsxs("ul", { className: "cat-list", children: [list.map((c) => (_jsxs("li", { children: [_jsx("div", { className: "swatches", children: _jsx("input", { type: "color", value: c.color, onChange: (e) => db.categories.update(c.id, { color: e.target.value }), "aria-label": `Couleur de ${c.name}` }) }), _jsx(LiveInput, { className: "cat-name", value: c.name, fallback: "Sans nom", onSave: (name) => void db.categories.update(c.id, { name }), "aria-label": "Nom de la cat\u00E9gorie" }), types.length > 1 && (_jsx("select", { className: "cat-move", value: ty.id, onChange: (e) => db.categories.update(c.id, { type: e.target.value }), "aria-label": `Type de ${c.name}`, children: types.map((o) => _jsx("option", { value: o.id, children: o.name }, o.id)) })), _jsx("button", { className: "icon-btn", onClick: () => removeCat(c.id, c.name), "aria-label": `Supprimer ${c.name}`, children: _jsx(Icon, { name: "trash", size: 18 }) })] }, c.id))), !list.length && _jsx("li", { className: "muted small", children: "Aucune cat\u00E9gorie pour l\u2019instant." })] }), _jsxs("button", { className: "btn ghost add-cat", onClick: () => db.categories.add({ id: uid(), name: 'Nouvelle catégorie', color: pickDistinctColor(cats.map((c) => c.color)), type: ty.id }), children: [_jsx(Icon, { name: "plus", size: 16 }), " Ajouter une cat\u00E9gorie"] })] }, ty.id));
                            }), _jsxs("button", { className: "btn secondary", onClick: addType, children: [_jsx(Icon, { name: "plus", size: 18 }), " Ajouter une grande cat\u00E9gorie"] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { className: "section-title", children: "Donn\u00E9es" }), _jsx("p", { className: "muted small", children: sync.session ? 'Tes données sont enregistrées sur cet appareil et sauvegardées dans ton compte. Tu peux aussi exporter un fichier de sauvegarde.' : 'Sans compte, tout est stocké uniquement sur cet appareil. Exporte une sauvegarde de temps en temps.' }), persisted === false && (_jsx("button", { className: "btn ghost", onClick: async () => setPersisted((await navigator.storage?.persist?.()) ?? false), children: "Prot\u00E9ger le stockage contre l\u2019effacement automatique" })), _jsxs("div", { className: "row2", children: [_jsx("button", { className: "btn secondary", onClick: async () => { const r = await exportData(); if (r === 'downloaded')
                                            ui.toast('Sauvegarde téléchargée'); }, children: "Exporter" }), _jsx("button", { className: "btn secondary", onClick: () => fileRef.current?.click(), children: "Importer" })] }), _jsx("input", { ref: fileRef, type: "file", accept: "application/json,.json", hidden: true, onChange: (e) => onImport(e.target.files?.[0]) })] }), _jsx("p", { className: "muted small center", children: "Cadence v1 \u00B7 fonctionne hors ligne" })] })] }));
}
