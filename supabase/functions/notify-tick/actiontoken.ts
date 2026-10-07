/**
 * Jeton signé qui autorise UNE action précise depuis une notification
 * (« marquer telle tâche de tel jour comme faite »), sans session ouverte.
 * Copie identique dans notify-tick/ et notify-action/.
 */
const enc = new TextEncoder();

export async function actionToken(secret: string, userId: string, occKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`done:${userId}:${occKey}`)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Comparaison en temps constant */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
