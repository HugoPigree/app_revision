# Cadence — planning & révisions (v1)

App perso pour organiser tes journées, tes révisions et tes activités récurrentes. Pensée d'abord pour le téléphone, avec une mise en page dédiée sur ordinateur (barre latérale, calendrier large).

En ligne : https://cadence-eosin-chi.vercel.app (déployée automatiquement par Vercel à chaque push sur `main`).
PWA hors ligne : une fois installée sur l'iPhone, elle s'ouvre comme une vraie app, avec son icône, même en mode avion.

## Ce que fait la v1

- **Planning** : vue semaine (par défaut) et vue jour. Tap sur un créneau vide → nouvelle tâche à cette heure. Glisser-déposer pour déplacer une tâche (à la souris, ou appui long au doigt ; dépose sur un jour du bandeau du haut pour changer de jour en gardant l'heure).
- **Tâches** : ponctuelles ou récurrentes (jours fixes, toutes les X semaines, ou tous les X jours, avec date de fin optionnelle). Trois types : *Révision* (mode Pomodoro), *Projet* (travail scolaire à rendre, coché quand c'est fait) et *Activité* ; chaque type a ses propres catégories en couleur.
- **Mode révision (Pomodoro)** : pomodoros de travail + pauses (25/5 par défaut, grande pause tous les 4 pomodoros, réglable). Le pomodoro suivant ne démarre que quand tu le relances, donc seul le vrai temps de travail est compté. L'écran reste allumé pendant un pomodoro et la séance survit si tu fermes l'app.
- **Bilan** : temps de révision par semaine/mois (avec comparaison), par jour, par catégorie, par sujet, taux de révisions faites.
- **Réglages** : durées des blocs, plage horaire du calendrier, catégories, export/import d'une sauvegarde JSON.

**Comptes et sauvegarde** : connexion par email + mot de passe (Supabase). Tout est d'abord enregistré sur l'appareil (l'app marche hors ligne), puis synchronisé avec ton compte dès qu'il y a du réseau : tu retrouves les mêmes données sur ton téléphone et ton PC. On peut aussi continuer sans compte (données seulement sur l'appareil).

### Comment marche la synchro
- Base locale IndexedDB (Dexie) ; chaque modification locale est marquée « en attente ».
- Push : envoi de l'état actuel de chaque enregistrement en attente (ou de sa suppression) vers la table `cadence_records`.
- Pull : récupération de ce qui a changé côté serveur depuis la dernière synchro (horodatage posé par le serveur).
- Déclencheurs : après une modification (1,5 s), au retour du réseau, quand l'app repasse au premier plan, et toutes les minutes.
- Sécurité : règles RLS Supabase, chaque compte ne lit et n'écrit que ses propres lignes. La clé utilisée dans l'app est la clé publique (publishable).

Variables d'environnement (déjà réglées sur Vercel) : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Sans elles, l'app fonctionne en mode 100 % local.

## Mettre l'app sur ton iPhone

Il faut l'héberger une fois en **HTTPS** (obligatoire pour le mode hors ligne). Le dossier `dist/` est déjà compilé.

**Option rapide — Netlify Drop**
1. Va sur https://app.netlify.com/drop depuis ton ordi.
2. Glisse le dossier `dist/` dans la page, puis crée un compte gratuit pour garder le site en ligne.
3. Ouvre l'URL obtenue dans **Safari** sur l'iPhone → bouton Partager → **Sur l'écran d'accueil**.
4. Ouvre l'app une première fois avec du réseau : ensuite elle fonctionne hors ligne.

**Option dev — Vercel / GitHub**
Pousse le projet sur GitHub et importe-le dans Vercel ou Netlify (build : `npm run build`, dossier : `dist`). Chaque push redéploie, et l'app se met à jour toute seule au prochain lancement.

> Les données sont liées à l'URL : si tu changes d'hébergement, exporte ta sauvegarde avant et réimporte-la après.

## Développer

```bash
npm install
npm run dev      # serveur de dev, accessible sur le réseau local
npm run build    # compile dans dist/
npm run preview  # teste la version compilée
```

Stack : Vite + React 18 + TypeScript, Dexie (IndexedDB), Supabase (comptes + sauvegarde), vite-plugin-pwa (service worker + manifest).

```
src/
  db.ts                    modèle de données (catégories, tâches, occurrences, séances, réglages)
  lib/recurrence.ts        calcul des répétitions et statuts (fait / pas fait / à venir)
  lib/backup.ts            export / import JSON
  lib/sync.ts              comptes Supabase + synchro hors ligne d'abord
  components/AuthScreen.tsx connexion / création de compte / mot de passe oublié
  components/Calendar.tsx  vues semaine et jour
  components/TaskEditor.tsx
  components/OccurrenceSheet.tsx
  components/Review.tsx    mode révision Pomodoro (minuteur, fin de séance)
  components/Tasks.tsx
  components/Stats.tsx     bilan
  components/SettingsView.tsx
```

## Limites connues

- Pas de notifications : une PWA hors ligne ne peut pas envoyer de rappels fiables sur iPhone. Le son de fin de bloc ne joue que si l'app est ouverte.
- Modifier une tâche récurrente depuis sa fiche change toutes ses répétitions. Pour un seul jour, fais-la glisser dans le planning et choisis « Ce jour seulement ».
- En cas de modification du même élément sur deux appareils hors ligne, c'est la dernière envoyée qui gagne.
