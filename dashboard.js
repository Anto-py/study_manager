// ============================================================
// Study Protocol Manager — Module Dashboard (étape 4)
// Dashboard chronobiologique : heatmap, graphique qualité,
// statistiques, détection de patterns, export PNG.
//
// Ce module est exposé globalement via window.StudyDashboard.
// Il dépend de window.StudyDB pour l'accès aux données.
//
// ALGORITHME DE DÉTECTION DE PATTERNS :
// ──────────────────────────────────────
// 1. Récupérer toutes les sessions des 3 dernières semaines
// 2. Regrouper par tranche horaire (blocs de 1h : 6h, 7h, … 22h)
// 3. Pour chaque tranche :
//    a. Compter le nombre de sessions
//    b. Calculer la qualité moyenne (si qualityRating renseigné)
// 4. Identifier :
//    - "Tranche la plus active" : tranche avec le plus de sessions
//    - "Meilleure qualité" : tranche avec qualité moyenne la plus haute
//      (seulement si >= 5 sessions dans cette tranche pour fiabilité)
// 5. Regrouper par jour de la semaine pour identifier les jours préférés
// 6. Générer des messages en langage naturel pour l'utilisateur
// ============================================================

const StudyDashboard = (function () {
  'use strict';

  // ---- Constantes ----
  const JOURS_SEMAINE = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const HEURE_DEBUT = 6;   // heatmap commence à 6h
  const HEURE_FIN = 23;    // heatmap finit à 23h (inclus)
  const NB_TRANCHES = HEURE_FIN - HEURE_DEBUT; // 17 tranches d'1 heure

  // Couleurs du dégradé heatmap (blanc → vert foncé)
  const HEATMAP_COLORS = [
    '#eef2f5', // 0 session  (gris très clair)
    '#c6e6d4', // 1 session  (vert très clair)
    '#7cc9a0', // 2 sessions (vert moyen)
    '#3a9d6e', // 3+ sessions (vert foncé)
  ];

  // Couleur du graphique qualité
  const CHART_LINE_COLOR = '#4a7c8a';
  const CHART_POINT_COLOR = '#5b9279';
  const CHART_GRID_COLOR = '#d2dce6';

  // ---- Cache des statistiques ----
  // Évite de recalculer à chaque render. Invalidé quand de nouvelles données arrivent.
  let _cache = {
    lastSessionCount: -1, // nombre de sessions au dernier calcul
    stats: null,          // statistiques mensuelles
    heatmapData: null,    // données de la heatmap pour la semaine courante
    heatmapWeekOffset: 0, // décalage de semaine (0 = actuelle)
    qualityData: null,    // données du graphique qualité
    patterns: null,       // patterns détectés
    allSessions: null     // toutes les sessions (cache brut)
  };

  // ---- Référence au tooltip DOM ----
  let _tooltipEl = null;

  // ==================================================================
  // FONCTIONS UTILITAIRES
  // ==================================================================

  /**
   * Retourne le lundi (début) de la semaine contenant la date donnée,
   * avec un décalage optionnel en semaines.
   */
  function getLundiDeSemaine(date, offsetSemaines) {
    const d = new Date(date);
    const jour = d.getDay(); // 0=dim, 1=lun...
    const diffLundi = jour === 0 ? -6 : 1 - jour;
    d.setDate(d.getDate() + diffLundi + (offsetSemaines || 0) * 7);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Retourne le dimanche (fin) de la semaine débutant le lundi donné */
  function getDimancheDeSemaine(lundi) {
    const d = new Date(lundi);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /** Formate une date en texte court : "3 fév" */
  function formatDateCourte(date) {
    return date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
  }

  /** Convertit des minutes en heures arrondies à 1 décimale */
  function minutesEnHeures(min) {
    return Math.round(min / 6) / 10; // arrondi à 0.1h
  }

  // ==================================================================
  // CHARGEMENT ET CACHE DES DONNÉES
  // ==================================================================

  /**
   * Charge toutes les sessions et invalide le cache si nécessaire.
   * Retourne true si le cache a été rafraîchi.
   */
  async function chargerDonnees() {
    const toutes = await StudyDB.getToutesSessions();
    if (toutes.length === _cache.lastSessionCount && _cache.allSessions) {
      return false; // pas de nouvelles données
    }
    _cache.allSessions = toutes;
    _cache.lastSessionCount = toutes.length;
    // Invalider les caches dérivés
    _cache.stats = null;
    _cache.heatmapData = null;
    _cache.qualityData = null;
    _cache.patterns = null;
    return true;
  }

  /** Force l'invalidation du cache (appelé après enregistrement d'une session) */
  function invaliderCache() {
    _cache.lastSessionCount = -1;
    _cache.stats = null;
    _cache.heatmapData = null;
    _cache.qualityData = null;
    _cache.patterns = null;
    _cache.allSessions = null;
  }

  // ==================================================================
  // STATISTIQUES MENSUELLES (3 cards en haut)
  // ==================================================================

  /**
   * Calcule les statistiques pour les cards du dashboard.
   * Retourne :
   *   {
   *     tempsFocaliseMois: number (heures),
   *     comparaisonMoisPrecedent: number (heures, +/-),
   *     sessionsAccomplies: number,
   *     moyenneParSemaine: number,
   *     matieresTop5: [{nom, count}]
   *   }
   */
  function calculerStats() {
    if (_cache.stats) return _cache.stats;

    const sessions = _cache.allSessions || [];
    const maintenant = new Date();

    // ---- Mois en cours ----
    const debutMoisCourant = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
    const finMoisCourant = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0, 23, 59, 59, 999);

    // ---- Mois précédent ----
    const debutMoisPrec = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
    const finMoisPrec = new Date(maintenant.getFullYear(), maintenant.getMonth(), 0, 23, 59, 59, 999);

    const sessionsMoisCourant = sessions.filter(
      (s) => s.date >= debutMoisCourant.getTime() && s.date <= finMoisCourant.getTime()
    );
    const sessionsMoisPrec = sessions.filter(
      (s) => s.date >= debutMoisPrec.getTime() && s.date <= finMoisPrec.getTime()
    );

    // Temps focalisé (en minutes, puis converti en heures)
    const tempsMoisCourant = sessionsMoisCourant.reduce(
      (sum, s) => sum + (s.actualDuration || s.duration || 0), 0
    );
    const tempsMoisPrec = sessionsMoisPrec.reduce(
      (sum, s) => sum + (s.actualDuration || s.duration || 0), 0
    );

    // Moyenne sessions par semaine (sur les 4 dernières semaines)
    const il4Semaines = new Date(maintenant);
    il4Semaines.setDate(il4Semaines.getDate() - 28);
    const sessions4Semaines = sessions.filter((s) => s.date >= il4Semaines.getTime());
    const moyenneParSemaine = Math.round(sessions4Semaines.length / 4 * 10) / 10;

    // Top 5 matières (toutes sessions confondues)
    const matieresCounts = {};
    sessions.forEach((s) => {
      const matiere = (s.subject || '').trim();
      if (matiere) {
        matieresCounts[matiere] = (matieresCounts[matiere] || 0) + 1;
      }
    });
    const matieresTop5 = Object.entries(matieresCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nom, count]) => ({ nom, count }));

    _cache.stats = {
      tempsFocaliseMois: minutesEnHeures(tempsMoisCourant),
      comparaisonMoisPrecedent: minutesEnHeures(tempsMoisCourant - tempsMoisPrec),
      sessionsAccomplies: sessions.length,
      moyenneParSemaine: moyenneParSemaine,
      matieresTop5: matieresTop5
    };

    return _cache.stats;
  }

  // ==================================================================
  // HEATMAP HEBDOMADAIRE
  // ==================================================================

  /**
   * Calcule les données de la heatmap pour une semaine donnée.
   * Retourne une matrice 7×NB_TRANCHES avec pour chaque cellule :
   *   { count, matieres: Set, dureeTotale }
   */
  async function calculerHeatmap(weekOffset) {
    // Utiliser le cache si même semaine et données à jour
    if (_cache.heatmapData && _cache.heatmapWeekOffset === weekOffset) {
      return _cache.heatmapData;
    }

    const lundi = getLundiDeSemaine(new Date(), weekOffset);
    const dimanche = getDimancheDeSemaine(lundi);

    const sessions = await StudyDB.getSessionsParPeriode(
      lundi.getTime(),
      dimanche.getTime()
    );

    // Initialiser la grille : 7 jours × NB_TRANCHES (index 0 = lundi)
    const grille = [];
    for (let jour = 0; jour < 7; jour++) {
      grille[jour] = [];
      for (let h = 0; h < NB_TRANCHES; h++) {
        grille[jour][h] = { count: 0, matieres: new Set(), dureeTotale: 0 };
      }
    }

    // Remplir la grille avec les sessions
    sessions.forEach((s) => {
      const d = new Date(s.date);
      // Convertir jour (0=dim…6=sam) en index lundi-first (0=lun…6=dim)
      let jourIdx = d.getDay() - 1;
      if (jourIdx < 0) jourIdx = 6; // dimanche → index 6

      const heure = s.hourOfDay !== undefined ? s.hourOfDay : d.getHours();
      const trancheIdx = heure - HEURE_DEBUT;

      if (trancheIdx >= 0 && trancheIdx < NB_TRANCHES) {
        const cellule = grille[jourIdx][trancheIdx];
        cellule.count++;
        if (s.subject) cellule.matieres.add(s.subject);
        cellule.dureeTotale += s.actualDuration || s.duration || 0;
      }
    });

    // Libellés des jours pour cette semaine
    const joursLabels = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(lundi);
      d.setDate(d.getDate() + i);
      // Index du jour de la semaine (lun=1, mar=2, ..., dim=0)
      const jourSemaine = d.getDay();
      joursLabels.push({
        court: JOURS_COURTS[jourSemaine],
        complet: JOURS_SEMAINE[jourSemaine],
        date: formatDateCourte(d)
      });
    }

    _cache.heatmapData = {
      grille: grille,
      lundi: lundi,
      dimanche: dimanche,
      joursLabels: joursLabels
    };
    _cache.heatmapWeekOffset = weekOffset;

    return _cache.heatmapData;
  }

  /**
   * Rendu de la heatmap dans le conteneur HTML spécifié.
   * Utilise des divs CSS Grid pour un meilleur support des tooltips.
   */
  function rendreHeatmap(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Créer la grille CSS
    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    // Ligne d'en-tête : heures
    const headerVide = document.createElement('div');
    headerVide.className = 'heatmap-corner';
    grid.appendChild(headerVide);

    for (let h = 0; h < NB_TRANCHES; h++) {
      const headerH = document.createElement('div');
      headerH.className = 'heatmap-hour-label';
      headerH.textContent = (HEURE_DEBUT + h) + 'h';
      grid.appendChild(headerH);
    }

    // Lignes de données : une par jour
    for (let jour = 0; jour < 7; jour++) {
      // Label du jour
      const jourLabel = document.createElement('div');
      jourLabel.className = 'heatmap-day-label';
      jourLabel.innerHTML = `<span class="heatmap-day-short">${data.joursLabels[jour].court}</span>
        <span class="heatmap-day-date">${data.joursLabels[jour].date}</span>`;
      grid.appendChild(jourLabel);

      // Cellules
      for (let h = 0; h < NB_TRANCHES; h++) {
        const cellule = data.grille[jour][h];
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        // Couleur selon intensité
        const colorIdx = Math.min(cellule.count, 3);
        cell.style.backgroundColor = HEATMAP_COLORS[colorIdx];

        // Tooltip au survol
        if (cellule.count > 0) {
          cell.classList.add('heatmap-cell-active');
          const matieresList = Array.from(cellule.matieres).join(', ') || 'Non précisé';
          cell.setAttribute('data-tooltip',
            `${cellule.count} session${cellule.count > 1 ? 's' : ''}\n` +
            `Matières : ${matieresList}\n` +
            `Durée : ${cellule.dureeTotale} min`
          );

          // Événements tooltip
          cell.addEventListener('mouseenter', afficherTooltip);
          cell.addEventListener('mouseleave', masquerTooltip);
          cell.addEventListener('touchstart', afficherTooltip, { passive: true });
        }

        grid.appendChild(cell);
      }
    }

    container.appendChild(grid);
  }

  // ---- Tooltip pour la heatmap ----

  function afficherTooltip(e) {
    const texte = e.target.getAttribute('data-tooltip');
    if (!texte) return;

    if (!_tooltipEl) {
      _tooltipEl = document.createElement('div');
      _tooltipEl.className = 'heatmap-tooltip';
      document.body.appendChild(_tooltipEl);
    }

    _tooltipEl.textContent = texte;
    _tooltipEl.style.display = 'block';

    // Positionner le tooltip
    const rect = e.target.getBoundingClientRect();
    _tooltipEl.style.left = rect.left + rect.width / 2 + 'px';
    _tooltipEl.style.top = rect.top - 8 + 'px';
  }

  function masquerTooltip() {
    if (_tooltipEl) {
      _tooltipEl.style.display = 'none';
    }
  }

  // ==================================================================
  // GRAPHIQUE DE QUALITÉ PERÇUE (Canvas)
  // ==================================================================

  /**
   * Calcule les données du graphique qualité sur les 2 dernières semaines.
   * Regroupe par tranche horaire et calcule la qualité moyenne.
   *
   * Retourne :
   *   [{
   *     heure: 8,
   *     qualiteMoyenne: 3.5,
   *     nbSessions: 12
   *   }, ...]
   */
  async function calculerQualite() {
    if (_cache.qualityData) return _cache.qualityData;

    const maintenant = new Date();
    const il2Semaines = new Date(maintenant);
    il2Semaines.setDate(il2Semaines.getDate() - 14);

    const sessions = await StudyDB.getSessionsParPeriode(
      il2Semaines.getTime(),
      maintenant.getTime()
    );

    // Tranches horaires d'intérêt : 8, 10, 12, 14, 16, 18, 20
    const tranches = [8, 10, 12, 14, 16, 18, 20];
    const donnees = tranches.map((h) => {
      // Sessions dans cette tranche (±1h pour lisser)
      const sessionsTrancheRaw = sessions.filter((s) => {
        const heure = s.hourOfDay !== undefined ? s.hourOfDay : new Date(s.date).getHours();
        return heure >= h - 1 && heure <= h + 1;
      });
      // Ne garder que celles avec un rating
      const sessionsAvecRating = sessionsTrancheRaw.filter(
        (s) => s.qualityRating != null && s.qualityRating >= 1 && s.qualityRating <= 5
      );

      const nbSessions = sessionsAvecRating.length;
      const qualiteMoyenne = nbSessions > 0
        ? Math.round(sessionsAvecRating.reduce((sum, s) => sum + s.qualityRating, 0) / nbSessions * 10) / 10
        : null;

      return { heure: h, qualiteMoyenne, nbSessions };
    });

    _cache.qualityData = donnees;
    return donnees;
  }

  /**
   * Dessine le graphique de qualité perçue sur un canvas.
   * Graphique en ligne avec points proportionnels au nombre de sessions.
   */
  function rendreGraphiqueQualite(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Taille responsive
    const containerWidth = canvas.parentElement.clientWidth;
    const width = Math.min(containerWidth, 500);
    const height = 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    // Marges
    const marge = { top: 20, right: 20, bottom: 35, left: 40 };
    const zoneW = width - marge.left - marge.right;
    const zoneH = height - marge.top - marge.bottom;

    // Effacer
    ctx.clearRect(0, 0, width, height);

    const donnees = _cache.qualityData || [];

    // Points avec des données valides
    const pointsValides = donnees.filter((d) => d.qualiteMoyenne !== null);

    // ---- Dessiner la grille ----
    ctx.strokeStyle = CHART_GRID_COLOR;
    ctx.lineWidth = 0.5;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#718096';

    // Lignes horizontales (qualité 1-5)
    for (let q = 1; q <= 5; q++) {
      const y = marge.top + zoneH - ((q - 1) / 4) * zoneH;
      ctx.beginPath();
      ctx.moveTo(marge.left, y);
      ctx.lineTo(width - marge.right, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(q.toString(), marge.left - 6, y + 4);
    }

    // Labels axe X
    ctx.textAlign = 'center';
    donnees.forEach((d, i) => {
      const x = marge.left + (i / (donnees.length - 1)) * zoneW;
      ctx.fillText(d.heure + 'h', x, height - 8);
    });

    // ---- Dessiner la ligne ----
    if (pointsValides.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = CHART_LINE_COLOR;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';

      let premierePoint = true;
      donnees.forEach((d, i) => {
        if (d.qualiteMoyenne === null) return;
        const x = marge.left + (i / (donnees.length - 1)) * zoneW;
        const y = marge.top + zoneH - ((d.qualiteMoyenne - 1) / 4) * zoneH;

        if (premierePoint) {
          ctx.moveTo(x, y);
          premierePoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // ---- Dessiner les points ----
    donnees.forEach((d, i) => {
      if (d.qualiteMoyenne === null) return;

      const x = marge.left + (i / (donnees.length - 1)) * zoneW;
      const y = marge.top + zoneH - ((d.qualiteMoyenne - 1) / 4) * zoneH;

      // Taille proportionnelle au nombre de sessions (min 4px, max 12px)
      const rayon = Math.max(4, Math.min(12, 3 + d.nbSessions * 1.5));

      ctx.beginPath();
      ctx.arc(x, y, rayon, 0, Math.PI * 2);
      ctx.fillStyle = CHART_POINT_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Nombre de sessions à côté du point
      if (d.nbSessions > 0) {
        ctx.fillStyle = '#718096';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('n=' + d.nbSessions, x, y - rayon - 5);
      }
    });

    // ---- Message si pas assez de données ----
    if (pointsValides.length < 2) {
      ctx.fillStyle = '#718096';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Pas encore assez de données de qualité',
        width / 2, height / 2
      );
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(
        'Évalue tes sessions pour voir le graphique',
        width / 2, height / 2 + 20
      );
    }
  }

  // ==================================================================
  // DÉTECTION DE PATTERNS
  // ==================================================================

  /**
   * Analyse les sessions des 3 dernières semaines pour détecter
   * les habitudes de l'utilisateur.
   *
   * Retourne :
   *   {
   *     meilleureTrancheActivite: { debut, fin, nbSessions },
   *     meilleureTrancheQualite: { debut, fin, qualiteMoyenne, nbSessions } | null,
   *     joursPreferes: [{ jour, pourcentage, nbSessions }],
   *     insights: [string],       // Messages en langage naturel
   *     suggestionCreneau: string  // Ex: "16:00-19:00"
   *   }
   */
  async function detecterPatterns() {
    if (_cache.patterns) return _cache.patterns;

    const maintenant = new Date();
    const il3Semaines = new Date(maintenant);
    il3Semaines.setDate(il3Semaines.getDate() - 21);

    const sessions = await StudyDB.getSessionsParPeriode(
      il3Semaines.getTime(),
      maintenant.getTime()
    );

    const totalSessions = sessions.length;
    const insights = [];

    // ---- Regroupement par tranche horaire (blocs de 1h) ----
    const parHeure = {};
    for (let h = HEURE_DEBUT; h <= HEURE_FIN; h++) {
      parHeure[h] = { count: 0, qualites: [] };
    }

    sessions.forEach((s) => {
      const heure = s.hourOfDay !== undefined ? s.hourOfDay : new Date(s.date).getHours();
      if (heure >= HEURE_DEBUT && heure <= HEURE_FIN) {
        parHeure[heure].count++;
        if (s.qualityRating != null && s.qualityRating >= 1) {
          parHeure[heure].qualites.push(s.qualityRating);
        }
      }
    });

    // ---- Tranche la plus active ----
    // On cherche la meilleure fenêtre de 3h consécutives
    let meilleurDebut = HEURE_DEBUT;
    let meilleurCount = 0;

    for (let h = HEURE_DEBUT; h <= HEURE_FIN - 2; h++) {
      const countFenetre = parHeure[h].count + parHeure[h + 1].count + parHeure[h + 2].count;
      if (countFenetre > meilleurCount) {
        meilleurCount = countFenetre;
        meilleurDebut = h;
      }
    }

    const meilleureTrancheActivite = {
      debut: meilleurDebut,
      fin: meilleurDebut + 3,
      nbSessions: meilleurCount
    };

    // ---- Tranche avec meilleure qualité moyenne ----
    // Fenêtre de 3h, minimum 5 sessions avec rating
    let meilleureTrancheQualite = null;
    let meilleureQualite = 0;

    for (let h = HEURE_DEBUT; h <= HEURE_FIN - 2; h++) {
      const qualites = [
        ...parHeure[h].qualites,
        ...parHeure[h + 1].qualites,
        ...parHeure[h + 2].qualites
      ];
      if (qualites.length >= 5) {
        const moyenne = qualites.reduce((a, b) => a + b, 0) / qualites.length;
        if (moyenne > meilleureQualite) {
          meilleureQualite = moyenne;
          meilleureTrancheQualite = {
            debut: h,
            fin: h + 3,
            qualiteMoyenne: Math.round(moyenne * 10) / 10,
            nbSessions: qualites.length
          };
        }
      }
    }

    // ---- Regroupement par jour de la semaine ----
    const parJour = [0, 0, 0, 0, 0, 0, 0]; // dim=0, lun=1, ...
    sessions.forEach((s) => {
      const jour = new Date(s.date).getDay();
      parJour[jour]++;
    });

    // Jours triés par nombre de sessions décroissant
    const joursTries = parJour
      .map((count, idx) => ({
        jour: JOURS_SEMAINE[idx],
        jourCourt: JOURS_COURTS[idx],
        pourcentage: totalSessions > 0 ? Math.round(count / totalSessions * 100) : 0,
        nbSessions: count
      }))
      .sort((a, b) => b.nbSessions - a.nbSessions);

    // ---- Générer les insights en langage naturel ----

    if (totalSessions >= 5 && meilleurCount > 0) {
      insights.push(
        `Tu sembles plus actif·ve entre ${meilleurDebut}h et ${meilleurDebut + 3}h ` +
        `(${meilleurCount} sessions sur 3 semaines)`
      );
    }

    if (meilleureTrancheQualite) {
      insights.push(
        `Tu sembles plus efficace entre ${meilleureTrancheQualite.debut}h-${meilleureTrancheQualite.fin}h ` +
        `(${meilleureTrancheQualite.nbSessions} sessions, qualité moyenne ${meilleureTrancheQualite.qualiteMoyenne}/5)`
      );
    }

    // Jours préférés : top 2 avec pourcentage cumulé
    const top2Jours = joursTries.slice(0, 2);
    if (totalSessions >= 5 && top2Jours[0].nbSessions > 0) {
      const pctCumul = top2Jours[0].pourcentage + (top2Jours[1] ? top2Jours[1].pourcentage : 0);
      if (pctCumul >= 40) {
        insights.push(
          `Tu travailles surtout le ${top2Jours[0].jour}` +
          (top2Jours[1] && top2Jours[1].nbSessions > 0 ? ` et ${top2Jours[1].jour}` : '') +
          ` (${pctCumul}% de tes sessions)`
        );
      }
    }

    // Suggestion de créneau (la tranche d'activité ou de qualité)
    const trancheSuggestion = meilleureTrancheQualite || meilleureTrancheActivite;
    const suggestionCreneau = trancheSuggestion
      ? `${String(trancheSuggestion.debut).padStart(2, '0')}:00-${String(trancheSuggestion.fin).padStart(2, '0')}:00`
      : null;

    _cache.patterns = {
      meilleureTrancheActivite,
      meilleureTrancheQualite,
      joursPreferes: joursTries,
      insights,
      suggestionCreneau,
      totalSessions
    };

    return _cache.patterns;
  }

  // ==================================================================
  // RENDU DU DASHBOARD COMPLET
  // ==================================================================

  /** Variable pour le décalage de semaine de la heatmap (navigation) */
  let _weekOffset = 0;

  /**
   * Point d'entrée principal : charge les données et rend le dashboard.
   * Appelé lorsque l'onglet "Mes statistiques" est activé.
   */
  async function afficherDashboard() {
    await chargerDonnees();

    // ---- Cards statistiques ----
    rendreCards();

    // ---- Heatmap ----
    await rendreHeatmapSection(0);

    // ---- Graphique qualité ----
    await calculerQualite();
    rendreGraphiqueQualite('qualityCanvas');

    // ---- Patterns / Insights ----
    await rendreInsights();
  }

  /** Rendu des 3 cards statistiques en haut */
  function rendreCards() {
    const stats = calculerStats();
    const sessions = _cache.allSessions || [];

    // Card 1 : Temps focalisé ce mois
    const cardTemps = document.getElementById('statTempsFocalise');
    if (cardTemps) {
      const diff = stats.comparaisonMoisPrecedent;
      const signe = diff >= 0 ? '+' : '';
      cardTemps.innerHTML = `
        <div class="stat-value">${stats.tempsFocaliseMois}h</div>
        <div class="stat-label">Temps focalisé ce mois</div>
        <div class="stat-compare ${diff >= 0 ? 'stat-compare-up' : 'stat-compare-down'}">${signe}${diff}h vs mois précédent</div>
      `;
    }

    // Card 2 : Sessions accomplies
    const cardSessions = document.getElementById('statSessionsAccomplies');
    if (cardSessions) {
      cardSessions.innerHTML = `
        <div class="stat-value">${stats.sessionsAccomplies}</div>
        <div class="stat-label">Sessions accomplies</div>
        <div class="stat-detail">${stats.moyenneParSemaine} / semaine en moyenne</div>
      `;
    }

    // Card 3 : Matières travaillées
    const cardMatieres = document.getElementById('statMatieresTravaillees');
    if (cardMatieres) {
      const liste = stats.matieresTop5.length > 0
        ? stats.matieresTop5.map((m) => `<span class="stat-matiere-tag">${escapeHtml(m.nom)} (${m.count})</span>`).join(' ')
        : '<span class="stat-empty">Aucune matière renseignée</span>';
      cardMatieres.innerHTML = `
        <div class="stat-label">Matières travaillées</div>
        <div class="stat-matieres">${liste}</div>
      `;
    }
  }

  /** Rendu de la section heatmap avec navigation de semaine */
  async function rendreHeatmapSection(offset) {
    _weekOffset = offset;
    const data = await calculerHeatmap(offset);

    // Mettre à jour le label de la semaine
    const labelEl = document.getElementById('heatmapWeekLabel');
    if (labelEl) {
      if (offset === 0) {
        labelEl.textContent = 'Semaine actuelle';
      } else {
        labelEl.textContent = `${formatDateCourte(data.lundi)} — ${formatDateCourte(data.dimanche)}`;
      }
    }

    rendreHeatmap('heatmapContainer', data);
  }

  /** Navigation heatmap : semaine précédente */
  function semainePrecedente() {
    rendreHeatmapSection(_weekOffset - 1);
  }

  /** Navigation heatmap : semaine actuelle */
  function semaineActuelle() {
    rendreHeatmapSection(0);
  }

  /** Navigation heatmap : semaine suivante */
  function semaineSuivante() {
    if (_weekOffset < 0) {
      rendreHeatmapSection(_weekOffset + 1);
    }
  }

  /** Rendu de la section Insights / Patterns */
  async function rendreInsights() {
    const patterns = await detecterPatterns();
    const container = document.getElementById('insightsContainer');
    if (!container) return;

    // Si pas assez de sessions, afficher un message pédagogique
    if (patterns.totalSessions < 10) {
      container.innerHTML = `
        <div class="insight-card insight-info">
          <p class="insight-text">Continue à travailler, les statistiques seront plus précises après 10 sessions.</p>
          <p class="insight-progress">${patterns.totalSessions}/10 sessions enregistrées</p>
        </div>
      `;
      return;
    }

    // Afficher les insights détectés
    if (patterns.insights.length === 0) {
      container.innerHTML = `
        <div class="insight-card insight-info">
          <p class="insight-text">Pas encore de patterns détectés. Continue tes sessions pour que je puisse analyser tes habitudes.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="insight-card">';
    html += '<h4 class="insight-title">Insights</h4>';

    patterns.insights.forEach((msg) => {
      html += `<p class="insight-text">${escapeHtml(msg)}</p>`;
    });

    // Bouton "Ajuster mes suggestions"
    if (patterns.suggestionCreneau) {
      html += `
        <button class="btn btn-secondary btn-adjust-suggestion" id="btnAjusterSuggestion"
                data-creneau="${escapeHtml(patterns.suggestionCreneau)}">
          Ajuster mes suggestions (${patterns.suggestionCreneau})
        </button>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    // Attacher l'événement du bouton
    const btnAjuster = document.getElementById('btnAjusterSuggestion');
    if (btnAjuster) {
      btnAjuster.addEventListener('click', async () => {
        const creneau = btnAjuster.dataset.creneau;
        await sauvegarderPreferenceHoraire(creneau);
        btnAjuster.textContent = 'Préférence enregistrée';
        btnAjuster.disabled = true;
      });
    }
  }

  /**
   * Sauvegarde la préférence horaire détectée dans la DB.
   * La préférence sera utilisée pour les suggestions du contrat.
   */
  async function sauvegarderPreferenceHoraire(creneau) {
    const prefs = (await StudyDB.getPreferences()) || {
      preferredTimeSlots: [],
      detectedChronotype: 'non_détecté',
      lastUpdated: null
    };

    prefs.preferredTimeSlots = [creneau];
    prefs.lastUpdated = Date.now();

    await StudyDB.sauvegarderPreferences(prefs);
  }

  // ==================================================================
  // EXPORT PNG DES GRAPHIQUES
  // ==================================================================

  /**
   * Exporte un élément du dashboard en PNG.
   * Pour les canvas, utilise directement toDataURL.
   * Pour les divs (heatmap), crée un canvas temporaire via html2canvas-like.
   */
  function exporterPNG(type) {
    if (type === 'qualite') {
      // Export du canvas qualité
      const canvas = document.getElementById('qualityCanvas');
      if (!canvas) return;
      telechargerCanvas(canvas, 'qualite-percue.png');
    } else if (type === 'heatmap') {
      // Pour la heatmap (HTML), on crée un canvas temporaire
      exporterHeatmapPNG();
    }
  }

  /** Exporte la heatmap HTML vers un canvas puis en PNG */
  function exporterHeatmapPNG() {
    const data = _cache.heatmapData;
    if (!data) return;

    const cellSize = 24;
    const labelW = 60;
    const labelH = 20;
    const padding = 10;

    const width = labelW + NB_TRANCHES * cellSize + padding * 2;
    const height = labelH + 7 * cellSize + padding * 2;

    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Fond blanc
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Labels heures
    ctx.fillStyle = '#718096';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h < NB_TRANCHES; h++) {
      ctx.fillText(
        (HEURE_DEBUT + h) + 'h',
        padding + labelW + h * cellSize + cellSize / 2,
        padding + labelH - 4
      );
    }

    // Labels jours + cellules
    ctx.textAlign = 'right';
    for (let jour = 0; jour < 7; jour++) {
      const y = padding + labelH + jour * cellSize;
      ctx.fillStyle = '#718096';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(data.joursLabels[jour].court, padding + labelW - 6, y + cellSize / 2 + 3);

      for (let h = 0; h < NB_TRANCHES; h++) {
        const x = padding + labelW + h * cellSize;
        const cellule = data.grille[jour][h];
        const colorIdx = Math.min(cellule.count, 3);
        ctx.fillStyle = HEATMAP_COLORS[colorIdx];
        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        // Bordure arrondie simulée
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      }
    }

    telechargerCanvas(canvas, 'heatmap-semaine.png');
  }

  /** Déclenche le téléchargement d'un canvas en PNG */
  function telechargerCanvas(canvas, nomFichier) {
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = nomFichier;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ==================================================================
  // SUGGESTION DE CRÉNEAUX POUR LE CONTRAT
  // ==================================================================

  /**
   * Récupère la suggestion de créneau horaire pour le contrat quotidien.
   * Retourne null si aucune préférence enregistrée.
   */
  async function getSuggestionContrat() {
    const prefs = await StudyDB.getPreferences();
    if (!prefs || !prefs.preferredTimeSlots || prefs.preferredTimeSlots.length === 0) {
      return null;
    }
    return {
      creneaux: prefs.preferredTimeSlots,
      chronotype: prefs.detectedChronotype || 'non_détecté'
    };
  }

  // ==================================================================
  // UTILITAIRE
  // ==================================================================

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  // ==================================================================
  // DONNÉES DE TEST (seed)
  // ==================================================================

  /**
   * Génère des données de test pour vérifier les graphiques.
   * Crée 30 sessions réparties sur les 3 dernières semaines avec
   * des horaires et qualités variés pour tester tous les composants.
   *
   * Appeler depuis la console : StudyDashboard.genererDonneesTest()
   */
  async function genererDonneesTest() {
    const matieres = ['Maths', 'Français', 'Sciences', 'Histoire', 'Anglais'];
    const maintenant = Date.now();
    const sessions = [];

    for (let i = 0; i < 30; i++) {
      // Répartir sur les 21 derniers jours
      const joursAvant = Math.floor(Math.random() * 21);
      // Heures avec pic entre 16h-19h et un autre entre 9h-11h
      let heure;
      const r = Math.random();
      if (r < 0.4) {
        heure = 16 + Math.floor(Math.random() * 3); // 16-18
      } else if (r < 0.7) {
        heure = 9 + Math.floor(Math.random() * 3); // 9-11
      } else {
        heure = 6 + Math.floor(Math.random() * 17); // 6-22
      }

      const dateSession = new Date(maintenant);
      dateSession.setDate(dateSession.getDate() - joursAvant);
      dateSession.setHours(heure, Math.floor(Math.random() * 60), 0, 0);

      // Qualité corrélée à l'heure (meilleure entre 16-19)
      let qualite;
      if (heure >= 16 && heure <= 19) {
        qualite = Math.min(5, Math.max(1, 3 + Math.floor(Math.random() * 3))); // 3-5
      } else if (heure >= 9 && heure <= 11) {
        qualite = Math.min(5, Math.max(1, 2 + Math.floor(Math.random() * 3))); // 2-4
      } else {
        qualite = Math.min(5, Math.max(1, 1 + Math.floor(Math.random() * 3))); // 1-3
      }

      const duree = Math.random() > 0.5 ? 50 : 25;
      const matiere = matieres[Math.floor(Math.random() * matieres.length)];

      sessions.push({
        taskName: `Tâche test ${i + 1}`,
        subject: matiere,
        date: dateSession.getTime(),
        duration: duree,
        actualDuration: duree - Math.floor(Math.random() * 5),
        difficulty: 1 + Math.floor(Math.random() * 3),
        summary: `Résumé de la session test ${i + 1} pour vérifier le dashboard.`,
        completed: true,
        qualityRating: qualite,
        hourOfDay: heure
      });
    }

    // Enregistrer chaque session
    for (const s of sessions) {
      await StudyDB.enregistrerSession(s);
    }

    // Invalider le cache et rafraîchir
    invaliderCache();
    console.info('[StudyDashboard] 30 sessions de test créées.');
    return sessions.length;
  }

  // ==== API PUBLIQUE ====
  return {
    afficherDashboard: afficherDashboard,
    invaliderCache: invaliderCache,
    semainePrecedente: semainePrecedente,
    semaineActuelle: semaineActuelle,
    semaineSuivante: semaineSuivante,
    exporterPNG: exporterPNG,
    getSuggestionContrat: getSuggestionContrat,
    detecterPatterns: detecterPatterns,
    genererDonneesTest: genererDonneesTest
  };
})();
