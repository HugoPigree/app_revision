import { db, deleteType, uid, type TypeDef } from '../db';
import type { UI } from '../ui';

/** Crée une grande catégorie (révision, projet, activité…) et renvoie son id */
export async function createType(types: TypeDef[], name: string, pomodoro = false): Promise<string> {
  const order = Math.max(-1, ...types.map((t) => t.order)) + 1;
  const id = uid();
  await db.types.add({ id, name: name.trim() || 'Sans nom', pomodoro, order });
  return id;
}

/**
 * Supprime une grande catégorie tout de suite, avec « Annuler » dans le message.
 * Ses tâches et catégories passent dans un type qui fonctionne pareil (avec ou sans Pomodoro).
 * Renvoie l'id du type qui les a récupérées (ou null si impossible).
 */
export async function removeTypeWithUndo(ui: UI, types: TypeDef[], id: string, onUndo?: () => void): Promise<string | null> {
  const ty = types.find((t) => t.id === id);
  const target = types.find((t) => t.id !== id && t.pomodoro === ty?.pomodoro) ?? types.find((t) => t.id !== id);
  if (!ty || !target) return null;
  const { moved, undo } = await deleteType(id, target.id);
  ui.toast(
    moved ? `« ${ty.name} » supprimée · ${moved} tâche${moved > 1 ? 's' : ''} → ${target.name}` : `« ${ty.name} » supprimée`,
    { label: 'Annuler', run: () => { void undo(); onUndo?.(); } },
  );
  return target.id;
}
