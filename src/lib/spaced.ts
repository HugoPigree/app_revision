/**
 * Répétition espacée simplifiée (inspirée de SM-2) :
 * plus la maîtrise est bonne, plus l'intervalle avant la prochaine révision s'allonge.
 */
export const MASTERY_LABELS = ['', 'Rien retenu', 'Flou', 'Moyen', 'Bien', 'Parfait'];

export function nextInterval(prev: number | undefined, mastery: number): number {
  const p = prev && prev > 0 ? prev : 1;
  let n: number;
  switch (mastery) {
    case 1: n = 1; break;
    case 2: n = 2; break;
    case 3: n = Math.max(3, Math.round(p * 1.5)); break;
    case 4: n = Math.max(4, Math.round(p * 2.5)); break;
    default: n = Math.max(7, Math.round(p * 3));
  }
  return Math.min(n, 60);
}
