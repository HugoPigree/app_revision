import { useState } from 'react';
import { catType, db, deleteCategory, deleteTask, typeOf, uid, useCategories, useTypes, type Recurrence, type Task, type TaskType } from '../db';
import { DAY_LETTERS, fmtDuration, todayKey, weekday } from '../lib/dates';
import { pickDistinctColor } from '../lib/colors';
import { createType, removeTypeWithUndo } from '../lib/types';
import { Icon, Sheet, useUI } from '../ui';

const DURATIONS = [15, 30, 45, 60, 90, 120];

export function TaskEditor({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const ui = useUI();
  const cats = [...useCategories().values()];
  const base: Task = task ?? {
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
  const [t, setT] = useState<Task>(base);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [error, setError] = useState('');
  const types = useTypes();
  const ty = typeOf(t.type, types);
  const catName = cats.find((c) => c.id === t.categoryId)?.name;
  // Sans titre, la tâche prend le nom de sa catégorie
  const fallbackTitle = catName ?? ty.name;
  const set = (patch: Partial<Task>) => setT((p) => ({ ...p, ...patch }));
  const rec = t.recurrence;

  const setRecKind = (kind: Recurrence['kind']) => {
    if (kind === 'none') set({ recurrence: { kind } });
    if (kind === 'weekly') set({ recurrence: { kind, days: [weekday(t.startDate)], interval: 1 } });
    if (kind === 'daily') set({ recurrence: { kind, every: 1 } });
  };

  const toggleDay = (d: number) => {
    if (rec.kind !== 'weekly') return;
    const days = rec.days.includes(d) ? rec.days.filter((x) => x !== d) : [...rec.days, d];
    set({ recurrence: { ...rec, days } });
  };

  const save = async () => {
    if (rec.kind === 'weekly' && rec.days.length === 0) return setError('Choisis au moins un jour.');
    if (t.endDate && t.endDate < t.startDate) return setError('La date de fin est avant la date de début.');
    if (!t.durationMin || t.durationMin < 5) return setError('Durée minimale : 5 minutes.');
    await db.tasks.put({ ...t, type: ty.id, title: t.title.trim() || fallbackTitle });
    ui.toast(task ? 'Tâche modifiée' : 'Tâche ajoutée');
    onClose();
  };

  const remove = async () => {
    if (!task?.id) return;
    const ok = await ui.ask({
      title: 'Supprimer cette tâche ?',
      message: task.recurrence.kind === 'none' ? undefined : 'Toutes ses répétitions seront supprimées du planning.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await deleteTask(task.id);
    ui.toast('Tâche supprimée');
    onClose();
  };

  // Seules les catégories du type choisi (révision / activité) sont proposées
  const shownCats = cats.filter((c) => typeOf(catType(c), types).id === ty.id || c.id === t.categoryId);
  const switchType = (ty: TaskType) => {
    const cur = cats.find((c) => c.id === t.categoryId);
    set({ type: ty, ...(cur && typeOf(catType(cur), types).id !== ty ? { categoryId: null } : {}) });
  };

  // ——— Grandes catégories (révision, projet, activité…) : ajout, renommage, suppression ———
  const [newType, setNewType] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const addType = async () => {
    const name = newType?.trim();
    setNewType(null);
    if (!name) return;
    const id = await createType(types, name);
    switchType(id);
  };

  const saveRename = async () => {
    const id = editingType;
    setEditingType(null);
    if (id && editName.trim()) await db.types.update(id, { name: editName.trim() });
  };

  const removeType = async (id: string) => {
    const wasSelected = ty.id === id;
    const target = await removeTypeWithUndo(ui, types, id, () => { if (wasSelected) set({ type: id }); });
    if (target && wasSelected) set({ type: target });
  };

  const removeCategory = async (id: string, name: string) => {
    const wasSelected = t.categoryId === id;
    const undo = await deleteCategory(id);
    if (wasSelected) set({ categoryId: null });
    ui.toast(`« ${name} » supprimée`, { label: 'Annuler', run: () => { void undo(); if (wasSelected) set({ categoryId: id }); } });
  };

  const addCategory = async () => {
    const name = newCat?.trim();
    if (!name) return setNewCat(null);
    const id = await db.categories.add({ id: uid(), name, color: pickDistinctColor(cats.map((c) => c.color)), type: ty.id });
    set({ categoryId: id });
    setNewCat(null);
  };

  return (
    <Sheet title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose}>
      <div className="form">
        <input
          className="title-input"
          placeholder={`Titre (facultatif) · ${fallbackTitle}`}
          value={t.title}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!task}
        />

        <div className="chips type-chips">
          {types.map((o) =>
            editingType === o.id ? (
              <span key={o.id} className="chip-input">
                <input
                  autoFocus
                  value={editName}
                  aria-label="Nouveau nom"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditingType(null); }}
                />
                <button onClick={saveRename}>OK</button>
              </span>
            ) : (
              <span key={o.id} className={`chip removable type-chip ${ty.id === o.id ? 'on' : ''}`}>
                <button className="chip-main" onClick={() => switchType(o.id)}>{o.name}</button>
                {ty.id === o.id && (
                  <button className="chip-x" onClick={() => { setEditingType(o.id); setEditName(o.name); }} aria-label={`Renommer ${o.name}`}>
                    <Icon name="edit" size={13} />
                  </button>
                )}
                {types.length > 1 && (
                  <button className="chip-x" onClick={() => removeType(o.id)} aria-label={`Supprimer la grande catégorie ${o.name}`}>
                    <Icon name="close" size={13} />
                  </button>
                )}
              </span>
            ),
          )}
          {newType === null ? (
            <button className="chip ghost" onClick={() => setNewType('')} aria-label="Ajouter une grande catégorie"><Icon name="plus" size={14} /> Ajouter</button>
          ) : (
            <span className="chip-input">
              <input
                autoFocus
                value={newType}
                placeholder="Ex. Cours"
                aria-label="Nom de la grande catégorie"
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addType(); if (e.key === 'Escape') setNewType(null); }}
              />
              <button onClick={addType}>OK</button>
            </span>
          )}
        </div>
        <div className="type-hint">
          <p className="hint">
            {ty.pomodoro
              ? `« ${ty.name} » se lance en mode Pomodoro (travail + pauses) et compte dans ton bilan.`
              : `« ${ty.name} » se coche simplement comme fait, sans Pomodoro.`}
          </p>
          <label className="switch" title="Mode Pomodoro">
            <input type="checkbox" checked={ty.pomodoro} onChange={(e) => db.types.update(ty.id, { pomodoro: e.target.checked })} aria-label={`Pomodoro pour ${ty.name}`} />
            <span className="switch-track"><span /></span>
            <span className="switch-label">Pomodoro</span>
          </label>
        </div>

        <label className="field-label">Catégorie</label>
        <div className="chips">
          <button className={`chip ${t.categoryId === null ? 'on' : ''}`} onClick={() => set({ categoryId: null })}>Aucune</button>
          {shownCats.map((c) => (
            <span key={c.id} className={`chip removable ${t.categoryId === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
              <button className="chip-main" onClick={() => set({ categoryId: c.id! })}>
                <i className="dot" /> {c.name}
              </button>
              <button className="chip-x" onClick={() => removeCategory(c.id!, c.name)} aria-label={`Supprimer la catégorie ${c.name}`}>
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
          {newCat === null ? (
            <button className="chip ghost" onClick={() => setNewCat('')}><Icon name="plus" size={14} /> Catégorie</button>
          ) : (
            <span className="chip-input">
              <input autoFocus value={newCat} placeholder="Nom" onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
              <button onClick={addCategory}>OK</button>
            </span>
          )}
        </div>

        <div className="row2">
          <div>
            <label className="field-label">{rec.kind === 'none' ? 'Date' : 'À partir du'}</label>
            <input type="date" value={t.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Heure</label>
            <input type="time" value={t.startTime} onChange={(e) => e.target.value && set({ startTime: e.target.value })} />
          </div>
        </div>

        <label className="field-label">Durée</label>
        <div className="chips">
          {DURATIONS.map((d) => (
            <button key={d} className={`chip ${t.durationMin === d ? 'on' : ''}`} onClick={() => set({ durationMin: d })}>
              {fmtDuration(d)}
            </button>
          ))}
          <span className="chip-input">
            <input type="number" inputMode="numeric" min={5} max={720} value={t.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} />
            <span>min</span>
          </span>
        </div>

        <label className="field-label">Répétition</label>
        <div className="seg full">
          <button className={rec.kind === 'none' ? 'on' : ''} onClick={() => setRecKind('none')}>Aucune</button>
          <button className={rec.kind === 'weekly' ? 'on' : ''} onClick={() => setRecKind('weekly')}>Jours fixes</button>
          <button className={rec.kind === 'daily' ? 'on' : ''} onClick={() => setRecKind('daily')}>Tous les X jours</button>
        </div>

        {rec.kind === 'weekly' && (
          <>
            <div className="weekdays">
              {DAY_LETTERS.map((l, i) => (
                <button key={i} className={rec.days.includes(i) ? 'on' : ''} onClick={() => toggleDay(i)}>{l}</button>
              ))}
            </div>
            <div className="inline-num">
              Toutes les
              <input type="number" inputMode="numeric" min={1} max={8} value={rec.interval} onChange={(e) => set({ recurrence: { ...rec, interval: Math.max(1, Number(e.target.value) || 1) } })} />
              semaine{rec.interval > 1 ? 's' : ''}
            </div>
          </>
        )}
        {rec.kind === 'daily' && (
          <div className="inline-num">
            Tous les
            <input type="number" inputMode="numeric" min={1} max={60} value={rec.every} onChange={(e) => set({ recurrence: { kind: 'daily', every: Math.max(1, Number(e.target.value) || 1) } })} />
            jour{rec.every > 1 ? 's' : ''}
          </div>
        )}
        {rec.kind !== 'none' && (
          <div className="end-row">
            <label className="toggle">
              <input type="checkbox" checked={t.endDate !== null} onChange={(e) => set({ endDate: e.target.checked ? t.startDate : null })} />
              <span>Date de fin</span>
            </label>
            {t.endDate !== null && <input type="date" value={t.endDate} onChange={(e) => e.target.value && set({ endDate: e.target.value })} />}
          </div>
        )}

        <label className="field-label">Notes</label>
        <textarea rows={2} placeholder="Pages, exercices, objectifs…" value={t.notes} onChange={(e) => set({ notes: e.target.value })} />

        {error && <p className="error">{error}</p>}

        <button className="btn primary big" onClick={save}>{task ? 'Enregistrer' : 'Ajouter au planning'}</button>
        {task && (
          <button className="btn danger-ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer la tâche</button>
        )}
      </div>
    </Sheet>
  );
}
