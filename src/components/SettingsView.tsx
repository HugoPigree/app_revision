import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, deleteCategory, PALETTE, useSettings, type Settings } from '../db';
import { exportData, importData } from '../lib/backup';
import { Icon, useUI } from '../ui';

function Stepper({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Diminuer ${label}`}>−</button>
        <b>{value}{unit ? <small> {unit}</small> : null}</b>
        <button onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`Augmenter ${label}`}>+</button>
      </div>
    </div>
  );
}

const PRESETS = [
  { name: 'Classique', sub: '25 / 5', workMin: 25, shortBreakMin: 5, longBreakMin: 20, blocksBeforeLong: 4 },
  { name: 'Long', sub: '50 / 10', workMin: 50, shortBreakMin: 10, longBreakMin: 30, blocksBeforeLong: 3 },
  { name: 'Court', sub: '15 / 3', workMin: 15, shortBreakMin: 3, longBreakMin: 15, blocksBeforeLong: 4 },
];

export function SettingsView() {
  const s = useSettings();
  const ui = useUI();
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);

  const update = (patch: Partial<Settings>) => db.settings.put({ ...s, ...patch });

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    const ok = await ui.ask({ title: 'Restaurer cette sauvegarde ?', message: 'Toutes tes données actuelles seront remplacées.', confirmLabel: 'Remplacer', danger: true });
    if (!ok) { if (fileRef.current) fileRef.current.value = ''; return; }
    try {
      await importData(f);
      ui.toast('Sauvegarde restaurée');
    } catch (e) {
      await ui.ask({ title: 'Import impossible', message: (e as Error).message, confirmLabel: 'OK', cancelLabel: null });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeCat = async (id: number, name: string) => {
    const ok = await ui.ask({ title: `Supprimer « ${name} » ?`, message: 'Les tâches de cette catégorie restent, sans catégorie.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    await deleteCategory(id);
  };

  const activePreset = PRESETS.find((p) => p.workMin === s.workMin && p.shortBreakMin === s.shortBreakMin && p.longBreakMin === s.longBreakMin && p.blocksBeforeLong === s.blocksBeforeLong);

  return (
    <div className="screen settings">
      <header className="page-head"><h1>Réglages</h1></header>
      <div className="scroll-body">
        <section className="card">
          <h2 className="section-title">Méthode de travail</h2>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.name} className={activePreset === p ? 'on' : ''} onClick={() => update({ workMin: p.workMin, shortBreakMin: p.shortBreakMin, longBreakMin: p.longBreakMin, blocksBeforeLong: p.blocksBeforeLong })}>
                <b>{p.name}</b><span>{p.sub}</span>
              </button>
            ))}
          </div>
          <Stepper label="Pomodoro (travail)" value={s.workMin} min={5} max={90} step={5} unit="min" onChange={(v) => update({ workMin: v })} />
          <Stepper label="Pause courte" value={s.shortBreakMin} min={1} max={30} unit="min" onChange={(v) => update({ shortBreakMin: v })} />
          <Stepper label="Grande pause" value={s.longBreakMin} min={5} max={60} step={5} unit="min" onChange={(v) => update({ longBreakMin: v })} />
          <Stepper label="Grande pause tous les" value={s.blocksBeforeLong} min={2} max={8} unit="pomodoros" onChange={(v) => update({ blocksBeforeLong: v })} />
        </section>

        <section className="card method">
          <h2 className="section-title">La méthode Pomodoro</h2>
          <p><b>1. Un pomodoro.</b> Tu travailles sur une seule chose pendant un bloc (25 min par défaut), sans distraction.</p>
          <p><b>2. Une pause courte.</b> À la fin du bloc, l’app sonne et lance la pause (5 min par défaut). Lève-toi, décroche de l’écran.</p>
          <p><b>3. Une grande pause.</b> Après plusieurs pomodoros (4 par défaut), une pause plus longue. Le pomodoro suivant ne démarre que quand tu le relances, pour que seul le vrai temps de travail compte dans ton bilan.</p>
        </section>

        <section className="card">
          <h2 className="section-title">Calendrier</h2>
          <Stepper label="Début de journée" value={s.dayStartHour} min={0} max={s.dayEndHour - 1} unit="h" onChange={(v) => update({ dayStartHour: v })} />
          <Stepper label="Fin de journée" value={s.dayEndHour} min={s.dayStartHour + 1} max={24} unit="h" onChange={(v) => update({ dayEndHour: v })} />
        </section>

        <section className="card">
          <h2 className="section-title">Catégories</h2>
          <ul className="cat-list">
            {cats.map((c) => (
              <li key={c.id}>
                <div className="swatches">
                  <input
                    type="color"
                    value={c.color}
                    onChange={(e) => db.categories.update(c.id!, { color: e.target.value })}
                    aria-label={`Couleur de ${c.name}`}
                  />
                </div>
                <input className="cat-name" value={c.name} onChange={(e) => db.categories.update(c.id!, { name: e.target.value })} />
                <button className="icon-btn" onClick={() => removeCat(c.id!, c.name)} aria-label={`Supprimer ${c.name}`}><Icon name="trash" size={18} /></button>
              </li>
            ))}
          </ul>
          <button className="btn secondary" onClick={() => db.categories.add({ name: 'Nouvelle catégorie', color: PALETTE[cats.length % PALETTE.length] })}>
            <Icon name="plus" size={18} /> Ajouter une catégorie
          </button>
        </section>

        <section className="card">
          <h2 className="section-title">Données</h2>
          <p className="muted small">Tout est stocké uniquement sur cet appareil, rien n’est envoyé en ligne. Ton téléphone et ton PC ont donc chacun leurs propres données. Exporte une sauvegarde de temps en temps.</p>
          {persisted === false && (
            <button className="btn ghost" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>Protéger le stockage contre l’effacement automatique</button>
          )}
          <div className="row2">
            <button className="btn secondary" onClick={async () => { const r = await exportData(); if (r === 'downloaded') ui.toast('Sauvegarde téléchargée'); }}>Exporter</button>
            <button className="btn secondary" onClick={() => fileRef.current?.click()}>Importer</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </section>

        <p className="muted small center">Cadence v1 · fonctionne hors ligne</p>
      </div>
    </div>
  );
}
