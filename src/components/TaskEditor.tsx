import { useState } from 'react';
import { catType, db, deleteCategory, deleteTask, typeOf, uid, useCategories, useTypes, type Recurrence, type Task, type TaskType } from '../db';
import { DAY_LETTERS, fmtDuration, minToTime, timeToMin, todayKey, weekday } from '../lib/dates';
import { pickDistinctColor } from '../lib/colors';
import { createType, removeTypeWithUndo } from '../lib/types';
import { Icon, Sheet, useUI } from '../ui';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const STEP = 5;
const MIN_DUR = 5;
const MAX_DUR = 12 * 60;

/** Durée : grande valeur avec − / +, saisie libre en touchant la valeur, raccourcis en dessous */
function DurationPicker({ value, start, onChange }: { value: number; start: string; onChange: (min: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState('');
  const [m, setM] = useState('');
  const clamp = (v: number) => Math.min(MAX_DUR, Math.max(MIN_DUR, Math.round(v)));
  const end = minToTime((timeToMin(start) + value) % (24 * 60));

  const openEdit = () => {
    setH(String(Math.floor(value / 60)));
    setM(String(value % 60));
    setEditing(true);
  };
  const commit = () => {
    const total = (Number(h) || 0) * 60 + (Number(m) || 0);
    if (total > 0) onChange(clamp(total));
    setEditing(false);
  };

  return (
    <div className="duration">
      <div className="duration-head">
        <span className="field-label">Durée</span>
        <span className="duration-end">Fin à {end}</span>
      </div>
      <div className="duration-main">
        <button className="dur-step" onClick={() => onChange(clamp(value - STEP))} disabled={value <= MIN_DUR} aria-label={`Moins ${STEP} minutes`}>−</button>
        {editing ? (
          <div className="dur-edit" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(); }}>
            <input
              autoFocus
              type="number"
              inputMode="numeric"
              min={0}
              max={12}
              value={h}
              onChange={(e) => setH(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              aria-label="Heures"
            />
            <span>h</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={m}
              onChange={(e) => setM(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              aria-label="Minutes"
            />
            <span>min</span>
            <button className="dur-ok" onClick={commit}>OK</button>
          </div>
        ) : (
          <button className="dur-value" onClick={openEdit} aria-label={`Durée ${fmtDuration(value)}, toucher pour saisir`}>
            <b>{fmtDuration(value)}</b>
            <span>toucher pour saisir</span>
          </button>
        )}
        <button className="dur-step" onClick={() => onChange(clamp(value + STEP))} disabled={value >= MAX_DUR} aria-label={`Plus ${STEP} minutes`}>+</button>
      </div>
      <div className="chips dur-presets">
        {DURATIONS.map((d) => (
          <button key={d} className={`chip ${value === d ? 'on' : ''}`} onClick={() => { setEditing(false); onChange(d); }}>
            {fmtDuration(d)}
          </button>
        ))}
      </div>
    </div>
  );
}

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

  const tyIndex = types.findIndex((o) => o.id === ty.id);

  return (
    <Sheet title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose}>
      <div className="form">
        <input
          className="title-input"
          placeholder={`Titre (facultatif) : ${fallbackTitle}`}
          value={t.title}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!task}
        />

        {/* Parent : la grande catégorie (onglets) — enfant : ses catégories (dans le panneau) */}
        <section className="type-group">
          <div className="type-tabs" role="tablist" aria-label="Grande catégorie">
            {types.map((o) => (
              <button
                key={o.id}
                role="tab"
                aria-selected={ty.id === o.id}
                className={`type-tab ${ty.id === o.id ? 'on' : ''}`}
                onClick={() => switchType(o.id)}
              >
                <Icon name={o.pomodoro ? 'clock' : 'check'} size={15} />
                {o.name}
              </button>
            ))}
            <button className="type-tab add" onClick={() => setNewType('')} aria-label="Ajouter une grande catégorie">
              <Icon name="plus" size={16} />
            </button>
          </div>

          <div className={`type-panel ${tyIndex === 0 ? 'first-on' : ''}`} role="tabpanel">
            {newType !== null ? (
              <div className="type-edit">
                <input
                  autoFocus
                  value={newType}
                  placeholder="Nom de la grande catégorie (ex. Cours)"
                  aria-label="Nom de la grande catégorie"
                  onChange={(e) => setNewType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addType(); if (e.key === 'Escape') setNewType(null); }}
                />
                <button className="btn primary" onClick={addType}>Créer</button>
                <button className="btn ghost" onClick={() => setNewType(null)}>Annuler</button>
              </div>
            ) : editingType ? (
              <div className="type-edit">
                <input
                  autoFocus
                  value={editName}
                  aria-label="Nouveau nom"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditingType(null); }}
                />
                <button className="btn primary" onClick={saveRename}>Renommer</button>
                <button className="btn ghost" onClick={() => setEditingType(null)}>Annuler</button>
              </div>
            ) : (
              <div className="type-head">
                <strong className="type-title">{ty.name}</strong>
                <button className="icon-btn sm" onClick={() => { setEditingType(ty.id); setEditName(ty.name); }} aria-label={`Renommer ${ty.name}`}>
                  <Icon name="edit" size={17} />
                </button>
                {types.length > 1 && (
                  <button className="icon-btn sm" onClick={() => removeType(ty.id)} aria-label={`Supprimer la grande catégorie ${ty.name}`}>
                    <Icon name="trash" size={17} />
                  </button>
                )}
              </div>
            )}

            <label className="mode-row">
              <span className="mode-text">
                {ty.pomodoro ? 'Se lance en Pomodoro et compte dans ton bilan' : 'Se coche simplement comme fait'}
              </span>
              <span className="switch">
                <input type="checkbox" checked={ty.pomodoro} onChange={(e) => db.types.update(ty.id, { pomodoro: e.target.checked })} aria-label={`Pomodoro pour ${ty.name}`} />
                <span className="switch-track"><span /></span>
                <span className="switch-label">Pomodoro</span>
              </span>
            </label>

            <div className="sub-label">Catégorie</div>
            <div className="chips cat-chips">
              <button className={`chip ${t.categoryId === null ? 'on' : ''}`} onClick={() => set({ categoryId: null })}>Aucune</button>
              {shownCats.map((c) => (
                <span key={c.id} className={`chip cat-chip removable ${t.categoryId === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
                  <button className="chip-main" onClick={() => set({ categoryId: c.id! })}>
                    <i className="dot" /> {c.name}
                  </button>
                  {t.categoryId === c.id && (
                    <button className="chip-x" onClick={() => removeCategory(c.id!, c.name)} aria-label={`Supprimer la catégorie ${c.name}`}>
                      <Icon name="close" size={13} />
                    </button>
                  )}
                </span>
              ))}
              {newCat === null ? (
                <button className="chip ghost" onClick={() => setNewCat('')}><Icon name="plus" size={14} /> Catégorie</button>
              ) : (
                <span className="chip-input">
                  <input autoFocus value={newCat} placeholder="Nom" onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCategory(); if (e.key === 'Escape') setNewCat(null); }} />
                  <button onClick={addCategory}>OK</button>
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="group">
          <h3 className="group-title">Quand</h3>
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
          <DurationPicker value={t.durationMin} start={t.startTime} onChange={(d) => set({ durationMin: d })} />
        </section>

        <section className="group">
          <h3 className="group-title">Répétition</h3>
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
        </section>

        <section className="group">
          <h3 className="group-title">Notes</h3>
          <textarea rows={2} placeholder="Pages, exercices, objectifs…" value={t.notes} onChange={(e) => set({ notes: e.target.value })} />
        </section>

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button className="btn primary big" onClick={save}>{task ? 'Enregistrer' : 'Ajouter au planning'}</button>
          {task && (
            <button className="btn danger-ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer la tâche</button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
