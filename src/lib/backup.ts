import { db } from '../db';
import { todayKey } from './dates';

const VERSION = 1;

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
  const data = JSON.parse(await file.text());
  if (data?.app !== 'cadence' || !Array.isArray(data.tasks)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Cadence.");
  }
  await db.transaction('rw', [db.categories, db.tasks, db.occStates, db.sessions, db.settings], async () => {
    await Promise.all([db.categories.clear(), db.tasks.clear(), db.occStates.clear(), db.sessions.clear(), db.settings.clear()]);
    await db.categories.bulkAdd(data.categories ?? []);
    await db.tasks.bulkAdd(data.tasks ?? []);
    await db.occStates.bulkAdd(data.occStates ?? []);
    await db.sessions.bulkAdd(data.sessions ?? []);
    await db.settings.bulkAdd(data.settings ?? []);
  });
}
