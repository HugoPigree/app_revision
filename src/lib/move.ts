import { db, setOccStatus, uid } from '../db';
import { addDays, daysBetween, minToTime, relativeDay, weekday } from './dates';
import type { Occurrence } from './recurrence';
import type { UI } from '../ui';

/**
 * Déplace une occurrence vers un autre jour / une autre heure.
 * - Tâche ponctuelle : on change simplement sa date et son heure.
 * - Tâche récurrente : on demande « ce jour seulement » ou « toutes les répétitions ».
 */
export async function moveOccurrence(ui: UI, occ: Occurrence, date: string, startMin: number): Promise<void> {
  const { task } = occ;
  if (date === occ.date && startMin === occ.start) return;
  const time = minToTime(startMin);
  const where = `${relativeDay(date)} à ${time}`;

  if (task.recurrence.kind === 'none') {
    await db.tasks.update(task.id!, { startDate: date, startTime: time });
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
  if (!choice) return;

  if (choice === 'one') {
    // On retire ce jour de la série et on crée une tâche ponctuelle au nouvel emplacement
    const { id: _id, ...rest } = task;
    void _id;
    const newId = await db.tasks.add({ ...rest, id: uid(), recurrence: { kind: 'none' }, startDate: date, startTime: time, endDate: null, createdAt: Date.now() });
    await setOccStatus(task.id!, occ.date, 'skipped');
    if (occ.status === 'done') await setOccStatus(newId, date, 'done');
    ui.toast(`Déplacée ${where} (ce jour seulement)`);
    return;
  }

  const shift = daysBetween(occ.date, date);
  const r = task.recurrence;
  if (r.kind === 'weekly') {
    const from = weekday(occ.date);
    const to = weekday(date);
    const days = [...new Set(r.days.map((d) => (d === from ? to : d)))].sort();
    await db.tasks.update(task.id!, { startTime: time, recurrence: { ...r, days } });
  } else if (r.kind === 'daily') {
    await db.tasks.update(task.id!, { startTime: time, startDate: addDays(task.startDate, shift) });
  }
  ui.toast('Toutes les répétitions ont été déplacées');
}
