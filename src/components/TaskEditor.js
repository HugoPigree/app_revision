import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { catType, db, deleteCategory, deleteTask, typeOf, uid, useCategories, useTypes } from '../db';
import { DAY_LETTERS, fmtDuration, minToTime, timeToMin, todayKey, weekday } from '../lib/dates';
import { pickDistinctColor } from '../lib/colors';
import { createType, removeTypeWithUndo } from '../lib/types';
import { Icon, Sheet, useUI } from '../ui';
const DURATIONS = [15, 30, 45, 60, 90, 120];
const STEP = 5;
const MIN_DUR = 5;
const MAX_DUR = 12 * 60;
/** Durée : grande valeur avec − / +, saisie libre en touchant la valeur, raccourcis en dessous */
function DurationPicker({ value, start, onChange }) {
    const [editing, setEditing] = useState(false);
    const [h, setH] = useState('');
    const [m, setM] = useState('');
    const clamp = (v) => Math.min(MAX_DUR, Math.max(MIN_DUR, Math.round(v)));
    const end = minToTime((timeToMin(start) + value) % (24 * 60));
    const openEdit = () => {
        setH(String(Math.floor(value / 60)));
        setM(String(value % 60));
        setEditing(true);
    };
    const commit = () => {
        const total = (Number(h) || 0) * 60 + (Number(m) || 0);
        if (total > 0)
            onChange(clamp(total));
        setEditing(false);
    };
    return (_jsxs("div", { className: "duration", children: [_jsxs("div", { className: "duration-head", children: [_jsx("span", { className: "field-label", children: "Dur\u00E9e" }), _jsxs("span", { className: "duration-end", children: ["Fin \u00E0 ", end] })] }), _jsxs("div", { className: "duration-main", children: [_jsx("button", { className: "dur-step", onClick: () => onChange(clamp(value - STEP)), disabled: value <= MIN_DUR, "aria-label": `Moins ${STEP} minutes`, children: "\u2212" }), editing ? (_jsxs("div", { className: "dur-edit", onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget))
                            commit(); }, children: [_jsx("input", { autoFocus: true, type: "number", inputMode: "numeric", min: 0, max: 12, value: h, onChange: (e) => setH(e.target.value), onKeyDown: (e) => e.key === 'Enter' && commit(), "aria-label": "Heures" }), _jsx("span", { children: "h" }), _jsx("input", { type: "number", inputMode: "numeric", min: 0, max: 59, value: m, onChange: (e) => setM(e.target.value), onKeyDown: (e) => e.key === 'Enter' && commit(), "aria-label": "Minutes" }), _jsx("span", { children: "min" }), _jsx("button", { className: "dur-ok", onClick: commit, children: "OK" })] })) : (_jsxs("button", { className: "dur-value", onClick: openEdit, "aria-label": `Durée ${fmtDuration(value)}, toucher pour saisir`, children: [_jsx("b", { children: fmtDuration(value) }), _jsx("span", { children: "toucher pour saisir" })] })), _jsx("button", { className: "dur-step", onClick: () => onChange(clamp(value + STEP)), disabled: value >= MAX_DUR, "aria-label": `Plus ${STEP} minutes`, children: "+" })] }), _jsx("div", { className: "chips dur-presets", children: DURATIONS.map((d) => (_jsx("button", { className: `chip ${value === d ? 'on' : ''}`, onClick: () => { setEditing(false); onChange(d); }, children: fmtDuration(d) }, d))) })] }));
}
export function TaskEditor({ task, defaults, onClose }) {
    const ui = useUI();
    const cats = [...useCategories().values()];
    const base = task ?? {
        title: '',
        type: 'revision',
        categoryId: null,
        startDate: todayKey(),
        startTime: '18:00',
        durationMin: 60,
        recurrence: { kind: 'none' },
        endDate: null,
        notes: '',
        createdAt: Date.now(),
        ...defaults,
        id: uid(),
    };
    const [t, setT] = useState(base);
    const [newCat, setNewCat] = useState(null);
    const [error, setError] = useState('');
    const types = useTypes();
    const ty = typeOf(t.type, types);
    const catName = cats.find((c) => c.id === t.categoryId)?.name;
    // Sans titre, la tâche prend le nom de sa catégorie
    const fallbackTitle = catName ?? ty.name;
    const set = (patch) => setT((p) => ({ ...p, ...patch }));
    const rec = t.recurrence;
    const setRecKind = (kind) => {
        if (kind === 'none')
            set({ recurrence: { kind } });
        if (kind === 'weekly')
            set({ recurrence: { kind, days: [weekday(t.startDate)], interval: 1 } });
        if (kind === 'daily')
            set({ recurrence: { kind, every: 1 } });
    };
    const toggleDay = (d) => {
        if (rec.kind !== 'weekly')
            return;
        const days = rec.days.includes(d) ? rec.days.filter((x) => x !== d) : [...rec.days, d];
        set({ recurrence: { ...rec, days } });
    };
    const save = async () => {
        if (rec.kind === 'weekly' && rec.days.length === 0)
            return setError('Choisis au moins un jour.');
        if (t.endDate && t.endDate < t.startDate)
            return setError('La date de fin est avant la date de début.');
        if (!t.durationMin || t.durationMin < 5)
            return setError('Durée minimale : 5 minutes.');
        await db.tasks.put({ ...t, type: ty.id, title: t.title.trim() || fallbackTitle });
        ui.toast(task ? 'Tâche modifiée' : 'Tâche ajoutée');
        onClose();
    };
    const remove = async () => {
        if (!task?.id)
            return;
        const ok = await ui.ask({
            title: 'Supprimer cette tâche ?',
            message: task.recurrence.kind === 'none' ? undefined : 'Toutes ses répétitions seront supprimées du planning.',
            confirmLabel: 'Supprimer',
            danger: true,
        });
        if (!ok)
            return;
        await deleteTask(task.id);
        ui.toast('Tâche supprimée');
        onClose();
    };
    // Seules les catégories du type choisi (révision / activité) sont proposées
    const shownCats = cats.filter((c) => typeOf(catType(c), types).id === ty.id || c.id === t.categoryId);
    const switchType = (ty) => {
        const cur = cats.find((c) => c.id === t.categoryId);
        set({ type: ty, ...(cur && typeOf(catType(cur), types).id !== ty ? { categoryId: null } : {}) });
    };
    // ——— Grandes catégories (révision, projet, activité…) : ajout, renommage, suppression ———
    const [newType, setNewType] = useState(null);
    const [editingType, setEditingType] = useState(null);
    const [editName, setEditName] = useState('');
    const addType = async () => {
        const name = newType?.trim();
        setNewType(null);
        if (!name)
            return;
        const id = await createType(types, name);
        switchType(id);
    };
    const saveRename = async () => {
        const id = editingType;
        setEditingType(null);
        if (id && editName.trim())
            await db.types.update(id, { name: editName.trim() });
    };
    const removeType = async (id) => {
        const wasSelected = ty.id === id;
        const target = await removeTypeWithUndo(ui, types, id, () => { if (wasSelected)
            set({ type: id }); });
        if (target && wasSelected)
            set({ type: target });
    };
    const removeCategory = async (id, name) => {
        const wasSelected = t.categoryId === id;
        const undo = await deleteCategory(id);
        if (wasSelected)
            set({ categoryId: null });
        ui.toast(`« ${name} » supprimée`, { label: 'Annuler', run: () => { void undo(); if (wasSelected)
                set({ categoryId: id }); } });
    };
    const addCategory = async () => {
        const name = newCat?.trim();
        if (!name)
            return setNewCat(null);
        const id = await db.categories.add({ id: uid(), name, color: pickDistinctColor(cats.map((c) => c.color)), type: ty.id });
        set({ categoryId: id });
        setNewCat(null);
    };
    const tyIndex = types.findIndex((o) => o.id === ty.id);
    return (_jsx(Sheet, { title: task ? 'Modifier la tâche' : 'Nouvelle tâche', onClose: onClose, children: _jsxs("div", { className: "form", children: [_jsx("input", { className: "title-input", placeholder: `Titre (facultatif) : ${fallbackTitle}`, value: t.title, onChange: (e) => set({ title: e.target.value }), autoFocus: !task }), _jsxs("section", { className: "type-group", children: [_jsxs("div", { className: "type-tabs", role: "tablist", "aria-label": "Grande cat\u00E9gorie", children: [types.map((o) => (_jsxs("button", { role: "tab", "aria-selected": ty.id === o.id, className: `type-tab ${ty.id === o.id ? 'on' : ''}`, onClick: () => switchType(o.id), children: [_jsx(Icon, { name: o.pomodoro ? 'clock' : 'check', size: 15 }), o.name] }, o.id))), _jsx("button", { className: "type-tab add", onClick: () => setNewType(''), "aria-label": "Ajouter une grande cat\u00E9gorie", children: _jsx(Icon, { name: "plus", size: 16 }) })] }), _jsxs("div", { className: `type-panel ${tyIndex === 0 ? 'first-on' : ''}`, role: "tabpanel", children: [newType !== null ? (_jsxs("div", { className: "type-edit", children: [_jsx("input", { autoFocus: true, value: newType, placeholder: "Nom de la grande cat\u00E9gorie (ex. Cours)", "aria-label": "Nom de la grande cat\u00E9gorie", onChange: (e) => setNewType(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                void addType(); if (e.key === 'Escape')
                                                setNewType(null); } }), _jsx("button", { className: "btn primary", onClick: addType, children: "Cr\u00E9er" }), _jsx("button", { className: "btn ghost", onClick: () => setNewType(null), children: "Annuler" })] })) : editingType ? (_jsxs("div", { className: "type-edit", children: [_jsx("input", { autoFocus: true, value: editName, "aria-label": "Nouveau nom", onChange: (e) => setEditName(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                void saveRename(); if (e.key === 'Escape')
                                                setEditingType(null); } }), _jsx("button", { className: "btn primary", onClick: saveRename, children: "Renommer" }), _jsx("button", { className: "btn ghost", onClick: () => setEditingType(null), children: "Annuler" })] })) : (_jsxs("div", { className: "type-head", children: [_jsx("strong", { className: "type-title", children: ty.name }), _jsx("button", { className: "icon-btn sm", onClick: () => { setEditingType(ty.id); setEditName(ty.name); }, "aria-label": `Renommer ${ty.name}`, children: _jsx(Icon, { name: "edit", size: 17 }) }), types.length > 1 && (_jsx("button", { className: "icon-btn sm", onClick: () => removeType(ty.id), "aria-label": `Supprimer la grande catégorie ${ty.name}`, children: _jsx(Icon, { name: "trash", size: 17 }) }))] })), _jsxs("label", { className: "mode-row", children: [_jsx("span", { className: "mode-text", children: ty.pomodoro ? 'Se lance en Pomodoro et compte dans ton bilan' : 'Se coche simplement comme fait' }), _jsxs("span", { className: "switch", children: [_jsx("input", { type: "checkbox", checked: ty.pomodoro, onChange: (e) => db.types.update(ty.id, { pomodoro: e.target.checked }), "aria-label": `Pomodoro pour ${ty.name}` }), _jsx("span", { className: "switch-track", children: _jsx("span", {}) }), _jsx("span", { className: "switch-label", children: "Pomodoro" })] })] }), _jsx("div", { className: "sub-label", children: "Cat\u00E9gorie" }), _jsxs("div", { className: "chips cat-chips", children: [_jsx("button", { className: `chip ${t.categoryId === null ? 'on' : ''}`, onClick: () => set({ categoryId: null }), children: "Aucune" }), shownCats.map((c) => (_jsxs("span", { className: `chip cat-chip removable ${t.categoryId === c.id ? 'on' : ''}`, style: { ['--c']: c.color }, children: [_jsxs("button", { className: "chip-main", onClick: () => set({ categoryId: c.id }), children: [_jsx("i", { className: "dot" }), " ", c.name] }), t.categoryId === c.id && (_jsx("button", { className: "chip-x", onClick: () => removeCategory(c.id, c.name), "aria-label": `Supprimer la catégorie ${c.name}`, children: _jsx(Icon, { name: "close", size: 13 }) }))] }, c.id))), newCat === null ? (_jsxs("button", { className: "chip ghost", onClick: () => setNewCat(''), children: [_jsx(Icon, { name: "plus", size: 14 }), " Cat\u00E9gorie"] })) : (_jsxs("span", { className: "chip-input", children: [_jsx("input", { autoFocus: true, value: newCat, placeholder: "Nom", onChange: (e) => setNewCat(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                        void addCategory(); if (e.key === 'Escape')
                                                        setNewCat(null); } }), _jsx("button", { onClick: addCategory, children: "OK" })] }))] })] })] }), _jsxs("section", { className: "group", children: [_jsx("h3", { className: "group-title", children: "Quand" }), _jsxs("div", { className: "row2", children: [_jsxs("div", { children: [_jsx("label", { className: "field-label", children: rec.kind === 'none' ? 'Date' : 'À partir du' }), _jsx("input", { type: "date", value: t.startDate, onChange: (e) => e.target.value && set({ startDate: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "field-label", children: "Heure" }), _jsx("input", { type: "time", value: t.startTime, onChange: (e) => e.target.value && set({ startTime: e.target.value }) })] })] }), _jsx(DurationPicker, { value: t.durationMin, start: t.startTime, onChange: (d) => set({ durationMin: d }) })] }), _jsxs("section", { className: "group", children: [_jsx("h3", { className: "group-title", children: "R\u00E9p\u00E9tition" }), _jsxs("div", { className: "seg full", children: [_jsx("button", { className: rec.kind === 'none' ? 'on' : '', onClick: () => setRecKind('none'), children: "Aucune" }), _jsx("button", { className: rec.kind === 'weekly' ? 'on' : '', onClick: () => setRecKind('weekly'), children: "Jours fixes" }), _jsx("button", { className: rec.kind === 'daily' ? 'on' : '', onClick: () => setRecKind('daily'), children: "Tous les X jours" })] }), rec.kind === 'weekly' && (_jsxs(_Fragment, { children: [_jsx("div", { className: "weekdays", children: DAY_LETTERS.map((l, i) => (_jsx("button", { className: rec.days.includes(i) ? 'on' : '', onClick: () => toggleDay(i), children: l }, i))) }), _jsxs("div", { className: "inline-num", children: ["Toutes les", _jsx("input", { type: "number", inputMode: "numeric", min: 1, max: 8, value: rec.interval, onChange: (e) => set({ recurrence: { ...rec, interval: Math.max(1, Number(e.target.value) || 1) } }) }), "semaine", rec.interval > 1 ? 's' : ''] })] })), rec.kind === 'daily' && (_jsxs("div", { className: "inline-num", children: ["Tous les", _jsx("input", { type: "number", inputMode: "numeric", min: 1, max: 60, value: rec.every, onChange: (e) => set({ recurrence: { kind: 'daily', every: Math.max(1, Number(e.target.value) || 1) } }) }), "jour", rec.every > 1 ? 's' : ''] })), rec.kind !== 'none' && (_jsxs("div", { className: "end-row", children: [_jsxs("label", { className: "toggle", children: [_jsx("input", { type: "checkbox", checked: t.endDate !== null, onChange: (e) => set({ endDate: e.target.checked ? t.startDate : null }) }), _jsx("span", { children: "Date de fin" })] }), t.endDate !== null && _jsx("input", { type: "date", value: t.endDate, onChange: (e) => e.target.value && set({ endDate: e.target.value }) })] }))] }), _jsxs("section", { className: "group", children: [_jsx("h3", { className: "group-title", children: "Notes" }), _jsx("textarea", { rows: 2, placeholder: "Pages, exercices, objectifs\u2026", value: t.notes, onChange: (e) => set({ notes: e.target.value }) })] }), error && _jsx("p", { className: "error", children: error }), _jsxs("div", { className: "sheet-actions", children: [_jsx("button", { className: "btn primary big", onClick: save, children: task ? 'Enregistrer' : 'Ajouter au planning' }), task && (_jsxs("button", { className: "btn danger-ghost", onClick: remove, children: [_jsx(Icon, { name: "trash", size: 18 }), " Supprimer la t\u00E2che"] }))] })] }) }));
}
