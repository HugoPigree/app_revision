// Fonction appelée chaque minute par une tâche planifiée (pg_cron) :
// envoie les rappels, récaps et fins de pomodoro par Web Push.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeNotifications, type NotifSettings, type OccState, type Task } from './logic.ts';
import { sendPush, type PushSubscription, type Vapid } from './webpush.ts';
import { actionToken } from './actiontoken.ts';

const ACTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-action`;

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

interface SubRow extends PushSubscription { user_id: string; tz: string }

async function config(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('cadence_config').select('key,value');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

async function sendToUser(subs: SubRow[], message: Record<string, unknown>, vapid: Vapid, stats: { sent: number; failed: number; removed: number }) {
  let delivered = false;
  for (const sub of subs) {
    try {
      const r = await sendPush(sub, message, vapid);
      if (r.ok) { stats.sent++; delivered = true; continue; }
      if (r.gone) {
        stats.removed++;
        await supabase.from('cadence_push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        stats.failed++;
        console.warn('Push refusé', r.status, r.text);
      }
    } catch (e) {
      stats.failed++;
      console.warn('Push en erreur', String(e));
    }
  }
  return delivered;
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const cfg = await config();
    if (!cfg.cron_secret || req.headers.get('x-cron-secret') !== cfg.cron_secret) {
      return new Response('Non autorisé', { status: 401 });
    }
    const vapid: Vapid = { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private, subject: cfg.vapid_subject };
    const now = new Date();
    const stats = { users: 0, sent: 0, failed: 0, removed: 0, scheduled: 0 };

    const { data: subRows, error: subErr } = await supabase.from('cadence_push_subscriptions').select('endpoint,p256dh,auth,user_id,tz');
    if (subErr) throw subErr;
    const byUser = new Map<string, SubRow[]>();
    for (const s of (subRows ?? []) as SubRow[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

    // 1. Notifications à heure précise (fin de pomodoro / de pause, test)
    const { data: due } = await supabase
      .from('cadence_scheduled_pushes')
      .select('user_id,kind,send_at,title,body')
      .lte('send_at', now.toISOString());
    for (const d of due ?? []) {
      const fresh = now.getTime() - new Date(d.send_at).getTime() < 15 * 60_000; // on ne réveille pas pour une vieille alerte
      const subs = byUser.get(d.user_id) ?? [];
      if (fresh && subs.length) {
        stats.scheduled++;
        await sendToUser(subs, { title: d.title, body: d.body, tag: d.kind.startsWith('pomo') ? 'pomodoro' : d.kind, url: '/' }, vapid, stats);
      }
      await supabase.from('cadence_scheduled_pushes').delete().eq('user_id', d.user_id).eq('kind', d.kind).eq('send_at', d.send_at);
    }

    // 2. Rappels, récap du matin, tâches non faites le soir
    for (const [userId, subs] of byUser) {
      stats.users++;
      const { data: rows, error } = await supabase
        .from('cadence_records')
        .select('tbl,id,data')
        .eq('user_id', userId)
        .eq('deleted', false)
        .in('tbl', ['tasks', 'occStates', 'settings']);
      if (error) { console.warn('Lecture des données', userId, error.message); continue; }
      const tasks = rows.filter((r) => r.tbl === 'tasks' && r.data).map((r) => r.data as Task);
      const states = rows.filter((r) => r.tbl === 'occStates' && r.data).map((r) => r.data as OccState);
      const settings = (rows.find((r) => r.tbl === 'settings' && r.id === 'main')?.data ?? null) as NotifSettings | null;

      const since = new Date(now.getTime() - 3 * 86400_000).toISOString();
      const { data: sentRows } = await supabase.from('cadence_sent_notifications').select('key').eq('user_id', userId).gte('sent_at', since);
      const sent = new Set((sentRows ?? []).map((r) => r.key));

      const notifs = computeNotifications({ tasks, states, settings, now, tz: subs[0].tz || 'Europe/Paris', sent });
      for (const n of notifs) {
        // On note d'abord l'envoi : si deux appels se chevauchent, un seul gagne
        const { error: insErr } = await supabase.from('cadence_sent_notifications').insert({ user_id: userId, key: n.key });
        if (insErr) continue;
        const msg: Record<string, unknown> = { title: n.title, body: n.body, tag: n.tag, url: n.url ?? '/' };
        if (n.occKey) {
          // Fin de tâche : boutons « ✓ Fait » (coche sans ouvrir l'app) et « Décaler » (ouvre l'app)
          msg.actions = [{ action: 'done', title: '✓ Fait' }, { action: 'postpone', title: 'Décaler' }];
          msg.act = { api: ACTION_URL, u: userId, k: n.occKey, t: await actionToken(cfg.cron_secret, userId, n.occKey) };
        }
        await sendToUser(subs, msg, vapid, stats);
      }
    }

    // Ménage du journal (plus de 4 jours)
    await supabase.from('cadence_sent_notifications').delete().lt('sent_at', new Date(now.getTime() - 4 * 86400_000).toISOString());

    return Response.json({ ok: true, ms: Date.now() - started, ...stats });
  } catch (e) {
    console.error('notify-tick', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
