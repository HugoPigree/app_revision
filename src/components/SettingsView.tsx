import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { catType, db, deleteCategory, PALETTE, resetLocalDB, uid, useSettings, type Settings, type TaskType } from '../db';
import { exportData, importData } from '../lib/backup';
import { cloudEnabled, signOutAndClear, syncNow, useSync } from '../lib/sync';
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
  // Ordre stable ici (pas de tri par nom) pour que la ligne ne bouge pas pendant qu'on la renomme
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
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
    if (!ok) return;
    await signOutAndClear(resetLocalDB);
    ui.toast('Déconnecté');
  };

  const syncLabel = () => {
    if (sync.status === 'syncing') return 'Synchronisation…';
    if (sync.status === 'offline') return sync.pending ? `Hors ligne · ${sync.pending} modif. en attente` : 'Hors ligne';
    if (sync.status === 'error') return 'Erreur de synchro, nouvel essai bientôt';
    if (!sync.lastSyncedAt) return 'Pas encore synchronisé';
    const min = Math.round((Date.now() - sync.lastSyncedAt) / 60_000);
    return `Synchronisé ${min < 1 ? 'à l’instant' : `il y a ${min} min`}${sync.pending ? ` · ${sync.pending} en attente` : ''}`;
  };

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

  const removeCat = async (id: string, name: string) => {
    const undo = await deleteCategory(id);
    ui.toast(`« ${name} » supprimée`, { label: 'Annuler', run: () => void undo() });
  };


  const activePreset = PRESETS.find((p) => p.workMin === s.workMin && p.shortBreakMin === s.shortBreakMin && p.longBreakMin === s.longBreakMin && p.blocksBeforeLong === s.blocksBeforeLong);

  return (
    <div className="screen settings">
      <header className="page-head"><h1>Réglages</h1></header>
      <div className="scroll-body">
        {cloudEnabled && (
          <section className="card account">
            <h2 className="section-title">Compte</h2>
            {sync.session ? (
              <>
                <div className="account-row">
                  <div className="avatar">{(sync.session.user.email ?? '?').charAt(0).toUpperCase()}</div>
                  <div className="account-text">
                    <strong>{sync.session.user.email}</strong>
                    <span className={`sync-state ${sync.status}`}><i />{syncLabel()}</span>
                  </div>
                </div>
                <div className="row2">
                  <button className="btn secondary" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>Synchroniser</button>
                  <button className="btn danger-ghost" onClick={signOut}>Se déconnecter</button>
                </div>
              </>
            ) : (
              <>
                <p className="muted small">Tu n’es pas connecté : tes données restent uniquement sur cet appareil. Crée un compte pour les sauvegarder et les retrouver sur ton téléphone et ton PC.</p>
                <button className="btn primary" onClick={ui.openAuth}>Se connecter / créer un compte</button>
              </>
            )}
          </section>
        )}

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

        <section className="card cats-card">
          <h2 className="section-title">Catégories</h2>
          {(['revision', 'activity'] as TaskType[]).map((ty) => {
            const list = cats.filter((c) => catType(c) === ty);
            const other: TaskType = ty === 'revision' ? 'activity' : 'revision';
            return (
              <div key={ty} className="cat-group">
                <h3 className="cat-group-title">{ty === 'revision' ? 'Révisions' : 'Activités'}</h3>
                <ul className="cat-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <div className="swatches">
                        <input
                          type="color"
                          value={c.color}
                          onChange={(e) => db.categories.update(c.id, { color: e.target.value })}
                          aria-label={`Couleur de ${c.name}`}
                        />
                      </div>
                      <input className="cat-name" value={c.name} onChange={(e) => db.categories.update(c.id, { name: e.target.value })} />
                      <button
                        className="cat-move"
                        onClick={() => db.categories.update(c.id, { type: other })}
                        title={`Passer dans ${other === 'revision' ? 'Révisions' : 'Activités'}`}
                        aria-label={`Passer ${c.name} dans ${other === 'revision' ? 'Révisions' : 'Activités'}`}
                      >
                        → {other === 'revision' ? 'Révisions' : 'Activités'}
                      </button>
                      <button className="icon-btn" onClick={() => removeCat(c.id, c.name)} aria-label={`Supprimer ${c.name}`}><Icon name="trash" size={18} /></button>
                    </li>
                  ))}
                  {!list.length && <li className="muted small">Aucune catégorie.</li>}
                </ul>
                <button
                  className="btn ghost add-cat"
                  onClick={() => db.categories.add({ id: uid(), name: ty === 'revision' ? 'Nouvelle matière' : 'Nouvelle activité', color: PALETTE[cats.length % PALETTE.length], type: ty })}
                >
                  <Icon name="plus" size={16} /> {ty === 'revision' ? 'Ajouter une matière' : 'Ajouter une catégorie d’activité'}
                </button>
              </div>
            );
          })}
        </section>

        <section className="card">
          <h2 className="section-title">Données</h2>
          <p className="muted small">{sync.session ? 'Tes données sont enregistrées sur cet appareil et sauvegardées dans ton compte. Tu peux aussi exporter un fichier de sauvegarde.' : 'Sans compte, tout est stocké uniquement sur cet appareil. Exporte une sauvegarde de temps en temps.'}</p>
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
