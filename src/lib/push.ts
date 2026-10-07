import { getSyncState, supabase } from './sync';

/** Clé publique VAPID du serveur (publique par nature, la clé privée reste dans Supabase) */
const VAPID_PUBLIC_KEY = 'BOyD9yL_C1pmwXVMf7NKhAIN6wT_I-QxV909rCnqaAJNoXFzO8QmsrcuoODpRni--YL7ZORehRLj5-cXlImkQvw';

const LOCAL_FLAG = 'cadence.pushEnabled';

export type PushState =
  | 'unsupported' // navigateur sans notifications push
  | 'ios-install' // iPhone : il faut ouvrir l'app depuis l'écran d'accueil
  | 'signed-out' // il faut un compte (le serveur doit savoir à qui envoyer)
  | 'denied' // refusé dans les réglages du téléphone
  | 'off'
  | 'on';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (!supabase || !getSyncState().session) return 'signed-out';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && localStorage.getItem(LOCAL_FLAG) === '1' ? 'on' : 'off';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}
const toB64url = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';

async function saveSubscription(sub: PushSubscription) {
  if (!supabase) return;
  const { error } = await supabase.from('cadence_push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      p256dh: toB64url(sub.getKey('p256dh')),
      auth: toB64url(sub.getKey('auth')),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
}

/** À appeler depuis un geste (bouton) : demande l'autorisation et abonne cet appareil. */
export async function enablePush(): Promise<PushState> {
  const state = await getPushState();
  if (state === 'unsupported' || state === 'ios-install' || state === 'signed-out') return state;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  }
  await saveSubscription(sub);
  localStorage.setItem(LOCAL_FLAG, '1');
  return 'on';
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(LOCAL_FLAG);
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.from('cadence_push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }
}

/** Au démarrage : si les notifs sont actives, on renvoie l'abonnement (il peut changer) et le fuseau horaire. */
export async function refreshPushSubscription(): Promise<void> {
  try {
    if (localStorage.getItem(LOCAL_FLAG) !== '1' || !pushSupported() || Notification.permission !== 'granted') return;
    if (!supabase || !getSyncState().session) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    await saveSubscription(sub);
  } catch (e) {
    console.warn('Abonnement push', e);
  }
}

// ——— Notifications à heure précise (pomodoro, test) ———

type Kind = 'pomo-work' | 'pomo-break' | 'test';

const canSchedule = () => !!supabase && !!getSyncState().session && localStorage.getItem(LOCAL_FLAG) === '1' && navigator.onLine;

export async function schedulePush(kind: Kind, at: number, title: string, body = ''): Promise<void> {
  if (!canSchedule()) return;
  const { error } = await supabase!.from('cadence_scheduled_pushes').upsert(
    { user_id: getSyncState().session!.user.id, kind, send_at: new Date(at).toISOString(), title, body },
    { onConflict: 'user_id,kind' },
  );
  if (error) console.warn('Notif planifiée', error.message);
}

export async function cancelPush(...kinds: Kind[]): Promise<void> {
  if (!supabase || !getSyncState().session || localStorage.getItem(LOCAL_FLAG) !== '1') return;
  const { error } = await supabase.from('cadence_scheduled_pushes').delete().in('kind', kinds);
  if (error) console.warn('Annulation notif', error.message);
}

export async function sendTestPush(): Promise<void> {
  await schedulePush('test', Date.now(), 'Notifications activées ✓', 'Tu recevras tes rappels Cadence ici.');
}
