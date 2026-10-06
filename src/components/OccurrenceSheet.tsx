import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteTask, setOccStatus, useCategories } from '../db';
import { fmtDuration, fmtLongDay, minToTime } from '../lib/dates';
import { describeRecurrence, type Occurrence } from '../lib/recurrence';
import { Icon, Sheet, useUI } from '../ui';

export function OccurrenceSheet({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const ui = useUI();
  const cat = useCategories().get(occ.task.categoryId ?? -1);
  const { task } = occ;
  const isRev = task.type === 'revision';
  const recurring = task.recurrence.kind !== 'none';
  const sessions = useLiveQuery(() => db.sessions.where('taskId').equals(task.id!).toArray(), [task.id]) ?? [];
  const sessionsHere = sessions.filter((s) => s.occKey === occ.key);

  const toggleDone = async () => {
    await setOccStatus(task.id!, occ.date, occ.status === 'done' ? null : 'done');
    ui.toast(occ.status === 'done' ? 'Marquée comme non faite' : 'Bien joué ✓');
    onClose();
  };

  const removeOne = async () => {
    if (recurring) {
      await setOccStatus(task.id!, occ.date, 'skipped');
      ui.toast('Occurrence retirée du planning');
    } else {
      if (!(await ui.ask({ title: 'Supprimer cette tâche ?', confirmLabel: 'Supprimer', danger: true }))) return;
      await deleteTask(task.id!);
      ui.toast('Tâche supprimée');
    }
    onClose();
  };

  const startReview = () => {
    onClose();
    ui.startReview({ taskId: task.id!, occKey: occ.key, date: occ.date, title: task.title, categoryId: task.categoryId });
  };

  return (
    <Sheet onClose={onClose}>
      <div className="occ">
        <div className="occ-tag" style={{ ['--c' as string]: cat?.color ?? 'var(--muted)' }}>
          <i className="dot" /> {cat?.name ?? 'Sans catégorie'} · {isRev ? 'Révision' : 'Activité'}
        </div>
        <h2 className="occ-title">{task.title}</h2>
        <ul className="occ-meta">
          <li><Icon name="calendar" size={18} /> {capitalize(fmtLongDay(occ.date))}</li>
          <li><Icon name="clock" size={18} /> {minToTime(occ.start)} – {minToTime(occ.end)} ({fmtDuration(task.durationMin)})</li>
          <li><Icon name="repeat" size={18} /> {describeRecurrence(task)}</li>
        </ul>
        {task.notes && <p className="occ-notes">{task.notes}</p>}

        <div className={`status-line ${occ.status}`}>
          {occ.status === 'done' && 'Fait ✓'}
          {occ.status === 'missed' && 'Pas fait'}
          {occ.status === 'upcoming' && 'À venir'}
          {sessionsHere.length > 0 && ` · ${fmtDuration(sessionsHere.reduce((a, s) => a + s.workMinutes, 0))} de révision`}
        </div>

        <div className="actions">
          {isRev && (
            <button className="btn primary big" onClick={startReview}>
              <Icon name="play" size={18} /> Lancer la révision
            </button>
          )}
          <button className={`btn ${isRev ? 'secondary' : 'primary big'}`} onClick={toggleDone}>
            <Icon name="check" size={18} /> {occ.status === 'done' ? 'Marquer comme non faite' : 'Marquer comme faite'}
          </button>
          <div className="row2">
            <button className="btn secondary" onClick={() => { onClose(); ui.openEditor(task); }}>
              <Icon name="edit" size={18} /> Modifier
            </button>
            <button className="btn danger-ghost" onClick={removeOne}>
              <Icon name="trash" size={18} /> {recurring ? 'Retirer ce jour' : 'Supprimer'}
            </button>
          </div>
          {recurring && <p className="hint center">« Modifier » change toutes les répétitions de cette tâche.</p>}
        </div>
      </div>
    </Sheet>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
