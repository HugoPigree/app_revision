import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { endRecovery, supabase } from '../lib/sync';
function frError(msg) {
    const m = msg.toLowerCase();
    if (m.includes('invalid login credentials'))
        return 'Email ou mot de passe incorrect.';
    if (m.includes('email not confirmed'))
        return 'Confirme d’abord ton adresse avec le lien reçu par mail.';
    if (m.includes('already registered') || m.includes('already been registered'))
        return 'Un compte existe déjà avec cet email. Connecte-toi.';
    if (m.includes('password should be at least') || m.includes('at least 6'))
        return 'Le mot de passe doit faire au moins 6 caractères.';
    if (m.includes('unable to validate email') || m.includes('invalid format'))
        return 'Adresse email invalide.';
    if (m.includes('rate limit') || m.includes('too many'))
        return 'Trop de tentatives, réessaie dans quelques minutes.';
    if (m.includes('failed to fetch') || m.includes('network'))
        return 'Pas de connexion internet.';
    return msg;
}
export function AuthScreen({ onSkip, onDone, initialMode = 'signin' }) {
    const [mode, setMode] = useState(initialMode);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        if (!supabase || busy)
            return;
        setError('');
        setInfo('');
        setBusy(true);
        try {
            if (mode === 'signin') {
                const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
                if (error)
                    throw error;
                onDone?.();
            }
            else if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
                if (error)
                    throw error;
                if (data.session)
                    onDone?.();
                else {
                    setInfo('Compte créé ! Ouvre le lien reçu par mail pour le confirmer, puis connecte-toi ici.');
                    setMode('signin');
                }
            }
            else if (mode === 'reset') {
                const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
                if (error)
                    throw error;
                setInfo('Si un compte existe avec cet email, tu vas recevoir un lien pour choisir un nouveau mot de passe.');
            }
            else {
                const { error } = await supabase.auth.updateUser({ password });
                if (error)
                    throw error;
                endRecovery();
                onDone?.();
            }
        }
        catch (err) {
            setError(frError(err.message));
        }
        finally {
            setBusy(false);
        }
    };
    const titles = {
        signin: 'Connexion',
        signup: 'Créer un compte',
        reset: 'Mot de passe oublié',
        newpass: 'Nouveau mot de passe',
    };
    return (_jsx("div", { className: "auth", children: _jsxs("form", { className: "auth-card", onSubmit: submit, children: [_jsxs("div", { className: "auth-brand", children: [_jsx("img", { src: "/icons/icon-192.png", alt: "", width: 56, height: 56 }), _jsx("h1", { children: "Cadence" }), _jsx("p", { className: "muted", children: mode === 'newpass' ? 'Choisis ton nouveau mot de passe.' : 'Ton planning et tes révisions, sauvegardés sur tous tes appareils.' })] }), (mode === 'signin' || mode === 'signup') && (_jsxs("div", { className: "seg full", children: [_jsx("button", { type: "button", className: mode === 'signin' ? 'on' : '', onClick: () => { setMode('signin'); setError(''); }, children: "Connexion" }), _jsx("button", { type: "button", className: mode === 'signup' ? 'on' : '', onClick: () => { setMode('signup'); setError(''); }, children: "Cr\u00E9er un compte" })] })), (mode === 'reset' || mode === 'newpass') && _jsx("h2", { className: "auth-title", children: titles[mode] }), mode !== 'newpass' && (_jsxs("label", { className: "auth-field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", autoComplete: "email", inputMode: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value), placeholder: "toi@exemple.fr" })] })), mode !== 'reset' && (_jsxs("label", { className: "auth-field", children: [_jsx("span", { children: mode === 'newpass' ? 'Nouveau mot de passe' : 'Mot de passe' }), _jsx("input", { type: "password", required: true, minLength: 6, autoComplete: mode === 'signin' ? 'current-password' : 'new-password', value: password, onChange: (e) => setPassword(e.target.value), placeholder: mode === 'signin' ? '' : '6 caractères minimum' })] })), error && _jsx("p", { className: "error", children: error }), info && _jsx("p", { className: "auth-info", children: info }), _jsx("button", { className: "btn primary big", type: "submit", disabled: busy, children: busy ? '…' : mode === 'signin' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : mode === 'reset' ? 'Envoyer le lien' : 'Enregistrer' }), mode === 'signin' && _jsx("button", { type: "button", className: "btn ghost", onClick: () => { setMode('reset'); setError(''); setInfo(''); }, children: "Mot de passe oubli\u00E9 ?" }), mode === 'reset' && _jsx("button", { type: "button", className: "btn ghost", onClick: () => { setMode('signin'); setError(''); setInfo(''); }, children: "Retour \u00E0 la connexion" }), onSkip && mode !== 'newpass' && (_jsxs("button", { type: "button", className: "btn ghost small-link", onClick: onSkip, children: ["Continuer sans compte ", _jsx("span", { className: "muted", children: "(donn\u00E9es seulement sur cet appareil)" })] }))] }) }));
}
