import { PALETTE } from '../db';

/** Couleur des tâches sans catégorie */
export const NO_CAT_COLOR = '#7b808a';

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Distance perçue approximative entre deux couleurs (« redmean ») */
function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Deux couleurs trop proches pour être distinguées d'un coup d'œil */
const tooClose = (a: string, b: string) => distance(a, b) < 110;

function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** Palette de secours : couleurs de base puis teintes réparties (angle d'or) */
const EXTRA = Array.from({ length: 24 }, (_, i) => hsl((i * 137.508 + 20) % 360, 62, 50));
const CANDIDATES = [...PALETTE, ...EXTRA];

/** Première couleur de la palette qui ne ressemble à aucune de celles déjà prises */
export function pickDistinctColor(taken: string[]): string {
  return CANDIDATES.find((c) => taken.every((t) => !tooClose(c, t))) ?? CANDIDATES[taken.length % CANDIDATES.length];
}

/**
 * Couleurs d'affichage pour une journée : chaque tâche garde la couleur de sa
 * catégorie si personne d'autre ne l'utilise déjà ce jour-là, sinon elle reçoit
 * une autre couleur bien distincte. Résultat : jamais deux fois la même couleur dans la journée.
 */
export function dayColors<T extends { key: string; start: number }>(items: T[], baseColor: (item: T) => string): Map<string, string> {
  const out = new Map<string, string>();
  const used: string[] = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    const base = baseColor(it);
    const color = used.some((u) => tooClose(u, base)) ? pickDistinctColor(used) : base;
    used.push(color);
    out.set(it.key, color);
  }
  return out;
}
