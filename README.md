# Study Protocol Manager v1.0

Application web progressive (PWA) d'organisation d'étude basée sur les principes scientifiques de l'autorégulation, la chronobiologie et la récupération active.

Conçue pour aider les étudiants à structurer leurs sessions d'étude avec un contrat quotidien, un timer de concentration, des flashcards à répétition espacée (algorithme SM-2) et un dashboard chronobiologique détectant les meilleurs créneaux de travail.

Développée dans le cadre de la formation FSE Bruxelles, cette application fonctionne entièrement hors-ligne grâce à IndexedDB et un Service Worker, sans aucune dépendance serveur.

## Fonctionnalités

- **Contrat quotidien** : Planifie 3-5 tâches avec durée (25/50 min) et difficulté
- **Timer de concentration** : Chronomètre circulaire avec pause/reprise et suggestion de pause
- **Récupération active** : Résumé post-session pour renforcer la mémorisation (Dunlosky)
- **Évaluation qualité** : Note ta concentration sur 5 étoiles par session
- **Flashcards SM-2** : Création automatique depuis les résumés + répétition espacée intelligente
- **Dashboard chronobiologique** : Heatmap hebdomadaire, graphique qualité, détection de patterns
- **Questionnaire chronotype** : 5 questions pour déterminer ton profil (matinal/intermédiaire/vespéral)
- **Export/Import** : CSV (compatible Excel), JSON complet, import de sauvegarde avec fusion
- **Mode sombre** : Thème clair/sombre/auto (selon le système)
- **PWA** : Installable sur mobile, fonctionne hors-ligne
- **Données locales** : Aucun serveur, tout reste sur ton appareil (IndexedDB)

## Références scientifiques

- **Zimmerman, B.J. (2002)** — *Becoming a self-regulated learner* : principes d'autorégulation appliqués au contrat quotidien et à la limitation volontaire des tâches
- **Dunlosky, J. et al. (2013)** — *Improving students' learning with effective learning techniques* : la récupération active (practice testing) comme technique d'étude la plus efficace
- **Carskadon, M.A. et al. (1998)** — Recherches en chronobiologie sur les rythmes circadiens et leur impact sur la performance cognitive, appliquées au questionnaire chronotype

## Installation locale

```bash
git clone https://github.com/votre-utilisateur/study-protocol-manager.git
cd study-protocol-manager
```

Puis ouvrir `index.html` dans un navigateur moderne (Chrome, Firefox, Safari, Edge).

Pour le mode hors-ligne et l'installation PWA, servir via un serveur HTTPS (même local) :

```bash
# Option 1 : Python
python3 -m http.server 8000

# Option 2 : Node.js
npx serve .
```

## Déploiement GitHub Pages

```bash
# 1. Initialiser le dépôt
git init
git add .
git commit -m "Initial commit - Study Protocol Manager v1.0"

# 2. Créer le dépôt sur GitHub puis :
git branch -M main
git remote add origin https://github.com/votre-utilisateur/study-protocol-manager.git
git push -u origin main

# 3. Activer GitHub Pages :
#    → Settings → Pages → Source: Deploy from a branch → main → / (root) → Save
#    → L'app sera disponible à : https://votre-utilisateur.github.io/study-protocol-manager/
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend | HTML5, CSS3 (variables, grid, flexbox), JavaScript ES2017+ |
| Persistance | IndexedDB (4 stores) avec fallback localStorage |
| PWA | Service Worker (Cache First), manifest.json |
| Flashcards | Algorithme SM-2 (SuperMemo 2) simplifié |
| Graphiques | Canvas 2D natif (pas de dépendance) |
| Export | Blob API, CSV UTF-8 BOM, JSON structuré |

**Aucune dépendance externe** — 0 librairie, 0 framework, 0 CDN.

## Structure des fichiers

```
study-protocol-manager/
├── index.html          # Page principale (SPA)
├── style.css           # Styles (dark mode via CSS variables)
├── db.js               # Module IndexedDB (v4, SM-2)
├── dashboard.js        # Dashboard, heatmap, graphiques, patterns
├── export.js           # Export CSV/JSON, import, stats GDPR
├── app.js              # Logique principale, navigation, timer
├── sw.js               # Service Worker (v5)
├── manifest.json       # Manifest PWA
├── icons/
│   ├── icon-192.png    # Icône PWA 192x192
│   └── icon-512.png    # Icône PWA 512x512
└── README.md           # Ce fichier
```

## Données de test

Pour tester rapidement avec des données fictives, ouvrir la console du navigateur et exécuter :

```javascript
await genererDonneesTest()
```

Cela crée ~50 sessions réalistes sur 4 semaines et 5 flashcards de test.

## Checklist pré-déploiement

- [ ] Timer fonctionne correctement (pause/reprise/fin)
- [ ] Données se sauvent dans IndexedDB
- [ ] Export CSV contient toutes les colonnes
- [ ] Import JSON restaure les données
- [ ] Heatmap affiche correctement avec >10 sessions
- [ ] Flashcards mode révision SM-2 fonctionne (Difficile/Moyen/Facile)
- [ ] PWA installable sur mobile
- [ ] Mode offline fonctionne (tester après déconnexion)
- [ ] Responsive sur mobile/tablette/desktop
- [ ] Mode sombre fonctionne correctement
- [ ] Onboarding s'affiche à la première visite
- [ ] Export/Import depuis les Paramètres
- [ ] Triple confirmation pour suppression des données

## Compatibilité

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Licence

MIT License — Libre d'utilisation, modification et distribution.
