const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(k: string, n: number): string {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** 0 = lundi … 6 = dimanche */
export function weekday(k: string): number {
  return (fromKey(k).getDay() + 6) % 7;
}

export function startOfWeek(k: string): string {
  return addDays(k, -weekday(k));
}

export function startOfMonth(k: string): string {
  return k.slice(0, 8) + '01';
}

export function endOfMonth(k: string): string {
  const d = fromKey(startOfMonth(k));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toKey(d);
}

export function addMonths(k: string, n: number): string {
  const d = fromKey(startOfMonth(k));
  d.setMonth(d.getMonth() + n);
  return toKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(m: number): string {
  const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`;
}

export function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const fmtDayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

export const fmtShort = (k: string) => `${DAY_SHORT[weekday(k)]} ${fmtDayMonth.format(fromKey(k))}`;
export const fmtLongDay = (k: string) => fmtLong.format(fromKey(k));
export const fmtMonth = (k: string) => {
  const s = fmtMonthYear.format(fromKey(k));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function relativeDay(k: string): string {
  const diff = daysBetween(todayKey(), k);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  return fmtShort(k);
}

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${pad(r)}` : `${h} h`;
}
