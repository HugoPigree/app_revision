// Bouton « ✓ Fait » d'une notification de fin de tâche : coche la tâche sans ouvrir l'app.
// Appelée par le service worker, authentifiée par un jeton signé propre à la tâche.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { actionToken, sameToken } from './actiontoken.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply(405, { ok: false });
  try {
    const { u, k, t } = (await req.json()) as { u?: unknown; k?: unknown; t?: unknown };
    if (typeof u !== 'string' || typeof k !== 'string' || typeof t !== 'string' || k.length > 200) return reply(400, { ok: false });
    const m = /^(.+)_(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!m) return reply(400, { ok: false });

    const { data: cfg } = await supabase.from('cadence_config').select('value').eq('key', 'cron_secret').single();
    if (!cfg?.value || !sameToken(t, await actionToken(cfg.value, u, k))) return reply(401, { ok: false });

    // Si la tâche a été retirée / déplacée entre-temps, on n'y touche pas
    const { data: cur } = await supabase.from('cadence_records').select('data,deleted').eq('user_id', u).eq('tbl', 'occStates').eq('id', k).maybeSingle();
    if (cur && !cur.deleted && (cur.data as { status?: string } | null)?.status === 'skipped') return reply(200, { ok: true, skipped: true });

    const { error } = await supabase.from('cadence_records').upsert(
      { user_id: u, tbl: 'occStates', id: k, data: { key: k, taskId: m[1], date: m[2], status: 'done' }, deleted: false },
      { onConflict: 'user_id,tbl,id' },
    );
    if (error) throw error;
    return reply(200, { ok: true });
  } catch (e) {
    console.error('notify-action', e);
    return reply(500, { ok: false });
  }
});
