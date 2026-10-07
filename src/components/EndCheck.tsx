import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setOccStatus, useCategories } from '../db';
import { addDays, fmtDuration, minToTime, nowMin, relativeDay, todayKey } from '../lib/dates';
import { expand, type Occurrence } from '../lib/recurrence';
import { postponeOccurrence } from '../lib/move';
import { loadRun } from './Review';
import { Icon, Sheet, useUI } from '../ui';

/* ——— Mémoire des tâches déjà traitées (sur cet appareil) ——— */

const ASKED = 'cadence.endAsked';
function readAsked(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ASKED) ?? '[]') as string[]); } catch { return new Set(); }
}
function markAsked(key: string) {
  const min = addDays(todayKey(), -2);
  const keep = [...readAsked()].filter((k) => k.slice(-10) >= min);
  keep.push(key);
  localStorage.setItem(ASKED, JSON.stringify(keep));
}

/** Fin d'une occurrence en timestamp (heure locale) */
function endTime(o: Occurrence): number {
  const [y, m, d] = o.date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, o.start + o.task.durationMin).getTime();
}

/* ——— Choix d'un nouveau créneau ——— */

const ceil15 = (m: number) => Math.ceil(m / 15) * 15;

export function PostponePicker({ occ, onDone, onBack }: { occ: Occurrence; onDone: (where: string) => void; onBack?: () => void }) {
  const today = todayKey();
  const dur = occ.task.durationMin;
  const inOneHour = ceil15(nowMin() + 60);
  const tomorrow = addDays(today, 1);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(minToTime(Math.min(ceil15(nowMin() + 30), 23 * 60)));

  const go = async (d: string, start: number) => onDone(await postponeOccurrence(occ, d, start));

  const options: { label: string; sub: string; date: string; start: number }[] = [];
  if (inOneHour + dur <= 24 * 60) options.push({ label: 'Dans 1 h', sub: `aujourd'hui ${minToTime(inOneHour)}`, date: today, start: inOneHour });
  if (nowMin() < 19 * 60 && 20 * 60 + dur <= 24 * 60) options.push({ label: 'Ce soir', sub: '20:00', date: today, start: 20 * 60 });
  options.push({ label: 'Demain', sub: `même heure, ${minToTime(occ.start)}`, date: tomorrow, start: occ.start });

  return (
    <div className="postpone">
      <div className="postpone-opts">
        {options.map((o) => (
          <button key={o.label} className="postpone-opt" onClick={() => void go(o.date, o.start)}>
            <strong>{o.label}</strong>
            <span>{o.sub}</span>
          </button>
        ))}
        <button className={`postpone-opt ${custom ? 'on' : ''}`} onClick={() => setCustom(true)}>
          <strong>Choisir</strong>
          <span>jour et heure</span>
        </button>
      </div>
      {custom && (
        <div className="postpone-custom">
          <input type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Jour" />
          <input type="time" value={time} step={300} onChange={(e) => e.target.value && setTime(e.target.value)} aria-label="Heure" />
          <button className="btn primary" onClick={() => { const [h, m] = time.split(':').map(Number); void go(date, h * 60 + m); }}>OK</button>
        </div>
      )}
      {onBack && <button className="btn ghost" onClick={onBack}>Retour</button>}
    </div>
  );
}

/* ——— Fenêtre « c'est fait ? » à la fin d'une tâche ——— */

/** Clé d'occurrence demandée depuis une notification (?fin=…) */
function readFocusFromUrl(): string | null {
  const p = new URLSearchParams(location.search);
  const k = p.get('fin');
  if (k) history.replaceState(null, '', location.pathname);
  return k;
}

