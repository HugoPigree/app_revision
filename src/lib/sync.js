import { createClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, fixCategoryTypes, markRemote, onLocalChange, SYNCED } from '../db';
/**
 * Synchro « hors ligne d'abord » :
 * - toutes les écritures se font d'abord dans la base locale (IndexedDB) ;
 * - chaque modification locale est mémorisée comme « en attente » ;
 * - push : on envoie l'état actuel de chaque enregistrement en attente (ou sa suppression) ;
 * - pull : on récupère ce qui a changé côté serveur depuis la dernière synchro.
 * Une seule table distante : cadence_records(user_id, tbl, id, data, deleted, updated_at).
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloudEnabled = !!(URL_ && KEY);
export const supabase = cloudEnabled
    ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cadence.auth' } })
    : null;
const REMOTE_TABLE = 'cadence_records';
const PENDING_KEY = 'cadence.pending';
const lastPullKey = (userId) => `cadence.lastPull.${userId}`;
let state = {
    status: cloudEnabled ? 'signed-out' : 'disabled',
    session: null,
    ready: !cloudEnabled,
    lastSyncedAt: Number(localStorage.getItem('cadence.lastSyncedAt')) || null,
    pending: 0,
    error: null,
    recovery: false,
};
const listeners = new Set();
function setState(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
}
export function useSync() {
    return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
export const getSyncState = () => state;
// ——— Modifications en attente ———
/** clé `${table}|${id}` → compteur (pour savoir si un enregistrement a re-changé pendant l'envoi) */
const pending = new Map();
try {
    for (const k of JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]'))
        pending.set(k, 1);
}
catch { /* ignore */ }
let counter = 1;
function savePending() {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify([...pending.keys()]));
    }
    catch { /* ignore */ }
    setState({ pending: pending.size });
}
setTimeout(() => setState({ pending: pending.size }), 0);
let debounce;
onLocalChange((table, id) => {
    pending.set(`${table}|${id}`, ++counter);
    savePending();
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void syncNow(), 1500);
});
// ——— Push / pull ———
let running = null;
let again = false;
export function syncNow() {
    if (running) {
        again = true;
        return running;
    }
    running = (async () => {
        try {
            do {
                again = false;
                await syncOnce();
            } while (again);
        }
        finally {
            running = null;
        }
    })();
    return running;
}
async function syncOnce() {
    const session = state.session;
    if (!supabase || !session)
        return;
    if (!navigator.onLine) {
        setState({ status: 'offline' });
        return;
    }
    setState({ status: 'syncing', error: null });
    try {
        await push(session.user.id);
        await pull(session.user.id);
        const now = Date.now();
        localStorage.setItem('cadence.lastSyncedAt', String(now));
        setState({ status: 'idle', lastSyncedAt: now });
    }
    catch (e) {
        const msg = e.message ?? String(e);
        console.warn('Synchro échouée', e);
        setState({ status: navigator.onLine ? 'error' : 'offline', error: msg });
    }
}
async function push(userId) {
    if (!pending.size)
        return;
    const snapshot = [...pending.entries()];
    for (let i = 0; i < snapshot.length; i += 400) {
        const chunk = snapshot.slice(i, i + 400);
        const rows = await Promise.all(chunk.map(async ([k]) => {
            const sep = k.indexOf('|');
            const tbl = k.slice(0, sep);
            const id = k.slice(sep + 1);
            const data = await db.table(tbl).get(id);
            return { user_id: userId, tbl, id, data: data ?? null, deleted: !data };
        }));
        const { error } = await supabase.from(REMOTE_TABLE).upsert(rows, { onConflict: 'user_id,tbl,id' });
        if (error)
            throw error;
        // On ne retire que ce qui n'a pas re-changé pendant l'envoi
        for (const [k, c] of chunk)
            if (pending.get(k) === c)
                pending.delete(k);
        savePending();
    }
}
async function pull(userId) {
    let since = localStorage.getItem(lastPullKey(userId)) ?? '1970-01-01T00:00:00Z';
    for (;;) {
        const { data, error } = await supabase
            .from(REMOTE_TABLE)
            .select('tbl,id,data,deleted,updated_at')
            .gt('updated_at', since)
            .order('updated_at', { ascending: true })
            .limit(1000);
        if (error)
            throw error;
        const rows = (data ?? []);
        if (!rows.length)
            break;
        await applyRemote(rows);
        if (rows.some((r) => r.tbl === 'categories'))
            await fixCategoryTypes();
        since = rows[rows.length - 1].updated_at;
        localStorage.setItem(lastPullKey(userId), since);
        if (rows.length < 1000)
            break;
    }
}
async function applyRemote(rows) {
    const tables = Object.keys(SYNCED).map((t) => db.table(t));
    await db.transaction('rw', tables, async (tx) => {
        markRemote(tx);
        for (const r of rows) {
            if (!(r.tbl in SYNCED))
                continue;
            if (pending.has(`${r.tbl}|${r.id}`))
                continue; // une modif locale plus récente attend d'être envoyée
            const table = db.table(r.tbl);
            if (r.deleted || !r.data)
                await table.delete(r.id);
            else
                await table.put(r.data);
        }
    });
}
// ——— Session ———
if (supabase) {
    supabase.auth.getSession().then(({ data }) => {
        setState({ session: data.session, ready: true, status: data.session ? 'idle' : 'signed-out' });
        if (data.session)
            void syncNow();
    });
    supabase.auth.onAuthStateChange((event, session) => {
        const prev = state.session?.user.id;
        setState({ session, status: session ? (state.status === 'signed-out' ? 'idle' : state.status) : 'signed-out', recovery: event === 'PASSWORD_RECOVERY' ? true : state.recovery });
        if (session && session.user.id !== prev)
            void syncNow();
    });
    window.addEventListener('online', () => void syncNow());
    window.addEventListener('offline', () => state.session && setState({ status: 'offline' }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
        void syncNow(); });
    setInterval(() => { if (document.visibilityState === 'visible')
        void syncNow(); }, 60000);
}
export function endRecovery() { setState({ recovery: false }); }
/** Envoie tout ce qui est en local (utile après connexion sur un appareil qui avait déjà des données) */
export async function markAllLocalPending() {
    for (const t of Object.keys(SYNCED)) {
        const keys = await db.table(t).toCollection().primaryKeys();
        for (const k of keys)
            pending.set(`${t}|${String(k)}`, ++counter);
    }
    savePending();
}
export async function signOutAndClear(resetLocal) {
    if (state.session)
        await supabase?.auth.signOut();
    pending.clear();
    savePending();
    localStorage.removeItem('cadence.lastSyncedAt');
    // La base locale est vidée : à la prochaine connexion il faudra tout re-télécharger
    for (const k of Object.keys(localStorage))
        if (k.startsWith('cadence.lastPull.'))
            localStorage.removeItem(k);
    await resetLocal();
    setState({ lastSyncedAt: null, status: 'signed-out', session: null });
}
export const hasPending = () => pending.size > 0;
