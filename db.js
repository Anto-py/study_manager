// ============================================================
// Study Protocol Manager — Module IndexedDB (v4 finale)
// Gère la persistance via IndexedDB avec fallback localStorage.
//
// Stores :
//   - "contracts"       : contrats quotidiens
//   - "sessions"        : sessions de travail (+ qualityRating, hourOfDay)
//   - "userPreferences" : préférences chronobiologiques de l'utilisateur
//   - "flashcards"      : cartes de révision avec répétition espacée SM-2
//
// Version 4 :
//   - Index "subject" sur sessions
//   - Index "nextReviewDate" sur flashcards
//   - Champs SM-2 : easinessFactor, interval, nextReviewDate
//   - Méthodes export/import complètes
// ============================================================

const StudyDB = (function () {
  'use strict';

  const DB_NAME = 'StudyProtocolDB';
  const DB_VERSION = 4;
  const STORE_CONTRACTS = 'contracts';
  const STORE_SESSIONS = 'sessions';
  const STORE_PREFS = 'userPreferences';
  const STORE_FLASHCARDS = 'flashcards';
  const LEGACY_KEY = 'studyproto_contract';

  let db = null;

  function isSupported() {
    return 'indexedDB' in window;
  }

  function open() {
    return new Promise((resolve, reject) => {
      if (!isSupported()) {
        console.warn('[StudyDB] IndexedDB non supporté, fallback localStorage.');
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        const oldVersion = event.oldVersion;
        const tx = event.target.transaction;

        // Version 0 -> 1
        if (oldVersion < 1) {
          if (!database.objectStoreNames.contains(STORE_CONTRACTS)) {
            const contractStore = database.createObjectStore(STORE_CONTRACTS, {
              keyPath: 'id', autoIncrement: true
            });
            contractStore.createIndex('date', 'date', { unique: false });
          }
          if (!database.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessionStore = database.createObjectStore(STORE_SESSIONS, {
              keyPath: 'id', autoIncrement: true
            });
            sessionStore.createIndex('date', 'date', { unique: false });
            sessionStore.createIndex('taskName', 'taskName', { unique: false });
          }
        }

        // Version 1 -> 2
        if (oldVersion < 2) {
          if (database.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessionStore = tx.objectStore(STORE_SESSIONS);
            if (!sessionStore.indexNames.contains('hourOfDay')) {
              sessionStore.createIndex('hourOfDay', 'hourOfDay', { unique: false });
            }
          }
          if (!database.objectStoreNames.contains(STORE_PREFS)) {
            database.createObjectStore(STORE_PREFS, { keyPath: 'id', autoIncrement: true });
          }
        }

        // Version 2 -> 3
        if (oldVersion < 3) {
          if (!database.objectStoreNames.contains(STORE_FLASHCARDS)) {
            const flashcardStore = database.createObjectStore(STORE_FLASHCARDS, {
              keyPath: 'id', autoIncrement: true
            });
            flashcardStore.createIndex('subject', 'subject', { unique: false });
            flashcardStore.createIndex('createdDate', 'createdDate', { unique: false });
            flashcardStore.createIndex('lastReviewed', 'lastReviewed', { unique: false });
          }
        }

        // Version 3 -> 4 : SM-2 indexes + sessions subject index
        if (oldVersion < 4) {
          if (database.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessionStore = tx.objectStore(STORE_SESSIONS);
            if (!sessionStore.indexNames.contains('subject')) {
              sessionStore.createIndex('subject', 'subject', { unique: false });
            }
          }
          if (database.objectStoreNames.contains(STORE_FLASHCARDS)) {
            const flashcardStore = tx.objectStore(STORE_FLASHCARDS);
            if (!flashcardStore.indexNames.contains('nextReviewDate')) {
              flashcardStore.createIndex('nextReviewDate', 'nextReviewDate', { unique: false });
            }
          }
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('[StudyDB] Erreur ouverture :', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async function init() {
    await open();
    if (db) {
      await migrerDepuisLocalStorage();
    }
  }

  async function migrerDepuisLocalStorage() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!data || !data.date || !Array.isArray(data.tasks)) return;
      const existant = await getContratParDate(data.date);
      if (!existant) {
        await sauvegarderContrat({
          date: data.date,
          locked: data.locked || false,
          tasks: data.tasks
        });
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('[StudyDB] Erreur migration localStorage :', e);
    }
  }

  function execTransaction(storeName, mode, callback) {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject(new Error('IndexedDB non disponible'));
        return;
      }
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = callback(store);
      if (result && typeof result.onsuccess !== 'undefined') {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }
    });
  }

  // ==== CONTRATS ====

  function sauvegarderContrat(contrat) {
    if (!db) {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(contrat));
      return Promise.resolve();
    }
    return execTransaction(STORE_CONTRACTS, 'readwrite', (store) => store.put(contrat));
  }

  function getContratParDate(date) {
    if (!db) {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return Promise.resolve(null);
      try {
        const data = JSON.parse(raw);
        return Promise.resolve(data && data.date === date ? data : null);
      } catch (_) {
        return Promise.resolve(null);
      }
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONTRACTS, 'readonly');
      const store = tx.objectStore(STORE_CONTRACTS);
      const index = store.index('date');
      const request = index.getAll(date);
      request.onsuccess = () => {
        const results = request.result;
        resolve(results.length > 0 ? results[results.length - 1] : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function supprimerContratDuJour(date) {
    if (!db) {
      localStorage.removeItem(LEGACY_KEY);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONTRACTS, 'readwrite');
      const store = tx.objectStore(STORE_CONTRACTS);
      const index = store.index('date');
      const request = index.getAllKeys(date);
      request.onsuccess = () => {
        request.result.forEach((key) => store.delete(key));
        tx.oncomplete = () => resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getTousContrats() {
    if (!db) {
      const raw = localStorage.getItem(LEGACY_KEY);
      return Promise.resolve(raw ? [JSON.parse(raw)] : []);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONTRACTS, 'readonly');
      const store = tx.objectStore(STORE_CONTRACTS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==== SESSIONS ====

  function enregistrerSession(session) {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      session.id = Date.now();
      sessions.push(session);
      localStorage.setItem('studyproto_sessions', JSON.stringify(sessions));
      return Promise.resolve(session.id);
    }
    return execTransaction(STORE_SESSIONS, 'readwrite', (store) => store.add(session));
  }

  function getDernieresSessions(limit) {
    limit = limit || 20;
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      sessions.sort((a, b) => b.date - a.date);
      return Promise.resolve(sessions.slice(0, limit));
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const results = [];
      const request = store.openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Pagination : sessions avec offset et limit */
  function getSessionsPaginees(offset, limit) {
    offset = offset || 0;
    limit = limit || 20;
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      sessions.sort((a, b) => b.date - a.date);
      return Promise.resolve(sessions.slice(offset, offset + limit));
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const results = [];
      let skipped = 0;
      const request = store.openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { resolve(results); return; }
        if (skipped < offset) {
          skipped++;
          cursor.continue();
        } else if (results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getToutesSessions() {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      sessions.sort((a, b) => b.date - a.date);
      return Promise.resolve(sessions);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        results.sort((a, b) => b.date - a.date);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getSessionsParPeriode(debut, fin) {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      return Promise.resolve(
        sessions.filter((s) => s.date >= debut && s.date <= fin).sort((a, b) => a.date - b.date)
      );
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const index = store.index('date');
      const range = IDBKeyRange.bound(debut, fin);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result.sort((a, b) => a.date - b.date));
      request.onerror = () => reject(request.error);
    });
  }

  function getNombreTotalSessions() {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      return Promise.resolve(sessions.length);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==== PRÉFÉRENCES ====

  function sauvegarderPreferences(prefs) {
    if (!db) {
      localStorage.setItem('studyproto_prefs', JSON.stringify(prefs));
      return Promise.resolve();
    }
    prefs.id = 1;
    return execTransaction(STORE_PREFS, 'readwrite', (store) => store.put(prefs));
  }

  function getPreferences() {
    if (!db) {
      const raw = localStorage.getItem('studyproto_prefs');
      if (!raw) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(raw)); }
      catch (_) { return Promise.resolve(null); }
    }
    return execTransaction(STORE_PREFS, 'readonly', (store) => store.get(1));
  }

  // ==== FLASHCARDS (avec SM-2) ====

  function ajouterFlashcard(flashcard) {
    // Ajouter les champs SM-2 par défaut si absents
    if (flashcard.easinessFactor === undefined) flashcard.easinessFactor = 2.5;
    if (flashcard.interval === undefined) flashcard.interval = 1;
    if (flashcard.nextReviewDate === undefined) flashcard.nextReviewDate = Date.now();

    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      flashcard.id = Date.now() + Math.floor(Math.random() * 1000);
      cards.push(flashcard);
      localStorage.setItem('studyproto_flashcards', JSON.stringify(cards));
      return Promise.resolve(flashcard.id);
    }
    return execTransaction(STORE_FLASHCARDS, 'readwrite', (store) => store.add(flashcard));
  }

  function mettreAJourFlashcard(flashcard) {
    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      const idx = cards.findIndex((c) => c.id === flashcard.id);
      if (idx >= 0) {
        cards[idx] = flashcard;
        localStorage.setItem('studyproto_flashcards', JSON.stringify(cards));
      }
      return Promise.resolve();
    }
    return execTransaction(STORE_FLASHCARDS, 'readwrite', (store) => store.put(flashcard));
  }

  function supprimerFlashcard(id) {
    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      localStorage.setItem('studyproto_flashcards', JSON.stringify(cards.filter((c) => c.id !== id)));
      return Promise.resolve();
    }
    return execTransaction(STORE_FLASHCARDS, 'readwrite', (store) => store.delete(id));
  }

  function getToutesFlashcards() {
    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      cards.sort((a, b) => b.createdDate - a.createdDate);
      return Promise.resolve(cards);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FLASHCARDS, 'readonly');
      const store = tx.objectStore(STORE_FLASHCARDS);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        results.sort((a, b) => b.createdDate - a.createdDate);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getFlashcardsParMatiere(matiere) {
    if (!matiere) return getToutesFlashcards();
    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      return Promise.resolve(
        cards.filter((c) => c.subject === matiere).sort((a, b) => b.createdDate - a.createdDate)
      );
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FLASHCARDS, 'readonly');
      const store = tx.objectStore(STORE_FLASHCARDS);
      const index = store.index('subject');
      const request = index.getAll(matiere);
      request.onsuccess = () => {
        resolve(request.result.sort((a, b) => b.createdDate - a.createdDate));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Récupère les flashcards dues pour révision (nextReviewDate <= maintenant) */
  function getFlashcardsDues() {
    const maintenant = Date.now();
    if (!db) {
      const cards = JSON.parse(localStorage.getItem('studyproto_flashcards') || '[]');
      return Promise.resolve(
        cards.filter((c) => !c.nextReviewDate || c.nextReviewDate <= maintenant)
             .sort((a, b) => (a.nextReviewDate || 0) - (b.nextReviewDate || 0))
      );
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FLASHCARDS, 'readonly');
      const store = tx.objectStore(STORE_FLASHCARDS);
      const index = store.index('nextReviewDate');
      const range = IDBKeyRange.upperBound(maintenant);
      const request = index.getAll(range);
      request.onsuccess = () => {
        resolve(request.result.sort((a, b) => (a.nextReviewDate || 0) - (b.nextReviewDate || 0)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Récupère la prochaine date de révision (la plus proche dans le futur) */
  async function getProchaineRevision() {
    const cards = await getToutesFlashcards();
    const maintenant = Date.now();
    let prochaine = null;
    cards.forEach((c) => {
      if (c.nextReviewDate && c.nextReviewDate > maintenant) {
        if (!prochaine || c.nextReviewDate < prochaine) {
          prochaine = c.nextReviewDate;
        }
      }
    });
    return prochaine;
  }

  async function getStatsFlashcards() {
    const cards = await getToutesFlashcards();
    const total = cards.length;
    const maitrisees = cards.filter((c) => c.reviewCount >= 3 && c.difficulty <= 1).length;
    const maintenant = Date.now();
    const dues = cards.filter((c) => !c.nextReviewDate || c.nextReviewDate <= maintenant).length;
    return { total, maitrisees, dues };
  }

  async function estPremiereUtilisation() {
    const prefs = await getPreferences();
    if (prefs && prefs.chronotypeScore) return false;
    const sessions = await getDernieresSessions(1);
    if (sessions.length > 0) return false;
    const today = new Date().toISOString().slice(0, 10);
    const contrat = await getContratParDate(today);
    if (contrat) return false;
    return true;
  }

  // ==== EXPORT / IMPORT ====

  /** Exporte toutes les données des 4 stores en objet structuré */
  async function exporterToutesDonnees() {
    const contracts = await getTousContrats();
    const sessions = await getToutesSessions();
    const prefs = await getPreferences();
    const flashcards = await getToutesFlashcards();

    return {
      exportDate: new Date().toISOString(),
      appVersion: '1.0',
      userData: {
        chronotype: prefs || null,
        contracts: contracts,
        sessions: sessions,
        flashcards: flashcards
      }
    };
  }

  /** Importe des données depuis un objet JSON (fusion intelligente) */
  async function importerDonnees(data) {
    if (!data || !data.userData) {
      throw new Error('Format de fichier invalide');
    }

    const ud = data.userData;
    let imported = { contracts: 0, sessions: 0, flashcards: 0, chronotype: false };

    // Importer le chronotype
    if (ud.chronotype && ud.chronotype.chronotypeScore) {
      await sauvegarderPreferences(ud.chronotype);
      imported.chronotype = true;
    }

    // Importer les contrats
    if (Array.isArray(ud.contracts)) {
      for (const c of ud.contracts) {
        const copy = Object.assign({}, c);
        delete copy.id; // laisser IndexedDB attribuer un nouvel ID
        await execTransaction(STORE_CONTRACTS, 'readwrite', (store) => store.add(copy));
        imported.contracts++;
      }
    }

    // Importer les sessions
    if (Array.isArray(ud.sessions)) {
      for (const s of ud.sessions) {
        const copy = Object.assign({}, s);
        delete copy.id;
        await execTransaction(STORE_SESSIONS, 'readwrite', (store) => store.add(copy));
        imported.sessions++;
      }
    }

    // Importer les flashcards
    if (Array.isArray(ud.flashcards)) {
      for (const f of ud.flashcards) {
        const copy = Object.assign({}, f);
        delete copy.id;
        // Assurer les champs SM-2
        if (copy.easinessFactor === undefined) copy.easinessFactor = 2.5;
        if (copy.interval === undefined) copy.interval = 1;
        if (copy.nextReviewDate === undefined) copy.nextReviewDate = Date.now();
        await execTransaction(STORE_FLASHCARDS, 'readwrite', (store) => store.add(copy));
        imported.flashcards++;
      }
    }

    return imported;
  }

  /** Estimation de la taille des données en Ko */
  async function estimerTailleDonnees() {
    const data = await exporterToutesDonnees();
    const json = JSON.stringify(data);
    return Math.round(new Blob([json]).size / 1024 * 10) / 10;
  }

  /** Période couverte par les sessions */
  async function getPeriodeSessions() {
    const sessions = await getToutesSessions();
    if (sessions.length === 0) return null;
    const dates = sessions.map((s) => s.date);
    return {
      debut: Math.min(...dates),
      fin: Math.max(...dates)
    };
  }

  // ==== RÉINITIALISATION ====

  async function reinitialiserTout() {
    if (db) {
      const stores = [STORE_CONTRACTS, STORE_SESSIONS, STORE_PREFS, STORE_FLASHCARDS];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((name) => tx.objectStore(name).clear());
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('studyproto_')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  /** Réinitialise uniquement les données (pas les préférences de thème etc.) */
  async function reinitialiserDonnees() {
    if (db) {
      const stores = [STORE_CONTRACTS, STORE_SESSIONS, STORE_PREFS, STORE_FLASHCARDS];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((name) => tx.objectStore(name).clear());
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('studyproto_') && key !== 'studyproto_theme' && key !== 'studyproto_tooltips_shown') {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  return {
    init, isSupported,
    sauvegarderContrat, getContratParDate, supprimerContratDuJour, getTousContrats,
    enregistrerSession, getDernieresSessions, getSessionsPaginees, getToutesSessions, getSessionsParPeriode, getNombreTotalSessions,
    sauvegarderPreferences, getPreferences,
    ajouterFlashcard, mettreAJourFlashcard, supprimerFlashcard,
    getToutesFlashcards, getFlashcardsParMatiere, getFlashcardsDues, getProchaineRevision, getStatsFlashcards,
    estPremiereUtilisation,
    exporterToutesDonnees, importerDonnees, estimerTailleDonnees, getPeriodeSessions,
    reinitialiserTout, reinitialiserDonnees
  };
})();
