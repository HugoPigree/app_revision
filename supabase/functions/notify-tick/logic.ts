/**
 * Calcul des notifications à envoyer pour un utilisateur, à un instant donné.
 * Pur (aucun accès réseau ni base) pour pouvoir être testé hors de Supabase.
 * Les règles de récurrence reprennent celles de l'app (src/lib/recurrence.ts).
 */

export type Recurrence =
  | { kind: 'none' }
  | { kind: 'weekly'; days: number[]; interval: number }
  | { kind: 'daily'; every: number };

export interface Task {
  id: string;
  createdAt?: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMin: number;
  recurrence: Recurrence;
  endDate: string | null;
}

export interface OccState { key: string; status: 'done' | 'skipped' }

export interface NotifSettings {
  notifyBefore?: number | null; // minutes avant (0 = à l'heure, null = désactivé)
  notifyMorning?: string | null; // "08:00" ou null
  notifyEvening?: string | null; // "21:00" ou null
  notifyEnd?: boolean; // « C'est fait ? » à la fin de chaque tâche
}

export const DEFAULTS = { notifyBefore: 10, notifyMorning: '08:00', notifyEvening: '21:00', notifyEnd: true };

export interface Notif { key: string; title: string; body: string; tag: string; url?: string }

// ——— Dates (clés YYYY-MM-DD, calculs en UTC pour éviter les surprises) ———

const pad = (n: number) => String(n).padStart(2, '0');
const toUTC = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (k: string, n: number) => fromUTC(toUTC(k) + n * 86400000);
const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const weekday = (k: string) => (new Date(toUTC(k)).getUTCDay() + 6) % 7; // 0 = lundi
const startOfWeek = (k: string) => addDays(k, -weekday(k));
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const hShort = (m: number) => `${Math.floor(m / 60) % 24}h${m % 60 ? pad(m % 60) : ''}`;

/** Date et minute locales dans le fuseau de l'utilisateur */
export function localNow(now: Date, tz: string): { date: string; min: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { date: `${get('year')}-${pad(get('month'))}-${pad(get('day'))}`, min: (get('hour') % 24) * 60 + get('minute') };
}

export function occursOn(task: Task, date: string): boolean {
  if (date < task.startDate) return false;
  if (task.endDate && date > task.endDate) return false;
  const r = task.recurrence ?? { kind: 'none' };
  switch (r.kind) {
    case 'none': return date === task.startDate;
    case 'daily': return daysBetween(task.startDate, date) % Math.max(1, r.every) === 0;
    case 'weekly': {
      if (!r.days.includes(weekday(date))) return false;
      const weeks = Math.round(daysBetween(startOfWeek(task.startDate), startOfWeek(date)) / 7);
      return weeks % Math.max(1, r.interval) === 0;
    }
    default: return false;
  }
}

interface Occ { key: string; task: Task; date: string; start: number; status: 'done' | 'todo' }

function occurrences(tasks: Task[], states: Map<string, OccState['status']>, date: string): Occ[] {
  const out: Occ[] = [];
  for (const task of tasks) {
    if (!occursOn(task, date)) continue;
    const key = `${task.id}_${date}`;
    const st = states.get(key);
    if (st === 'skipped') continue;
    out.push({ key, task, date, start: toMin(task.startTime), status: st === 'done' ? 'done' : 'todo' });
  }
  return out.sort((a, b) => a.start - b.start);
}

function listTitles(occs: Occ[], withTime: boolean, max = 4): string {
  const parts = occs.slice(0, max).map((o) => (withTime ? `${hShort(o.start)} ${o.task.title}` : o.task.title));
  if (occs.length > max) parts.push(`+${occs.length - max}`);
  return parts.join(', ');
}

/**
 * Notifications à envoyer maintenant. `sent` contient les clés déjà envoyées.
 * Chaque règle a une fenêtre (pas un instant exact) : si une minute est ratée, la notif part à la suivante.
 */
