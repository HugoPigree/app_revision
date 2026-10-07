import { db, setOccStatus, uid } from '../db';
import { addDays, daysBetween, minToTime, relativeDay, weekday } from './dates';
/**
 * Déplace une occurrence vers un autre jour / une autre heure.
 * - Tâche ponctuelle : on change simplement sa date et son heure.
 * - Tâche récurrente : on demande « ce jour seulement » ou « toutes les répétitions ».
 */
export async function moveOccurrence(ui, occ, date, startMin) {
    const { task } = occ;
    if (date === occ.date && startMin === occ.start)
        return;
    const time = minToTime(startMin);
    const where = `${relativeDay(date)} à ${time}`;
    if (task.recurrence.kind === 'none') {
        await db.tasks.update(task.id, { startDate: date, startTime: time });
        ui.toast(`Déplacée ${where}`);
        return;
    }
    const choice = await ui.choose({
        title: 'Déplacer une tâche récurrente',
        message: `« ${task.title} » → ${where}`,
        choices: [
            { value: 'one', label: 'Ce jour seulement', primary: true },
            { value: 'all', label: 'Toutes les répétitions' },
        ],
    });
    if (!choice)
        return;
    if (choice === 'one') {
        await moveThisDayOnly(occ, date, time);
        ui.toast(`Déplacée ${where} (ce jour seulement)`);
        return;
    }
    const shift = daysBetween(occ.date, date);
    const r = task.recurrence;
    if (r.kind === 'weekly') {
        const from = weekday(occ.date);
        const to = weekday(date);
        const days = [...new Set(r.days.map((d) => (d === from ? to : d)))].sort();
        await db.tasks.update(task.id, { startTime: time, recurrence: { ...r, days } });
    }
    else if (r.kind === 'daily') {
        await db.tasks.update(task.id, { startTime: time, startDate: addDays(task.startDate, shift) });
    }
    ui.toast('Toutes les répétitions ont été déplacées');
}
/** Retire ce jour de la série et crée une tâche ponctuelle au nouvel emplacement */
async function moveThisDayOnly(occ, date, time) {
    const { id: _id, ...rest } = occ.task;
    void _id;
    const newId = await db.tasks.add({ ...rest, id: uid(), recurrence: { kind: 'none' }, startDate: date, startTime: time, endDate: null, createdAt: Date.now() });
    await setOccStatus(occ.task.id, occ.date, 'skipped');
    if (occ.status === 'done')
        await setOccStatus(newId, date, 'done');
    return newId;
}
/**
 * Décale une occurrence (fin de tâche pas faite) : sans question,
 * une tâche récurrente n'est décalée que pour ce jour-là.
 */
export async function postponeOccurrence(occ, date, startMin) {
    const time = minToTime(startMin);
    if (occ.task.recurrence.kind === 'none') {
        await db.tasks.update(occ.task.id, { startDate: date, startTime: time, createdAt: Date.now() });
    }
    else {
        await moveThisDayOnly(occ, date, time);
    }
    return `${relativeDay(date)} à ${time}`;
}
