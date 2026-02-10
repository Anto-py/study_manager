// ============================================================
// Study Protocol Manager — Logique applicative (étape 3)
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

  // ---- Références DOM ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Onglets de navigation
  const appNav      = $('#appNav');
  const tabMain     = $('#tabMain');
  const tabHistory  = $('#tabHistory');
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
  let activeTab = 'main';      // onglet actif : 'main', 'history' ou 'dashboard'

  // ---- Initialisation ----
  async function init() {
    afficherDate();

    // Initialiser IndexedDB (migration automatique)
    await StudyDB.init();

    // Charger le contrat du jour
    await chargerContrat();

    // Vérifier s'il y a une session interrompue à restaurer
    restaurerSessionInterrompue();

    // Afficher la suggestion de créneau si disponible
    afficherSuggestionCreneau();

    attacherEvenements();
    enregistrerServiceWorker();
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

  /**
   * Affiche la suggestion de créneau si une préférence horaire est enregistrée.
   * La suggestion apparaît dans le formulaire de création de contrat.
   */
  async function afficherSuggestionCreneau() {
    const suggestion = await StudyDashboard.getSuggestionContrat();
    if (!suggestion || !suggestion.creneaux || suggestion.creneaux.length === 0) {
      suggestionCreneau.classList.add('hidden');
      return;
    }

    const creneau = suggestion.creneaux[0]; // Premier créneau préféré
    suggestionCreneauText.textContent =
      `Suggestion : planifie tes tâches difficiles entre ${creneau} (ton créneau le plus efficace)`;
    suggestionCreneau.classList.remove('hidden');
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

      afficherToast('Session restaurée — en pause');
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
        <span class="task-number">Tâche ${index + 1}</span>
        <button class="btn-remove-task" type="button" title="Supprimer cette tâche">&times;</button>
      </div>
      <div class="field">
        <label>Nom de la tâche *</label>
        <input type="text" class="input-name" placeholder="Ex : Résumé chapitre 4" value="${escapeHtml((data && data.name) || '')}" required>
      </div>
      <div class="field">
        <label>Matière / contexte</label>
        <input type="text" class="input-subject" placeholder="Ex : Français (optionnel)" value="${escapeHtml((data && data.subject) || '')}">
      </div>
      <div class="field-row">
        <div class="field">
          <label>Durée estimée</label>
          <select class="input-duration">
            <option value="25" ${(data && data.duration === 50) ? '' : 'selected'}>25 minutes</option>
            <option value="50" ${(data && data.duration === 50) ? 'selected' : ''}>50 minutes</option>
          </select>
        </div>
        <div class="field">
          <label>Difficulté perçue</label>
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
      c.querySelector('.task-number').textContent = `Tâche ${i + 1}`;
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
      <p class="progress-text">${done} / ${total} tâche${total > 1 ? 's' : ''} accomplie${done > 1 ? 's' : ''}</p>
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
        statusIndicator = '<span class="status-dot status-dot-green" title="Terminé avec résumé"></span>';
      } else if (task.done && task.sessionStatus === 'without-summary') {
        statusIndicator = '<span class="status-dot status-dot-yellow" title="Terminé sans résumé"></span>';
      } else if (!task.done) {
        statusIndicator = '<span class="status-dot status-dot-grey" title="Pas encore commencé"></span>';
      } else {
        statusIndicator = '<span class="status-dot status-dot-green" title="Terminé"></span>';
      }

      li.innerHTML = `
        <span class="locked-item-check">${task.done ? '&#10003;' : ''}</span>
        <div class="locked-item-body">
          <div class="locked-item-name">${statusIndicator} ${escapeHtml(task.name)}</div>
          <div class="locked-item-meta">
            ${task.subject ? escapeHtml(task.subject) + ' — ' : ''}${task.duration} min — ${diffText}
          </div>
        </div>
        ${task.done
          ? '<span style="font-size:.82rem;color:var(--color-done);font-weight:600;">Fait</span>'
          : `<button class="btn-start-task" data-idx="${idx}">Mode concentration</button>`
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

        afficherToast('Session enregistrée');
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
      'Es-tu sûr\u00b7e de vouloir abandonner cette session\u00a0?',
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
          ? session.summary.substring(0, 80) + '…'
          : session.summary;
        summaryPreview = `<p class="history-summary" title="Cliquer pour voir en entier">${escapeHtml(truncated)}</p>`;
      } else {
        summaryPreview = '<p class="history-no-summary">Pas de résumé</p>';
      }

      const statusDot = hasSummary
        ? '<span class="status-dot status-dot-green"></span>'
        : '<span class="status-dot status-dot-yellow"></span>';

      // Affichage de la qualité si disponible
      let qualityDisplay = '';
      if (session.qualityRating != null && session.qualityRating >= 1) {
        const stars = '\u2605'.repeat(session.qualityRating) +
                      '\u2606'.repeat(5 - session.qualityRating);
        qualityDisplay = `<span class="history-quality" title="Qualité de concentration">${stars}</span>`;
      }

      card.innerHTML = `
        <div class="history-card-header">
          <span class="history-date">${dateStr} à ${timeStr}</span>
          <div class="history-card-badges">
            ${qualityDisplay}
            ${statusDot}
          </div>
        </div>
        <div class="history-card-body">
          <div class="history-task-name">${escapeHtml(session.taskName)}</div>
          <div class="history-meta">
            ${session.subject ? escapeHtml(session.subject) + ' — ' : ''}${session.actualDuration || session.duration} min effective${(session.actualDuration || session.duration) > 1 ? 's' : ''}
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
    summaryDetailTitle.textContent = 'Résumé — ' + taskName;
    summaryDetailText.textContent = summary;
    summaryDetailModal.classList.remove('hidden');
  }

  // ---- Export CSV ----

  async function exporterCSV() {
    const sessions = await StudyDB.getToutesSessions();
    if (sessions.length === 0) {
      afficherToast('Aucune session à exporter');
      return;
    }

    // En-tête CSV (ajout qualité et heure)
    const headers = [
      'Date', 'Heure', 'Tâche', 'Matière',
      'Durée prévue (min)', 'Durée réelle (min)',
      'Difficulté', 'Qualité (1-5)', 'Résumé', 'Complété'
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

    afficherToast('Export CSV téléchargé');
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
      'Commencer une nouvelle journée\u00a0? Le contrat actuel sera effacé.',
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
      { name: 'Résumé chapitre 4', subject: 'Français', duration: 25, difficulty: 2, done: false },
      { name: 'Exercices équations', subject: 'Maths', duration: 50, difficulty: 3, done: false },
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

    if (tab === 'main') {
      tabMain.classList.remove('hidden');
      tabHistory.classList.add('hidden');
      tabDashboard.classList.add('hidden');
    } else if (tab === 'history') {
      tabMain.classList.add('hidden');
      tabHistory.classList.remove('hidden');
      tabDashboard.classList.add('hidden');
      afficherHistorique();
    } else if (tab === 'dashboard') {
      tabMain.classList.add('hidden');
      tabHistory.classList.add('hidden');
      tabDashboard.classList.remove('hidden');
      // Charger le dashboard chronobiologique
      StudyDashboard.afficherDashboard();
    }
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
          'Quitter la session en cours\u00a0? La tâche ne sera pas marquée comme accomplie.',
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
