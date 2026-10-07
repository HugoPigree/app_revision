import { useEffect, useState } from 'react';
import { db, useSettings, type Settings } from '../db';
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from '../lib/push';
import { useSync } from '../lib/sync';
import { useUI } from '../ui';

const BEFORE_OPTIONS: { v: number | null; label: string }[] = [
  { v: null, label: 'Désactivé' },
  { v: 0, label: 'À l’heure' },
  { v: 5, label: '5 min avant' },
  { v: 10, label: '10 min avant' },
  { v: 15, label: '15 min avant' },
  { v: 30, label: '30 min avant' },
  { v: 60, label: '1 h avant' },
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track"><span /></span>
    </label>
  );
}

export function NotificationsCard() {
  const s = useSettings();
  const sync = useSync();
  const ui = useUI();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'));
  }, [sync.session?.user.id]);

  const update = (patch: Partial<Settings>) => db.settings.put({ ...s, ...patch });

  const turnOn = async () => {
    setBusy(true);
    try {
      const st = await enablePush();
      setState(st);
      if (st === 'on') {
        await sendTestPush();
        ui.toast('Notifications activées : une notif de test arrive dans moins d’une minute');
      } else if (st === 'denied') {
        ui.toast('Notifications refusées');
      }
    } catch (e) {
      console.warn(e);
      ui.toast('Impossible d’activer les notifications');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    await disablePush().catch(() => {});
    setState('off');
    setBusy(false);
    ui.toast('Notifications désactivées sur cet appareil');
  };

  return (
    <section className="card notifs">
      <h2 className="section-title">Notifications</h2>

      {state === 'ios-install' && (
        <p className="notice">Sur iPhone, les notifications ne marchent que dans l’app installée : dans Safari, touche <b>Partager</b> puis <b>Sur l’écran d’accueil</b>, et ouvre Cadence depuis l’icône.</p>
      )}
      {state === 'unsupported' && <p className="notice">Ce navigateur ne gère pas les notifications push.</p>}
      {state === 'signed-out' && <p className="notice">Connecte-toi à ton compte pour recevoir des notifications (c’est le serveur qui les envoie, même app fermée).</p>}
      {state === 'denied' && (
        <p className="notice">Les notifications sont bloquées. Réactive-les dans les réglages du téléphone (iPhone : <b>Réglages → Notifications → Cadence</b>), puis reviens ici.</p>
      )}

      {(state === 'off' || state === 'on') && (
        <div className="notif-device">
          <div>
            <strong>Sur cet appareil</strong>
            <span className="muted small">{state === 'on' ? 'Activées' : 'Désactivées'}</span>
          </div>
          {state === 'on' ? (
            <div className="notif-actions">
              <button className="btn ghost" onClick={async () => { await sendTestPush(); ui.toast('Notif de test envoyée : elle arrive dans moins d’une minute'); }}>Tester</button>
              <button className="btn secondary" onClick={turnOff} disabled={busy}>Désactiver</button>
            </div>
          ) : (
            <button className="btn primary" onClick={turnOn} disabled={busy}>{busy ? '…' : 'Activer'}</button>
          )}
        </div>
      )}

      <div className={`notif-prefs ${state === 'on' ? '' : 'dim'}`}>
        <div className="notif-row">
          <span>Rappel avant une tâche</span>
          <select
            className="cat-move"
            value={s.notifyBefore === null ? 'off' : String(s.notifyBefore)}
            onChange={(e) => update({ notifyBefore: e.target.value === 'off' ? null : Number(e.target.value) })}
          >
            {BEFORE_OPTIONS.map((o) => <option key={String(o.v)} value={o.v === null ? 'off' : String(o.v)}>{o.label}</option>)}
          </select>
        </div>
        <div className="notif-row">
          <span>Fin de pomodoro et de pause</span>
          <Switch checked={s.notifyPomodoro} onChange={(v) => update({ notifyPomodoro: v })} label="Fin de pomodoro et de pause" />
        </div>
        <div className="notif-row">
          <span>Récap du matin</span>
          <div className="notif-time">
            {s.notifyMorning && <input type="time" value={s.notifyMorning} onChange={(e) => e.target.value && update({ notifyMorning: e.target.value })} />}
            <Switch checked={!!s.notifyMorning} onChange={(v) => update({ notifyMorning: v ? '08:00' : null })} label="Récap du matin" />
          </div>
        </div>
        <div className="notif-row">
          <span>Tâches pas cochées le soir</span>
          <div className="notif-time">
            {s.notifyEvening && <input type="time" value={s.notifyEvening} onChange={(e) => e.target.value && update({ notifyEvening: e.target.value })} />}
            <Switch checked={!!s.notifyEvening} onChange={(v) => update({ notifyEvening: v ? '21:00' : null })} label="Tâches pas cochées le soir" />
          </div>
        </div>
        <p className="muted small">Ces réglages valent pour tous tes appareils. Les notifs arrivent même quand l’app est fermée (à la minute près).</p>
      </div>
    </section>
  );
}
