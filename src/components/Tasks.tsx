import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, useCategories, type Task } from '../db';
import { fmtDuration, relativeDay, todayKey } from '../lib/dates';
import { describeRecurrence, nextOccurrence } from '../lib/recurrence';
import { Icon, useUI } from '../ui';

type Filter = 'all' | 'revision' | 'activity';

export function TasksView() {
  const ui = useUI();
  const cats = useCategories();
  const [filter, setFilter] = useState<Filter>('all');
  const [showPast, setShowPast] = useState(false);
  const data = useLiveQuery(async () => {
    const [tasks, skipped] = await Promise.all([db.tasks.toArray(), db.occStates.where('date').aboveOrEqual(todayKey()).toArray()]);
    return { tasks, skipped: new Set(skipped.map((s) => s.key)) };
  }, []);

  if (!data) return <div className="screen" />;
  const tasks = data.tasks.filter((t) => filter === 'all' || t.type === filter);
  const withNext = tasks.map((t) => ({ t, next: nextOccurrence(t, data.skipped) }));
  const recurring = withNext.filter(({ t, next }) => t.recurrence.kind !== 'none' && next).sort((a, b) => a.t.title.localeCompare(b.t.title));
  const upcoming = withNext.filter(({ t, next }) => t.recurrence.kind === 'none' && next).sort((a, b) => (a.next! < b.next! ? -1 : 1));
  const past = withNext.filter(({ next }) => !next).sort((a, b) => (a.t.startDate < b.t.startDate ? 1 : -1));

  const review = (t: Task, next: string | null) =>
    ui.startReview({
      taskId: t.id!,
      occKey: next === todayKey() ? `${t.id}_${next}` : null,
      date: todayKey(),
      title: t.title,
      categoryId: t.categoryId,
    });

  const Row = ({ t, next }: { t: Task; next: string | null }) => {
    const cat = cats.get(t.categoryId ?? '');
    return (
      <li className="task-row" style={{ ['--c' as string]: cat?.color ?? 'var(--muted)' }}>
        <button className="task-main" onClick={() => ui.openEditor(t)}>
          <i className="bar" />
          <span className="task-text">
            <strong>{t.title}</strong>
            <span className="muted small">
              {t.recurrence.kind !== 'none' ? describeRecurrence(t) : null}
              {t.recurrence.kind !== 'none' && next ? ' · ' : ''}
              {next ? `${t.recurrence.kind !== 'none' ? 'prochaine ' : ''}${relativeDay(next)} à ${t.startTime}` : `${relativeDay(t.startDate)} à ${t.startTime}`}
              {' · '}{fmtDuration(t.durationMin)}
            </span>
          </span>
        </button>
        {t.type === 'revision' && (
          <button className="round-play" onClick={() => review(t, next)} aria-label={`Réviser ${t.title}`}>
            <Icon name="play" size={16} />
          </button>
        )}
      </li>
    );
  };

  const empty = data.tasks.length === 0;

  return (
    <div className="screen tasks">
      <header className="page-head">
        <h1>Tâches</h1>
        <div className="seg">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Toutes</button>
          <button className={filter === 'revision' ? 'on' : ''} onClick={() => setFilter('revision')}>Révisions</button>
          <button className={filter === 'activity' ? 'on' : ''} onClick={() => setFilter('activity')}>Activités</button>
        </div>
      </header>
      <div className="scroll-body">
        {empty && (
          <div className="empty">
            <h3>Aucune tâche pour l’instant</h3>
            <p>Ajoute tes révisions (un chapitre = une tâche) et tes activités récurrentes : sport, cours, boulot…</p>
            <button className="btn primary" onClick={() => ui.openEditor()}><Icon name="plus" size={18} /> Créer ma première tâche</button>
          </div>
        )}
        {recurring.length > 0 && (
          <section>
            <h2 className="section-title">Récurrentes</h2>
            <ul className="task-list">{recurring.map(({ t, next }) => <Row key={t.id} t={t} next={next} />)}</ul>
          </section>
        )}
        {upcoming.length > 0 && (
          <section>
            <h2 className="section-title">À venir</h2>
            <ul className="task-list">{upcoming.map(({ t, next }) => <Row key={t.id} t={t} next={next} />)}</ul>
          </section>
        )}
        {past.length > 0 && (
          <section>
            <button className="section-title as-btn" onClick={() => setShowPast(!showPast)}>
              Passées ({past.length}) <Icon name={showPast ? 'left' : 'right'} size={14} />
            </button>
            {showPast && <ul className="task-list past">{past.map(({ t, next }) => <Row key={t.id} t={t} next={next} />)}</ul>}
          </section>
        )}
        {!empty && tasks.length === 0 && <p className="muted center">Rien dans ce filtre.</p>}
      </div>
      <button className="fab" onClick={() => ui.openEditor(undefined, filter === 'activity' ? { type: 'activity' } : undefined)} aria-label="Nouvelle tâche">
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}
