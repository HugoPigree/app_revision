import { useEffect, useState } from 'react';
import { db, setOccStatus, uid, useCategories, useSettings, type Settings } from '../db';
import { fmtDuration, todayKey } from '../lib/dates';
import { cancelPush, schedulePush } from '../lib/push';
import { Icon, useUI, type ReviewCtx } from '../ui';

type Phase = 'ready' | 'work' | 'short' | 'long' | 'finished';

export interface Run {
  ctx: ReviewCtx;
  startedAt: number;
  cfg: { work: number; short: number; long: number; every: number };
  phase: Phase;
  phaseDur: number; // ms
  phaseEnd: number; // timestamp (valable si pas en pause)
  pausedLeft: number | null; // ms restantes si en pause
  blocks: number; // blocs de travail terminés
  workMs: number; // temps de travail effectif terminé
}

const KEY = 'cadence.activeRun';

export function loadRun(): Run | null {
  try {
    const r = localStorage.getItem(KEY);
    return r ? (JSON.parse(r) as Run) : null;
  } catch {
    return null;
  }
}
function saveRun(r: Run | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible */ }
}

const cfgFrom = (s: Settings) => ({ work: s.workMin, short: s.shortBreakMin, long: s.longBreakMin, every: Math.max(1, s.blocksBeforeLong) });

function newRun(ctx: ReviewCtx, s: Settings): Run {
  return { ctx, startedAt: Date.now(), cfg: cfgFrom(s), phase: 'ready', phaseDur: 0, phaseEnd: 0, pausedLeft: null, blocks: 0, workMs: 0 };
}

const timed = (p: Phase) => p === 'work' || p === 'short' || p === 'long';

/** Fait avancer le minuteur jusqu'à `now` (gère le cas où l'app était en arrière-plan). */
function advance(r: Run, now: number): { run: Run; event: 'workEnd' | 'breakEnd' | null } {
  let run = r;
  let event: 'workEnd' | 'breakEnd' | null = null;
  while (timed(run.phase) && run.pausedLeft === null && now >= run.phaseEnd) {
    if (run.phase === 'work') {
      const blocks = run.blocks + 1;
      const long = blocks % run.cfg.every === 0;
      const dur = (long ? run.cfg.long : run.cfg.short) * 60_000;
      run = { ...run, blocks, workMs: run.workMs + run.phaseDur, phase: long ? 'long' : 'short', phaseDur: dur, phaseEnd: run.phaseEnd + dur };
      event = 'workEnd';
    } else {
      // Fin de pause : on attend que tu relances toi-même le bloc suivant
      run = { ...run, phase: 'ready' };
      event = 'breakEnd';
    }
  }
  return { run, event };
}

