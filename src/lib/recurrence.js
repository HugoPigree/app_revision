import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addDays, daysBetween, startOfWeek, timeToMin, todayKey, weekday, DAY_LONG } from './dates';
const DAY_ABBR = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
export function occursOn(task, date) {
    if (date < task.startDate)
        return false;
    if (task.endDate && date > task.endDate)
        return false;
    const r = task.recurrence;
    switch (r.kind) {
        case 'none':
            return date === task.startDate;
        case 'daily':
            return daysBetween(task.startDate, date) % Math.max(1, r.every) === 0;
        case 'weekly': {
            if (!r.days.includes(weekday(date)))
                return false;
            const weeks = Math.round(daysBetween(startOfWeek(task.startDate), startOfWeek(date)) / 7);
            return weeks % Math.max(1, r.interval) === 0;
        }
    }
}
export function expand(tasks, states, from, to) {
    const byKey = new Map(states.map((s) => [s.key, s]));
    const today = todayKey();
    const out = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
        for (const task of tasks) {
            if (!occursOn(task, date))
                continue;
            const key = `${task.id}_${date}`;
            const st = byKey.get(key);
            if (st?.status === 'skipped')
                continue;
            const start = timeToMin(task.startTime);
            out.push({
                key,
                task,
                date,
                start,
                end: Math.min(24 * 60, start + task.durationMin),
                status: st?.status === 'done' ? 'done' : date < today ? 'missed' : 'upcoming',
            });
        }
    }
    return out.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));
}
export function useOccurrences(from, to) {
    return useLiveQuery(async () => {
        const [tasks, states] = await Promise.all([
            db.tasks.toArray(),
            db.occStates.where('date').between(from, to, true, true).toArray(),
        ]);
        return expand(tasks, states, from, to);
    }, [from, to]);
}
/** Prochaine occurrence non faite à partir de `from` (incluse), sur un an max. */
export function nextOccurrence(task, excluded, from = todayKey()) {
    let d = from < task.startDate ? task.startDate : from;
    for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
        if (task.endDate && d > task.endDate)
            return null;
        if (occursOn(task, d) && !excluded.has(`${task.id}_${d}`))
            return d;
        if (task.recurrence.kind === 'none')
            return null;
    }
    return null;
}
export function describeRecurrence(task) {
    const r = task.recurrence;
    let s;
    if (r.kind === 'none')
        return 'Une seule fois';
    if (r.kind === 'daily')
        s = r.every === 1 ? 'Tous les jours' : `Tous les ${r.every} jours`;
    else {
        const days = [...r.days].sort();
        const label = days.length === 7 ? 'tous les jours'
            : days.length === 5 && days.every((d) => d < 5) ? 'en semaine'
                : days.length === 1 ? `le ${DAY_LONG[days[0]]}`
                    : days.map((d) => DAY_ABBR[d]).join(', ');
        s = (r.interval > 1 ? `Toutes les ${r.interval} semaines, ` : 'Chaque semaine, ') + label;
    }
    return task.endDate ? `${s} (jusqu'au ${task.endDate.split('-').reverse().join('/')})` : s;
}
