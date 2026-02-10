# Study Protocol Manager

Progressive Web App pour aider des élèves francophones (15-18 ans) à organiser leur travail scolaire via un contrat quotidien et un timer de concentration.

## Fonctionnalités

- **Contrat du jour** : définir 3 à 5 tâches avec nom, matière, durée (25 ou 50 min) et difficulté
- **Timer de session** : compte à rebours avec progression circulaire, pause, son de fin
- **Suggestion de pause** : 5 min après 25 min, 10 min après 50 min
- **Mode hors-ligne** : fonctionne sans connexion après la première visite (Service Worker)
- **Persistance** : le contrat du jour est sauvegardé dans le navigateur (localStorage)

## Structure du projet

```
index.html       — Page principale
style.css        — Styles (palette apaisante, mobile-first)
app.js           — Logique applicative (vanilla JS)
manifest.json    — Manifeste PWA
sw.js            — Service Worker pour le mode offline
icons/           — Icônes PWA (192x192 et 512x512)
```

## Déploiement sur GitHub Pages

1. Pousser ce dépôt sur GitHub
2. Aller dans **Settings → Pages**
3. Sous **Source**, sélectionner la branche `main` (ou `master`) et le dossier `/ (root)`
4. Cliquer sur **Save**
5. L'application sera disponible à `https://<username>.github.io/<repo-name>/`

## Déploiement alternatif

Le projet est composé de fichiers statiques uniquement. Il peut être hébergé sur :
- **Netlify** : glisser-déposer le dossier dans l'interface Netlify Drop
- **Vercel** : `npx vercel` depuis le dossier du projet
- **Serveur local** : `python3 -m http.server 8000` puis ouvrir `http://localhost:8000`

## Compatibilité

- Chrome / Edge (desktop et mobile)
- Firefox (desktop et mobile)
- Safari (iOS et macOS)
