// ============================================================
// Study Protocol Manager — Module IndexedDB
// Gère la persistance via IndexedDB avec fallback localStorage.
// Migration automatique des données localStorage existantes.
// ============================================================

/**
 * Module DB exposé globalement via window.StudyDB
 * Deux stores :
 *   - "contracts" : contrats quotidiens (id auto, date, tasks)
 *   - "sessions"  : sessions de travail (id auto, taskName, subject, etc.)
 */
const StudyDB = (function () {
  'use strict';

  const DB_NAME = 'StudyProtocolDB';
  const DB_VERSION = 1;
  const STORE_CONTRACTS = 'contracts';
  const STORE_SESSIONS = 'sessions';
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

        // Store "contracts" — un contrat par jour
        if (!database.objectStoreNames.contains(STORE_CONTRACTS)) {
          const contractStore = database.createObjectStore(STORE_CONTRACTS, {
            keyPath: 'id',
            autoIncrement: true
          });
          // Index pour rechercher par date (YYYY-MM-DD)
          contractStore.createIndex('date', 'date', { unique: false });
        }

        // Store "sessions" — chaque session de travail
        if (!database.objectStoreNames.contains(STORE_SESSIONS)) {
          const sessionStore = database.createObjectStore(STORE_SESSIONS, {
            keyPath: 'id',
            autoIncrement: true
          });
          // Index pour rechercher par date
          sessionStore.createIndex('date', 'date', { unique: false });
          // Index pour rechercher par nom de tâche
          sessionStore.createIndex('taskName', 'taskName', { unique: false });
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
        // Insérer le contrat migré
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
        // Fallback localStorage si IndexedDB indisponible
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
      // Fallback localStorage
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
      // Fallback localStorage
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
        // Retourne le dernier contrat pour cette date (le plus récent)
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
      // Fallback : stocker dans localStorage sous une clé dédiée
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      session.id = Date.now(); // identifiant simple
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
      // Fallback localStorage
      const sessions = JSON.parse(localStorage.getItem('studyproto_sessions') || '[]');
      sessions.sort((a, b) => b.date - a.date);
      return Promise.resolve(sessions.slice(0, limit));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const results = [];

      // Curseur inversé pour obtenir les plus récentes d'abord
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
        // Trier par date décroissante
        results.sort((a, b) => b.date - a.date);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
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
    getToutesSessions: getToutesSessions
  };
})();
