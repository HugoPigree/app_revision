import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from './db';
import type { Occurrence } from './lib/recurrence';
import { CalendarView } from './components/Calendar';
import { OccurrenceSheet } from './components/OccurrenceSheet';
import { loadRun, Review, ReviewBanner } from './components/Review';
import { SettingsView } from './components/SettingsView';
import { StatsView } from './components/Stats';
import { TaskEditor } from './components/TaskEditor';
import { TasksView } from './components/Tasks';
import { ConfirmDialog, Icon, UIContext, type AskOptions, type ReviewCtx, type UI } from './ui';

type Tab = 'calendar' | 'tasks' | 'stats' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Planning', icon: 'calendar' },
  { id: 'tasks', label: 'Tâches', icon: 'tasks' },
  { id: 'stats', label: 'Bilan', icon: 'stats' },
  { id: 'settings', label: 'Réglages', icon: 'settings' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [editor, setEditor] = useState<{ task?: Task; defaults?: Partial<Task>; n: number } | null>(null);
  const [occ, setOcc] = useState<Occurrence | null>(null);
  // Si une séance tournait quand l'app a été fermée, on la rouvre directement
  const [review, setReview] = useState<ReviewCtx | null>(() => loadRun()?.ctx ?? null);
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null);
  const [asking, setAsking] = useState<AskOptions | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const choose = useCallback((opts: AskOptions) => {
    resolver.current?.(null);
    setAsking(opts);
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, []);
  const ask = useCallback((opts: AskOptions) => choose(opts).then((v) => v === 'ok'), [choose]);

  const answer = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsking(null);
  }, []);

  const startReview = useCallback(async (ctx: ReviewCtx) => {
    const running = loadRun();
    if (running && running.phase !== 'finished' && (running.ctx.taskId !== ctx.taskId || running.ctx.occKey !== ctx.occKey)) {
      const ok = await ask({
        title: 'Une séance est déjà en cours',
        message: `« ${running.ctx.title} » n’est pas terminée. L’abandonner pour démarrer celle-ci ?`,
        confirmLabel: 'Abandonner et démarrer',
        cancelLabel: 'Reprendre l’autre',
        danger: true,
      });
      if (!ok) { setReview(running.ctx); return; }
      localStorage.removeItem('cadence.activeRun');
    }
    setReview(ctx);
  }, [ask]);

  const ui: UI = useMemo(() => ({
    openEditor: (task, defaults) => setEditor({ task, defaults, n: Date.now() }),
    openOccurrence: setOcc,
    startReview: (ctx) => { void startReview(ctx); },
    toast: (msg) => setToast({ msg, n: Date.now() }),
    ask,
    choose,
  }), [startReview, ask, choose]);

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        <nav className="tabbar">
          <div className="brand">
            <img src="/icons/icon-192.png" alt="" width={30} height={30} />
            <span>Cadence</span>
          </div>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} size={24} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="main-col">
          <main>
            {tab === 'calendar' && <CalendarView />}
            {tab === 'tasks' && <TasksView />}
            {tab === 'stats' && <StatsView />}
            {tab === 'settings' && <SettingsView />}
          </main>
          {!review && <ReviewBanner onOpen={setReview} />}
        </div>

        {editor && <TaskEditor key={editor.n} task={editor.task} defaults={editor.defaults} onClose={() => setEditor(null)} />}
        {occ && <OccurrenceSheet occ={occ} onClose={() => setOcc(null)} />}
        {review && (
          <Review
            key={`${review.taskId}_${review.occKey}`}
            ctx={review}
            onMinimize={() => { setReview(null); bump((x) => x + 1); }}
            onDone={() => setReview(null)}
          />
        )}
        {asking && <ConfirmDialog opts={asking} onAnswer={answer} />}
        {toast && <div className="toast" key={toast.n}>{toast.msg}</div>}
      </div>
    </UIContext.Provider>
  );
}