export function EndCheck({ paused }: { paused: boolean }) {
  const ui = useUI();
  const cats = useCategories();
  const [tick, setTick] = useState(0);
  const [focus, setFocus] = useState<string | null>(readFocusFromUrl);
  const [later, setLater] = useState<Set<string>>(() => new Set()); // « plus tard » : jusqu'à la prochaine ouverture
  const [mode, setMode] = useState<'ask' | 'postpone'>('ask');

  // Vérifie régulièrement, et à chaque retour sur l'app
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    const id = setInterval(again, 30_000);
    const onVis = () => document.visibilityState === 'visible' && again();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', again);
    const onMsg = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string } | null)?.type === 'open' ? e.data.url as string : null;
      const k = url ? new URL(url, location.origin).searchParams.get('fin') : null;
      if (k) { setFocus(k); setMode('ask'); again(); }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', again);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, []);

  const today = todayKey();
  const yesterday = addDays(today, -1);
  const occs = useLiveQuery(async () => {
    const [tasks, states] = await Promise.all([
      db.tasks.toArray(),
      db.occStates.where('date').between(yesterday, today, true, true).toArray(),
    ]);
    return expand(tasks, states, yesterday, today);
  }, [yesterday, today]);

  const current = useMemo(() => {
    if (!occs) return null;
    void tick;
    const now = Date.now();
    const asked = readAsked();
    const run = loadRun();
    const running = run && run.phase !== 'finished' ? run.ctx.occKey : null;
    const open = occs.filter((o) => o.status !== 'done' && o.key !== running);
    // Depuis une notification : celle-là d'abord, même si déjà vue
    const focused = focus ? open.find((o) => o.key === focus) : undefined;
    if (focused) return { occ: focused, left: 0 };
    const due = open.filter((o) =>
      o.date === today &&
      endTime(o) <= now &&
      (o.task.createdAt ?? 0) < endTime(o) && // ajoutée après coup : rien à demander
      !asked.has(o.key) &&
      !later.has(o.key),
    );
    return due.length ? { occ: due[due.length - 1], left: due.length - 1 } : null;
  }, [occs, tick, focus, later, today]);

  useEffect(() => { setMode('ask'); }, [current?.occ.key]);

  if (!current || paused) return null;
  const { occ, left } = current;
  const cat = cats.get(occ.task.categoryId ?? '');

  const finish = (msg: string, remember = true) => {
    if (remember) markAsked(occ.key);
    if (focus === occ.key) setFocus(null);
    setTick((t) => t + 1);
    ui.toast(msg);
  };
  const done = async () => { await setOccStatus(occ.task.id!, occ.date, 'done'); finish('Bien joué ✓'); };
  const notDone = () => finish('Notée comme pas faite');
  const close = () => {
    if (focus === occ.key) setFocus(null);
    setLater((s) => new Set(s).add(occ.key));
  };

  return (
    <Sheet key={occ.key} onClose={close}>
      <div className="endcheck">
        <div className="occ-tag" style={{ ['--c' as string]: cat?.color ?? 'var(--muted)' }}>
          <i className="dot" /> {occ.date === today ? 'Terminée' : `Terminée ${relativeDay(occ.date)}`} · {minToTime(occ.start)} – {minToTime(occ.start + occ.task.durationMin)}
        </div>
        <h2 className="occ-title">{occ.task.title}</h2>

        {mode === 'ask' ? (
          <>
            <p className="endcheck-q">C’est fait ?</p>
            <div className="actions">
              <button className="btn primary big" onClick={() => void done()}>
                <Icon name="check" size={18} /> Oui, c’est fait
              </button>
              <button className="btn secondary big" onClick={() => setMode('postpone')}>
                <Icon name="clock" size={18} /> Décaler
              </button>
              <button className="btn ghost" onClick={notDone}>Pas fait, tant pis</button>
            </div>
            {left > 0 && <p className="hint center">Encore {left} tâche{left > 1 ? 's' : ''} terminée{left > 1 ? 's' : ''} à vérifier</p>}
          </>
        ) : (
          <>
            <p className="endcheck-q">À quand la décaler ? <span className="muted">({fmtDuration(occ.task.durationMin)})</span></p>
            <PostponePicker occ={occ} onBack={() => setMode('ask')} onDone={(where) => finish(`Décalée ${where}`, false)} />
          </>
        )}
      </div>
    </Sheet>
  );
}
