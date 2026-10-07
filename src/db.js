import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
/** Types par défaut : ids fixes pour qu'ils soient les mêmes sur tous les appareils */
export const DEFAULT_TYPES = [
    { id: 'revision', name: 'Révision', pomodoro: true, order: 0 },
    { id: 'project', name: 'Projet', pomodoro: false, order: 1 },
    { id: 'activity', name: 'Activité', pomodoro: false, order: 2 },
];
export function useTypes() {
    const list = useLiveQuery(() => db.types.toArray(), []);
    return (list ?? DEFAULT_TYPES).slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
/** Type d'une tâche ou d'une catégorie ; si le type a été supprimé ailleurs, on retombe sur le premier */
export function typeOf(id, types) {
    return types.find((t) => t.id === id) ?? types[0] ?? DEFAULT_TYPES[0];
}
export const DEFAULT_SETTINGS = {
    id: 'main',
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 20,
    blocksBeforeLong: 4,
    dayStartHour: 7,
    dayEndHour: 23,
    notifyBefore: 10,
    notifyPomodoro: true,
    notifyMorning: '08:00',
    notifyEvening: '21:00',
    notifyEnd: true,
};
export const PALETTE = [
    '#3b6fd8', '#e2533d', '#2f9e6b', '#8a5cd6', '#e09a1a',
    '#1f9bb3', '#d64f8c', '#6b7a3a', '#7a5c48', '#5b6577',
];
/** Catégories par défaut : ids fixes pour qu'elles soient les mêmes sur tous les appareils */
export const DEFAULT_CATEGORIES = [
    { id: 'cat-maths', name: 'Maths', color: PALETTE[0], type: 'revision' },
    { id: 'cat-anglais', name: 'Anglais', color: PALETTE[3], type: 'revision' },
    { id: 'cat-info', name: 'Info', color: PALETTE[5], type: 'revision' },
    { id: 'cat-sport', name: 'Sport', color: PALETTE[2], type: 'activity' },
    { id: 'cat-perso', name: 'Perso', color: PALETTE[4], type: 'activity' },
];
const ACTIVITY_WORDS = /sport|salle|muscu|course|running|foot|basket|tennis|natation|piscine|perso|boulot|travail|job|taf|loisir|sortie|courses|ménage|menage|cuisine|jeu|lecture/i;
const PROJECT_WORDS = /projet|rendu|dossier|exposé|expose|mémoire|memoire|\btp\b|devoir/i;
/** Type d'une catégorie, avec une valeur par défaut pour les anciennes données sans type */
export function catType(c) {
    if (c.type)
        return c.type;
    const def = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
    if (def?.type)
        return def.type;
    if (PROJECT_WORDS.test(c.name))
        return 'project';
    return ACTIVITY_WORDS.test(c.name) ? 'activity' : 'revision';
}
/** Donne un type aux catégories qui n'en ont pas, d'après les tâches qui les utilisent */
export async function fixCategoryTypes() {
    const untyped = (await db.categories.toArray()).filter((c) => !c.type);
    if (!untyped.length)
        return;
    const tasks = await db.tasks.toArray();
    const typeIds = DEFAULT_TYPES.map((t) => t.id);
    for (const c of untyped) {
        const used = tasks.filter((t) => t.categoryId === c.id);
        const counts = typeIds.map((ty) => [ty, used.filter((t) => t.type === ty).length]).sort((a, b) => b[1] - a[1]);
        const type = used.length && counts[0][1] > counts[1][1] ? counts[0][0] : catType(c);
        await db.categories.update(c.id, { type });
    }
}
export function uid() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
/** Tables synchronisées et leur clé primaire */
export const SYNCED = {
    categories: 'id',
    tasks: 'id',
    occStates: 'key',
    sessions: 'id',
    settings: 'id',
    types: 'id',
};
class CadenceDB extends Dexie {
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
        this.version(2).stores({ types: 'id, order' });
    }
}
export const db = new CadenceDB();
let changeListener = null;
export function onLocalChange(fn) { changeListener = fn; }
/** Les écritures faites dans une transaction marquée « remote » ne sont pas renvoyées au serveur */
const REMOTE = Symbol('remote');
export function markRemote(tx) { tx[REMOTE] = true; }
const isRemote = (tx) => !!tx && !!(tx[REMOTE] || (tx.parent && tx.parent[REMOTE]));
for (const [name, pk] of Object.entries(SYNCED)) {
    const table = db.table(name);
    const emit = (tx, id) => {
        if (isRemote(tx) || id === undefined || id === null)
            return;
        const key = String(id);
        setTimeout(() => changeListener?.(name, key), 0);
    };
    table.hook('creating', function (primKey, obj, tx) {
        const id = primKey ?? obj[pk];
        emit(tx, id);
    });
    table.hook('updating', function (_mods, primKey, _obj, tx) { emit(tx, primKey); });
    table.hook('deleting', function (primKey, _obj, tx) { emit(tx, primKey); });
}
// ——— Initialisation : migration de l'ancienne base + catégories par défaut ———
export async function initDB() {
    const done = await db.meta.get('initialized');
    if (done)
        return;
    const migrated = await migrateFromV1();
    if (!migrated) {
        // Nouvelle installation : catégories par défaut, non suivies (identiques sur chaque appareil)
        await db.transaction('rw', db.categories, db.settings, db.types, async (tx) => {
            markRemote(tx);
            await db.types.bulkPut(DEFAULT_TYPES);
            await db.categories.bulkPut(DEFAULT_CATEGORIES);
            if (!(await db.settings.get('main')))
                await db.settings.put(DEFAULT_SETTINGS);
        });
        await db.meta.put({ key: 'typesSeeded', value: Date.now() });
    }
    await db.meta.put({ key: 'initialized', value: Date.now() });
}
/** Réinitialise la base locale (déconnexion) */
export async function resetLocalDB() {
    await db.transaction('rw', [db.categories, db.tasks, db.occStates, db.sessions, db.settings, db.types, db.meta], async (tx) => {
        markRemote(tx);
        await Promise.all([db.categories.clear(), db.tasks.clear(), db.occStates.clear(), db.sessions.clear(), db.settings.clear(), db.types.clear()]);
        await db.types.bulkPut(DEFAULT_TYPES);
        await db.meta.put({ key: 'typesSeeded', value: Date.now() });
        await db.categories.bulkPut(DEFAULT_CATEGORIES);
        await db.settings.put(DEFAULT_SETTINGS);
        await db.meta.put({ key: 'initialized', value: Date.now() });
    });
}
/** À lancer à chaque démarrage : corrections de données sans effet si déjà faites */
export async function repairDB() {
    // Installations d'avant les types modifiables : on ajoute les 3 types par défaut (une seule fois)
    if (!(await db.meta.get('typesSeeded'))) {
        await db.transaction('rw', db.types, db.meta, async (tx) => {
            markRemote(tx);
            for (const t of DEFAULT_TYPES)
                if (!(await db.types.get(t.id)))
                    await db.types.put(t);
            await db.meta.put({ key: 'typesSeeded', value: Date.now() });
        });
    }
    await fixCategoryTypes();
}
/** Supprime un type : ses catégories et ses tâches passent dans un autre type. Renvoie une fonction d'annulation. */
export async function deleteType(id, moveTo) {
    let saved;
    let taskIds = [];
    let catIds = [];
    await db.transaction('rw', db.types, db.tasks, db.categories, async () => {
        saved = await db.types.get(id);
        taskIds = (await db.tasks.where('type').equals(id).primaryKeys());
        catIds = (await db.categories.filter((c) => c.type === id).primaryKeys());
        await db.types.delete(id);
        await db.tasks.where('id').anyOf(taskIds).modify({ type: moveTo });
        await db.categories.where('id').anyOf(catIds).modify({ type: moveTo });
    });
    return {
        moved: taskIds.length,
        undo: async () => {
            if (!saved)
                return;
            const t = saved;
            await db.transaction('rw', db.types, db.tasks, db.categories, async () => {
                await db.types.put(t);
                await db.tasks.where('id').anyOf(taskIds).modify({ type: t.id });
                await db.categories.where('id').anyOf(catIds).modify({ type: t.id });
            });
        },
    };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Convertit des données v1 (ids numériques) vers le format actuel (ids texte) */
export function convertV1(src) {
    const cats = src.categories, tasks = src.tasks, states = src.occStates, sessions = src.sessions;
    const catMap = new Map();
    const newCats = cats.map((c) => {
        const def = DEFAULT_CATEGORIES.find((d) => d.name === c.name);
        const id = def && ![...catMap.values()].includes(def.id) ? def.id : uid();
        catMap.set(c.id, id);
        return { id, name: c.name, color: c.color, ...(def && def.id === id ? { type: def.type } : {}) };
    });
    const taskMap = new Map();
    const newTasks = tasks.map((t) => {
        const id = uid();
        taskMap.set(t.id, id);
        const { srInterval: _sr, ...rest } = t;
        void _sr;
        return { ...rest, id, categoryId: t.categoryId == null ? null : catMap.get(t.categoryId) ?? null };
    });
    const newStates = states
        .filter((s) => taskMap.has(s.taskId))
        .map((s) => ({ ...s, taskId: taskMap.get(s.taskId), key: `${taskMap.get(s.taskId)}_${s.date}` }));
    const newSessions = sessions.map((s) => ({
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
async function migrateFromV1() {
    if (!(await Dexie.exists('cadence')))
        return false;
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
        if (!cats.length && !tasks.length && !sessions.length)
            return false;
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
            if (!newCats.some((c) => c.id === d.id))
                setTimeout(() => changeListener?.('categories', d.id), 0);
        }
        return true;
    }
    catch (e) {
        console.warn('Migration v1 impossible', e);
        return false;
    }
    finally {
        old.close();
    }
}
// ——— Accès ———
export function useSettings() {
    const s = useLiveQuery(() => db.settings.get('main'), []);
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export function useCategories() {
    const list = useLiveQuery(() => db.categories.toArray(), []) ?? [];
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    return new Map(list.map((c) => [c.id, c]));
}
export async function setOccStatus(taskId, date, status) {
    const key = `${taskId}_${date}`;
    if (status === null)
        await db.occStates.delete(key);
    else
        await db.occStates.put({ key, taskId, date, status });
}
/** Supprime une catégorie ; ses tâches restent, sans catégorie. */
export async function deleteCategory(id) {
    let saved;
    let taskIds = [];
    await db.transaction('rw', db.categories, db.tasks, async () => {
        saved = await db.categories.get(id);
        taskIds = (await db.tasks.where('categoryId').equals(id).primaryKeys());
        await db.categories.delete(id);
        await db.tasks.where('categoryId').equals(id).modify({ categoryId: null });
    });
    // Renvoie une fonction pour annuler la suppression
    return async () => {
        if (!saved)
            return;
        const cat = saved;
        await db.transaction('rw', db.categories, db.tasks, async () => {
            await db.categories.put(cat);
            await db.tasks.where('id').anyOf(taskIds).modify({ categoryId: cat.id });
        });
    };
}
export async function deleteTask(taskId) {
    await db.transaction('rw', db.tasks, db.occStates, async () => {
        await db.tasks.delete(taskId);
        await db.occStates.where('taskId').equals(taskId).delete();
    });
}
