import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteTask, setOccStatus, typeOf, useCategories, useTypes } from '../db';
import { fmtDuration, fmtLongDay, minToTime } from '../lib/dates';
import { describeRecurrence } from '../lib/recurrence';
import { useState } from 'react';
import { PostponePicker } from './EndCheck';
import { Icon, Sheet, useUI } from '../ui';
export function OccurrenceSheet({ occ, onClose }) {
    const ui = useUI();
    const cat = useCategories().get(occ.task.categoryId ?? '');
    const { task } = occ;
    const ty = typeOf(task.type, useTypes());
    const isRev = ty.pomodoro;
    const recurring = task.recurrence.kind !== 'none';
    const sessions = useLiveQuery(() => db.sessions.where('taskId').equals(task.id).toArray(), [task.id]) ?? [];
    const sessionsHere = sessions.filter((s) => s.occKey === occ.key);
    const [postponing, setPostponing] = useState(false);
    const toggleDone = async () => {
        await setOccStatus(task.id, occ.date, occ.status === 'done' ? null : 'done');
        ui.toast(occ.status === 'done' ? 'Marquée comme non faite' : 'Bien joué ✓');
        onClose();
    };
    const removeOne = async () => {
        if (recurring) {
            await setOccStatus(task.id, occ.date, 'skipped');
            ui.toast('Occurrence retirée du planning');
        }
        else {
            if (!(await ui.ask({ title: 'Supprimer cette tâche ?', confirmLabel: 'Supprimer', danger: true })))
                return;
            await deleteTask(task.id);
            ui.toast('Tâche supprimée');
        }
        onClose();
    };
    const startReview = () => {
        onClose();
        ui.startReview({ taskId: task.id, occKey: occ.key, date: occ.date, title: task.title, categoryId: task.categoryId });
    };
    return (_jsx(Sheet, { onClose: onClose, children: _jsxs("div", { className: "occ", children: [_jsxs("div", { className: "occ-tag", style: { ['--c']: cat?.color ?? 'var(--muted)' }, children: [_jsx("i", { className: "dot" }), " ", cat?.name ?? 'Sans catégorie', " \u00B7 ", ty.name] }), _jsx("h2", { className: "occ-title", children: task.title }), _jsxs("ul", { className: "occ-meta", children: [_jsxs("li", { children: [_jsx(Icon, { name: "calendar", size: 18 }), " ", capitalize(fmtLongDay(occ.date))] }), _jsxs("li", { children: [_jsx(Icon, { name: "clock", size: 18 }), " ", minToTime(occ.start), " \u2013 ", minToTime(occ.end), " (", fmtDuration(task.durationMin), ")"] }), _jsxs("li", { children: [_jsx(Icon, { name: "repeat", size: 18 }), " ", describeRecurrence(task)] })] }), task.notes && _jsx("p", { className: "occ-notes", children: task.notes }), _jsxs("div", { className: `status-line ${occ.status}`, children: [occ.status === 'done' && 'Fait ✓', occ.status === 'missed' && 'Pas fait', occ.status === 'upcoming' && 'À venir', sessionsHere.length > 0 && ` · ${fmtDuration(sessionsHere.reduce((a, s) => a + s.workMinutes, 0))} de révision`] }), _jsxs("div", { className: "actions", children: [isRev && (_jsxs("button", { className: "btn primary big", onClick: startReview, children: [_jsx(Icon, { name: "play", size: 18 }), " Lancer la r\u00E9vision"] })), _jsxs("button", { className: `btn ${isRev ? 'secondary' : 'primary big'}`, onClick: toggleDone, children: [_jsx(Icon, { name: "check", size: 18 }), " ", occ.status === 'done' ? 'Marquer comme non faite' : 'Marquer comme faite'] }), occ.status !== 'done' && !postponing && (_jsxs("button", { className: "btn secondary", onClick: () => setPostponing(true), children: [_jsx(Icon, { name: "clock", size: 18 }), " D\u00E9caler"] })), postponing && (_jsx(PostponePicker, { occ: occ, onBack: () => setPostponing(false), onDone: (where) => { ui.toast(`Décalée ${where}`); onClose(); } })), _jsxs("div", { className: "row2", children: [_jsxs("button", { className: "btn secondary", onClick: () => { onClose(); ui.openEditor(task); }, children: [_jsx(Icon, { name: "edit", size: 18 }), " Modifier"] }), _jsxs("button", { className: "btn danger-ghost", onClick: removeOne, children: [_jsx(Icon, { name: "trash", size: 18 }), " ", recurring ? 'Retirer ce jour' : 'Supprimer'] })] }), recurring && _jsx("p", { className: "hint center", children: "\u00AB Modifier \u00BB change toutes les r\u00E9p\u00E9titions de cette t\u00E2che." })] })] }) }));
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
