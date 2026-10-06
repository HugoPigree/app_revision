import { useEffect, useState } from 'react';
import { db, setOccStatus, useCategories, useSettings, type Settings } from '../db';
import { addDays, fmtDuration, fmtShort, todayKey } from '../lib/dates';
import { MASTERY_LABELS, nextInterval } from '../lib/spaced';
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

const WORK_TIPS = [
  'Ferme ton cours. Écris sur une feuille blanche tout ce dont tu te souviens.',
  'Fais un exercice sans regarder la correction, puis corrige-toi.',
  'Explique la notion à voix haute, comme si tu la présentais à quelqu’un.',
  'Écris 3 questions d’examen possibles et réponds-y de mémoire.',
  'Refais de tête le schéma ou la démonstration clé du chapitre.',
];
const BREAK_TIPS = [
  'Lève-toi, bouge, bois de l’eau. Évite les réseaux : ton cerveau consolide.',
  'Regarde au loin par la fenêtre quelques minutes, sans écran.',
  'Étire-toi et respire. La pause fait partie de la méthode.',
];
const LONG_BREAK_TIP = 'Grande pause : sors de ta pièce, mange un truc, marche un peu. Pas d’écran si possible.';

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
  const cat = useCategories().get(ctx.categoryId ?? -1);
  const [run, setRun] = useState<Run>(() => {
    const existing = loadRun();
    return existing && existing.ctx.occKey === ctx.occKey && existing.ctx.taskId === ctx.taskId ? existing : newRun(ctx, settings);
  });
  const [now, setNow] = useState(Date.now());
  const [mastery, setMastery] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ interval: number; date: string } | null>(null);
  const [customDate, setCustomDate] = useState<string | null>(null);

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

  const finish = () => {
    const extra = run.phase === 'work' ? run.phaseDur - remaining : 0;
    const workMs = run.workMs + extra;
    if (workMs < 60_000) {
      if (!confirm('Moins d’une minute de travail : abandonner la séance sans l’enregistrer ?')) return;
      saveRun(null);
      onDone();
      return;
    }
    if (run.phase === 'work' && !confirm('Terminer la séance maintenant ? Le bloc en cours sera compté au prorata.')) return;
    setRun({ ...run, workMs, phase: 'finished', pausedLeft: null });
  };

  const save = async (m: number | null = mastery) => {
    const workMinutes = Math.round(run.workMs / 60_000);
    await db.sessions.add({
      taskId: ctx.taskId,
      occKey: ctx.occKey,
      categoryId: ctx.categoryId,
      title: ctx.title,
      date: todayKey(),
      startedAt: run.startedAt,
      endedAt: Date.now(),
      workMinutes,
      blocks: run.blocks,
      mastery: m,
    });
    if (ctx.taskId && ctx.occKey) await setOccStatus(ctx.taskId, ctx.date, 'done');
    saveRun(null);
    if (ctx.taskId && m) {
      const interval = nextInterval(ctx.srInterval, m);
      setSaved({ interval, date: addDays(todayKey(), interval) });
    } else {
      ui.toast(`Séance enregistrée : ${fmtDuration(workMinutes)}`);
      onDone();
    }
  };

  const planNext = async (date: string, interval: number) => {
    const src = ctx.taskId ? await db.tasks.get(ctx.taskId) : undefined;
    await db.tasks.add({
      title: ctx.title,
      type: 'revision',
      categoryId: ctx.categoryId,
      startDate: date,
      startTime: src?.startTime ?? '18:00',
      durationMin: src?.durationMin ?? 60,
      recurrence: { kind: 'none' },
      endDate: null,
      notes: src?.notes ?? '',
      srInterval: interval,
      createdAt: Date.now(),
    });
    ui.toast(`Révision planifiée ${fmtShort(date)}`);
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
          <p className="muted center">de travail effectif · {run.blocks} bloc{run.blocks > 1 ? 's' : ''} complet{run.blocks > 1 ? 's' : ''}</p>

          {!saved ? (
            <>
              <h3 className="q">Sans regarder tes notes, tu maîtrises <em>{ctx.title}</em> à quel point ?</h3>
              <div className="mastery">
                {[1, 2, 3, 4, 5].map((m) => (
                  <button key={m} className={mastery === m ? 'on' : ''} onClick={() => setMastery(m)}>
                    <b>{m}</b>
                    <span>{MASTERY_LABELS[m]}</span>
                  </button>
                ))}
              </div>
              <p className="hint center">Ta note sert à planifier la prochaine révision au bon moment (répétition espacée).</p>
              <button className="btn primary big" onClick={() => save()} disabled={!mastery && !!ctx.taskId}>Enregistrer la séance</button>
              {ctx.taskId && <button className="btn ghost" onClick={() => void save(null)}>Enregistrer sans noter</button>}
            </>
          ) : (
            <div className="next-card">
              <p className="eyebrow">Prochaine révision conseillée</p>
              <h2>Dans {saved.interval} jour{saved.interval > 1 ? 's' : ''}</h2>
              <p className="muted">{capitalize(fmtShort(customDate ?? saved.date))}</p>
              <input type="date" value={customDate ?? saved.date} min={addDays(todayKey(), 1)} onChange={(e) => e.target.value && setCustomDate(e.target.value)} />
              <button className="btn primary big" onClick={() => planNext(customDate ?? saved.date, saved.interval)}>Ajouter au planning</button>
              <button className="btn ghost" onClick={() => { ui.toast('Séance enregistrée'); onDone(); }}>Pas maintenant</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ——— Minuteur ———
  const isBreak = run.phase === 'short' || run.phase === 'long';
  const nextBlock = run.blocks + 1;
  const label =
    run.phase === 'work' ? `Concentration · bloc ${nextBlock}`
    : run.phase === 'short' ? 'Pause courte'
    : run.phase === 'long' ? 'Grande pause'
    : run.blocks === 0 ? 'Prêt à démarrer' : `Prêt pour le bloc ${nextBlock}`;
  const tip =
    run.phase === 'long' ? LONG_BREAK_TIP
    : isBreak ? BREAK_TIPS[run.blocks % BREAK_TIPS.length]
    : WORK_TIPS[run.blocks % WORK_TIPS.length];
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

        <div className="tip">
          <span className="tip-label">{isBreak ? 'Pendant la pause' : 'Rappel actif'}</span>
          <p>{tip}</p>
        </div>

        <p className="muted center small">Travail effectif : {fmtDuration(totalWorkMin)}</p>

        <div className="controls">
          {run.phase === 'ready' && (
            <button className="btn primary big" onClick={startBlock}><Icon name="play" size={18} /> {run.blocks === 0 ? 'Commencer' : `Lancer le bloc ${nextBlock}`} ({cfg.work} min)</button>
          )}
          {timed(run.phase) && (run.pausedLeft === null
            ? <button className="btn secondary big" onClick={pause}><Icon name="pause" size={18} /> Pause</button>
            : <button className="btn primary big" onClick={resume}><Icon name="play" size={18} /> Reprendre</button>)}
          {isBreak && <button className="btn ghost" onClick={skipBreak}><Icon name="skip" size={16} /> Passer la pause</button>}
          {(run.blocks > 0 || run.phase === 'work') && (
            <button className="btn ghost" onClick={finish}><Icon name="stop" size={16} /> Terminer la séance</button>
          )}
          {run.phase === 'ready' && run.blocks === 0 && (
            <p className="hint center">{cfg.work} min de travail, {cfg.short} min de pause, grande pause de {cfg.long} min tous les {cfg.every} blocs.</p>
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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
