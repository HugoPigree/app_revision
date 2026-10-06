import Dexie, { type Table, type Transaction } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

export type TaskType = 'revision' | 'activity';

/** days : 0 = lundi … 6 = dimanche */
export type Recurrence =
  | { kind: 'none' }
  | { kind: 'weekly'; days: number[]; interval: number }
  | { kind: 'daily'; every: number };

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  categoryId: string | null;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMin: number;
  recurrence: Recurrence;
  endDate: string | null;
  notes: string;
  createdAt: number;
}

/** État d'une occurrence précise d'une tâche (clé = `${taskId}_${date}`) */
export interface OccState {
  key: string;
  taskId: string;
  date: string;
  status: 'done' | 'skipped';
}

export interface Session {
  id: string;
  taskId: string | null;
  occKey: string | null;
  categoryId: string | null;
  title: string;
  date: string;
  startedAt: number;
  endedAt: number;
  workMinutes: number;
  blocks: number;
  mastery: number | null;
}

export interface Settings {
  id: 'main';
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  blocksBeforeLong: number;
  dayStartHour: number;
  dayEndHour: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 20,
  blocksBeforeLong: 4,
  dayStartHour: 7,
  dayEndHour: 23,
};

export const PALETTE = [
  '#3b6fd8', '#e2533d', '#2f9e6b', '#8a5cd6', '#e09a1a',
  '#1f9bb3', '#d64f8c', '#6b7a3a', '#7a5c48', '#5b6577',
];

/** Catégories par défaut : ids fixes pour qu'elles soient les mêmes sur tous les appareils */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-maths', name: 'Maths', color: PALETTE[0] },
  { id: 'cat-anglais', name: 'Anglais', color: PALETTE[3] },
  { id: 'cat-info', name: 'Info', color: PALETTE[5] },
  { id: 'cat-sport', name: 'Sport', color: PALETTE[2] },
  { id: 'cat-perso', name: 'Perso', color: PALETTE[4] },
];

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/** Tables synchronisées et leur clé primaire */
export const SYNCED = {
  categories: 'id',
  tasks: 'id',
  occStates: 'key',
  sessions: 'id',
  settings: 'id',
} as const;
export type SyncedTable = keyof typeof SYNCED;

interface Meta { key: string; value: unknown }

class CadenceDB extends Dexie {
  categories!: Table<Category, string>;
  tasks!: Table<Task, string>;
  occStates!: Table<OccState, string>;
  sessions!: Table<Session, string>;
  settings!: Table<Settings, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('cadence-v2');
    this.version(1).stores({
      categories: 'id, name',
      tasks: 'id, type, categoryId, startDate',
      occStates: 'key, taskId, date',
      sessions: 'id, date, taskId, categoryId',
      settings: 'id',
      meta: 'key',
    });
  }
}

export const db = new CadenceDB();

// ——— Suivi des modifications locales (pour la synchro) ———

type ChangeListener = (table: SyncedTable, id: string) => void;
let changeListener: ChangeListener | null = null;
export function onLocalChange(fn: ChangeListener) { changeListener = fn; }

/** Les écritures faites dans une transaction marquée « remote » ne sont pas renvoyées au serveur */
const REMOTE = Symbol('remote');
export function markRemote(tx: Transaction) { (tx as unknown as Record<symbol, boolean>)[REMOTE] = true; }
const isRemote = (tx: Transaction | null | undefined) =>
  !!tx && !!((tx as unknown as Record<symbol, boolean>)[REMOTE] || (tx.parent && (tx.parent as unknown as Record<symbol, boolean>)[REMOTE]));

for (const [name, pk] of Object.entries(SYNCED) as [SyncedTable, string][]) {
  const table = db.table(name);
  const emit = (tx: Transaction, id: unknown) => {
    if (isRemote(tx) || id === undefined || id === null) return;
    const key = String(id);
    setTimeout(() => changeListener?.(name, key), 0);
  };
  table.hook('creating', function (primKey, obj, tx) {
    const id = primKey ?? (obj as Record<string, unknown>)[pk];
    emit(tx, id);
  });
  table.hook('updating', function (_mods, primKey, _obj, tx) { emit(tx, primKey); });
  table.hook('deleting', function (primKey, _obj, tx) { emit(tx, primKey); });
}

// ——— Initialisation : migration de l'ancienne base + catégories par défaut ———

export async function initDB(): Promise<void> {
  const done = await db.meta.get('initialized');
  if (done) return;
  const migrated = await migrateFromV1();
  if (!migrated) {
    // Nouvelle installation : catégories par défaut, non suivies (identiques sur chaque appareil)
    await db.transaction('rw', db.categories, db.settings, async (tx) => {
      markRemote(tx);
      await db.categories.bulkPut(DEFAULT_CATEGORIES);
      if (!(await db.settings.get('main'))) await db.settings.put(DEFAULT_SETTINGS);
    });
  }
  await db.meta.put({ key: 'initialized', value: Date.now() });
}

