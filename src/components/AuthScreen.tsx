import { useState } from 'react';
import { endRecovery, supabase } from '../lib/sync';

type Mode = 'signin' | 'signup' | 'reset' | 'newpass';

function frError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return 'Confirme d’abord ton adresse avec le lien reçu par mail.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Un compte existe déjà avec cet email. Connecte-toi.';
  if (m.includes('password should be at least') || m.includes('at least 6')) return 'Le mot de passe doit faire au moins 6 caractères.';
  if (m.includes('unable to validate email') || m.includes('invalid format')) return 'Adresse email invalide.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives, réessaie dans quelques minutes.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Pas de connexion internet.';
  return msg;
}

export function AuthScreen({ onSkip, onDone, initialMode = 'signin' }: { onSkip?: () => void; onDone?: () => void; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || busy) return;
    setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onDone?.();
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (data.session) onDone?.();
        else { setInfo('Compte créé ! Ouvre le lien reçu par mail pour le confirmer, puis connecte-toi ici.'); setMode('signin'); }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo('Si un compte existe avec cet email, tu vas recevoir un lien pour choisir un nouveau mot de passe.');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        endRecovery();
        onDone?.();
      }
    } catch (err) {
      setError(frError((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    signin: 'Connexion',
    signup: 'Créer un compte',
    reset: 'Mot de passe oublié',
    newpass: 'Nouveau mot de passe',
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src="/icons/icon-192.png" alt="" width={56} height={56} />
          <h1>Cadence</h1>
          <p className="muted">{mode === 'newpass' ? 'Choisis ton nouveau mot de passe.' : 'Ton planning et tes révisions, sauvegardés sur tous tes appareils.'}</p>
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <div className="seg full">
            <button type="button" className={mode === 'signin' ? 'on' : ''} onClick={() => { setMode('signin'); setError(''); }}>Connexion</button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setError(''); }}>Créer un compte</button>
          </div>
        )}
        {(mode === 'reset' || mode === 'newpass') && <h2 className="auth-title">{titles[mode]}</h2>}

        {mode !== 'newpass' && (
          <label className="auth-field">
            <span>Email</span>
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.fr" />
          </label>
        )}
        {mode !== 'reset' && (
          <label className="auth-field">
            <span>{mode === 'newpass' ? 'Nouveau mot de passe' : 'Mot de passe'}</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signin' ? '' : '6 caractères minimum'}
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {info && <p className="auth-info">{info}</p>}

        <button className="btn primary big" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : mode === 'reset' ? 'Envoyer le lien' : 'Enregistrer'}
        </button>

        {mode === 'signin' && <button type="button" className="btn ghost" onClick={() => { setMode('reset'); setError(''); setInfo(''); }}>Mot de passe oublié ?</button>}
        {mode === 'reset' && <button type="button" className="btn ghost" onClick={() => { setMode('signin'); setError(''); setInfo(''); }}>Retour à la connexion</button>}
        {onSkip && mode !== 'newpass' && (
          <button type="button" className="btn ghost small-link" onClick={onSkip}>
            Continuer sans compte <span className="muted">(données seulement sur cet appareil)</span>
          </button>
        )}
      </form>
    </div>
  );
}