let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    if (!audio) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new AC();
    }
    void audio.resume();
  } catch { /* pas d'audio */ }
}
function chime(kind: 'workEnd' | 'breakEnd') {
  navigator.vibrate?.([200, 100, 200]);
  if (!audio) return;
  const notes = kind === 'workEnd' ? [784, 659, 523] : [523, 659, 784];
  notes.forEach((f, i) => {
    const o = audio!.createOscillator();
    const g = audio!.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = audio!.currentTime + i * 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(audio!.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function Review({ ctx, onMinimize, onDone }: { ctx: ReviewCtx; onMinimize: () => void; onDone: () => void }) {
  const settings = useSettings();
  const ui = useUI();
  const cat = useCategories().get(ctx.categoryId ?? '');
  const [run, setRun] = useState<Run>(() => {
    const existing = loadRun();
    return existing && existing.ctx.occKey === ctx.occKey && existing.ctx.taskId === ctx.taskId ? existing : newRun(ctx, settings);
  });
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);

  // Horloge
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => {
    const { run: next, event } = advance(run, now);
    if (event) {
      setRun(next);
      chime(event);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  useEffect(() => {
    saveRun(run);
  }, [run]);

  // Notifications push de fin de pomodoro / de pause (utiles quand l'app est en arrière-plan)
  const running = timed(run.phase) && run.pausedLeft === null;
  useEffect(() => {
    if (!settings.notifyPomodoro || !running) {
      void cancelPush('pomo-work', 'pomo-break');
      return;
    }
    const subject = ctx.title;
    if (run.phase === 'work') {
      const blocks = run.blocks + 1;
      const long = blocks % run.cfg.every === 0;
      const breakMin = long ? run.cfg.long : run.cfg.short;
      void schedulePush('pomo-work', run.phaseEnd, 'Pomodoro terminé ✓', `${subject} · ${long ? 'Grande pause' : 'Pause'} de ${breakMin} min`);
      void schedulePush('pomo-break', run.phaseEnd + breakMin * 60_000, 'Pause terminée', `Lance le pomodoro ${blocks + 1} quand tu es prêt`);
    } else {
      void cancelPush('pomo-work');
      void schedulePush('pomo-break', run.phaseEnd, 'Pause terminée', `Lance le pomodoro ${run.blocks + 1} quand tu es prêt`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.phaseEnd, running, settings.notifyPomodoro]);

  // Empêche l'écran de se mettre en veille pendant un bloc
  useEffect(() => {
    if (!timed(run.phase) || run.pausedLeft !== null) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [run.phase, run.pausedLeft]);

  const remaining = run.pausedLeft ?? Math.max(0, run.phaseEnd - now);
  const progress = timed(run.phase) && run.phaseDur ? 1 - remaining / run.phaseDur : 0;
  const currentWorkMs = run.phase === 'work' ? run.phaseDur - remaining : 0;
  const totalWorkMin = (run.workMs + currentWorkMs) / 60_000;

  const startBlock = () => {
    unlockAudio();
    const fresh = run.blocks === 0 && run.workMs === 0;
    const cfg = fresh ? cfgFrom(settings) : run.cfg;
    const dur = cfg.work * 60_000;
    const t = Date.now();
    setRun({ ...run, cfg, startedAt: fresh ? t : run.startedAt, phase: 'work', phaseDur: dur, phaseEnd: t + dur, pausedLeft: null });
  };
  const pause = () => setRun({ ...run, pausedLeft: Math.max(0, run.phaseEnd - Date.now()) });
  const resume = () => {
    unlockAudio();
    setRun({ ...run, phaseEnd: Date.now() + (run.pausedLeft ?? 0), pausedLeft: null });
  };
  const skipBreak = () => setRun({ ...run, phase: 'ready', pausedLeft: null });

  const finish = async () => {
    const extra = run.phase === 'work' ? run.phaseDur - remaining : 0;
    const workMs = run.workMs + extra;
    if (workMs < 60_000) {
      const ok = await ui.ask({
        title: 'Abandonner la séance ?',
        message: 'Moins d’une minute de travail : rien ne sera enregistré.',
        confirmLabel: 'Abandonner',
        cancelLabel: 'Continuer',
        danger: true,
      });
      if (!ok) return;
      saveRun(null);
      void cancelPush('pomo-work', 'pomo-break');
      onDone();
      return;
    }
    if (run.phase === 'work') {
      const ok = await ui.ask({
        title: 'Terminer la séance ?',
        message: 'Le pomodoro en cours sera compté au prorata du temps passé.',
        confirmLabel: 'Terminer',
        cancelLabel: 'Continuer',
      });
      if (!ok) return;
    }
    setRun({ ...run, workMs: run.workMs + (run.phase === 'work' ? run.phaseDur - (run.pausedLeft ?? Math.max(0, run.phaseEnd - Date.now())) : 0), phase: 'finished', pausedLeft: null });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const workMinutes = Math.round(run.workMs / 60_000);
    await db.sessions.add({
      id: uid(),
      taskId: ctx.taskId,
      occKey: ctx.occKey,
      categoryId: ctx.categoryId,
      title: ctx.title,
      date: todayKey(),
      startedAt: run.startedAt,
      endedAt: Date.now(),
      workMinutes,
      blocks: run.blocks,
      mastery: null,
    });
    if (ctx.taskId && ctx.occKey) await setOccStatus(ctx.taskId, ctx.date, 'done');
    saveRun(null);
    void cancelPush('pomo-work', 'pomo-break');
    ui.toast(`Séance enregistrée : ${fmtDuration(workMinutes)}`);
    onDone();
  };

  const discard = async () => {
    const ok = await ui.ask({ title: 'Supprimer cette séance ?', message: 'Elle ne comptera pas dans ton bilan.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    saveRun(null);
    void cancelPush('pomo-work', 'pomo-break');
    onDone();
  };

  // ——— Écran de fin ———
  if (run.phase === 'finished') {
    const workMinutes = Math.round(run.workMs / 60_000);
    return (
      <div className="review finished">
        <div className="review-inner">
          <p className="eyebrow">Séance terminée</p>
          <h1 className="big-num">{fmtDuration(workMinutes)}</h1>
          <p className="muted center">de travail effectif sur <strong>{ctx.title}</strong></p>

          <div className="finish-stats">
            <div><b>{run.blocks}</b><span>pomodoro{run.blocks > 1 ? 's' : ''} complet{run.blocks > 1 ? 's' : ''}</span></div>
            <div><b>{Math.max(0, Math.round((Date.now() - run.startedAt) / 60_000))}<small> min</small></b><span>durée totale, pauses comprises</span></div>
          </div>
          <div className="controls">
            <button className="btn primary big" onClick={save} disabled={saving}>Enregistrer la séance</button>
            <button className="btn danger-ghost" onClick={discard}>Ne pas enregistrer</button>
          </div>
        </div>
      </div>
    );
  }

  // ——— Minuteur ———
  const isBreak = run.phase === 'short' || run.phase === 'long';
  const nextBlock = run.blocks + 1;
  const label =
    run.phase === 'work' ? `Pomodoro ${nextBlock}`
    : run.phase === 'short' ? 'Pause courte'
    : run.phase === 'long' ? 'Grande pause'
    : run.blocks === 0 ? 'Prêt à démarrer' : `Prêt pour le pomodoro ${nextBlock}`;
  const R = 118, C = 2 * Math.PI * R;
  const fresh = run.blocks === 0 && run.workMs === 0 && run.phase === 'ready';
  const cfg = fresh ? cfgFrom(settings) : run.cfg;
  const shownTime = run.phase === 'ready' ? mmss(cfg.work * 60_000) : mmss(remaining);
  const inCycle = run.blocks % cfg.every;

  return (
    <div className={`review phase-${run.phase} ${run.pausedLeft !== null ? 'paused' : ''}`}>
      <div className="review-top">
        <button className="icon-btn" onClick={onMinimize} aria-label="Réduire"><Icon name="close" /></button>
        <div className="review-title">
          <span className="occ-tag" style={{ ['--c' as string]: cat?.color ?? 'var(--muted)' }}><i className="dot" /> {cat?.name ?? 'Révision'}</span>
          <strong>{ctx.title}</strong>
        </div>
        <span style={{ width: 40 }} />
      </div>

      <div className="review-inner">
        <p className="phase-label">{label}{run.pausedLeft !== null ? ' · en pause' : ''}</p>
        <div className="ring">
          <svg viewBox="0 0 260 260">
            <circle cx="130" cy="130" r={R} className="ring-bg" />
            <circle cx="130" cy="130" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 130 130)" />
          </svg>
          <div className="ring-text">
            <span className="time">{shownTime}</span>
            <span className="cycle">
              {Array.from({ length: cfg.every }, (_, i) => (
                <i key={i} className={i < inCycle || (inCycle === 0 && run.blocks > 0 && isBreak) ? 'on' : i === inCycle && run.phase === 'work' ? 'cur' : ''} />
              ))}
            </span>
          </div>
        </div>

        <p className="muted center small">Travail effectif : {fmtDuration(totalWorkMin)}</p>

        <div className="controls">
          {run.phase === 'ready' && (
            <button className="btn primary big" onClick={startBlock}><Icon name="play" size={18} /> {run.blocks === 0 ? 'Commencer' : `Lancer le pomodoro ${nextBlock}`} ({cfg.work} min)</button>
          )}
          {timed(run.phase) && (run.pausedLeft === null
            ? <button className="btn secondary big" onClick={pause}><Icon name="pause" size={18} /> Pause</button>
            : <button className="btn primary big" onClick={resume}><Icon name="play" size={18} /> Reprendre</button>)}
          {isBreak && <button className="btn ghost" onClick={skipBreak}><Icon name="skip" size={16} /> Passer la pause</button>}
          {(run.blocks > 0 || run.phase === 'work') && (
            <button className="btn ghost" onClick={finish}><Icon name="stop" size={16} /> Terminer la séance</button>
          )}
          {run.phase === 'ready' && run.blocks === 0 && (
            <p className="hint center">{cfg.work} min de travail, {cfg.short} min de pause, grande pause de {cfg.long} min tous les {cfg.every} pomodoros.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Bandeau affiché quand une séance tourne mais que l'écran révision est réduit */
export function ReviewBanner({ onOpen }: { onOpen: (ctx: ReviewCtx) => void }) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const r = loadRun();
  if (!r || r.phase === 'finished') return null;
  const { run } = advance(r, Date.now());
  const rem = run.pausedLeft ?? Math.max(0, run.phaseEnd - Date.now());
  const txt =
    run.phase === 'ready' ? 'en attente' : `${run.phase === 'work' ? 'travail' : 'pause'} ${mmss(rem)}${run.pausedLeft !== null ? ' (pause)' : ''}`;
  return (
    <button className={`review-banner phase-${run.phase}`} onClick={() => onOpen(run.ctx)}>
      <span className="pulse" /> <strong>{run.ctx.title}</strong> <span>· {txt}</span>
    </button>
  );
}

