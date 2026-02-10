// ============================================================
// Study Protocol Manager — Logique applicative
// Persistance via localStorage, aucun backend requis.
// ============================================================

(function () {
  'use strict';

  // ---- Constantes ----
  const MAX_TASKS = 5;
  const MIN_TASKS = 3;
  const DIFFICULTY_LABELS = ['', 'Facile', 'Moyen', 'Difficile'];
  const STORAGE_KEY = 'studyproto_contract';

  // Périmètre du cercle SVG (2 * PI * rayon 90)
  const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

  // ---- Références DOM ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const viewContract = $('#viewContract');
  const viewLocked   = $('#viewLocked');
  const viewTimer    = $('#viewTimer');

  const taskListEl      = $('#taskList');
  const btnAddTask      = $('#btnAddTask');
  const btnLockContract = $('#btnLockContract');
  const btnLoadDemo     = $('#btnLoadDemo');

  const progressSummary = $('#progressSummary');
  const lockedTaskList  = $('#lockedTaskList');
  const btnResetDay     = $('#btnResetDay');

  const timerTaskName    = $('#timerTaskName');
  const timerSubject     = $('#timerSubject');
  const timerDigits      = $('#timerDigits');
  const timerRingProgress = $('#timerRingProgress');
  const btnPause         = $('#btnPause');
  const btnFinish        = $('#btnFinish');
  const btnAbandon       = $('#btnAbandon');
  const btnBackToList    = $('#btnBackToList');
  const chkSound         = $('#chkSound');
  const breakSuggestion  = $('#breakSuggestion');
  const breakDuration    = $('#breakDuration');
  const btnDismissBreak  = $('#btnDismissBreak');

  const confirmDialog  = $('#confirmDialog');
  const confirmMessage = $('#confirmMessage');
  const btnConfirmYes  = $('#btnConfirmYes');
  const btnConfirmNo   = $('#btnConfirmNo');

  // ---- État applicatif ----
  let contract = null;         // { date, locked, tasks: [...] }
  let timerInterval = null;
  let timerRemaining = 0;      // secondes restantes
  let timerTotal = 0;          // durée totale en secondes
  let timerPaused = false;
  let currentTaskIndex = -1;
  let confirmCallback = null;  // fonction appelée si l'utilisateur confirme

  // ---- Initialisation ----
  function init() {
    afficherDate();
    chargerContrat();
    attacherEvenements();
    enregistrerServiceWorker();
  }

  // Affiche la date du jour dans l'en-tête
  function afficherDate() {
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    $('#currentDate').textContent = new Date().toLocaleDateString('fr-BE', options);
  }

  // ---- Persistance localStorage ----

  function sauvegarderContrat() {
    if (contract) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contract));
    }
  }

  function chargerContrat() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        contract = JSON.parse(raw);
      } catch (_) {
        contract = null;
      }
    }

    // Vérifier que le contrat date d'aujourd'hui
    const today = new Date().toISOString().slice(0, 10);
    if (contract && contract.date === today && contract.locked) {
      afficherVueVerrouillee();
    } else if (contract && contract.date === today && !contract.locked) {
      // Contrat en cours d'édition, le restaurer
      restaurerFormulaire();
    } else {
      // Nouveau jour ou pas de contrat : formulaire vierge
      contract = null;
      creerFormulaireInitial();
    }
  }

  // ---- Formulaire de création du contrat ----

  // Crée le formulaire avec un nombre initial de tâches
  function creerFormulaireInitial() {
    taskListEl.innerHTML = '';
    for (let i = 0; i < MIN_TASKS; i++) {
      ajouterCarteTache();
    }
    mettreAJourBoutons();
    afficherVue('viewContract');
  }

  // Restaure le formulaire depuis un contrat non verrouillé
  function restaurerFormulaire() {
    taskListEl.innerHTML = '';
    contract.tasks.forEach((t) => {
      ajouterCarteTache(t);
    });
    mettreAJourBoutons();
    afficherVue('viewContract');
  }

  // Génère le HTML d'une carte de tâche
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

  // Remet à jour les numéros « Tâche 1, Tâche 2… » après suppression
  function renumeroterCartes() {
    const cards = taskListEl.querySelectorAll('.task-card');
    cards.forEach((c, i) => {
      c.dataset.index = i;
      c.querySelector('.task-number').textContent = `Tâche ${i + 1}`;
    });
  }

  // Active ou désactive les boutons selon le nombre de tâches et la validité
  function mettreAJourBoutons() {
    const count = taskListEl.children.length;
    btnAddTask.disabled = count >= MAX_TASKS;

    // Le bouton « Démarrer » est actif si ≥ MIN_TASKS tâches ont un nom
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
      if (!name) return; // ignorer les tâches vides
      tasks.push({
        name: name,
        subject: c.querySelector('.input-subject').value.trim(),
        duration: parseInt(c.querySelector('.input-duration').value, 10),
        difficulty: parseInt(c.querySelector('.input-difficulty').value, 10),
        done: false
      });
    });
    return tasks;
  }

  // ---- Verrouillage du contrat ----

  function verrouillerContrat() {
    const tasks = lireTachesFormulaire();
    if (tasks.length < MIN_TASKS) return;

    contract = {
      date: new Date().toISOString().slice(0, 10),
      locked: true,
      tasks: tasks
    };
    sauvegarderContrat();
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
      li.className = 'locked-item' + (task.done ? ' done' : '');
      const diffText = DIFFICULTY_LABELS[task.difficulty] || '';
      li.innerHTML = `
        <span class="locked-item-check">${task.done ? '&#10003;' : ''}</span>
        <div class="locked-item-body">
          <div class="locked-item-name">${escapeHtml(task.name)}</div>
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

      if (timerRemaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        finDeSession();
      }
    }, 1000);
  }

  function mettreAJourAffichageTimer() {
    // Affichage MM:SS
    const min = Math.floor(Math.max(0, timerRemaining) / 60);
    const sec = Math.max(0, timerRemaining) % 60;
    timerDigits.textContent =
      String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');

    // Barre de progression circulaire
    const progress = timerTotal > 0 ? timerRemaining / timerTotal : 1;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    timerRingProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
    timerRingProgress.style.strokeDashoffset = offset;
  }

  function finDeSession() {
    // Jouer un son doux si activé
    if (chkSound.checked) {
      jouerSonFin();
    }

    // Marquer la tâche comme accomplie
    marquerTacheAccomplie();

    // Suggérer une pause
    const task = contract.tasks[currentTaskIndex];
    breakDuration.textContent = task.duration === 50 ? '10' : '5';
    breakSuggestion.classList.remove('hidden');
  }

  function marquerTacheAccomplie() {
    if (currentTaskIndex >= 0 && contract.tasks[currentTaskIndex]) {
      contract.tasks[currentTaskIndex].done = true;
      sauvegarderContrat();
    }
  }

  function togglePause() {
    timerPaused = !timerPaused;
    btnPause.textContent = timerPaused ? 'Reprendre' : 'Pause';
  }

  function terminerSession() {
    clearInterval(timerInterval);
    timerInterval = null;
    marquerTacheAccomplie();
    retourContrat();
  }

  function abandonnerSession() {
    afficherConfirmation(
      'Es-tu sûr·e de vouloir abandonner cette session\u00a0?',
      'Oui, abandonner',
      () => {
        clearInterval(timerInterval);
        timerInterval = null;
        retourContrat();
      }
    );
  }

  function retourContrat() {
    currentTaskIndex = -1;
    breakSuggestion.classList.add('hidden');
    afficherVueVerrouillee();
  }

  // ---- Son de fin de session ----

  function jouerSonFin() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Deux notes douces successives
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
      () => {
        localStorage.removeItem(STORAGE_KEY);
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

  // ---- Navigation entre vues ----

  function afficherVue(id) {
    [viewContract, viewLocked, viewTimer].forEach((v) => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
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
        // Timer en cours, demander confirmation
        afficherConfirmation(
          'Quitter la session en cours\u00a0? La tâche ne sera pas marquée comme accomplie.',
          'Oui, quitter',
          () => {
            clearInterval(timerInterval);
            timerInterval = null;
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
  }

  // ---- Lancement ----
  document.addEventListener('DOMContentLoaded', init);

})();
