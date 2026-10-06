import { convertV1, db, DEFAULT_SETTINGS } from '../db';
import { todayKey } from './dates';

const VERSION = 2;

export async function exportData(): Promise<'shared' | 'downloaded'> {
  const data = {
    app: 'cadence',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    categories: await db.categories.toArray(),
    tasks: await db.tasks.toArray(),
    occStates: await db.occStates.toArray(),
    sessions: await db.sessions.toArray(),
    settings: await db.settings.toArray(),
  };
  const name = `cadence-sauvegarde-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  // Sur iPhone, la feuille de partage est le moyen le plus fiable (Fichiers, AirDrop, mail…)
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Cadence' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

export async function importData(file: File): Promise<void> {
  const raw = JSON.parse(await file.text());
  if (raw?.app !== 'cadence' || !Array.isArray(raw.tasks)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Cadence.");
  }
  // Les sauvegardes v1 ont des identifiants numériques : on les convertit
  const data = raw.version >= 2 ? raw : { ...raw, ...convertV1(raw) };
  const tables = [db.categories, db.tasks, db.occStates, db.sessions, db.settings];
  await db.transaction('rw', tables, async () => {
    // Suppressions clé par clé (et non clear()) pour que la synchro les envoie aussi au compte
    for (const t of tables) await t.bulkDelete(await t.toCollection().primaryKeys());
    await db.categories.bulkPut(data.categories ?? []);
    await db.tasks.bulkPut(data.tasks ?? []);
    await db.occStates.bulkPut(data.occStates ?? []);
    await db.sessions.bulkPut(data.sessions ?? []);
    await db.settings.put({ ...DEFAULT_SETTINGS, ...(data.settings?.[0] ?? {}), id: 'main' });
  });
}
