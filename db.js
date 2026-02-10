// ============================================================
// Study Protocol Manager — Module IndexedDB (étape 3)
// Gère la persistance via IndexedDB avec fallback localStorage.
// Migration automatique des données localStorage existantes.
//
// Stores :
//   - "contracts"       : contrats quotidiens
//   - "sessions"        : sessions de travail (+ qualityRating, hourOfDay)
//   - "userPreferences" : préférences chronobiologiques de l'utilisateur
// ============================================================

/**
 * Module DB exposé globalement via window.StudyDB
 *
 * Version 2 du schéma :
 *   - Ajout du champ hourOfDay (index) et qualityRating aux sessions
 *   - Nouveau store "userPreferences" pour les préférences horaires
 */
const StudyDB = (function () {
  'use strict';

  const DB_NAME = 'StudyProtocolDB';
  const DB_VERSION = 2; // v2 : ajout userPreferences + index hourOfDay
  const STORE_CONTRACTS = 'contracts';
  const STORE_SESSIONS = 'sessions';
  const STORE_PREFS = 'userPreferences';
  const LEGACY_KEY = 'studyproto_contract';

  let db = null; // référence à la base IDBDatabase

  // ---- Vérifie le support IndexedDB ----
  function isSupported() {
    return 'indexedDB' in window;
  }

  // ---- Ouverture / création de la base ----
  function open() {
    return new Promise((resolve, reject) => {
      if (!isSupported()) {
        console.warn('[StudyDB] IndexedDB non supporté, fallback localStorage.');
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Création ou mise à jour du schéma
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        const oldVersion = event.oldVersion;

        // ---- Version 0 → 1 : stores initiaux ----
        if (oldVersion < 1) {
          // Store "contracts" — un contrat par jour
          if (!database.objectStoreNames.contains(STORE_CONTRACTS)) {
            const contractStore = database.createObjectStore(STORE_CONTRACTS, {
              keyPath: 'id',
              autoIncrement: true
            });
            contractStore.createIndex('date', 'date', { unique: false });
          }

          // Store "sessions" — chaque session de travail
          if (!database.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessionStore = database.createObjectStore(STORE_SESSIONS, {
              keyPath: 'id',
              autoIncrement: true
            });
            sessionStore.createIndex('date', 'date', { unique: false });
            sessionStore.createIndex('taskName', 'taskName', { unique: false });
          }
        }

        // ---- Version 1 → 2 : ajout userPreferences + index hourOfDay ----
        if (oldVersion < 2) {
          // Ajout de l'index hourOfDay au store sessions existant
          const tx = event.target.transaction;
          if (database.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessionStore = tx.objectStore(STORE_SESSIONS);
            if (!sessionStore.indexNames.contains('hourOfDay')) {
              sessionStore.createIndex('hourOfDay', 'hourOfDay', { unique: false });
            }
          }

          // Nouveau store "userPreferences"
          if (!database.objectStoreNames.contains(STORE_PREFS)) {
            database.createObjectStore(STORE_PREFS, {
              keyPath: 'id',
              autoIncrement: true
            });
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

  // ---- Initialise la DB et migre les données localStorage si nécessaire ----
  async function init() {
    await open();
    if (db) {
      await migrerDepuisLocalStorage();
    }
  }

  // ---- Migration localStorage → IndexedDB ----
  async function migrerDepuisLocalStorage() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return; // rien à migrer

    try {
      const data = JSON.parse(raw);
      if (!data || !data.date || !Array.isArray(data.tasks)) return;

      // Vérifier si ce contrat existe déjà dans IndexedDB
      const existant = await getContratParDate(data.date);
      if (!existant) {
        await sauvegarderContrat({
          date: data.date,
          locked: data.locked || false,
          tasks: data.tasks
        });
        console.info('[StudyDB] Migration localStorage → IndexedDB réussie.');
      }

      // Supprimer l'ancienne clé localStorage
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('[StudyDB] Erreur migration localStorage :', e);
    }
  }

  // ---- Helpers pour transactions ----

  /** Exécute une opération sur un store et retourne une promesse */
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

  // ==== OPÉRATIONS SUR LES CONTRATS ====

  /** Sauvegarde un contrat (ajout ou mise à jour) */
  function sauvegarderContrat(contrat) {
    if (!db) {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(contrat));
      return Promise.resolve();
    }
    return execTransaction(STORE_CONTRACTS, 'readwrite', (store) => {
      return store.put(contrat);
    });
  }

  /** Récupère un contrat par sa date (YYYY-MM-DD) */
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

  /** Supprime le contrat du jour */
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
        const keys = request.result;
        keys.forEach((key) => store.delete(key));
        tx.oncomplete = () => resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==== OPÉRATIONS SUR LES SESSIONS ====

  /** Enregistre une session de travail */
  function enregistrerSession(session) {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      session.id = Date.now();
      sessions.push(session);
      localStorage.setItem('studyproto_sessions', JSON.stringify(sessions));
      return Promise.resolve(session.id);
    }

    return execTransaction(STORE_SESSIONS, 'readwrite', (store) => {
      return store.add(session);
    });
  }

  /** Récupère les N dernières sessions (ordre chronologique inversé) */
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

  /** Récupère toutes les sessions (pour export CSV) */
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

  /**
   * Récupère les sessions dans une période donnée [debut, fin] (timestamps).
   * Utilisé par le dashboard pour les calculs de statistiques.
   */
  function getSessionsParPeriode(debut, fin) {
    if (!db) {
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      return Promise.resolve(
        sessions.filter((s) => s.date >= debut && s.date <= fin)
                .sort((a, b) => a.date - b.date)
      );
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const index = store.index('date');
      const range = IDBKeyRange.bound(debut, fin);
      const request = index.getAll(range);

      request.onsuccess = () => {
        resolve(request.result.sort((a, b) => a.date - b.date));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==== OPÉRATIONS SUR LES PRÉFÉRENCES UTILISATEUR ====

  /**
   * Sauvegarde les préférences utilisateur (chronotype, créneaux préférés).
   * Structure attendue :
   *   {
   *     id: 1,  (toujours 1, une seule entrée)
   *     preferredTimeSlots: ["16:00-19:00"],
   *     detectedChronotype: "matinal" | "vespertinus" | "non_détecté",
   *     lastUpdated: timestamp
   *   }
   */
  function sauvegarderPreferences(prefs) {
    if (!db) {
      localStorage.setItem('studyproto_prefs', JSON.stringify(prefs));
      return Promise.resolve();
    }
    // Toujours utiliser id=1 pour avoir une seule entrée
    prefs.id = 1;
    return execTransaction(STORE_PREFS, 'readwrite', (store) => {
      return store.put(prefs);
    });
  }

  /** Récupère les préférences utilisateur */
  function getPreferences() {
    if (!db) {
      const raw = localStorage.getItem('studyproto_prefs');
      if (!raw) return Promise.resolve(null);
      try {
        return Promise.resolve(JSON.parse(raw));
      } catch (_) {
        return Promise.resolve(null);
      }
    }

    return execTransaction(STORE_PREFS, 'readonly', (store) => {
      return store.get(1);
    });
  }

  // ==== API PUBLIQUE ====
  return {
    init: init,
    isSupported: isSupported,
    sauvegarderContrat: sauvegarderContrat,
    getContratParDate: getContratParDate,
    supprimerContratDuJour: supprimerContratDuJour,
    enregistrerSession: enregistrerSession,
    getDernieresSessions: getDernieresSessions,
    getToutesSessions: getToutesSessions,
    getSessionsParPeriode: getSessionsParPeriode,
    sauvegarderPreferences: sauvegarderPreferences,
    getPreferences: getPreferences
  };
})();
