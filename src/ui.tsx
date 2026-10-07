import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Task } from './db';
import type { Occurrence } from './lib/recurrence';

export interface ReviewCtx {
  taskId: string | null;
  occKey: string | null;
  date: string;
  title: string;
  categoryId: string | null;
}

export interface AskOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string | null; // null = pas de bouton Annuler (simple info)
  danger?: boolean;
  /** Plusieurs choix (empilés) au lieu de OK / Annuler */
  choices?: { value: string; label: string; primary?: boolean; danger?: boolean }[];
}

export interface UI {
  openEditor: (task?: Task, defaults?: Partial<Task>) => void;
  openOccurrence: (occ: Occurrence) => void;
  startReview: (ctx: ReviewCtx) => void;
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
  /** Confirmation intégrée à l'app (remplace window.confirm, peu fiable dans une web app installée) */
  ask: (opts: AskOptions) => Promise<boolean>;
  /** Ouvre l'écran de connexion / création de compte */
  openAuth: () => void;
  /** Comme ask, avec plusieurs choix : renvoie la valeur choisie, ou null si annulé */
  choose: (opts: AskOptions) => Promise<string | null>;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}
export const DESKTOP = '(min-width: 900px)';

export const UIContext = createContext<UI | null>(null);
export const useUI = () => useContext(UIContext)!;

export function ConfirmDialog({ opts, onAnswer }: { opts: AskOptions; onAnswer: (value: string | null) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer(null);
      if (e.key === 'Enter' && !opts.choices) onAnswer('ok');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer, opts.choices]);
  return (
    <div className="confirm-backdrop" onClick={() => onAnswer(null)}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title">{opts.title}</h3>
        {opts.message && <p>{opts.message}</p>}
        {opts.choices ? (
          <div className="confirm-choices">
            {opts.choices.map((c) => (
              <button key={c.value} className={`btn ${c.danger ? 'danger' : c.primary ? 'primary' : 'secondary'}`} onClick={() => onAnswer(c.value)}>
                {c.label}
              </button>
            ))}
            <button className="btn ghost" onClick={() => onAnswer(null)}>{opts.cancelLabel ?? 'Annuler'}</button>
          </div>
        ) : (
          <div className="confirm-actions">
            {opts.cancelLabel !== null && (
              <button className="btn secondary" onClick={() => onAnswer(null)}>{opts.cancelLabel ?? 'Annuler'}</button>
            )}
            <button className={`btn ${opts.danger ? 'danger' : 'primary'}`} onClick={() => onAnswer('ok')} autoFocus>
              {opts.confirmLabel ?? 'OK'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={close} aria-label="Fermer">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const PATHS: Record<string, string> = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  play: 'M7 5v14l11-7L7 5Z',
  pause: 'M8 5v14M16 5v14',
  check: 'M5 12.5l4.5 4.5L19 7',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  skip: 'M6 5l9 7-9 7V5ZM18 5v14',
  stop: 'M6 6h12v12H6z',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * Champ texte qui garde sa propre valeur pendant la saisie et enregistre
 * un peu après (et à la sortie du champ). Évite de perdre des lettres quand
 * la valeur vient de la base locale (mise à jour asynchrone).
 */
export function LiveInput({ value, onSave, fallback, ...rest }: {
  value: string;
  onSave: (v: string) => void;
  fallback?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { if (!focused.current) setLocal(value); }, [value]);
  const commit = (v: string) => {
    clearTimeout(timer.current);
    const out = v.trim() || fallback;
    if (out !== undefined && out !== value) onSave(out);
  };
  return (
    <input
      {...rest}
      value={local}
      onFocus={(e) => { focused.current = true; rest.onFocus?.(e); }}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        clearTimeout(timer.current);
        if (v.trim()) timer.current = window.setTimeout(() => onSave(v.trim()), 400);
      }}
      onBlur={(e) => {
        focused.current = false;
        commit(local);
        if (!local.trim() && fallback) setLocal(fallback);
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); rest.onKeyDown?.(e); }}
    />
  );
}
