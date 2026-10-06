import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

export type TaskType = 'revision' | 'activity';

/** days : 0 = lundi … 6 = dimanche */
export type Recurrence =
  | { kind: 'none' }
  | { kind: 'weekly'; days: number[]; interval: number }
  | { kind: 'daily'; every: number };

export interface Category {
  id?: number;
  name: string;
  color: string;
}

export interface Task {
  id?: number;
  title: string;
  type: TaskType;
  categoryId: number | null;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMin: number;
  recurrence: Recurrence;
  endDate: string | null;
  notes: string;
  /** Intervalle (jours) utilisé par la répétition espacée pour planifier cette révision */
  srInterval?: number;
  createdAt: number;
}

/** État d'une occurrence précise d'une tâche (clé = `${taskId}_${date}`) */
export interface OccState {
  key: string;
  taskId: number;
  date: string;
  status: 'done' | 'skipped';
}

export interface Session {
  id?: number;
  taskId: number | null;
  occKey: string | null;
  categoryId: number | null;
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

class CadenceDB extends Dexie {
  categories!: Table<Category, number>;
  tasks!: Table<Task, number>;
  occStates!: Table<OccState, string>;
  sessions!: Table<Session, number>;
  settings!: Table<Settings, string>;

  constructor() {
    super('cadence');
    this.version(1).stores({
      categories: '++id, name',
      tasks: '++id, type, categoryId, startDate',
      occStates: 'key, taskId, date',
      sessions: '++id, date, taskId, categoryId',
      settings: 'id',
    });
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd([
        { name: 'Maths', color: PALETTE[0] },
        { name: 'Anglais', color: PALETTE[3] },
        { name: 'Info', color: PALETTE[5] },
        { name: 'Sport', color: PALETTE[2] },
        { name: 'Perso', color: PALETTE[4] },
      ]);
      tx.table('settings').add(DEFAULT_SETTINGS);
    });
  }
}

export const db = new CadenceDB();

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'), []);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export function useCategories(): Map<number, Category> {
  const list = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  return new Map(list.map((c) => [c.id!, c]));
}

export async function setOccStatus(taskId: number, date: string, status: OccState['status'] | null) {
  const key = `${taskId}_${date}`;
  if (status === null) await db.occStates.delete(key);
  else await db.occStates.put({ key, taskId, date, status });
}

/** Supprime une catégorie ; ses tâches restent, sans catégorie. */
export async function deleteCategory(id: number) {
  await db.transaction('rw', db.categories, db.tasks, async () => {
    await db.categories.delete(id);
    await db.tasks.where('categoryId').equals(id).modify({ categoryId: null });
  });
}

export async function deleteTask(taskId: number) {
  await db.transaction('rw', db.tasks, db.occStates, async () => {
    await db.tasks.delete(taskId);
    await db.occStates.where('taskId').equals(taskId).delete();
  });
}
