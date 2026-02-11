// ============================================================
// Study Protocol Manager — Application principale (v1.0 finale)
// Gère : contrat quotidien, timer, récupération active,
// évaluation qualité, historique paginé, flashcards SM-2,
// onboarding, dark mode, tooltips contextuels, export/import.
// ============================================================

(function () {
  'use strict';

  // ---- État global ----
  let activeTab = 'main';
  let contratDuJour = null;
  let currentTaskIndex = -1;
  let timerInterval = null;
  let timerSecondsLeft = 0;
  let timerTotalSeconds = 0;
  let timerPaused = false;
  let timerStartedAt = null;
  let timerPausedElapsed = 0;
  let sessionPending = null;

  // Historique paginé
  let historyOffset = 0;
  const HISTORY_PAGE_SIZE = 20;

  // Flashcards
  let reviewCards = [];
  let reviewIndex = 0;
  let reviewFlipped = false;
  let reviewMode = 'due'; // 'due' ou 'all'

  // Onboarding
  let onboardingStep = 0;
  let onboardingAnswers = [0, 0, 0, 0, 0];
  let welcomeSlide = 0;

  // Qualité
  let selectedQuality = 0;

  // Import
  let pendingImportFile = null;

  // Tooltips shown (persisted in localStorage)
  let tooltipsShown = {};

  // ---- Constantes ----
  const DIFFICULTY_LABELS = ['', 'Facile', 'Moyen', 'Difficile'];
  const QUALITY_LABELS = ['', 'Très difficile', 'Difficile', 'Moyenne', 'Bonne', 'Excellente'];
  const CIRCUMFERENCE = 2 * Math.PI * 90; // ~565.49

  const CHRONOTYPE_QUESTIONS = [
    {
      text: 'Si tu pouvais te lever à l\'heure que tu veux (sans réveil), à quelle heure te réveillerais-tu naturellement ?',
      options: [
        { label: 'Avant 7h', score: 5 },
        { label: 'Entre 7h et 8h', score: 4 },
        { label: 'Entre 8h et 9h30', score: 3 },
        { label: 'Entre 9h30 et 11h', score: 2 },
        { label: 'Après 11h', score: 1 }
      ]
    },
    {
      text: 'À quel moment de la journée te sens-tu le plus alerte et efficace pour réfléchir ?',
      options: [
        { label: 'Tôt le matin (8h-10h)', score: 5 },
        { label: 'En fin de matinée (10h-12h)', score: 4 },
        { label: 'En début d\'après-midi (13h-15h)', score: 3 },
        { label: 'En fin d\'après-midi (15h-18h)', score: 2 },
        { label: 'Le soir (après 18h)', score: 1 }
      ]
    },
    {
      text: 'Si tu devais passer un examen important, à quelle heure préférerais-tu le planifier ?',
      options: [
        { label: '8h-10h', score: 5 },
        { label: '10h-12h', score: 4 },
        { label: '13h-15h', score: 3 },
        { label: '15h-17h', score: 2 },
        { label: 'Après 17h', score: 1 }
      ]
    },
    {
      text: 'En soirée, à partir de quelle heure commences-tu à te sentir fatigué·e ?',
      options: [
        { label: 'Avant 21h', score: 5 },
        { label: 'Vers 21h-22h', score: 4 },
        { label: 'Vers 22h-23h', score: 3 },
        { label: 'Vers 23h-minuit', score: 2 },
        { label: 'Après minuit', score: 1 }
      ]
    },
    {
      text: 'Comment te décrirais-tu globalement ?',
      options: [
        { label: 'Définitivement du matin', score: 5 },
        { label: 'Plutôt du matin', score: 4 },
        { label: 'Ni l\'un ni l\'autre', score: 3 },
        { label: 'Plutôt du soir', score: 2 },
        { label: 'Définitivement du soir', score: 1 }
      ]
    }
  ];

  const CHRONOTYPE_PROFILES = {
    matinal: {
      icon: '\u2600\uFE0F',
      label: 'Profil Matinal',
      desc: 'Tu es naturellement plus productif·ve le matin. Ton pic de concentration se situe en début de journée. Profite de ces moments pour les tâches les plus exigeantes.',
      slots: [
        { time: '8h - 12h', label: 'Pic de concentration' },
        { time: '14h - 16h', label: 'Deuxième créneau' }
      ],
      preferred: ['08:00-12:00', '14:00-16:00']
    },
    intermediaire: {
      icon: '\u26C5',
      label: 'Profil Intermédiaire',
      desc: 'Tu as un rythme équilibré avec une bonne énergie en milieu de journée. Tu peux étudier efficacement sur de larges plages horaires.',
      slots: [
        { time: '10h - 12h', label: 'Pic de concentration' },
        { time: '15h - 18h', label: 'Deuxième créneau' }
      ],
      preferred: ['10:00-12:00', '15:00-18:00']
    },
    vesperal: {
      icon: '\uD83C\uDF19',
      label: 'Profil Vespéral',
      desc: 'Tu es plus efficace en fin de journée et le soir. Ton cerveau se met en marche progressivement et atteint son pic dans l\'après-midi.',
      slots: [
        { time: '14h - 17h', label: 'Pic de concentration' },
        { time: '19h - 21h', label: 'Deuxième créneau' }
      ],
      preferred: ['14:00-17:00', '19:00-21:00']
    }
  };

  // ==================================================================
  // INITIALISATION
  // ==================================================================

  document.addEventListener('DOMContentLoaded', async () => {
    await StudyDB.init();

    // Charger les tooltips déjà vus
    try {
      tooltipsShown = JSON.parse(localStorage.getItem('studyproto_tooltips_shown') || '{}');
    } catch (_) { tooltipsShown = {}; }

    // Appliquer le thème
    appliquerTheme();

    // Afficher la date
    afficherDate();

    // Vérifier si première utilisation
    const premiere = await StudyDB.estPremiereUtilisation();
    if (premiere) {
      afficherWelcomeScreen();
    } else {
      await chargerContratDuJour();
    }

    // Attacher les événements
    attacherEvenements();

    // Service Worker
    enregistrerSW();
  });

  function afficherDate() {
    const el = document.getElementById('currentDate');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleDateString('fr-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }
  }

  function enregistrerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        // Vérifier mise à jour
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                afficherToast('Nouvelle version disponible. Recharge la page.');
              }
            });
          }
        });
      }).catch(() => {});
    }
  }

  // ==================================================================
  // THÈME SOMBRE
  // ==================================================================

  function appliquerTheme() {
    const saved = localStorage.getItem('studyproto_theme') || 'light';
    const radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach((r) => { if (r.value === saved) r.checked = true; });
    setTheme(saved);
  }

  function setTheme(mode) {
    if (mode === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
    localStorage.setItem('studyproto_theme', mode);
    // Update meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      meta.setAttribute('content', isDark ? '#1a1a2e' : '#4a7c8a');
    }
  }

  // ==================================================================
  // WELCOME SLIDES (première visite)
  // ==================================================================

  function afficherWelcomeScreen() {
    document.getElementById('appHeader').classList.add('hidden');
    document.getElementById('appNav').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('appFooter').classList.add('hidden');
    document.getElementById('welcomeScreen').classList.remove('hidden');
    welcomeSlide = 0;
    renderWelcomeSlide();
  }

  function renderWelcomeSlide() {
    const slides = document.querySelectorAll('.welcome-slide');
    const dots = document.querySelectorAll('.welcome-dot');
    slides.forEach((s, i) => s.classList.toggle('hidden', i !== welcomeSlide));
    dots.forEach((d, i) => d.classList.toggle('active', i === welcomeSlide));
    const btn = document.getElementById('btnWelcomeNext');
    btn.textContent = welcomeSlide === 3 ? 'C\'est parti !' : 'Suivant';
  }

  function nextWelcomeSlide() {
    if (welcomeSlide < 3) {
      welcomeSlide++;
      renderWelcomeSlide();
    } else {
      // Fin des slides → questionnaire chronotype
      document.getElementById('welcomeScreen').classList.add('hidden');
      afficherOnboarding();
    }
  }

  // ==================================================================
  // ONBOARDING CHRONOTYPE
  // ==================================================================

  function afficherOnboarding() {
    document.getElementById('appHeader').classList.add('hidden');
    document.getElementById('appNav').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('appFooter').classList.add('hidden');
    document.getElementById('onboardingScreen').classList.remove('hidden');
    onboardingStep = 0;
    onboardingAnswers = [0, 0, 0, 0, 0];
    rendreQuestionOnboarding();
  }

  function rendreQuestionOnboarding() {
    const q = CHRONOTYPE_QUESTIONS[onboardingStep];
    const container = document.getElementById('onboardingQuestions');
    const progressBar = document.getElementById('onboardingProgressBar');
    const stepLabel = document.getElementById('onboardingStepLabel');
    const btnPrev = document.getElementById('btnOnboardingPrev');
    const btnNext = document.getElementById('btnOnboardingNext');

    progressBar.style.width = ((onboardingStep + 1) * 20) + '%';
    stepLabel.textContent = 'Question ' + (onboardingStep + 1) + ' / 5';
    btnPrev.disabled = onboardingStep === 0;

    let html = '<p class="onboarding-question-text">' + escapeHtml(q.text) + '</p>';
    html += '<div class="onboarding-options">';
    q.options.forEach((opt, i) => {
      const checked = onboardingAnswers[onboardingStep] === opt.score ? 'checked' : '';
      html += '<label class="onboarding-option">';
      html += '<input type="radio" name="chronoQ' + onboardingStep + '" value="' + opt.score + '" ' + checked + '>';
      html += '<span class="onboarding-option-label">' + escapeHtml(opt.label) + '</span>';
      html += '</label>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Événements radios
    container.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        onboardingAnswers[onboardingStep] = parseInt(radio.value);
        btnNext.disabled = false;
      });
    });

    btnNext.disabled = onboardingAnswers[onboardingStep] === 0;
    btnNext.textContent = onboardingStep === 4 ? 'Voir mon profil' : 'Suivant \u2192';
  }

  function onboardingPrevious() {
    if (onboardingStep > 0) {
      onboardingStep--;
      rendreQuestionOnboarding();
    }
  }

  function onboardingNext() {
    if (onboardingStep < 4) {
      onboardingStep++;
      rendreQuestionOnboarding();
    } else {
      calculerChronotype();
    }
  }

  function skipOnboarding() {
    document.getElementById('onboardingScreen').classList.add('hidden');
    montrerApp();
  }

  async function calculerChronotype() {
    const totalScore = onboardingAnswers.reduce((a, b) => a + b, 0);
    let profil;
    if (totalScore >= 19) profil = 'matinal';
    else if (totalScore >= 12) profil = 'intermediaire';
    else profil = 'vesperal';

    const profile = CHRONOTYPE_PROFILES[profil];

    // Sauvegarder
    const prefs = {
      preferredTimeSlots: profile.preferred,
      detectedChronotype: profil,
      chronotypeScore: totalScore,
      chronotypeLabel: profile.label,
      optimalTimeSlots: profile.slots.map((s) => s.time),
      questionnaireDate: Date.now(),
      lastUpdated: Date.now()
    };
    await StudyDB.sauvegarderPreferences(prefs);

    // Afficher résultat
    document.getElementById('onboardingScreen').classList.add('hidden');
    document.getElementById('chronotypeResultScreen').classList.remove('hidden');

    document.getElementById('chronotypeIcon').textContent = profile.icon;
    document.getElementById('chronotypeResultTitle').textContent = 'Ton profil : ' + profile.label;
    document.getElementById('chronotypeResultDesc').textContent = profile.desc;

    const slotsList = document.getElementById('chronotypeSlotsList');
    slotsList.innerHTML = profile.slots.map((s) =>
      '<div class="chronotype-slot-item">' +
      '<span class="chronotype-slot-time">' + s.time + '</span>' +
      '<span class="chronotype-slot-label">' + s.label + '</span>' +
      '</div>'
    ).join('');
  }

  function startAppAfterOnboarding() {
    document.getElementById('chronotypeResultScreen').classList.add('hidden');
    montrerApp();
  }

  function montrerApp() {
    document.getElementById('appHeader').classList.remove('hidden');
    document.getElementById('appNav').classList.remove('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('appFooter').classList.remove('hidden');
    chargerContratDuJour();
  }

  // ==================================================================
  // NAVIGATION PAR ONGLETS
  // ==================================================================

  function changerOnglet(tab) {
    activeTab = tab;
    const tabs = ['tabMain', 'tabDashboard', 'tabFlashcards', 'tabHistory', 'tabSettings'];
    const tabMap = { main: 'tabMain', dashboard: 'tabDashboard', flashcards: 'tabFlashcards', history: 'tabHistory', settings: 'tabSettings' };
    tabs.forEach((t) => {
      const el = document.getElementById(t);
      if (el) el.classList.toggle('hidden', t !== tabMap[tab]);
    });
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Charger le contenu de l'onglet
    if (tab === 'dashboard') {
      StudyDashboard.afficherDashboard();
      afficherChronotypeCard();
      showTooltip('dashboard', 'Ton heatmap se remplira au fur et à mesure de tes sessions. Plus tu travailles, plus les patterns apparaissent.');
    } else if (tab === 'flashcards') {
      afficherFlashcards();
    } else if (tab === 'history') {
      historyOffset = 0;
      chargerHistorique();
    } else if (tab === 'settings') {
      chargerParametres();
    }
  }

  // ==================================================================
  // CONTRAT QUOTIDIEN
  // ==================================================================

  async function chargerContratDuJour() {
    const today = new Date().toISOString().slice(0, 10);
    contratDuJour = await StudyDB.getContratParDate(today);

    if (contratDuJour && contratDuJour.locked) {
      afficherContratVerrouille();
    } else {
      afficherFormulaireContrat();
    }

    // Suggestion créneau
    await afficherSuggestionCreneau();
  }

  async function afficherSuggestionCreneau() {
    const suggestion = await StudyDashboard.getSuggestionContrat();
    const el = document.getElementById('suggestionCreneau');
    const txt = document.getElementById('suggestionCreneauText');
    if (!suggestion || !suggestion.creneaux || suggestion.creneaux.length === 0) {
      el.classList.add('hidden');
      return;
    }
    const prefs = await StudyDB.getPreferences();
    if (prefs && prefs.chronotypeLabel) {
      txt.textContent = prefs.chronotypeLabel + ' — Tes créneaux optimaux : ' + suggestion.creneaux.join(', ');
    } else {
      txt.textContent = 'Tes créneaux optimaux détectés : ' + suggestion.creneaux.join(', ');
    }
    el.classList.remove('hidden');
  }

  function afficherFormulaireContrat() {
    show('viewContract'); hide('viewLocked'); hide('viewTimer');

    const taskList = document.getElementById('taskList');
    if (contratDuJour && contratDuJour.tasks && contratDuJour.tasks.length > 0) {
      taskList.innerHTML = '';
      contratDuJour.tasks.forEach((t, i) => ajouterChampsTask(i, t));
    } else {
      taskList.innerHTML = '';
      ajouterChampsTask(0);
    }
    validerFormulaire();
  }

  function ajouterChampsTask(index, data) {
    const taskList = document.getElementById('taskList');
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.index = index;

    const diff = data ? data.difficulty : 2;
    card.innerHTML =
      '<div class="task-card-header">' +
      '<span class="task-number">T\u00e2che ' + (index + 1) + '</span>' +
      '<button class="btn-remove-task" type="button" title="Supprimer">\u00D7</button>' +
      '</div>' +
      '<div class="field"><label>Nom de la t\u00e2che</label>' +
      '<input type="text" class="task-name" placeholder="Ex : R\u00e9sum\u00e9 chapitre 4" value="' + escapeAttr(data ? data.name : '') + '"></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>Mati\u00e8re</label>' +
      '<input type="text" class="task-subject" placeholder="Ex : Maths" value="' + escapeAttr(data ? data.subject : '') + '"></div>' +
      '<div class="field"><label>Dur\u00e9e</label>' +
      '<select class="task-duration">' +
      '<option value="25"' + (data && data.duration === 25 ? ' selected' : '') + '>25 min</option>' +
      '<option value="50"' + (data && data.duration === 50 ? ' selected' : '') + '>50 min</option>' +
      '</select></div></div>' +
      '<div class="field"><label>Difficult\u00e9 : <span class="difficulty-label">' + DIFFICULTY_LABELS[diff] + '</span></label>' +
      '<div class="difficulty-group">' +
      '<input type="range" class="task-difficulty" min="1" max="3" value="' + diff + '">' +
      '</div></div>';

    taskList.appendChild(card);

    // Événements
    card.querySelector('.btn-remove-task').addEventListener('click', () => {
      card.remove();
      renumeroterTasks();
      validerFormulaire();
    });
    card.querySelector('.task-difficulty').addEventListener('input', (e) => {
      card.querySelector('.difficulty-label').textContent = DIFFICULTY_LABELS[parseInt(e.target.value)];
    });
    card.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', validerFormulaire);
    });
  }

  function renumeroterTasks() {
    document.querySelectorAll('.task-card').forEach((card, i) => {
      card.dataset.index = i;
      card.querySelector('.task-number').textContent = 'T\u00e2che ' + (i + 1);
    });
  }

  function validerFormulaire() {
    const cards = document.querySelectorAll('.task-card');
    const btnLock = document.getElementById('btnLockContract');
    const btnAdd = document.getElementById('btnAddTask');

    let valid = cards.length >= 1;
    cards.forEach((card) => {
      const name = card.querySelector('.task-name').value.trim();
      if (!name) valid = false;
    });

    btnLock.disabled = !valid || cards.length < 1;
    btnAdd.disabled = cards.length >= 5;

    // Tooltip contextuel
    if (cards.length === 1) {
      showTooltip('contract', 'Limite-toi à 3-5 tâches maximum pour rester efficace.');
    }
  }

  function ajouterNouvelleTache() {
    const cards = document.querySelectorAll('.task-card');
    if (cards.length >= 5) return;
    ajouterChampsTask(cards.length);
    validerFormulaire();
  }

  function chargerDemo() {
    const demo = [
      { name: 'Résumé chapitre 4', subject: 'Français', duration: 25, difficulty: 2 },
      { name: 'Exercices équations', subject: 'Maths', duration: 50, difficulty: 3 },
      { name: 'Relire notes cours', subject: 'Sciences', duration: 25, difficulty: 1 }
    ];
    document.getElementById('taskList').innerHTML = '';
    demo.forEach((t, i) => ajouterChampsTask(i, t));
    validerFormulaire();
  }

  async function verrouillerContrat() {
    const cards = document.querySelectorAll('.task-card');
    const tasks = [];
    cards.forEach((card) => {
      tasks.push({
        name: card.querySelector('.task-name').value.trim(),
        subject: card.querySelector('.task-subject').value.trim(),
        duration: parseInt(card.querySelector('.task-duration').value),
        difficulty: parseInt(card.querySelector('.task-difficulty').value),
        done: false,
        sessionStatus: null
      });
    });

    const today = new Date().toISOString().slice(0, 10);
    contratDuJour = {
      date: today,
      locked: true,
      tasks: tasks
    };
    if (contratDuJour.id) {
      await StudyDB.sauvegarderContrat(contratDuJour);
    } else {
      const id = await StudyDB.sauvegarderContrat(contratDuJour);
      if (id) contratDuJour.id = id;
    }

    afficherContratVerrouille();
  }

  function afficherContratVerrouille() {
    hide('viewContract'); show('viewLocked'); hide('viewTimer');

    const tasks = contratDuJour.tasks;
    const done = tasks.filter((t) => t.done).length;
    const total = tasks.length;

    // Progression
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progressSummary').innerHTML =
      '<p class="progress-text">' + done + ' / ' + total + ' t\u00e2ches termin\u00e9es</p>' +
      '<div class="progress-bar-wrapper"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>';

    // Liste
    const list = document.getElementById('lockedTaskList');
    list.innerHTML = '';
    tasks.forEach((t, i) => {
      const li = document.createElement('li');
      let className = 'locked-item';
      let checkIcon = '';
      let dotClass = 'status-dot-grey';

      if (t.done && t.sessionStatus === 'with-summary') {
        className += ' done';
        checkIcon = '\u2713';
        dotClass = 'status-dot-green';
      } else if (t.done && t.sessionStatus === 'without-summary') {
        className += ' done status-without-summary';
        checkIcon = '\u2713';
        dotClass = 'status-dot-yellow';
      }

      li.className = className;
      li.innerHTML =
        '<div class="locked-item-check">' + checkIcon + '</div>' +
        '<div class="locked-item-body">' +
        '<div class="locked-item-name"><span class="status-dot ' + dotClass + '"></span> ' + escapeHtml(t.name) + '</div>' +
        '<div class="locked-item-meta">' + escapeHtml(t.subject || '') + ' \u2022 ' + t.duration + ' min \u2022 ' + DIFFICULTY_LABELS[t.difficulty] + '</div>' +
        '</div>' +
        (t.done ? '' : '<button class="btn-start-task" data-index="' + i + '" type="button">Commencer</button>');

      list.appendChild(li);
    });

    // Boutons démarrer
    list.querySelectorAll('.btn-start-task').forEach((btn) => {
      btn.addEventListener('click', () => demarrerSession(parseInt(btn.dataset.index)));
    });
  }

  async function resetDay() {
    const today = new Date().toISOString().slice(0, 10);
    await StudyDB.supprimerContratDuJour(today);
    contratDuJour = null;
    afficherFormulaireContrat();
  }

  // ==================================================================
  // TIMER
  // ==================================================================

  function demarrerSession(taskIdx) {
    currentTaskIndex = taskIdx;
    const task = contratDuJour.tasks[taskIdx];
    hide('viewContract'); hide('viewLocked'); show('viewTimer');

    document.getElementById('timerTaskName').textContent = task.name;
    document.getElementById('timerSubject').textContent = task.subject || '';

    timerTotalSeconds = task.duration * 60;
    timerSecondsLeft = timerTotalSeconds;
    timerPaused = false;
    timerStartedAt = Date.now();
    timerPausedElapsed = 0;

    document.getElementById('btnPause').textContent = 'Pause';
    document.getElementById('breakSuggestion').classList.add('hidden');

    updateTimerDisplay();
    timerInterval = setInterval(timerTick, 1000);
  }

  function timerTick() {
    if (timerPaused) return;
    timerSecondsLeft--;
    updateTimerDisplay();

    if (timerSecondsLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      jouerSonFin();
      terminerSession(true);
    }
  }

  function updateTimerDisplay() {
    const mins = Math.floor(Math.max(0, timerSecondsLeft) / 60);
    const secs = Math.max(0, timerSecondsLeft) % 60;
    document.getElementById('timerDigits').textContent =
      String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

    const progress = timerTotalSeconds > 0 ? (timerTotalSeconds - timerSecondsLeft) / timerTotalSeconds : 0;
    const offset = CIRCUMFERENCE * (1 - progress);
    document.getElementById('timerRingProgress').style.strokeDashoffset = offset;
  }

  function togglePause() {
    timerPaused = !timerPaused;
    document.getElementById('btnPause').textContent = timerPaused ? 'Reprendre' : 'Pause';
  }

  function jouerSonFin() {
    const chk = document.getElementById('chkSound');
    if (!chk || !chk.checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 600;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
      osc.stop(ctx.currentTime + 1);
    } catch (_) {}
  }

  async function terminerSession(completed) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    const task = contratDuJour.tasks[currentTaskIndex];
    const elapsed = Math.round((timerTotalSeconds - timerSecondsLeft) / 60);

    sessionPending = {
      taskName: task.name,
      subject: task.subject,
      date: Date.now(),
      duration: task.duration,
      actualDuration: elapsed,
      difficulty: task.difficulty,
      summary: null,
      completed: completed,
      qualityRating: null,
      hourOfDay: new Date().getHours()
    };

    // Suggestion de pause
    if (completed) {
      const breakDur = task.duration >= 50 ? 10 : 5;
      document.getElementById('breakDuration').textContent = breakDur;
      document.getElementById('breakSuggestion').classList.remove('hidden');
    }

    // Ouvrir le modal de résumé
    ouvrirRecallModal();
  }

  function abandonnerSession() {
    confirmer('Abandonner cette session ?', () => terminerSession(false));
  }

  function retourContrat() {
    if (timerInterval) {
      confirmer('Quitter le timer ? Ta progression sera perdue.', () => {
        clearInterval(timerInterval);
        timerInterval = null;
        afficherContratVerrouille();
      });
    } else {
      afficherContratVerrouille();
    }
  }

  // ==================================================================
  // MODALS : RÉSUMÉ + QUALITÉ
  // ==================================================================

  function ouvrirRecallModal() {
    document.getElementById('recallTextarea').value = '';
    document.getElementById('recallCharCount').textContent = '0';
    document.getElementById('recallCharCount').parentElement.classList.remove('recall-counter-ok');
    document.getElementById('btnRecallSave').disabled = true;
    document.getElementById('recallModal').classList.remove('hidden');
  }

  function updateRecallCounter() {
    const textarea = document.getElementById('recallTextarea');
    const count = textarea.value.length;
    const countEl = document.getElementById('recallCharCount');
    countEl.textContent = count;
    const ok = count >= 50;
    countEl.parentElement.classList.toggle('recall-counter-ok', ok);
    document.getElementById('btnRecallSave').disabled = !ok;
  }

  async function sauvegarderResume() {
    const summary = document.getElementById('recallTextarea').value.trim();
    sessionPending.summary = summary;
    document.getElementById('recallModal').classList.add('hidden');

    // Tooltip après premier résumé
    showTooltip('summary', 'Résumer ce que tu retiens renforce ta mémoire. Continue comme ça !');

    // Ouvrir qualité
    ouvrirQualityModal();

    // Suggestions flashcards
    if (summary.length >= 50) {
      const suggestions = extraireConceptsCles(summary);
      if (suggestions.length > 0) {
        setTimeout(() => proposerFlashcards(suggestions, sessionPending.subject, sessionPending.taskName), 600);
      }
    }
  }

  function skipResume() {
    sessionPending.summary = null;
    document.getElementById('recallModal').classList.add('hidden');
    ouvrirQualityModal();
  }

  function ouvrirQualityModal() {
    selectedQuality = 0;
    document.querySelectorAll('.quality-star').forEach((s) => s.classList.remove('active'));
    document.getElementById('qualitySelectedLabel').innerHTML = '&nbsp;';
    document.getElementById('btnQualitySave').disabled = true;
    document.getElementById('qualityModal').classList.remove('hidden');
  }

  function selectQuality(rating) {
    selectedQuality = rating;
    document.querySelectorAll('.quality-star').forEach((s) => {
      s.classList.toggle('active', parseInt(s.dataset.rating) <= rating);
    });
    document.getElementById('qualitySelectedLabel').textContent = QUALITY_LABELS[rating];
    document.getElementById('btnQualitySave').disabled = false;
  }

  async function sauvegarderQualite() {
    sessionPending.qualityRating = selectedQuality;
    document.getElementById('qualityModal').classList.add('hidden');
    await finaliserSession();
  }

  function skipQuality() {
    document.getElementById('qualityModal').classList.add('hidden');
    finaliserSession();
  }

  async function finaliserSession() {
    await StudyDB.enregistrerSession(sessionPending);

    // Marquer la tâche comme terminée
    const task = contratDuJour.tasks[currentTaskIndex];
    task.done = true;
    task.sessionStatus = sessionPending.summary ? 'with-summary' : 'without-summary';
    await StudyDB.sauvegarderContrat(contratDuJour);

    StudyDashboard.invaliderCache();
    afficherToast('Session enregistr\u00e9e !');
    sessionPending = null;

    afficherContratVerrouille();
  }

  // ==================================================================
  // FLASHCARDS : EXTRACTION CONCEPTS + SUGGESTION
  // ==================================================================

  function extraireConceptsCles(texte) {
    const suggestions = [];
    const phrases = texte.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 15);

    phrases.forEach((phrase) => {
      // Définitions
      const defMatch = phrase.match(/^(.+?)\s+(?:est|sont|signifie|d\u00e9signe|repr\u00e9sente)\s+(.+)/i);
      if (defMatch && suggestions.length < 5) {
        suggestions.push({
          question: 'D\u00e9finis : ' + defMatch[1].trim(),
          answer: defMatch[2].trim(),
          selected: true
        });
        return;
      }

      // Énumérations
      const enumMatch = phrase.match(/il\s+(?:y\s+a|existe)\s+(\d+)\s+(?:types?\s+de|formes?\s+de|cat\u00e9gories?\s+de|sortes?\s+de)?\s*(.+)/i);
      if (enumMatch && suggestions.length < 5) {
        suggestions.push({
          question: 'Combien de ' + enumMatch[2].trim() + ' y a-t-il ?',
          answer: enumMatch[1] + ' : ' + phrase,
          selected: true
        });
        return;
      }

      // Générique (phrases longues)
      if (phrase.length > 40 && suggestions.length < 5) {
        const preview = phrase.length > 80 ? phrase.substring(0, 77) + '...' : phrase;
        suggestions.push({
          question: 'Que retiens-tu sur : \u00ab ' + preview + ' \u00bb ?',
          answer: phrase,
          selected: true
        });
      }
    });

    return suggestions.slice(0, 5);
  }

  function proposerFlashcards(suggestions, subject, taskName) {
    const list = document.getElementById('flashcardSuggestionList');
    list.innerHTML = '';
    suggestions.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'flashcard-suggestion-item';
      item.innerHTML =
        '<div class="flashcard-suggestion-check">' +
        '<input type="checkbox" id="sugg' + i + '" ' + (s.selected ? 'checked' : '') + '>' +
        '</div>' +
        '<div class="flashcard-suggestion-content">' +
        '<p class="flashcard-suggestion-q">' + escapeHtml(s.question) + '</p>' +
        '<p class="flashcard-suggestion-a">' + escapeHtml(s.answer) + '</p>' +
        '</div>';
      list.appendChild(item);
    });

    // Sauvegarder les suggestions pour la création
    window._pendingSuggestions = suggestions;
    window._pendingSuggestionSubject = subject;
    window._pendingSuggestionTask = taskName;

    document.getElementById('flashcardSuggestionModal').classList.remove('hidden');
  }

  async function sauvegarderSuggestionsFlashcards() {
    const suggestions = window._pendingSuggestions || [];
    const subject = window._pendingSuggestionSubject || '';
    const taskName = window._pendingSuggestionTask || '';
    let count = 0;

    for (let i = 0; i < suggestions.length; i++) {
      const chk = document.getElementById('sugg' + i);
      if (chk && chk.checked) {
        await StudyDB.ajouterFlashcard({
          question: suggestions[i].question,
          answer: suggestions[i].answer,
          subject: subject,
          taskName: taskName,
          createdDate: Date.now(),
          reviewCount: 0,
          lastReviewed: null,
          difficulty: 2,
          easinessFactor: 2.5,
          interval: 1,
          nextReviewDate: Date.now()
        });
        count++;
      }
    }

    document.getElementById('flashcardSuggestionModal').classList.add('hidden');
    if (count > 0) afficherToast(count + ' carte' + (count > 1 ? 's' : '') + ' cr\u00e9\u00e9e' + (count > 1 ? 's' : ''));
    delete window._pendingSuggestions;
    delete window._pendingSuggestionSubject;
    delete window._pendingSuggestionTask;
  }

  // ==================================================================
  // FLASHCARDS : LISTE + CRÉATION MANUELLE
  // ==================================================================

  async function afficherFlashcards() {
    const filter = document.getElementById('flashcardFilterSubject').value;
    const cards = filter ? await StudyDB.getFlashcardsParMatiere(filter) : await StudyDB.getToutesFlashcards();
    const stats = await StudyDB.getStatsFlashcards();

    // Stats
    document.getElementById('flashcardStats').innerHTML =
      '<div class="flashcard-stat-item"><span class="flashcard-stat-value">' + stats.total + '</span><span class="flashcard-stat-label">Total</span></div>' +
      '<div class="flashcard-stat-item"><span class="flashcard-stat-value">' + stats.maitrisees + '</span><span class="flashcard-stat-label">Ma\u00eetris\u00e9es</span></div>' +
      '<div class="flashcard-stat-item"><span class="flashcard-stat-value">' + stats.dues + '</span><span class="flashcard-stat-label">\u00c0 r\u00e9viser</span></div>';

    // Bannière cartes dues
    const banner = document.getElementById('flashcardDueBanner');
    const dueCount = document.getElementById('flashcardDueCount');
    if (stats.dues > 0) {
      banner.style.display = 'block';
      dueCount.textContent = stats.dues + ' carte' + (stats.dues > 1 ? 's' : '') + ' \u00e0 r\u00e9viser aujourd\'hui';
    } else {
      const next = await StudyDB.getProchaineRevision();
      if (next && stats.total > 0) {
        banner.style.display = 'block';
        const nextDate = new Date(next);
        const demain = new Date(); demain.setDate(demain.getDate() + 1);
        if (nextDate.toDateString() === demain.toDateString()) {
          dueCount.textContent = 'Prochaine r\u00e9vision demain';
        } else {
          dueCount.textContent = 'Prochaine r\u00e9vision le ' + nextDate.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
        }
      } else {
        banner.style.display = 'none';
      }
    }

    // Boutons révision
    document.getElementById('btnStartReview').disabled = stats.dues === 0;
    document.getElementById('btnReviewAll').disabled = stats.total === 0;

    // Filtre matières
    const allCards = await StudyDB.getToutesFlashcards();
    const subjects = [...new Set(allCards.map((c) => c.subject).filter(Boolean))];
    const select = document.getElementById('flashcardFilterSubject');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Toutes les mati\u00e8res</option>';
    subjects.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === currentVal) opt.selected = true;
      select.appendChild(opt);
    });

    // Liste
    const list = document.getElementById('flashcardList');
    const empty = document.getElementById('flashcardEmpty');
    list.innerHTML = '';

    if (cards.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      cards.forEach((card) => {
        const el = document.createElement('div');
        el.className = 'flashcard-item';
        const diffClass = 'flashcard-diff-' + card.difficulty;
        const diffLabel = DIFFICULTY_LABELS[card.difficulty] || 'Moyen';
        const mastered = card.reviewCount >= 3 && card.difficulty <= 1;
        const nextReview = card.nextReviewDate ? new Date(card.nextReviewDate).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) : '';

        el.innerHTML =
          '<div class="flashcard-item-header">' +
          '<span class="flashcard-item-subject">' + escapeHtml(card.subject || 'Sans mati\u00e8re') + '</span>' +
          '<span class="flashcard-item-diff ' + diffClass + '">' + diffLabel + '</span>' +
          '</div>' +
          '<p class="flashcard-item-question">' + escapeHtml(card.question) + '</p>' +
          '<p class="flashcard-item-answer">' + escapeHtml(card.answer) + '</p>' +
          '<div class="flashcard-item-footer">' +
          '<span class="flashcard-item-reviews">' +
          (mastered ? '\u2705 Ma\u00eetris\u00e9e' : '\uD83D\uDD04 ' + card.reviewCount + 'x') +
          (nextReview ? ' \u2022 Prochaine : ' + nextReview : '') +
          '</span>' +
          '<button class="btn-delete-flashcard" data-id="' + card.id + '" type="button" title="Supprimer">\u00D7</button>' +
          '</div>';
        list.appendChild(el);
      });

      // Événements suppression
      list.querySelectorAll('.btn-delete-flashcard').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await StudyDB.supprimerFlashcard(parseInt(btn.dataset.id));
          afficherFlashcards();
        });
      });
    }
  }

  function ouvrirCreationManuelle() {
    document.getElementById('manualFlashcardQuestion').value = '';
    document.getElementById('manualFlashcardAnswer').value = '';
    document.getElementById('manualFlashcardSubject').value = '';
    document.getElementById('flashcardManualModal').classList.remove('hidden');
  }

  async function sauvegarderFlashcardManuelle() {
    const q = document.getElementById('manualFlashcardQuestion').value.trim();
    const a = document.getElementById('manualFlashcardAnswer').value.trim();
    const s = document.getElementById('manualFlashcardSubject').value.trim();

    if (!q || !a) { afficherToast('Question et r\u00e9ponse requises'); return; }

    await StudyDB.ajouterFlashcard({
      question: q,
      answer: a,
      subject: s,
      taskName: '',
      createdDate: Date.now(),
      reviewCount: 0,
      lastReviewed: null,
      difficulty: 2,
      easinessFactor: 2.5,
      interval: 1,
      nextReviewDate: Date.now()
    });

    document.getElementById('flashcardManualModal').classList.add('hidden');
    afficherToast('Carte cr\u00e9\u00e9e');
    afficherFlashcards();
  }

  // ==================================================================
  // FLASHCARDS : MODE RÉVISION SM-2
  // ==================================================================

  async function demarrerRevision(mode) {
    reviewMode = mode || 'due';
    let cards;

    if (reviewMode === 'due') {
      cards = await StudyDB.getFlashcardsDues();
    } else {
      cards = await StudyDB.getToutesFlashcards();
    }

    if (cards.length === 0) {
      afficherToast('Aucune carte \u00e0 r\u00e9viser');
      return;
    }

    // Trier : non maîtrisées d'abord, puis par nextReviewDate
    cards.sort((a, b) => {
      const aMastered = a.reviewCount >= 3 && a.difficulty <= 1;
      const bMastered = b.reviewCount >= 3 && b.difficulty <= 1;
      if (aMastered !== bMastered) return aMastered ? 1 : -1;
      return (a.nextReviewDate || 0) - (b.nextReviewDate || 0);
    });

    // Max 20 cartes par session
    reviewCards = cards.slice(0, 20);
    reviewIndex = 0;
    reviewFlipped = false;

    document.getElementById('flashcardReviewModal').classList.remove('hidden');
    afficherCarteRevision();
  }

  function afficherCarteRevision() {
    if (reviewIndex >= reviewCards.length) {
      finRevision();
      return;
    }

    const card = reviewCards[reviewIndex];
    document.getElementById('reviewProgress').textContent = (reviewIndex + 1) + ' / ' + reviewCards.length;
    document.getElementById('reviewQuestionText').textContent = card.question;
    document.getElementById('reviewAnswerText').textContent = card.answer;
    document.getElementById('reviewSubject').textContent = card.subject || '';

    // Reset flip
    reviewFlipped = false;
    document.getElementById('flashcardFlipInner').classList.remove('flipped');
    document.getElementById('btnRevealAnswer').classList.remove('hidden');
    document.getElementById('reviewButtons').classList.add('hidden');
  }

  function revelerReponse() {
    reviewFlipped = true;
    document.getElementById('flashcardFlipInner').classList.add('flipped');
    document.getElementById('btnRevealAnswer').classList.add('hidden');
    document.getElementById('reviewButtons').classList.remove('hidden');
  }

  function flipCard() {
    if (!reviewFlipped) {
      revelerReponse();
    }
  }

  /**
   * Algorithme SM-2 simplifié :
   * - Difficile (1) : interval = 1 jour, easiness -= 0.2
   * - Moyen (3) : interval = interval * easiness
   * - Facile (5) : interval = interval * easiness * 1.3, easiness += 0.1
   */
  async function repondreRevision(qualite) {
    const card = reviewCards[reviewIndex];

    // Assurer les valeurs par défaut SM-2
    if (!card.easinessFactor) card.easinessFactor = 2.5;
    if (!card.interval) card.interval = 1;

    card.reviewCount = (card.reviewCount || 0) + 1;
    card.lastReviewed = Date.now();

    if (qualite === 1) {
      // Difficile
      card.interval = 1;
      card.easinessFactor = Math.max(1.3, card.easinessFactor - 0.2);
      card.difficulty = Math.min(3, (card.difficulty || 2) + 1);
    } else if (qualite === 3) {
      // Moyen
      card.interval = Math.max(1, Math.round(card.interval * card.easinessFactor));
    } else if (qualite === 5) {
      // Facile
      card.interval = Math.max(1, Math.round(card.interval * card.easinessFactor * 1.3));
      card.easinessFactor = Math.min(2.5, card.easinessFactor + 0.1);
      card.difficulty = Math.max(1, (card.difficulty || 2) - 1);
    }

    // Calculer nextReviewDate
    card.nextReviewDate = Date.now() + card.interval * 86400000;

    await StudyDB.mettreAJourFlashcard(card);

    // Carte suivante
    reviewIndex++;
    afficherCarteRevision();
  }

  function finRevision() {
    document.getElementById('flashcardReviewModal').classList.add('hidden');
    afficherToast('R\u00e9vision termin\u00e9e !');
    afficherFlashcards();
  }

  function fermerRevision() {
    document.getElementById('flashcardReviewModal').classList.add('hidden');
    afficherFlashcards();
  }

  // ==================================================================
  // HISTORIQUE PAGINÉ
  // ==================================================================

  async function chargerHistorique() {
    const sessions = await StudyDB.getSessionsPaginees(historyOffset, HISTORY_PAGE_SIZE);
    const total = await StudyDB.getNombreTotalSessions();
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    const btnLoad = document.getElementById('btnLoadMore');

    if (historyOffset === 0) list.innerHTML = '';

    if (total === 0) {
      empty.classList.remove('hidden');
      btnLoad.classList.add('hidden');
      return;
    }

    empty.classList.add('hidden');

    sessions.forEach((s) => {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
      const timeStr = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const stars = s.qualityRating ? '\u2605'.repeat(s.qualityRating) + '\u2606'.repeat(5 - s.qualityRating) : '';

      let dotClass = 'status-dot-grey';
      if (s.completed && s.summary) dotClass = 'status-dot-green';
      else if (s.completed) dotClass = 'status-dot-yellow';

      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML =
        '<div class="history-card-header">' +
        '<span class="history-date">' + dateStr + ' \u00e0 ' + timeStr + '</span>' +
        '<div class="history-card-badges">' +
        '<span class="status-dot ' + dotClass + '"></span>' +
        (stars ? '<span class="history-quality">' + stars + '</span>' : '') +
        '</div></div>' +
        '<div class="history-card-body">' +
        '<p class="history-task-name">' + escapeHtml(s.taskName) + '</p>' +
        '<p class="history-meta">' + escapeHtml(s.subject || '') + ' \u2022 ' + (s.actualDuration || s.duration) + ' min \u2022 ' + DIFFICULTY_LABELS[s.difficulty] + '</p>' +
        (s.summary
          ? '<p class="history-summary" data-summary="' + escapeAttr(s.summary) + '" data-task="' + escapeAttr(s.taskName) + '">' + escapeHtml(s.summary.substring(0, 120)) + (s.summary.length > 120 ? '...' : '') + '</p>'
          : '<p class="history-no-summary">Pas de r\u00e9sum\u00e9</p>') +
        '</div>';

      list.appendChild(card);
    });

    // Événements résumé
    list.querySelectorAll('.history-summary').forEach((el) => {
      el.addEventListener('click', () => {
        document.getElementById('summaryDetailTitle').textContent = el.dataset.task;
        document.getElementById('summaryDetailText').textContent = el.dataset.summary;
        document.getElementById('summaryDetailModal').classList.remove('hidden');
      });
    });

    // Pagination
    const loaded = historyOffset + sessions.length;
    if (loaded < total) {
      btnLoad.classList.remove('hidden');
    } else {
      btnLoad.classList.add('hidden');
    }
  }

  function chargerPlusDeSessions() {
    historyOffset += HISTORY_PAGE_SIZE;
    chargerHistorique();
  }

  // ==================================================================
  // PARAMÈTRES
  // ==================================================================

  async function chargerParametres() {
    // GDPR stats
    const gdpr = await StudyExport.getStatistiquesGDPR();
    document.getElementById('gdprTotalSessions').textContent = gdpr.totalSessions;
    document.getElementById('gdprTotalFlashcards').textContent = gdpr.totalFlashcards;
    document.getElementById('gdprPeriode').textContent = gdpr.periodeDebut
      ? 'du ' + gdpr.periodeDebut + ' au ' + gdpr.periodeFin
      : 'Aucune donn\u00e9e';
    document.getElementById('gdprTaille').textContent = gdpr.tailleKo + ' Ko';

    // Chronotype info
    const prefs = await StudyDB.getPreferences();
    const infoEl = document.getElementById('settingsChronotypeInfo');
    if (prefs && prefs.chronotypeLabel) {
      const dateTest = new Date(prefs.questionnaireDate);
      infoEl.textContent = prefs.chronotypeLabel + ' (test du ' + dateTest.toLocaleDateString('fr-BE') + ')';
    } else {
      infoEl.textContent = 'Aucun profil d\u00e9tect\u00e9.';
    }
  }

  // ==================================================================
  // CHRONOTYPE CARD (Dashboard)
  // ==================================================================

  async function afficherChronotypeCard() {
    const prefs = await StudyDB.getPreferences();
    const card = document.getElementById('chronotypeCard');
    if (prefs && prefs.detectedChronotype && CHRONOTYPE_PROFILES[prefs.detectedChronotype]) {
      const profile = CHRONOTYPE_PROFILES[prefs.detectedChronotype];
      document.getElementById('chronotypeCardIcon').textContent = profile.icon;
      document.getElementById('chronotypeCardLabel').textContent = profile.label;
      document.getElementById('chronotypeCardDate').textContent = 'Test du ' + new Date(prefs.questionnaireDate).toLocaleDateString('fr-BE');
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  }

  // ==================================================================
  // TOOLTIPS CONTEXTUELS
  // ==================================================================

  function showTooltip(key, message) {
    if (tooltipsShown[key]) return;
    tooltipsShown[key] = true;
    localStorage.setItem('studyproto_tooltips_shown', JSON.stringify(tooltipsShown));

    const tooltip = document.getElementById('contextualTooltip');
    const text = document.getElementById('contextualTooltipText');
    text.textContent = message;
    tooltip.classList.remove('hidden');

    // Auto-dismiss après 8s
    setTimeout(() => {
      tooltip.classList.add('hidden');
    }, 8000);
  }

  function dismissTooltip() {
    document.getElementById('contextualTooltip').classList.add('hidden');
  }

  // ==================================================================
  // IMPORT / EXPORT
  // ==================================================================

  async function exportCSV() {
    const result = await StudyExport.exporterCSV();
    if (result) afficherToast('Export CSV t\u00e9l\u00e9charg\u00e9');
    else afficherToast('Aucune session \u00e0 exporter');
  }

  async function exportJSON() {
    await StudyExport.exporterJSON();
    afficherToast('Sauvegarde JSON t\u00e9l\u00e9charg\u00e9e');
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    pendingImportFile = file;
    document.getElementById('importConfirmModal').classList.remove('hidden');
    e.target.value = ''; // reset pour pouvoir re-sélectionner le même fichier
  }

  async function importMerge() {
    document.getElementById('importConfirmModal').classList.add('hidden');
    if (!pendingImportFile) return;
    try {
      const result = await StudyExport.importerJSON(pendingImportFile);
      afficherToast('Import\u00e9 : ' + result.sessions + ' sessions, ' + result.flashcards + ' cartes');
      StudyDashboard.invaliderCache();
      pendingImportFile = null;
      chargerParametres();
    } catch (err) {
      afficherToast('Erreur : ' + err.message);
      pendingImportFile = null;
    }
  }

  async function importReplace() {
    document.getElementById('importConfirmModal').classList.add('hidden');
    if (!pendingImportFile) return;

    confirmer('Es-tu absolument s\u00fbr\u00b7e ? Toutes tes donn\u00e9es actuelles seront supprim\u00e9es.', async () => {
      try {
        await StudyDB.reinitialiserDonnees();
        const result = await StudyExport.importerJSON(pendingImportFile);
        afficherToast('Donn\u00e9es remplac\u00e9es : ' + result.sessions + ' sessions, ' + result.flashcards + ' cartes');
        StudyDashboard.invaliderCache();
        pendingImportFile = null;
        chargerParametres();
      } catch (err) {
        afficherToast('Erreur : ' + err.message);
        pendingImportFile = null;
      }
    });
  }

  function importCancel() {
    document.getElementById('importConfirmModal').classList.add('hidden');
    pendingImportFile = null;
  }

  // ==================================================================
  // RESET COMPLET (triple confirmation)
  // ==================================================================

  function resetApp() {
    confirmer('Supprimer toutes tes donn\u00e9es ? Cette action est irr\u00e9versible.', () => {
      confirmer('Deuxi\u00e8me confirmation : es-tu vraiment s\u00fbr\u00b7e ?', () => {
        confirmer('Derni\u00e8re chance : TOUTES les donn\u00e9es seront perdues.', async () => {
          await StudyDB.reinitialiserDonnees();
          StudyDashboard.invaliderCache();
          afficherToast('Toutes les donn\u00e9es ont \u00e9t\u00e9 supprim\u00e9es');
          contratDuJour = null;
          changerOnglet('main');
          afficherFormulaireContrat();
        });
      });
    });
  }

  // ==================================================================
  // UTILITAIRES UI
  // ==================================================================

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function afficherToast(message, duree) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('toast-visible');
    toast.classList.remove('toast-hiding');

    setTimeout(() => {
      toast.classList.add('toast-hiding');
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, duree || 2500);
  }

  function confirmer(message, onYes) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmDialog').classList.remove('hidden');
    document.getElementById('btnConfirmYes').onclick = () => {
      document.getElementById('confirmDialog').classList.add('hidden');
      onYes();
    };
    document.getElementById('btnConfirmNo').onclick = () => {
      document.getElementById('confirmDialog').classList.add('hidden');
    };
  }

  // ==================================================================
  // ATTACHEMENT DES ÉVÉNEMENTS
  // ==================================================================

  function attacherEvenements() {
    // Navigation
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => changerOnglet(btn.dataset.tab));
    });

    // Welcome slides
    document.getElementById('btnWelcomeNext').addEventListener('click', nextWelcomeSlide);

    // Onboarding
    document.getElementById('btnOnboardingPrev').addEventListener('click', onboardingPrevious);
    document.getElementById('btnOnboardingNext').addEventListener('click', onboardingNext);
    document.getElementById('btnOnboardingSkip').addEventListener('click', skipOnboarding);
    document.getElementById('btnStartApp').addEventListener('click', startAppAfterOnboarding);

    // Contrat
    document.getElementById('btnAddTask').addEventListener('click', ajouterNouvelleTache);
    document.getElementById('btnLockContract').addEventListener('click', verrouillerContrat);
    document.getElementById('btnLoadDemo').addEventListener('click', chargerDemo);
    document.getElementById('btnResetDay').addEventListener('click', () => {
      confirmer('Cr\u00e9er un nouveau contrat ? Le contrat actuel sera supprim\u00e9.', resetDay);
    });

    // Timer
    document.getElementById('btnPause').addEventListener('click', togglePause);
    document.getElementById('btnFinish').addEventListener('click', () => terminerSession(true));
    document.getElementById('btnAbandon').addEventListener('click', abandonnerSession);
    document.getElementById('btnBackToList').addEventListener('click', retourContrat);
    document.getElementById('btnDismissBreak').addEventListener('click', () => {
      document.getElementById('breakSuggestion').classList.add('hidden');
    });

    // Modal résumé
    document.getElementById('recallTextarea').addEventListener('input', updateRecallCounter);
    document.getElementById('btnRecallSave').addEventListener('click', sauvegarderResume);
    document.getElementById('btnRecallSkip').addEventListener('click', skipResume);

    // Modal qualité
    document.querySelectorAll('.quality-star').forEach((star) => {
      star.addEventListener('click', () => selectQuality(parseInt(star.dataset.rating)));
    });
    document.getElementById('btnQualitySave').addEventListener('click', sauvegarderQualite);
    document.getElementById('btnQualitySkip').addEventListener('click', skipQuality);

    // Modal résumé détail
    document.getElementById('btnCloseSummaryDetail').addEventListener('click', () => {
      document.getElementById('summaryDetailModal').classList.add('hidden');
    });

    // Modal suggestion flashcards
    document.getElementById('btnFlashcardSuggestionSave').addEventListener('click', sauvegarderSuggestionsFlashcards);
    document.getElementById('btnFlashcardSuggestionSkip').addEventListener('click', () => {
      document.getElementById('flashcardSuggestionModal').classList.add('hidden');
    });

    // Flashcards
    document.getElementById('btnStartReview').addEventListener('click', () => demarrerRevision('due'));
    document.getElementById('btnReviewAll').addEventListener('click', () => demarrerRevision('all'));
    document.getElementById('btnCreateManualFlashcard').addEventListener('click', ouvrirCreationManuelle);
    document.getElementById('btnManualFlashcardSave').addEventListener('click', sauvegarderFlashcardManuelle);
    document.getElementById('btnManualFlashcardCancel').addEventListener('click', () => {
      document.getElementById('flashcardManualModal').classList.add('hidden');
    });
    document.getElementById('flashcardFilterSubject').addEventListener('change', afficherFlashcards);

    // Révision SM-2
    document.getElementById('flashcardFlipContainer').addEventListener('click', flipCard);
    document.getElementById('btnRevealAnswer').addEventListener('click', revelerReponse);
    document.getElementById('btnReviewHard').addEventListener('click', () => repondreRevision(1));
    document.getElementById('btnReviewMedium').addEventListener('click', () => repondreRevision(3));
    document.getElementById('btnReviewEasy').addEventListener('click', () => repondreRevision(5));
    document.getElementById('btnCloseReview').addEventListener('click', fermerRevision);

    // Historique
    document.getElementById('btnLoadMore').addEventListener('click', chargerPlusDeSessions);
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

    // Dashboard
    document.getElementById('btnWeekPrev').addEventListener('click', () => StudyDashboard.semainePrecedente());
    document.getElementById('btnWeekNext').addEventListener('click', () => StudyDashboard.semaineSuivante());
    document.getElementById('btnExportHeatmap').addEventListener('click', () => StudyDashboard.exporterPNG('heatmap'));
    document.getElementById('btnExportQualite').addEventListener('click', () => StudyDashboard.exporterPNG('qualite'));
    document.getElementById('btnRefaireChronotype').addEventListener('click', afficherOnboarding);

    // Paramètres
    document.querySelectorAll('input[name="theme"]').forEach((radio) => {
      radio.addEventListener('change', () => setTheme(radio.value));
    });
    document.getElementById('btnSettingsChronotype').addEventListener('click', afficherOnboarding);
    document.getElementById('btnExportCSVSettings').addEventListener('click', exportCSV);
    document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
    document.getElementById('importJSONInput').addEventListener('change', handleImportFile);
    document.getElementById('btnImportMerge').addEventListener('click', importMerge);
    document.getElementById('btnImportReplace').addEventListener('click', importReplace);
    document.getElementById('btnImportCancel').addEventListener('click', importCancel);
    document.getElementById('btnResetApp').addEventListener('click', resetApp);

    // Tooltip
    document.getElementById('btnTooltipDismiss').addEventListener('click', dismissTooltip);

    // Thème auto - écouter les changements système
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const saved = localStorage.getItem('studyproto_theme');
      if (saved === 'auto') setTheme('auto');
    });

    // Swipe sur welcome slides (mobile)
    let touchStartX = 0;
    const welcomeEl = document.getElementById('welcomeSlides');
    if (welcomeEl) {
      welcomeEl.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
      welcomeEl.addEventListener('touchend', (e) => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          if (diff > 0 && welcomeSlide < 3) { welcomeSlide++; renderWelcomeSlide(); }
          else if (diff < 0 && welcomeSlide > 0) { welcomeSlide--; renderWelcomeSlide(); }
        }
      }, { passive: true });
    }
  }

  // ==================================================================
  // DONNÉES DE TEST (accessible via console)
  // ==================================================================

  window.genererDonneesTest = async function () {
    const matieres = ['Maths', 'Fran\u00e7ais', 'Sciences', 'Histoire', 'Anglais', 'Physique', 'Chimie'];
    const taches = ['Exercices', 'R\u00e9sum\u00e9', 'R\u00e9vision', 'Lecture', 'Probl\u00e8mes', 'Notes de cours', 'Pr\u00e9paration examen'];
    const maintenant = Date.now();
    let count = 0;

    for (let i = 0; i < 50; i++) {
      const joursAvant = Math.floor(Math.random() * 28);
      let heure;
      const r = Math.random();
      if (r < 0.35) heure = 16 + Math.floor(Math.random() * 3);
      else if (r < 0.6) heure = 9 + Math.floor(Math.random() * 3);
      else if (r < 0.8) heure = 13 + Math.floor(Math.random() * 3);
      else heure = 6 + Math.floor(Math.random() * 17);

      const dateSession = new Date(maintenant);
      dateSession.setDate(dateSession.getDate() - joursAvant);
      dateSession.setHours(heure, Math.floor(Math.random() * 60), 0, 0);

      // Qualité corrélée à l'heure
      let qualite;
      if (heure >= 16 && heure <= 19) qualite = 3 + Math.floor(Math.random() * 3);
      else if (heure >= 9 && heure <= 11) qualite = 2 + Math.floor(Math.random() * 3);
      else qualite = 1 + Math.floor(Math.random() * 3);
      qualite = Math.min(5, Math.max(1, qualite));

      // Plus de sessions en semaine
      const dow = dateSession.getDay();
      if ((dow === 0 || dow === 6) && Math.random() < 0.4) continue;

      const duree = Math.random() > 0.5 ? 50 : 25;
      const matiere = matieres[Math.floor(Math.random() * matieres.length)];
      const tache = taches[Math.floor(Math.random() * taches.length)];

      await StudyDB.enregistrerSession({
        taskName: tache + ' ' + matiere,
        subject: matiere,
        date: dateSession.getTime(),
        duration: duree,
        actualDuration: duree - Math.floor(Math.random() * 5),
        difficulty: 1 + Math.floor(Math.random() * 3),
        summary: Math.random() > 0.3 ? 'R\u00e9sum\u00e9 de la session ' + (i + 1) + ' : travail sur ' + tache.toLowerCase() + ' en ' + matiere.toLowerCase() + '. Concepts importants retenus.' : null,
        completed: Math.random() > 0.1,
        qualityRating: qualite,
        hourOfDay: heure
      });
      count++;
    }

    // Quelques flashcards de test
    const flashcardExamples = [
      { q: 'Qu\'est-ce que la photosynthèse ?', a: 'La photosynthèse est le processus par lequel les plantes convertissent la lumière en énergie chimique.', s: 'Sciences' },
      { q: 'Théorème de Pythagore', a: 'Dans un triangle rectangle, le carré de l\'hypoténuse est égal à la somme des carrés des deux autres côtés : a² + b² = c²', s: 'Maths' },
      { q: 'Qu\'est-ce qu\'une métaphore ?', a: 'Figure de style qui établit une comparaison implicite entre deux éléments sans utiliser de mot de comparaison.', s: 'Français' },
      { q: 'Date de la Révolution française', a: '1789 - Prise de la Bastille le 14 juillet', s: 'Histoire' },
      { q: 'Formule de la vitesse', a: 'v = d/t (vitesse = distance / temps)', s: 'Physique' }
    ];

    for (const fc of flashcardExamples) {
      await StudyDB.ajouterFlashcard({
        question: fc.q, answer: fc.a, subject: fc.s, taskName: '',
        createdDate: Date.now() - Math.floor(Math.random() * 86400000 * 7),
        reviewCount: Math.floor(Math.random() * 4),
        lastReviewed: Math.random() > 0.5 ? Date.now() - Math.floor(Math.random() * 86400000 * 3) : null,
        difficulty: 1 + Math.floor(Math.random() * 3),
        easinessFactor: 2.5,
        interval: 1 + Math.floor(Math.random() * 5),
        nextReviewDate: Date.now() + Math.floor(Math.random() * 86400000 * 3) - 86400000
      });
    }

    StudyDashboard.invaliderCache();
    console.info('[StudyApp] ' + count + ' sessions et ' + flashcardExamples.length + ' flashcards de test créées.');
    console.info('[StudyApp] Recharge la page ou navigue vers les onglets pour voir les données.');
    return count;
  };

})();