export function computeNotifications(args: {
  tasks: Task[];
  states: OccState[];
  settings: NotifSettings | null;
  now: Date;
  tz: string;
  sent: Set<string>;
}): Notif[] {
  const s = { ...DEFAULTS, ...(args.settings ?? {}) };
  const { date: today, min: nowMin } = localNow(args.now, args.tz);
  const states = new Map(args.states.map((x) => [x.key, x.status] as const));
  const out: Notif[] = [];
  const push = (n: Notif) => { if (!args.sent.has(n.key)) out.push(n); };

  // 1. Rappel avant chaque tâche (aujourd'hui, et demain pour les tâches juste après minuit)
  if (typeof s.notifyBefore === 'number' && s.notifyBefore >= 0) {
    const before = s.notifyBefore;
    for (const [date, offset] of [[today, 0], [addDays(today, 1), 1440]] as const) {
      for (const o of occurrences(args.tasks, states, date)) {
        if (o.status === 'done') continue;
        const start = o.start + offset;
        const from = start - before;
        const until = before === 0 ? start + 5 : start; // à l'heure : petite tolérance
        if (nowMin >= from && nowMin < until) {
          const left = start - nowMin;
          const end = o.start + o.task.durationMin;
          push({
            key: `rem:${o.key}:${before}`,
            title: before === 0 || left <= 0 ? `C'est l'heure : ${o.task.title}` : `${o.task.title} dans ${left} min`,
            body: `${hhmm(o.start)} – ${hhmm(end)}`,
            tag: `rem-${o.key}`,
          });
        }
      }
    }
  }

  const todays = occurrences(args.tasks, states, today);

  // 4. Fin de tâche : « c'est fait ? » (fenêtre de 30 min après la fin, hier inclus pour les tâches qui passent minuit)
  if (s.notifyEnd) {
    for (const [date, offset] of [[addDays(today, -1), -1440], [today, 0]] as const) {
      for (const o of occurrences(args.tasks, states, date)) {
        if (o.status === 'done') continue;
        const end = o.start + o.task.durationMin + offset;
        if (nowMin < end || nowMin >= end + 30) continue;
        // Tâche ajoutée après coup (déjà finie au moment de sa création) : on ne demande rien
        if (o.task.createdAt && o.task.createdAt > args.now.getTime() - (nowMin - end) * 60000) continue;
        push({
          key: `end:${o.key}:${o.task.startTime}`, // l'heure dans la clé : une tâche décalée au même jour redemande
          title: `${o.task.title} : c'est fait ?`,
          body: `${hhmm(o.start)} – ${hhmm(o.start + o.task.durationMin)} · Touche pour cocher ou décaler`,
          tag: `end-${o.key}`,
          url: `/?fin=${encodeURIComponent(o.key)}`,
        });
      }
    }
  }

  // 2. Récap du matin (fenêtre de 3 h après l'heure choisie)
  if (s.notifyMorning) {
    const t = toMin(s.notifyMorning);
    if (nowMin >= t && nowMin < t + 180) {
      const left = todays.filter((o) => o.status !== 'done');
      if (left.length) {
        push({
          key: `morning:${today}`,
          title: `${left.length} tâche${left.length > 1 ? 's' : ''} au programme aujourd'hui`,
          body: listTitles(left, true),
          tag: 'morning',
        });
      }
    }
  }

  // 3. Tâches pas cochées le soir (celles déjà commencées, fenêtre de 3 h)
  if (s.notifyEvening) {
    const t = toMin(s.notifyEvening);
    if (nowMin >= t && nowMin < t + 180) {
      const missed = todays.filter((o) => o.status !== 'done' && o.start <= nowMin);
      if (missed.length) {
        push({
          key: `evening:${today}`,
          title: `${missed.length} tâche${missed.length > 1 ? 's' : ''} pas cochée${missed.length > 1 ? 's' : ''} aujourd'hui`,
          body: `${listTitles(missed, false)}. Coche ce qui est fait ou replanifie le reste.`,
          tag: 'evening',
        });
      }
    }
  }

  return out;
}
