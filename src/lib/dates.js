const pad = (n) => String(n).padStart(2, '0');
export function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
}
export function todayKey() {
    return toKey(new Date());
}
export function addDays(k, n) {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return toKey(d);
}
/** 0 = lundi … 6 = dimanche */
export function weekday(k) {
    return (fromKey(k).getDay() + 6) % 7;
}
export function startOfWeek(k) {
    return addDays(k, -weekday(k));
}
export function startOfMonth(k) {
    return k.slice(0, 8) + '01';
}
export function endOfMonth(k) {
    const d = fromKey(startOfMonth(k));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toKey(d);
}
export function addMonths(k, n) {
    const d = fromKey(startOfMonth(k));
    d.setMonth(d.getMonth() + n);
    return toKey(d);
}
export function daysBetween(a, b) {
    return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);
}
export function dateRange(from, to) {
    const out = [];
    for (let k = from; k <= to; k = addDays(k, 1))
        out.push(k);
    return out;
}
export function timeToMin(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
export function minToTime(m) {
    const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
    return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`;
}
export function nowMin() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}
export const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const fmtDayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
export const fmtShort = (k) => `${DAY_SHORT[weekday(k)]} ${fmtDayMonth.format(fromKey(k))}`;
export const fmtLongDay = (k) => fmtLong.format(fromKey(k));
export const fmtMonth = (k) => {
    const s = fmtMonthYear.format(fromKey(k));
    return s.charAt(0).toUpperCase() + s.slice(1);
};
export function relativeDay(k) {
    const diff = daysBetween(todayKey(), k);
    if (diff === 0)
        return "aujourd'hui";
    if (diff === 1)
        return 'demain';
    if (diff === -1)
        return 'hier';
    return fmtShort(k);
}
export function fmtDuration(min) {
    const m = Math.round(min);
    if (m < 60)
        return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${pad(r)}` : `${h} h`;
}