/** Réinitialise la base locale (déconnexion) */
export async function resetLocalDB(): Promise<void> {
  await db.transaction('rw', [db.categories, db.tasks, db.occStates, db.sessions, db.settings, db.meta], async (tx) => {
    markRemote(tx);
    await Promise.all([db.categories.clear(), db.tasks.clear(), db.occStates.clear(), db.sessions.clear(), db.settings.clear()]);
    await db.categories.bulkPut(DEFAULT_CATEGORIES);
    await db.settings.put(DEFAULT_SETTINGS);
    await db.meta.put({ key: 'initialized', value: Date.now() });
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Convertit des données v1 (ids numériques) vers le format actuel (ids texte) */
export function convertV1(src: { categories: any[]; tasks: any[]; occStates: any[]; sessions: any[] }) {
  const cats = src.categories, tasks = src.tasks, states = src.occStates, sessions = src.sessions;
    const catMap = new Map<number, string>();
    const newCats: Category[] = cats.map((c) => {
      const def = DEFAULT_CATEGORIES.find((d) => d.name === c.name);
      const id = def && ![...catMap.values()].includes(def.id) ? def.id : uid();
      catMap.set(c.id, id);
      return { id, name: c.name, color: c.color };
    });
    const taskMap = new Map<number, string>();
    const newTasks: Task[] = tasks.map((t) => {
      const id = uid();
      taskMap.set(t.id, id);
      const { srInterval: _sr, ...rest } = t;
      void _sr;
      return { ...rest, id, categoryId: t.categoryId == null ? null : catMap.get(t.categoryId) ?? null };
    });
    const newStates: OccState[] = states
      .filter((s) => taskMap.has(s.taskId))
      .map((s) => ({ ...s, taskId: taskMap.get(s.taskId)!, key: `${taskMap.get(s.taskId)}_${s.date}` }));
    const newSessions: Session[] = sessions.map((s) => ({
      ...s,
      id: uid(),
      taskId: s.taskId == null ? null : taskMap.get(s.taskId) ?? null,
      categoryId: s.categoryId == null ? null : catMap.get(s.categoryId) ?? null,
      occKey: s.occKey && s.taskId != null && taskMap.has(s.taskId) ? `${taskMap.get(s.taskId)}_${s.occKey.split('_').pop()}` : null,
    }));

  return { categories: newCats, tasks: newTasks, occStates: newStates, sessions: newSessions };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Récupère les données de la v1 (ids numériques) et les convertit. Renvoie true si une migration a eu lieu. */
async function migrateFromV1(): Promise<boolean> {
  if (!(await Dexie.exists('cadence'))) return false;
  const old = new Dexie('cadence');
  old.version(1).stores({
    categories: '++id, name', tasks: '++id, type, categoryId, startDate',
    occStates: 'key, taskId, date', sessions: '++id, date, taskId, categoryId', settings: 'id',
  });
  try {
    await old.open();
    const [cats, tasks, states, sessions, settings] = await Promise.all([
      old.table('categories').toArray(), old.table('tasks').toArray(), old.table('occStates').toArray(),
      old.table('sessions').toArray(), old.table('settings').toArray(),
    ]);
    if (!cats.length && !tasks.length && !sessions.length) return false;

    const { categories: newCats, tasks: newTasks, occStates: newStates, sessions: newSessions } = convertV1({ categories: cats, tasks, occStates: states, sessions });

    // Écritures normales (suivies) : elles seront envoyées au compte à la première connexion
    await db.transaction('rw', [db.categories, db.tasks, db.occStates, db.sessions, db.settings], async () => {
      await db.categories.bulkPut(newCats);
      await db.tasks.bulkPut(newTasks);
      await db.occStates.bulkPut(newStates);
      await db.sessions.bulkPut(newSessions);
      await db.settings.put({ ...DEFAULT_SETTINGS, ...(settings[0] ?? {}), id: 'main' });
    });
    // Catégories par défaut supprimées en v1 : on envoie aussi leur suppression
    for (const d of DEFAULT_CATEGORIES) {
      if (!newCats.some((c) => c.id === d.id)) setTimeout(() => changeListener?.('categories', d.id), 0);
    }
    return true;
  } catch (e) {
    console.warn('Migration v1 impossible', e);
    return false;
  } finally {
    old.close();
  }
}

// ——— Accès ———

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'), []);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export function useCategories(): Map<string, Category> {
  const list = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return new Map(list.map((c) => [c.id, c]));
}

export async function setOccStatus(taskId: string, date: string, status: OccState['status'] | null) {
  const key = `${taskId}_${date}`;
  if (status === null) await db.occStates.delete(key);
  else await db.occStates.put({ key, taskId, date, status });
}

/** Supprime une catégorie ; ses tâches restent, sans catégorie. */
export async function deleteCategory(id: string) {
  await db.transaction('rw', db.categories, db.tasks, async () => {
    await db.categories.delete(id);
    await db.tasks.where('categoryId').equals(id).modify({ categoryId: null });
  });
}

export async function deleteTask(taskId: string) {
  await db.transaction('rw', db.tasks, db.occStates, async () => {
    await db.tasks.delete(taskId);
    await db.occStates.where('taskId').equals(taskId).delete();
  });
}
