// ============================================================
// Study Protocol Manager — Logique applicative (étape 4)
// Persistance via IndexedDB (module db.js), fallback localStorage.
// Fonctionnalités :
//   - Contrat quotidien avec verrouillage
//   - Timer de session avec pause/reprise
//   - Test de récupération active après chaque session
//   - Évaluation qualité de concentration (1-5 étoiles)
//   - Historique des sessions avec export CSV
//   - Dashboard chronobiologique (module dashboard.js)
//   - Suggestions de créneaux basées sur les patterns détectés
//   - Indicateurs visuels de statut
//   - Récupération de session interrompue (refresh page)
//   - Questionnaire chronotype à l'onboarding (étape 4)
//   - Cartes de révision (flashcards) avec extraction auto (étape 4)
//   - Mode révision interactif avec flip (étape 4)
// ============================================================

(function () {
  'use strict';

  // ---- Constantes ----
  const MAX_TASKS = 5;
  const MIN_TASKS = 3;
  const DIFFICULTY_LABELS = ['', 'Facile', 'Moyen', 'Difficile'];
  const MIN_RECALL_CHARS = 50; // minimum de caractères pour le résumé

  // Labels de qualité (index 0 non utilisé, 1-5 correspondent aux étoiles)
  const QUALITY_LABELS = [
    '',
    'Très difficile de me concentrer',
    'Difficile de me concentrer',
    'Concentration moyenne',
    'Bonne concentration',
    'Excellente concentration'
  ];

  // Périmètre du cercle SVG (2 * PI * rayon 90)
  const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

  // Clé pour sauvegarder l'état du timer en cas de refresh
  const TIMER_STATE_KEY = 'studyproto_timer_state';

  // ---- Questionnaire chronotype (5 questions, score 1-5 chacune) ----
  const CHRONOTYPE_QUESTIONS = [
    {
      question: 'Si tu n\'avais aucune obligation, à quelle heure te lèverais-tu naturellement ?',
      options: [
        { label: 'Avant 7h', score: 5 },
        { label: 'Entre 7h et 8h', score: 4 },
        { label: 'Entre 8h et 9h30', score: 3 },
        { label: 'Entre 9h30 et 11h', score: 2 },
        { label: 'Après 11h', score: 1 }
      ]
    },
    {
      question: 'À quel moment de la journée te sens-tu le plus en forme pour réfléchir ?',
      options: [
        { label: 'Tôt le matin (8h-10h)', score: 5 },
        { label: 'En fin de matinée (10h-12h)', score: 4 },
        { label: 'En début d\'après-midi (13h-15h)', score: 3 },
        { label: 'En fin d\'après-midi (16h-18h)', score: 2 },
        { label: 'Le soir (après 19h)', score: 1 }
      ]
    },
    {
      question: 'Si tu devais passer un examen important, quand le planifierais-tu idéalement ?',
      options: [
        { label: '8h-10h', score: 5 },
        { label: '10h-12h', score: 4 },
        { label: '14h-16h', score: 3 },
        { label: '16h-18h', score: 2 },
        { label: 'Après 18h', score: 1 }
      ]
    },
    {
      question: 'À quelle heure commences-tu à te sentir fatigué(e) le soir ?',
      options: [
        { label: 'Avant 21h', score: 5 },
        { label: 'Vers 21h-22h', score: 4 },
        { label: 'Vers 22h-23h', score: 3 },
        { label: 'Vers 23h-minuit', score: 2 },
        { label: 'Après minuit', score: 1 }
      ]
    },
    {
      question: 'Comment te décrirais-tu ?',
      options: [
        { label: 'Clairement du matin', score: 5 },
        { label: 'Plutôt du matin', score: 4 },
        { label: 'Ni l\'un ni l\'autre', score: 3 },
        { label: 'Plutôt du soir', score: 2 },
        { label: 'Clairement du soir', score: 1 }
      ]
    }
  ];

  // Profils chronotypes avec créneaux optimaux
  const CHRONOTYPE_PROFILES = {
    matinal: {
      label: 'Matinal',
      icon: '\u{1F305}',
      description: 'Tu es plus efficace le matin ! Ton cerveau est au top de sa forme en début de journée. Profite de cette énergie pour les tâches les plus exigeantes.',
      optimalSlots: ['8h-12h', '14h-16h'],
      slotLabels: ['Créneau principal (haute énergie)', 'Créneau secondaire']
    },
    intermediaire: {
      label: 'Intermédiaire',
      icon: '\u{2600}\u{FE0F}',
      description: 'Tu as un rythme équilibré avec des pics d\'énergie en milieu de journée. Tu peux adapter tes horaires assez librement.',
      optimalSlots: ['10h-12h', '15h-18h'],
      slotLabels: ['Créneau matinal', 'Créneau après-midi (haute énergie)']
    },
    vespertinus: {
      label: 'Vespéral',
      icon: '\u{1F319}',
      description: 'Tu es plus efficace l\'après-midi et le soir ! C\'est normal \u2014 beaucoup d\'ados ont ce profil. Planifie tes tâches difficiles en fin de journée.',
      optimalSlots: ['14h-17h', '19h-21h'],
      slotLabels: ['Créneau après-midi (haute énergie)', 'Créneau soirée']
    }
  };

  // ---- Références DOM ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Onglets de navigation
  const appHeader   = $('#appHeader');
  const appNav      = $('#appNav');
  const tabMain     = $('#tabMain');
  const tabHistory  = $('#tabHistory');
  const tabFlashcards = $('#tabFlashcards');
  const tabDashboard = $('#tabDashboard');

  // Vues principales
  const viewContract = $('#viewContract');
  const viewLocked   = $('#viewLocked');
  const viewTimer    = $('#viewTimer');

  // Formulaire de contrat
  const taskListEl      = $('#taskList');
  const btnAddTask      = $('#btnAddTask');
  const btnLockContract = $('#btnLockContract');
  const btnLoadDemo     = $('#btnLoadDemo');

  // Suggestion de créneau
  const suggestionCreneau     = $('#suggestionCreneau');
  const suggestionCreneauText = $('#suggestionCreneauText');

  // Badge créneau optimal
  const badgeCreneauOptimal = $('#badgeCreneauOptimal');

  // Vue verrouillée
  const progressSummary = $('#progressSummary');
  const lockedTaskList  = $('#lockedTaskList');
  const btnResetDay     = $('#btnResetDay');

  // Timer
  const timerTaskName     = $('#timerTaskName');
  const timerSubject      = $('#timerSubject');
  const timerDigits       = $('#timerDigits');
  const timerRingProgress = $('#timerRingProgress');
  const btnPause          = $('#btnPause');
  const btnFinish         = $('#btnFinish');
  const btnAbandon        = $('#btnAbandon');
  const btnBackToList     = $('#btnBackToList');
  const chkSound          = $('#chkSound');
  const breakSuggestion   = $('#breakSuggestion');
  const breakDuration     = $('#breakDuration');
  const btnDismissBreak   = $('#btnDismissBreak');

  // Dialogue de confirmation
  const confirmDialog  = $('#confirmDialog');
  const confirmMessage = $('#confirmMessage');
  const btnConfirmYes  = $('#btnConfirmYes');
  const btnConfirmNo   = $('#btnConfirmNo');

  // Modal récupération active
  const recallModal     = $('#recallModal');
  const recallTextarea  = $('#recallTextarea');
  const recallCharCount = $('#recallCharCount');
  const btnRecallSave   = $('#btnRecallSave');
  const btnRecallSkip   = $('#btnRecallSkip');

  // Modal évaluation qualité
  const qualityModal        = $('#qualityModal');
  const qualityStarsEl      = $('#qualityStars');
  const qualitySelectedLabel = $('#qualitySelectedLabel');
  const btnQualitySave      = $('#btnQualitySave');
  const btnQualitySkip      = $('#btnQualitySkip');

  // Modal détail résumé
  const summaryDetailModal = $('#summaryDetailModal');
  const summaryDetailTitle = $('#summaryDetailTitle');
  const summaryDetailText  = $('#summaryDetailText');
  const btnCloseSummaryDetail = $('#btnCloseSummaryDetail');

  // Onboarding
  const onboardingScreen      = $('#onboardingScreen');
  const onboardingProgressBar = $('#onboardingProgressBar');
  const onboardingStepLabel   = $('#onboardingStepLabel');
  const onboardingQuestions   = $('#onboardingQuestions');
  const btnOnboardingPrev     = $('#btnOnboardingPrev');
  const btnOnboardingNext     = $('#btnOnboardingNext');
  const btnOnboardingSkip     = $('#btnOnboardingSkip');

  // Résultat chronotype
  const chronotypeResultScreen = $('#chronotypeResultScreen');
  const chronotypeIcon         = $('#chronotypeIcon');
  const chronotypeResultTitle  = $('#chronotypeResultTitle');
  const chronotypeResultDesc   = $('#chronotypeResultDesc');
  const chronotypeSlotsList    = $('#chronotypeSlotsList');
  const btnStartApp            = $('#btnStartApp');

  // Flashcards tab
  const flashcardStats         = $('#flashcardStats');
  const flashcardFilterSubject = $('#flashcardFilterSubject');
  const btnStartReview         = $('#btnStartReview');
  const btnCreateManualFlashcard = $('#btnCreateManualFlashcard');
  const flashcardList          = $('#flashcardList');
  const flashcardEmpty         = $('#flashcardEmpty');

  // Flashcard suggestion modal
  const flashcardSuggestionModal = $('#flashcardSuggestionModal');
  const flashcardSuggestionHint = $('#flashcardSuggestionHint');
  const flashcardSuggestionList = $('#flashcardSuggestionList');
  const btnFlashcardSuggestionSave = $('#btnFlashcardSuggestionSave');
  const btnFlashcardSuggestionSkip = $('#btnFlashcardSuggestionSkip');

  // Manual flashcard modal
  const flashcardManualModal     = $('#flashcardManualModal');
  const manualFlashcardQuestion  = $('#manualFlashcardQuestion');
  const manualFlashcardAnswer    = $('#manualFlashcardAnswer');
  const manualFlashcardSubject   = $('#manualFlashcardSubject');
  const btnManualFlashcardSave   = $('#btnManualFlashcardSave');
  const btnManualFlashcardCancel = $('#btnManualFlashcardCancel');

  // Flashcard review modal
  const flashcardReviewModal   = $('#flashcardReviewModal');
  const reviewProgress         = $('#reviewProgress');
  const btnCloseReview         = $('#btnCloseReview');
  const flashcardFlipContainer = $('#flashcardFlipContainer');
  const flashcardFlipInner     = $('#flashcardFlipInner');
  const reviewQuestionText     = $('#reviewQuestionText');
  const reviewAnswerText       = $('#reviewAnswerText');
  const btnRevealAnswer        = $('#btnRevealAnswer');
  const reviewButtons          = $('#reviewButtons');
  const btnReviewKnew          = $('#btnReviewKnew');
  const btnReviewRetry         = $('#btnReviewRetry');
  const reviewSubject          = $('#reviewSubject');

  // Dashboard chronotype card
  const chronotypeCard      = $('#chronotypeCard');
  const chronotypeCardIcon  = $('#chronotypeCardIcon');
  const chronotypeCardLabel = $('#chronotypeCardLabel');
  const chronotypeCardDate  = $('#chronotypeCardDate');
  const btnRefaireChronotype = $('#btnRefaireChronotype');

  // Historique
  const historyList  = $('#historyList');
  const historyEmpty = $('#historyEmpty');
  const btnExportCSV = $('#btnExportCSV');

  // Toast
  const toastEl = $('#toast');

  // ---- État applicatif ----
  let contract = null;         // { id?, date, locked, tasks: [...] }
  let timerInterval = null;
  let timerRemaining = 0;      // secondes restantes
  let timerTotal = 0;           // durée totale en secondes
  let timerPaused = false;
  let currentTaskIndex = -1;
  let confirmCallback = null;   // fonction appelée si l'utilisateur confirme
  let timerStartTime = null;    // timestamp de début de session
  let timerPausedTotal = 0;     // temps total en pause (en ms)
  let timerPauseStart = null;   // timestamp du début de la pause en cours
  let recallCallback = null;    // callback après le modal de récupération active
  let qualityCallback = null;   // callback après le modal de qualité
  let selectedQuality = 0;      // étoiles sélectionnées (1-5 ou 0=rien)
  let activeTab = 'main';      // onglet actif

  // État onboarding
  let onboardingStep = 0;       // question courante (0-4)
  let onboardingAnswers = [];   // scores sélectionnés pour chaque question

  // État flashcard review
  let reviewCards = [];          // cartes à réviser dans la session
  let reviewIndex = 0;           // index courant dans reviewCards
  let reviewFlipped = false;     // la carte est-elle retournée ?

  // Suggestions de flashcards en attente (après un résumé)
  let pendingSuggestions = [];
  let pendingSuggestionSubject = '';
  let pendingSuggestionTaskName = '';

  // ---- Initialisation ----
  async function init() {
    afficherDate();

    // Initialiser IndexedDB (migration automatique)
    await StudyDB.init();

    // Vérifier s'il y a une première utilisation
    const premiere = await StudyDB.estPremiereUtilisation();
    if (premiere) {
      masquerAppPrincipale();
      demarrerOnboarding();
    } else {
      demarrerApp();
    }
  }

  /** Cache le header et la navigation pour l'onboarding */
  function masquerAppPrincipale() {
    if (appHeader) appHeader.classList.add('hidden');
    if (appNav) appNav.classList.add('hidden');
    if (tabMain) tabMain.classList.add('hidden');
  }

  /** Affiche le header et la navigation */
  function afficherAppPrincipale() {
    if (appHeader) appHeader.classList.remove('hidden');
    if (appNav) appNav.classList.remove('hidden');
    if (tabMain) tabMain.classList.remove('hidden');
  }

  /** Démarre l'application normale (après onboarding ou si déjà utilisé) */
  async function demarrerApp() {
    // Masquer les écrans d'onboarding
    if (onboardingScreen) onboardingScreen.classList.add('hidden');
    if (chronotypeResultScreen) chronotypeResultScreen.classList.add('hidden');
    afficherAppPrincipale();

    // Charger le contrat du jour
    await chargerContrat();

    // Vérifier s'il y a une session interrompue à restaurer
    restaurerSessionInterrompue();

    // Afficher la suggestion de créneau si disponible
    afficherSuggestionCreneau();
    afficherBadgeCreneauOptimal();

    attacherEvenements();
    enregistrerServiceWorker();
  }

  // ============================================================
  // QUESTIONNAIRE CHRONOTYPE (ONBOARDING)
  // ============================================================

  /** Démarre le questionnaire d'onboarding */
  function demarrerOnboarding() {
    onboardingStep = 0;
    onboardingAnswers = new Array(CHRONOTYPE_QUESTIONS.length).fill(null);

    genererQuestionsOnboarding();
    mettreAJourOnboarding();

    onboardingScreen.classList.remove('hidden');

    // Événements onboarding
    btnOnboardingPrev.addEventListener('click', onboardingPrecedent);
    btnOnboardingNext.addEventListener('click', onboardingSuivant);
    btnOnboardingSkip.addEventListener('click', onboardingPasser);
  }

  /** Génère le HTML des 5 questions dans le conteneur */
  function genererQuestionsOnboarding() {
    onboardingQuestions.innerHTML = '';

    CHRONOTYPE_QUESTIONS.forEach((q, qIdx) => {
      const div = document.createElement('div');
      div.className = 'onboarding-question' + (qIdx === 0 ? '' : ' hidden');
      div.dataset.qindex = qIdx;

      let optionsHtml = '';
      q.options.forEach((opt, oIdx) => {
        optionsHtml += `
          <label class="onboarding-option">
            <input type="radio" name="chrono_q${qIdx}" value="${opt.score}" data-qindex="${qIdx}">
            <span class="onboarding-option-label">${escapeHtml(opt.label)}</span>
          </label>
        `;
      });

      div.innerHTML = `
        <p class="onboarding-question-text">${escapeHtml(q.question)}</p>
        <div class="onboarding-options">${optionsHtml}</div>
      `;

      onboardingQuestions.appendChild(div);

      // Écouter les changements de radio
      div.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          onboardingAnswers[qIdx] = parseInt(radio.value, 10);
          mettreAJourOnboarding();
        });
      });
    });
  }

  /** Met à jour l'affichage de l'onboarding (progression, boutons) */
  function mettreAJourOnboarding() {
    const total = CHRONOTYPE_QUESTIONS.length;
    const pct = ((onboardingStep + 1) / total) * 100;

    onboardingProgressBar.style.width = pct + '%';
    onboardingStepLabel.textContent = `Question ${onboardingStep + 1} / ${total}`;

    // Afficher uniquement la question courante
    onboardingQuestions.querySelectorAll('.onboarding-question').forEach((div) => {
      const idx = parseInt(div.dataset.qindex, 10);
      div.classList.toggle('hidden', idx !== onboardingStep);
    });

    // Bouton précédent
    btnOnboardingPrev.disabled = onboardingStep === 0;

    // Bouton suivant : actif seulement si une réponse est sélectionnée
    const aRepondu = onboardingAnswers[onboardingStep] !== null;
    const estDernier = onboardingStep === total - 1;

    btnOnboardingNext.disabled = !aRepondu;
    btnOnboardingNext.textContent = estDernier ? 'Voir mon profil' : 'Suivant \u2192';
  }

  function onboardingPrecedent() {
    if (onboardingStep > 0) {
      onboardingStep--;
      mettreAJourOnboarding();
    }
  }

  function onboardingSuivant() {
    if (onboardingAnswers[onboardingStep] === null) return;

    if (onboardingStep < CHRONOTYPE_QUESTIONS.length - 1) {
      onboardingStep++;
      mettreAJourOnboarding();
    } else {
      // Dernière question : calculer le résultat
      finaliserChronotype();
    }
  }

  /** Passe l'onboarding et lance l'app directement */
  function onboardingPasser() {
    onboardingScreen.classList.add('hidden');
    demarrerApp();
  }

  /** Calcule le score chronotype et affiche le résultat */
  async function finaliserChronotype() {
    const score = onboardingAnswers.reduce((sum, s) => sum + (s || 0), 0);

    // Déterminer le profil : 5-11 vespertinus, 12-18 intermédiaire, 19-25 matinal
    let chronotypeKey;
    if (score >= 19) {
      chronotypeKey = 'matinal';
    } else if (score >= 12) {
      chronotypeKey = 'intermediaire';
    } else {
      chronotypeKey = 'vespertinus';
    }

    const profil = CHRONOTYPE_PROFILES[chronotypeKey];

    // Sauvegarder les préférences
    const prefs = {
      preferredTimeSlots: profil.optimalSlots,
      detectedChronotype: chronotypeKey,
      chronotypeScore: score,
      chronotypeLabel: profil.label,
      optimalTimeSlots: profil.optimalSlots,
      questionnaireDate: Date.now(),
      lastUpdated: Date.now()
    };
    await StudyDB.sauvegarderPreferences(prefs);

    // Afficher l'écran de résultat
    afficherResultatChronotype(profil, score);
  }

  /** Affiche l'écran de résultat du chronotype */
  function afficherResultatChronotype(profil, score) {
    onboardingScreen.classList.add('hidden');
    chronotypeResultScreen.classList.remove('hidden');

    chronotypeIcon.textContent = profil.icon;
    chronotypeResultTitle.textContent = 'Ton profil : ' + profil.label;
    chronotypeResultDesc.textContent = profil.description;

    // Afficher les créneaux optimaux
    chronotypeSlotsList.innerHTML = '';
    profil.optimalSlots.forEach((slot, i) => {
      const div = document.createElement('div');
      div.className = 'chronotype-slot-item';
      div.innerHTML = `
        <span class="chronotype-slot-time">${escapeHtml(slot)}</span>
        <span class="chronotype-slot-label">${escapeHtml(profil.slotLabels[i])}</span>
      `;
      chronotypeSlotsList.appendChild(div);
    });

    // Bouton pour démarrer l'app
    btnStartApp.addEventListener('click', () => {
      chronotypeResultScreen.classList.add('hidden');
      demarrerApp();
    });
  }

  // Affiche la date du jour dans l'en-tête
  function afficherDate() {
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    $('#currentDate').textContent = new Date().toLocaleDateString('fr-BE', options);
  }

  // ---- Persistance IndexedDB (via module StudyDB) ----

  async function sauvegarderContrat() {
    if (!contract) return;
    await StudyDB.sauvegarderContrat(contract);
  }

  async function chargerContrat() {
    const today = new Date().toISOString().slice(0, 10);
    const saved = await StudyDB.getContratParDate(today);

    if (saved) {
      contract = saved;
      if (contract.locked) {
        afficherVueVerrouillee();
      } else {
        restaurerFormulaire();
      }
    } else {
      // Nouveau jour ou pas de contrat : formulaire vierge
      contract = null;
      creerFormulaireInitial();
    }
  }

  // ---- Suggestion de créneau horaire (intégration patterns) ----

  async function afficherSuggestionCreneau() {
    const suggestion = await StudyDashboard.getSuggestionContrat();
    if (!suggestion || !suggestion.creneaux || suggestion.creneaux.length === 0) {
      suggestionCreneau.classList.add('hidden');
      return;
    }

    const creneau = suggestion.creneaux[0];
    suggestionCreneauText.textContent =
      'Suggestion : planifie tes t\u00e2ches difficiles entre ' + creneau + ' (ton cr\u00e9neau le plus efficace)';
    suggestionCreneau.classList.remove('hidden');
  }

  /** Affiche un badge avec le créneau optimal si un chronotype est défini */
  async function afficherBadgeCreneauOptimal() {
    if (!badgeCreneauOptimal) return;
    const prefs = await StudyDB.getPreferences();
    if (!prefs || !prefs.chronotypeLabel || !prefs.optimalTimeSlots) {
      badgeCreneauOptimal.classList.add('hidden');
      return;
    }

    const profil = CHRONOTYPE_PROFILES[prefs.detectedChronotype];
    if (!profil) {
      badgeCreneauOptimal.classList.add('hidden');
      return;
    }

    const heure = new Date().getHours();
    const dansCreneauOptimal = estDansCreneauOptimal(heure, prefs.optimalTimeSlots);

    if (dansCreneauOptimal) {
      badgeCreneauOptimal.innerHTML = profil.icon + ' Tu es dans ton cr\u00e9neau optimal !';
      badgeCreneauOptimal.className = 'badge-creneau badge-creneau-actif';
    } else {
      badgeCreneauOptimal.innerHTML = profil.icon + ' Profil ' + prefs.chronotypeLabel + ' \u2014 optimal : ' + prefs.optimalTimeSlots[0];
      badgeCreneauOptimal.className = 'badge-creneau';
    }
  }

  /** Vérifie si l'heure actuelle est dans un créneau optimal */
  function estDansCreneauOptimal(heure, slots) {
    for (const slot of slots) {
      const match = slot.match(/(\d+)h-(\d+)h/);
      if (match) {
        const debut = parseInt(match[1], 10);
        const fin = parseInt(match[2], 10);
        if (heure >= debut && heure < fin) return true;
      }
    }
    return false;
  }

  // ---- Sauvegarde / restauration de session interrompue ----

  /** Sauvegarde l'état du timer pour récupération en cas de refresh */
  function sauvegarderEtatTimer() {
    if (currentTaskIndex < 0) return;
    const state = {
      taskIndex: currentTaskIndex,
      remaining: timerRemaining,
      total: timerTotal,
      paused: timerPaused,
      startTime: timerStartTime,
      pausedTotal: timerPausedTotal,
      pauseStart: timerPauseStart,
      timestamp: Date.now()
    };
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state));
  }

  /** Supprime l'état de timer sauvegardé */
  function effacerEtatTimer() {
    localStorage.removeItem(TIMER_STATE_KEY);
  }

  /** Restaure une session si la page a été rafraîchie pendant le timer */
  function restaurerSessionInterrompue() {
    const raw = localStorage.getItem(TIMER_STATE_KEY);
    if (!raw || !contract || !contract.locked) {
      effacerEtatTimer();
      return;
    }

    try {
      const state = JSON.parse(raw);
      const elapsed = Math.floor((Date.now() - state.timestamp) / 1000);

      // Si plus de 5 minutes se sont écoulées, la session est considérée abandonnée
      if (elapsed > 300) {
        effacerEtatTimer();
        return;
      }

      // Vérifier que la tâche existe et n'est pas déjà terminée
      if (!contract.tasks[state.taskIndex] || contract.tasks[state.taskIndex].done) {
        effacerEtatTimer();
        return;
      }

      // Restaurer le timer avec le temps écoulé déduit
      currentTaskIndex = state.taskIndex;
      const task = contract.tasks[currentTaskIndex];

      timerTaskName.textContent = task.name;
      timerSubject.textContent = task.subject || '';
      timerTotal = state.total;
      timerRemaining = Math.max(0, state.remaining - elapsed);
      timerPaused = true; // Reprendre en pause pour laisser l'utilisateur choisir
      timerStartTime = state.startTime;
      timerPausedTotal = state.pausedTotal + (Date.now() - state.timestamp);
      timerPauseStart = Date.now();

      btnPause.textContent = 'Reprendre';
      breakSuggestion.classList.add('hidden');
      mettreAJourAffichageTimer();
      afficherVue('viewTimer');

      // Démarrer le compte à rebours (en pause)
      demarrerCompteARebours();

      afficherToast('Session restaur\u00e9e \u2014 en pause');
    } catch (_) {
      effacerEtatTimer();
    }
  }

  // ---- Formulaire de création du contrat ----

  function creerFormulaireInitial() {
    taskListEl.innerHTML = '';
    for (let i = 0; i < MIN_TASKS; i++) {
      ajouterCarteTache();
    }
    mettreAJourBoutons();
    afficherVue('viewContract');
  }

  function restaurerFormulaire() {
    taskListEl.innerHTML = '';
    contract.tasks.forEach((t) => {
      ajouterCarteTache(t);
    });
    mettreAJourBoutons();
    afficherVue('viewContract');
  }

  function ajouterCarteTache(data) {
    const index = taskListEl.children.length;
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.index = index;

    const diffVal = (data && data.difficulty) || 2;
    const diffText = DIFFICULTY_LABELS[diffVal];

    card.innerHTML = `
      <div class="task-card-header">
        <span class="task-number">T\u00e2che ${index + 1}</span>
        <button class="btn-remove-task" type="button" title="Supprimer cette t\u00e2che">&times;</button>
      </div>
      <div class="field">
        <label>Nom de la t\u00e2che *</label>
        <input type="text" class="input-name" placeholder="Ex : R\u00e9sum\u00e9 chapitre 4" value="${escapeHtml((data && data.name) || '')}" required>
      </div>
      <div class="field">
        <label>Mati\u00e8re / contexte</label>
        <input type="text" class="input-subject" placeholder="Ex : Fran\u00e7ais (optionnel)" value="${escapeHtml((data && data.subject) || '')}">
      </div>
      <div class="field-row">
        <div class="field">
          <label>Dur\u00e9e estim\u00e9e</label>
          <select class="input-duration">
            <option value="25" ${(data && data.duration === 50) ? '' : 'selected'}>25 minutes</option>
            <option value="50" ${(data && data.duration === 50) ? 'selected' : ''}>50 minutes</option>
          </select>
        </div>
        <div class="field">
          <label>Difficult\u00e9 per\u00e7ue</label>
          <div class="difficulty-group">
            <input type="range" class="input-difficulty" min="1" max="3" value="${diffVal}">
            <span class="difficulty-label">${diffText}</span>
          </div>
        </div>
      </div>
    `;

    taskListEl.appendChild(card);

    // Événement slider difficulté
    const slider = card.querySelector('.input-difficulty');
    const label = card.querySelector('.difficulty-label');
    slider.addEventListener('input', () => {
      label.textContent = DIFFICULTY_LABELS[parseInt(slider.value, 10)];
    });

    // Événement suppression
    card.querySelector('.btn-remove-task').addEventListener('click', () => {
      card.remove();
      renumeroterCartes();
      mettreAJourBoutons();
    });

    // Événement changement pour vérifier la validité
    card.querySelector('.input-name').addEventListener('input', mettreAJourBoutons);
  }

  function renumeroterCartes() {
    const cards = taskListEl.querySelectorAll('.task-card');
    cards.forEach((c, i) => {
      c.dataset.index = i;
      c.querySelector('.task-number').textContent = 'T\u00e2che ' + (i + 1);
    });
  }

  function mettreAJourBoutons() {
    const count = taskListEl.children.length;
    btnAddTask.disabled = count >= MAX_TASKS;

    const names = Array.from(taskListEl.querySelectorAll('.input-name'));
    const filledCount = names.filter((n) => n.value.trim().length > 0).length;
    btnLockContract.disabled = filledCount < MIN_TASKS;
  }

  // ---- Lecture des données du formulaire ----

  function lireTachesFormulaire() {
    const cards = taskListEl.querySelectorAll('.task-card');
    const tasks = [];
    cards.forEach((c) => {
      const name = c.querySelector('.input-name').value.trim();
      if (!name) return;
      tasks.push({
        name: name,
        subject: c.querySelector('.input-subject').value.trim(),
        duration: parseInt(c.querySelector('.input-duration').value, 10),
        difficulty: parseInt(c.querySelector('.input-difficulty').value, 10),
        done: false,
        sessionStatus: null
      });
    });
    return tasks;
  }

  // ---- Verrouillage du contrat ----

  async function verrouillerContrat() {
    const tasks = lireTachesFormulaire();
    if (tasks.length < MIN_TASKS) return;

    contract = {
      date: new Date().toISOString().slice(0, 10),
      locked: true,
      tasks: tasks
    };
    await sauvegarderContrat();
    afficherVueVerrouillee();
  }

  // ---- Vue contrat verrouillé ----

  function afficherVueVerrouillee() {
    afficherVue('viewLocked');
    rendreListeVerrouillee();
    rendreProgression();
  }

  function rendreProgression() {
    const total = contract.tasks.length;
    const done = contract.tasks.filter((t) => t.done).length;
    const pct = Math.round((done / total) * 100);

    progressSummary.innerHTML = `
      <p class="progress-text">${done} / ${total} t\u00e2che${total > 1 ? 's' : ''} accomplie${done > 1 ? 's' : ''}</p>
      <div class="progress-bar-wrapper">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
    `;
  }

  function rendreListeVerrouillee() {
    lockedTaskList.innerHTML = '';
    contract.tasks.forEach((task, idx) => {
      const li = document.createElement('li');

      // Déterminer la classe de statut visuel
      let statusClass = '';
      if (task.done && task.sessionStatus === 'with-summary') {
        statusClass = ' done status-with-summary';
      } else if (task.done && task.sessionStatus === 'without-summary') {
        statusClass = ' done status-without-summary';
      } else if (task.done) {
        statusClass = ' done';
      }

      li.className = 'locked-item' + statusClass;

      const diffText = DIFFICULTY_LABELS[task.difficulty] || '';

      // Indicateur visuel de statut
      let statusIndicator = '';
      if (task.done && task.sessionStatus === 'with-summary') {
        statusIndicator = '<span class="status-dot status-dot-green" title="Termin\u00e9 avec r\u00e9sum\u00e9"></span>';
      } else if (task.done && task.sessionStatus === 'without-summary') {
        statusIndicator = '<span class="status-dot status-dot-yellow" title="Termin\u00e9 sans r\u00e9sum\u00e9"></span>';
      } else if (!task.done) {
        statusIndicator = '<span class="status-dot status-dot-grey" title="Pas encore commenc\u00e9"></span>';
      } else {
        statusIndicator = '<span class="status-dot status-dot-green" title="Termin\u00e9"></span>';
      }

      li.innerHTML = `
        <span class="locked-item-check">${task.done ? '&#10003;' : ''}</span>
        <div class="locked-item-body">
          <div class="locked-item-name">${statusIndicator} ${escapeHtml(task.name)}</div>
          <div class="locked-item-meta">
            ${task.subject ? escapeHtml(task.subject) + ' \u2014 ' : ''}${task.duration} min \u2014 ${diffText}
          </div>
        </div>
        ${task.done
          ? '<span style="font-size:.82rem;color:var(--color-done);font-weight:600;">Fait</span>'
          : '<button class="btn-start-task" data-idx="' + idx + '">Mode concentration</button>'
        }
      `;
      lockedTaskList.appendChild(li);
    });

    // Événements sur les boutons « Mode concentration »
    lockedTaskList.querySelectorAll('.btn-start-task').forEach((btn) => {
      btn.addEventListener('click', () => {
        lancerTimer(parseInt(btn.dataset.idx, 10));
      });
    });
  }

  // ---- Timer de session ----

  function lancerTimer(taskIdx) {
    currentTaskIndex = taskIdx;
    const task = contract.tasks[taskIdx];

    timerTaskName.textContent = task.name;
    timerSubject.textContent = task.subject || '';

    timerTotal = task.duration * 60;
    timerRemaining = timerTotal;
    timerPaused = false;
    timerStartTime = Date.now();
    timerPausedTotal = 0;
    timerPauseStart = null;

    btnPause.textContent = 'Pause';
    breakSuggestion.classList.add('hidden');

    mettreAJourAffichageTimer();
    afficherVue('viewTimer');
    demarrerCompteARebours();
  }

  function demarrerCompteARebours() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (timerPaused) return;

      timerRemaining--;
      mettreAJourAffichageTimer();

      // Sauvegarder l'état périodiquement (toutes les 5 secondes)
      if (timerRemaining % 5 === 0) {
        sauvegarderEtatTimer();
      }

      if (timerRemaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        effacerEtatTimer();
        finDeSession();
      }
    }, 1000);
  }

  function mettreAJourAffichageTimer() {
    const min = Math.floor(Math.max(0, timerRemaining) / 60);
    const sec = Math.max(0, timerRemaining) % 60;
    timerDigits.textContent =
      String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');

    const progress = timerTotal > 0 ? timerRemaining / timerTotal : 1;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    timerRingProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
    timerRingProgress.style.strokeDashoffset = offset;
  }

  /** Calcule la durée réelle passée en minutes (sans les pauses) */
  function calculerDureeReelle() {
    if (!timerStartTime) return 0;
    let pauseMs = timerPausedTotal;
    if (timerPaused && timerPauseStart) {
      pauseMs += Date.now() - timerPauseStart;
    }
    const totalMs = Date.now() - timerStartTime - pauseMs;
    return Math.max(0, Math.round(totalMs / 60000));
  }

  function finDeSession() {
    if (chkSound.checked) {
      jouerSonFin();
    }
    // Marquer la tâche et déclencher le flux recall → qualité → sauvegarde
    marquerTacheAccomplieEtRecall();
  }

  /**
   * Flux complet après fin de session :
   * 1. Modal récupération active (résumé)
   * 2. Modal évaluation qualité (étoiles)
   * 3. Sauvegarde de la session avec toutes les données
   * 4. Suggestion de flashcards si résumé fourni (étape 4)
   */
  function marquerTacheAccomplieEtRecall() {
    if (currentTaskIndex < 0 || !contract.tasks[currentTaskIndex]) return;

    const task = contract.tasks[currentTaskIndex];
    const dureeReelle = calculerDureeReelle();

    // Étape 1 : Modal de récupération active
    ouvrirRecallModal((summary, skipped) => {

      // Étape 2 : Modal d'évaluation qualité
      ouvrirQualityModal((rating) => {

        // Étape 3 : Sauvegarder la session
        task.done = true;
        task.sessionStatus = skipped ? 'without-summary' : 'with-summary';
        sauvegarderContrat();

        // Extraire l'heure de la session pour le champ hourOfDay
        const heureSession = new Date().getHours();

        const sessionData = {
          taskName: task.name,
          subject: task.subject || '',
          date: Date.now(),
          duration: task.duration,
          actualDuration: dureeReelle,
          difficulty: task.difficulty,
          summary: skipped ? null : summary,
          completed: true,
          qualityRating: rating,     // 1-5 ou null si passé
          hourOfDay: heureSession    // 0-23
        };
        StudyDB.enregistrerSession(sessionData);

        // Invalider le cache du dashboard pour inclure la nouvelle session
        StudyDashboard.invaliderCache();

        // Suggestion de pause
        breakDuration.textContent = task.duration === 50 ? '10' : '5';
        breakSuggestion.classList.remove('hidden');

        afficherToast('Session enregistr\u00e9e');

        // Étape 4 : Suggestion de flashcards si résumé fourni
        if (!skipped && summary && summary.length >= MIN_RECALL_CHARS) {
          const suggestions = extraireConceptsCles(summary);
          if (suggestions.length > 0) {
            pendingSuggestions = suggestions;
            pendingSuggestionSubject = task.subject || '';
            pendingSuggestionTaskName = task.name;
            // Afficher le modal de suggestions avec un léger délai
            setTimeout(() => {
              ouvrirFlashcardSuggestionModal();
            }, 800);
          }
        }
      });
    });
  }

  // ---- Modal de récupération active ----

  /** Ouvre le modal de récupération active. Le callback reçoit (summary, skipped). */
  function ouvrirRecallModal(callback) {
    recallCallback = callback;
    recallTextarea.value = '';
    recallCharCount.textContent = '0';
    btnRecallSave.disabled = true;
    recallModal.classList.remove('hidden');
    recallTextarea.focus();
  }

  function fermerRecallModal() {
    recallModal.classList.add('hidden');
    recallCallback = null;
  }

  // ---- Modal d'évaluation qualité ----

  /** Ouvre le modal d'évaluation qualité. Le callback reçoit le rating (1-5 ou null). */
  function ouvrirQualityModal(callback) {
    qualityCallback = callback;
    selectedQuality = 0;
    mettreAJourEtoiles();
    qualitySelectedLabel.innerHTML = '&nbsp;';
    btnQualitySave.disabled = true;
    qualityModal.classList.remove('hidden');
  }

  function fermerQualityModal() {
    qualityModal.classList.add('hidden');
    qualityCallback = null;
  }

  /** Met à jour l'affichage des étoiles selon la sélection */
  function mettreAJourEtoiles() {
    qualityStarsEl.querySelectorAll('.quality-star').forEach((btn) => {
      const rating = parseInt(btn.dataset.rating, 10);
      if (rating <= selectedQuality) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // ============================================================
  // EXTRACTION DE CONCEPTS CLÉS (FLASHCARDS AUTOMATIQUES)
  // ============================================================

  /**
   * Extrait des concepts clés d'un texte (résumé de session) pour
   * proposer des cartes de révision.
   *
   * Algorithme :
   * 1. Découper en phrases (délimiteurs . ! ?)
   * 2. Chercher des patterns de définition : "X est Y", "X signifie Y"
   * 3. Chercher des patterns d'énumération : "il y a N types"
   * 4. Pour les phrases restantes : question de rappel générique
   * 5. Limiter à 5 suggestions maximum
   *
   * Retourne un tableau de { question, answer, selected: true }
   */
  function extraireConceptsCles(texte) {
    const suggestions = [];

    // Nettoyage et découpage en phrases
    const phrases = texte
      .replace(/\n+/g, '. ')
      .split(/(?<=[.!?])\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 15);

    for (const phrase of phrases) {
      if (suggestions.length >= 5) break;

      // Pattern 1 : Définition — "X est/sont/signifie/correspond à Y"
      const defMatch = phrase.match(
        /^(.{3,60}?)\s+(?:est|sont|c'est|signifie|d\u00e9signe|correspond\s+\u00e0|se\s+d\u00e9finit\s+comme)\s+(.{8,})/i
      );
      if (defMatch) {
        const sujet = defMatch[1]
          .replace(/^(le|la|les|l'|un|une|des|du|de la)\s+/i, '')
          .trim();
        suggestions.push({
          question: 'D\u00e9finis : ' + sujet.charAt(0).toUpperCase() + sujet.slice(1),
          answer: phrase.replace(/[.!?]$/, ''),
          selected: true
        });
        continue;
      }

      // Pattern 2 : Énumération — "il y a N types/catégories"
      const enumMatch = phrase.match(
        /(?:il\s+(?:y\s+a|existe))\s+(\d+)\s+(\w+)/i
      );
      if (enumMatch) {
        suggestions.push({
          question: 'Combien de ' + enumMatch[2] + ' y a-t-il ?',
          answer: phrase.replace(/[.!?]$/, ''),
          selected: true
        });
        continue;
      }

      // Pattern 3 : Phrase longue sans pattern spécifique → question de rappel
      if (phrase.length > 30) {
        const words = phrase.split(/\s+/);
        const topicWords = [];
        let len = 0;
        for (const w of words) {
          if (len + w.length > 40) break;
          topicWords.push(w);
          len += w.length + 1;
        }
        const topic = topicWords.join(' ');
        suggestions.push({
          question: 'Que retiens-tu sur : \u00ab ' + topic + '\u2026 \u00bb ?',
          answer: phrase.replace(/[.!?]$/, ''),
          selected: true
        });
      }
    }

    return suggestions;
  }

  // ============================================================
  // MODAL SUGGESTION DE FLASHCARDS
  // ============================================================

  /** Ouvre le modal de suggestion de flashcards après un résumé */
  function ouvrirFlashcardSuggestionModal() {
    if (!flashcardSuggestionModal || pendingSuggestions.length === 0) return;

    flashcardSuggestionHint.textContent =
      'J\'ai d\u00e9tect\u00e9 ' + pendingSuggestions.length +
      ' concept' + (pendingSuggestions.length > 1 ? 's' : '') +
      ' cl\u00e9' + (pendingSuggestions.length > 1 ? 's' : '') +
      ' dans ton r\u00e9sum\u00e9. Veux-tu cr\u00e9er des cartes de r\u00e9vision ?';

    // Générer la liste de suggestions avec checkboxes
    flashcardSuggestionList.innerHTML = '';
    pendingSuggestions.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'flashcard-suggestion-item';
      item.innerHTML = `
        <label class="flashcard-suggestion-check">
          <input type="checkbox" data-idx="${idx}" ${s.selected ? 'checked' : ''}>
        </label>
        <div class="flashcard-suggestion-content">
          <div class="flashcard-suggestion-q">${escapeHtml(s.question)}</div>
          <div class="flashcard-suggestion-a">${escapeHtml(s.answer)}</div>
        </div>
      `;

      item.querySelector('input').addEventListener('change', (e) => {
        pendingSuggestions[idx].selected = e.target.checked;
      });

      flashcardSuggestionList.appendChild(item);
    });

    flashcardSuggestionModal.classList.remove('hidden');
  }

  /** Sauvegarde les flashcards sélectionnées */
  async function sauvegarderFlashcardsSuggestions() {
    const selection = pendingSuggestions.filter((s) => s.selected);
    let count = 0;

    for (const s of selection) {
      await StudyDB.ajouterFlashcard({
        question: s.question,
        answer: s.answer,
        subject: pendingSuggestionSubject,
        taskName: pendingSuggestionTaskName,
        createdDate: Date.now(),
        reviewCount: 0,
        lastReviewed: null,
        difficulty: 2
      });
      count++;
    }

    flashcardSuggestionModal.classList.add('hidden');
    pendingSuggestions = [];

    if (count > 0) {
      afficherToast(count + ' carte' + (count > 1 ? 's' : '') + ' cr\u00e9\u00e9e' + (count > 1 ? 's' : ''));
    }
  }

  // ============================================================
  // MODAL CRÉATION MANUELLE DE FLASHCARD
  // ============================================================

  function ouvrirFlashcardManualModal() {
    if (!flashcardManualModal) return;
    manualFlashcardQuestion.value = '';
    manualFlashcardAnswer.value = '';
    manualFlashcardSubject.value = '';
    flashcardManualModal.classList.remove('hidden');
    manualFlashcardQuestion.focus();
  }

  async function sauvegarderFlashcardManuelle() {
    const question = manualFlashcardQuestion.value.trim();
    const answer = manualFlashcardAnswer.value.trim();
    const subject = manualFlashcardSubject.value.trim();

    if (!question || !answer) {
      afficherToast('Remplis la question et la r\u00e9ponse');
      return;
    }

    await StudyDB.ajouterFlashcard({
      question: question,
      answer: answer,
      subject: subject,
      taskName: '',
      createdDate: Date.now(),
      reviewCount: 0,
      lastReviewed: null,
      difficulty: 2
    });

    flashcardManualModal.classList.add('hidden');
    afficherToast('Carte cr\u00e9\u00e9e');

    // Rafraîchir la liste si on est sur l'onglet flashcards
    if (activeTab === 'flashcards') {
      afficherFlashcards();
    }
  }

  // ============================================================
  // ONGLET FLASHCARDS (LISTE, STATS, FILTRE)
  // ============================================================

  /** Affiche l'onglet flashcards complet */
  async function afficherFlashcards() {
    await afficherStatsFlashcards();
    await remplirFiltreMatieresFlashcards();
    await afficherListeFlashcards();
  }

  /** Affiche les statistiques en haut de l'onglet */
  async function afficherStatsFlashcards() {
    if (!flashcardStats) return;
    const stats = await StudyDB.getStatsFlashcards();

    flashcardStats.innerHTML = `
      <div class="flashcard-stat-item">
        <span class="flashcard-stat-value">${stats.total}</span>
        <span class="flashcard-stat-label">Cartes</span>
      </div>
      <div class="flashcard-stat-item">
        <span class="flashcard-stat-value">${stats.maitrisees}</span>
        <span class="flashcard-stat-label">Ma\u00eetris\u00e9es</span>
      </div>
      <div class="flashcard-stat-item">
        <span class="flashcard-stat-value">${stats.total - stats.maitrisees}</span>
        <span class="flashcard-stat-label">\u00c0 r\u00e9viser</span>
      </div>
    `;

    // Activer/désactiver le bouton de révision
    if (btnStartReview) {
      btnStartReview.disabled = stats.total === 0;
    }
  }

  /** Remplit le filtre par matière avec les matières existantes */
  async function remplirFiltreMatieresFlashcards() {
    if (!flashcardFilterSubject) return;
    const cards = await StudyDB.getToutesFlashcards();

    const matieres = new Set();
    cards.forEach((c) => {
      if (c.subject) matieres.add(c.subject);
    });

    // Garder la sélection actuelle
    const currentValue = flashcardFilterSubject.value;

    flashcardFilterSubject.innerHTML = '<option value="">Toutes les mati\u00e8res</option>';
    Array.from(matieres).sort().forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      flashcardFilterSubject.appendChild(opt);
    });

    flashcardFilterSubject.value = currentValue;
  }

  /** Affiche la liste des flashcards avec le filtre actif */
  async function afficherListeFlashcards() {
    if (!flashcardList) return;
    const matiere = flashcardFilterSubject ? flashcardFilterSubject.value : '';
    const cards = await StudyDB.getFlashcardsParMatiere(matiere);

    flashcardList.innerHTML = '';

    if (cards.length === 0) {
      flashcardEmpty.classList.remove('hidden');
      flashcardList.classList.add('hidden');
      return;
    }

    flashcardEmpty.classList.add('hidden');
    flashcardList.classList.remove('hidden');

    cards.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'flashcard-item';

      // Indicateur de maîtrise
      const maitrisee = card.reviewCount >= 3 && card.difficulty <= 1;
      const diffLabel = card.difficulty <= 1 ? 'Facile' : card.difficulty === 2 ? 'Moyen' : 'Difficile';

      div.innerHTML = `
        <div class="flashcard-item-header">
          <span class="flashcard-item-subject">${escapeHtml(card.subject || 'Sans mati\u00e8re')}</span>
          <span class="flashcard-item-diff flashcard-diff-${card.difficulty}">${diffLabel}</span>
        </div>
        <div class="flashcard-item-question">${escapeHtml(card.question)}</div>
        <div class="flashcard-item-answer">${escapeHtml(card.answer)}</div>
        <div class="flashcard-item-footer">
          <span class="flashcard-item-reviews">${card.reviewCount} r\u00e9vision${card.reviewCount !== 1 ? 's' : ''}${maitrisee ? ' \u2014 Ma\u00eetris\u00e9e' : ''}</span>
          <button class="btn-delete-flashcard" data-id="${card.id}" title="Supprimer">&times;</button>
        </div>
      `;

      // Événement suppression
      div.querySelector('.btn-delete-flashcard').addEventListener('click', async () => {
        await StudyDB.supprimerFlashcard(card.id);
        afficherToast('Carte supprim\u00e9e');
        afficherFlashcards();
      });

      flashcardList.appendChild(div);
    });
  }

  // ============================================================
  // MODE RÉVISION DE FLASHCARDS
  // ============================================================

  /** Démarre une session de révision */
  async function demarrerRevision() {
    const matiere = flashcardFilterSubject ? flashcardFilterSubject.value : '';
    const cards = await StudyDB.getFlashcardsParMatiere(matiere);

    if (cards.length === 0) {
      afficherToast('Aucune carte \u00e0 r\u00e9viser');
      return;
    }

    // Trier : cartes non maîtrisées en premier, puis par ancienneté de révision
    reviewCards = cards.sort((a, b) => {
      const aMaitrisee = a.reviewCount >= 3 && a.difficulty <= 1;
      const bMaitrisee = b.reviewCount >= 3 && b.difficulty <= 1;
      if (aMaitrisee !== bMaitrisee) return aMaitrisee ? 1 : -1;
      return (a.lastReviewed || 0) - (b.lastReviewed || 0);
    }).slice(0, 20); // Maximum 20 cartes par session

    reviewIndex = 0;
    reviewFlipped = false;

    afficherCarteRevision();
    flashcardReviewModal.classList.remove('hidden');
  }

  /** Affiche la carte courante dans le mode révision */
  function afficherCarteRevision() {
    if (reviewIndex >= reviewCards.length) {
      finDeRevision();
      return;
    }

    const card = reviewCards[reviewIndex];
    reviewProgress.textContent = (reviewIndex + 1) + ' / ' + reviewCards.length;
    reviewQuestionText.textContent = card.question;
    reviewAnswerText.textContent = card.answer;
    reviewSubject.textContent = card.subject || '';

    // Remettre la carte face question
    reviewFlipped = false;
    flashcardFlipInner.classList.remove('flipped');
    btnRevealAnswer.classList.remove('hidden');
    reviewButtons.classList.add('hidden');
  }

  /** Retourne la carte pour révéler la réponse */
  function revelerReponse() {
    reviewFlipped = true;
    flashcardFlipInner.classList.add('flipped');
    btnRevealAnswer.classList.add('hidden');
    reviewButtons.classList.remove('hidden');
  }

  /** L'utilisateur savait la réponse */
  async function revisionJeSavais() {
    const card = reviewCards[reviewIndex];
    card.reviewCount = (card.reviewCount || 0) + 1;
    card.lastReviewed = Date.now();
    card.difficulty = Math.max(1, (card.difficulty || 2) - 1);
    await StudyDB.mettreAJourFlashcard(card);

    reviewIndex++;
    afficherCarteRevision();
  }

  /** L'utilisateur ne savait pas → à revoir */
  async function revisionARevoir() {
    const card = reviewCards[reviewIndex];
    card.reviewCount = (card.reviewCount || 0) + 1;
    card.lastReviewed = Date.now();
    card.difficulty = Math.min(3, (card.difficulty || 2) + 1);
    await StudyDB.mettreAJourFlashcard(card);

    reviewIndex++;
    afficherCarteRevision();
  }

  /** Fin de la session de révision */
  function finDeRevision() {
    flashcardReviewModal.classList.add('hidden');
    afficherToast('R\u00e9vision termin\u00e9e !');

    // Rafraîchir la liste si sur l'onglet flashcards
    if (activeTab === 'flashcards') {
      afficherFlashcards();
    }
  }

  // ---- Timer : pause / terminer / abandonner ----

  function togglePause() {
    timerPaused = !timerPaused;
    if (timerPaused) {
      timerPauseStart = Date.now();
      btnPause.textContent = 'Reprendre';
    } else {
      if (timerPauseStart) {
        timerPausedTotal += Date.now() - timerPauseStart;
        timerPauseStart = null;
      }
      btnPause.textContent = 'Pause';
    }
    sauvegarderEtatTimer();
  }

  function terminerSession() {
    clearInterval(timerInterval);
    timerInterval = null;
    effacerEtatTimer();

    if (currentTaskIndex >= 0 && contract.tasks[currentTaskIndex]) {
      marquerTacheAccomplieEtRecall();
    }
  }

  function abandonnerSession() {
    afficherConfirmation(
      'Es-tu s\u00fbr\u00b7e de vouloir abandonner cette session\u00a0?',
      'Oui, abandonner',
      () => {
        clearInterval(timerInterval);
        timerInterval = null;
        effacerEtatTimer();
        retourContrat();
      }
    );
  }

  function retourContrat() {
    currentTaskIndex = -1;
    timerStartTime = null;
    timerPausedTotal = 0;
    timerPauseStart = null;
    breakSuggestion.classList.add('hidden');
    afficherVueVerrouillee();
  }

  // ---- Son de fin de session ----

  function jouerSonFin() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [440, 523.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.3 + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.3);
        osc.stop(ctx.currentTime + i * 0.3 + 0.7);
      });
    } catch (_) {
      // Navigateur ne supporte pas AudioContext, on ignore
    }
  }

  // ---- Toast / notification discrète ----

  let toastTimeout = null;

  function afficherToast(message) {
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    toastEl.classList.add('toast-visible');

    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('toast-visible');
      toastEl.classList.add('toast-hiding');
      setTimeout(() => {
        toastEl.classList.add('hidden');
        toastEl.classList.remove('toast-hiding');
      }, 400);
    }, 2500);
  }

  // ---- Historique des sessions ----

  async function afficherHistorique() {
    const sessions = await StudyDB.getDernieresSessions(20);

    if (sessions.length === 0) {
      historyList.innerHTML = '';
      historyEmpty.classList.remove('hidden');
      return;
    }

    historyEmpty.classList.add('hidden');
    historyList.innerHTML = '';

    sessions.forEach((session) => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const dateObj = new Date(session.date);
      const dateStr = dateObj.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      const timeStr = dateObj.toLocaleTimeString('fr-BE', {
        hour: '2-digit', minute: '2-digit'
      });

      const hasSummary = session.summary && session.summary.length > 0;
      let summaryPreview = '';
      if (hasSummary) {
        const truncated = session.summary.length > 80
          ? session.summary.substring(0, 80) + '\u2026'
          : session.summary;
        summaryPreview = '<p class="history-summary" title="Cliquer pour voir en entier">' + escapeHtml(truncated) + '</p>';
      } else {
        summaryPreview = '<p class="history-no-summary">Pas de r\u00e9sum\u00e9</p>';
      }

      const statusDot = hasSummary
        ? '<span class="status-dot status-dot-green"></span>'
        : '<span class="status-dot status-dot-yellow"></span>';

      // Affichage de la qualité si disponible
      let qualityDisplay = '';
      if (session.qualityRating != null && session.qualityRating >= 1) {
        const stars = '\u2605'.repeat(session.qualityRating) +
                      '\u2606'.repeat(5 - session.qualityRating);
        qualityDisplay = '<span class="history-quality" title="Qualit\u00e9 de concentration">' + stars + '</span>';
      }

      card.innerHTML = `
        <div class="history-card-header">
          <span class="history-date">${dateStr} \u00e0 ${timeStr}</span>
          <div class="history-card-badges">
            ${qualityDisplay}
            ${statusDot}
          </div>
        </div>
        <div class="history-card-body">
          <div class="history-task-name">${escapeHtml(session.taskName)}</div>
          <div class="history-meta">
            ${session.subject ? escapeHtml(session.subject) + ' \u2014 ' : ''}${session.actualDuration || session.duration} min effective${(session.actualDuration || session.duration) > 1 ? 's' : ''}
          </div>
          ${summaryPreview}
        </div>
      `;

      if (hasSummary) {
        card.querySelector('.history-summary').addEventListener('click', () => {
          ouvrirDetailResume(session.taskName, session.summary);
        });
      }

      historyList.appendChild(card);
    });
  }

  /** Ouvre le modal de détail d'un résumé */
  function ouvrirDetailResume(taskName, summary) {
    summaryDetailTitle.textContent = 'R\u00e9sum\u00e9 \u2014 ' + taskName;
    summaryDetailText.textContent = summary;
    summaryDetailModal.classList.remove('hidden');
  }

  // ---- Export CSV ----

  async function exporterCSV() {
    const sessions = await StudyDB.getToutesSessions();
    if (sessions.length === 0) {
      afficherToast('Aucune session \u00e0 exporter');
      return;
    }

    // En-tête CSV (ajout qualité et heure)
    const headers = [
      'Date', 'Heure', 'T\u00e2che', 'Mati\u00e8re',
      'Dur\u00e9e pr\u00e9vue (min)', 'Dur\u00e9e r\u00e9elle (min)',
      'Difficult\u00e9', 'Qualit\u00e9 (1-5)', 'R\u00e9sum\u00e9', 'Compl\u00e9t\u00e9'
    ];
    const rows = [headers.join(';')];

    sessions.forEach((s) => {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString('fr-BE');
      const timeStr = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const diffLabel = DIFFICULTY_LABELS[s.difficulty] || '';
      const summaryClean = s.summary ? '"' + s.summary.replace(/"/g, '""') + '"' : '';
      const qualite = s.qualityRating != null ? s.qualityRating : '';

      rows.push([
        dateStr,
        timeStr,
        '"' + (s.taskName || '').replace(/"/g, '""') + '"',
        '"' + (s.subject || '').replace(/"/g, '""') + '"',
        s.duration,
        s.actualDuration || '',
        diffLabel,
        qualite,
        summaryClean,
        s.completed ? 'Oui' : 'Non'
      ].join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'study-sessions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    afficherToast('Export CSV t\u00e9l\u00e9charg\u00e9');
  }

  // ---- Dialogue de confirmation ----

  function afficherConfirmation(message, labelOui, callback) {
    confirmMessage.textContent = message;
    btnConfirmYes.textContent = labelOui;
    confirmCallback = callback;
    confirmDialog.classList.remove('hidden');
  }

  function fermerConfirmation() {
    confirmDialog.classList.add('hidden');
    confirmCallback = null;
  }

  // ---- Réinitialisation (nouvelle journée) ----

  function nouvelleJournee() {
    afficherConfirmation(
      'Commencer une nouvelle journ\u00e9e\u00a0? Le contrat actuel sera effac\u00e9.',
      'Oui, recommencer',
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        await StudyDB.supprimerContratDuJour(today);
        contract = null;
        creerFormulaireInitial();
      }
    );
  }

  // ---- Données de démonstration ----

  function chargerDemo() {
    const demoTasks = [
      { name: 'R\u00e9sum\u00e9 chapitre 4', subject: 'Fran\u00e7ais', duration: 25, difficulty: 2, done: false },
      { name: 'Exercices \u00e9quations', subject: 'Maths', duration: 50, difficulty: 3, done: false },
      { name: 'Relire notes cours', subject: 'Sciences', duration: 25, difficulty: 1, done: false }
    ];
    taskListEl.innerHTML = '';
    demoTasks.forEach((t) => ajouterCarteTache(t));
    mettreAJourBoutons();
  }

  // ---- Navigation entre vues et onglets ----

  function afficherVue(id) {
    [viewContract, viewLocked, viewTimer].forEach((v) => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');

    // Masquer la navigation quand on est dans le timer
    if (id === 'viewTimer') {
      appNav.classList.add('hidden');
    } else {
      appNav.classList.remove('hidden');
    }
  }

  function changerOnglet(tab) {
    activeTab = tab;

    // Mettre à jour les classes actives des onglets
    appNav.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Masquer tous les onglets
    tabMain.classList.add('hidden');
    tabHistory.classList.add('hidden');
    if (tabFlashcards) tabFlashcards.classList.add('hidden');
    tabDashboard.classList.add('hidden');

    if (tab === 'main') {
      tabMain.classList.remove('hidden');
    } else if (tab === 'history') {
      tabHistory.classList.remove('hidden');
      afficherHistorique();
    } else if (tab === 'flashcards') {
      if (tabFlashcards) {
        tabFlashcards.classList.remove('hidden');
        afficherFlashcards();
      }
    } else if (tab === 'dashboard') {
      tabDashboard.classList.remove('hidden');
      // Charger le dashboard chronobiologique
      StudyDashboard.afficherDashboard();
      // Afficher la carte chronotype dans le dashboard
      afficherChronotypeCardDashboard();
    }
  }

  // ---- Carte chronotype dans le dashboard ----

  async function afficherChronotypeCardDashboard() {
    if (!chronotypeCard) return;
    const prefs = await StudyDB.getPreferences();
    if (!prefs || !prefs.chronotypeLabel) {
      chronotypeCard.style.display = 'none';
      return;
    }

    const profil = CHRONOTYPE_PROFILES[prefs.detectedChronotype];
    if (!profil) {
      chronotypeCard.style.display = 'none';
      return;
    }

    chronotypeCard.style.display = '';
    chronotypeCardIcon.textContent = profil.icon;
    chronotypeCardLabel.textContent = 'Profil ' + profil.label;

    if (prefs.questionnaireDate) {
      const date = new Date(prefs.questionnaireDate);
      chronotypeCardDate.textContent = 'Test du ' + date.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    } else {
      chronotypeCardDate.textContent = '';
    }
  }

  /** Relance le questionnaire chronotype depuis le dashboard */
  function relancerChronotype() {
    masquerAppPrincipale();
    tabDashboard.classList.add('hidden');
    demarrerOnboarding();
  }

  // ---- Utilitaire : échappement HTML ----

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  // ---- Enregistrement du Service Worker ----

  function enregistrerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Échec silencieux — l'app fonctionne sans SW
      });
    }
  }

  // ---- Attache des événements ----

  function attacherEvenements() {
    // Formulaire de contrat
    btnAddTask.addEventListener('click', () => {
      if (taskListEl.children.length < MAX_TASKS) {
        ajouterCarteTache();
        mettreAJourBoutons();
      }
    });

    btnLockContract.addEventListener('click', verrouillerContrat);
    btnLoadDemo.addEventListener('click', chargerDemo);
    btnResetDay.addEventListener('click', nouvelleJournee);

    // Timer
    btnPause.addEventListener('click', togglePause);
    btnFinish.addEventListener('click', terminerSession);
    btnAbandon.addEventListener('click', abandonnerSession);
    btnBackToList.addEventListener('click', () => {
      if (timerInterval) {
        afficherConfirmation(
          'Quitter la session en cours\u00a0? La t\u00e2che ne sera pas marqu\u00e9e comme accomplie.',
          'Oui, quitter',
          () => {
            clearInterval(timerInterval);
            timerInterval = null;
            effacerEtatTimer();
            retourContrat();
          }
        );
      } else {
        retourContrat();
      }
    });

    btnDismissBreak.addEventListener('click', () => {
      breakSuggestion.classList.add('hidden');
      retourContrat();
    });

    // Dialogue de confirmation
    btnConfirmYes.addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      fermerConfirmation();
    });
    btnConfirmNo.addEventListener('click', fermerConfirmation);

    // Navigation par onglets
    appNav.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        changerOnglet(btn.dataset.tab);
      });
    });

    // ---- Modal récupération active ----

    recallTextarea.addEventListener('input', () => {
      const len = recallTextarea.value.trim().length;
      recallCharCount.textContent = len;
      btnRecallSave.disabled = len < MIN_RECALL_CHARS;

      const counterEl = recallCharCount.parentElement;
      if (len >= MIN_RECALL_CHARS) {
        counterEl.classList.add('recall-counter-ok');
      } else {
        counterEl.classList.remove('recall-counter-ok');
      }
    });

    btnRecallSave.addEventListener('click', () => {
      const summary = recallTextarea.value.trim();
      if (summary.length < MIN_RECALL_CHARS) return;
      if (recallCallback) {
        recallCallback(summary, false);
      }
      fermerRecallModal();
    });

    btnRecallSkip.addEventListener('click', () => {
      if (recallCallback) {
        recallCallback(null, true);
      }
      fermerRecallModal();
    });

    // ---- Modal évaluation qualité ----

    // Clic sur une étoile
    qualityStarsEl.querySelectorAll('.quality-star').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedQuality = parseInt(btn.dataset.rating, 10);
        mettreAJourEtoiles();
        qualitySelectedLabel.textContent = QUALITY_LABELS[selectedQuality] || '';
        btnQualitySave.disabled = false;
      });
    });

    btnQualitySave.addEventListener('click', () => {
      if (selectedQuality >= 1 && qualityCallback) {
        qualityCallback(selectedQuality);
      }
      fermerQualityModal();
    });

    btnQualitySkip.addEventListener('click', () => {
      if (qualityCallback) {
        qualityCallback(null);
      }
      fermerQualityModal();
    });

    // ---- Modal détail résumé ----
    btnCloseSummaryDetail.addEventListener('click', () => {
      summaryDetailModal.classList.add('hidden');
    });

    // Export CSV
    btnExportCSV.addEventListener('click', exporterCSV);

    // ---- Dashboard : navigation heatmap et exports PNG ----
    const btnWeekPrev = $('#btnWeekPrev');
    const btnWeekNext = $('#btnWeekNext');
    const btnExportHeatmap = $('#btnExportHeatmap');
    const btnExportQualite = $('#btnExportQualite');

    if (btnWeekPrev) btnWeekPrev.addEventListener('click', StudyDashboard.semainePrecedente);
    if (btnWeekNext) btnWeekNext.addEventListener('click', StudyDashboard.semaineSuivante);
    if (btnExportHeatmap) btnExportHeatmap.addEventListener('click', () => StudyDashboard.exporterPNG('heatmap'));
    if (btnExportQualite) btnExportQualite.addEventListener('click', () => StudyDashboard.exporterPNG('qualite'));

    // ---- Flashcard Suggestion Modal ----
    if (btnFlashcardSuggestionSave) {
      btnFlashcardSuggestionSave.addEventListener('click', sauvegarderFlashcardsSuggestions);
    }
    if (btnFlashcardSuggestionSkip) {
      btnFlashcardSuggestionSkip.addEventListener('click', () => {
        flashcardSuggestionModal.classList.add('hidden');
        pendingSuggestions = [];
      });
    }

    // ---- Flashcard Manual Modal ----
    if (btnCreateManualFlashcard) {
      btnCreateManualFlashcard.addEventListener('click', ouvrirFlashcardManualModal);
    }
    if (btnManualFlashcardSave) {
      btnManualFlashcardSave.addEventListener('click', sauvegarderFlashcardManuelle);
    }
    if (btnManualFlashcardCancel) {
      btnManualFlashcardCancel.addEventListener('click', () => {
        flashcardManualModal.classList.add('hidden');
      });
    }

    // ---- Flashcard Review Modal ----
    if (btnStartReview) {
      btnStartReview.addEventListener('click', demarrerRevision);
    }
    if (btnRevealAnswer) {
      btnRevealAnswer.addEventListener('click', revelerReponse);
    }
    if (btnReviewKnew) {
      btnReviewKnew.addEventListener('click', revisionJeSavais);
    }
    if (btnReviewRetry) {
      btnReviewRetry.addEventListener('click', revisionARevoir);
    }
    if (btnCloseReview) {
      btnCloseReview.addEventListener('click', () => {
        flashcardReviewModal.classList.add('hidden');
        if (activeTab === 'flashcards') afficherFlashcards();
      });
    }
    // Clic sur le conteneur de carte pour retourner
    if (flashcardFlipContainer) {
      flashcardFlipContainer.addEventListener('click', () => {
        if (!reviewFlipped) revelerReponse();
      });
    }

    // ---- Flashcard Filter ----
    if (flashcardFilterSubject) {
      flashcardFilterSubject.addEventListener('change', afficherListeFlashcards);
    }

    // ---- Dashboard : Refaire le test chronotype ----
    if (btnRefaireChronotype) {
      btnRefaireChronotype.addEventListener('click', relancerChronotype);
    }

    // Sauvegarde de l'état du timer avant fermeture/refresh de la page
    window.addEventListener('beforeunload', () => {
      if (timerInterval && currentTaskIndex >= 0) {
        sauvegarderEtatTimer();
      }
    });
  }

  // ---- Lancement ----
  document.addEventListener('DOMContentLoaded', init);

})();
