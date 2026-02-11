// ============================================================
// Study Protocol Manager — Module Export/Import
// Gère l'export CSV, JSON et l'import de sauvegardes.
// Exposé globalement via window.StudyExport
// ============================================================

const StudyExport = (function () {
  'use strict';

  const DIFFICULTY_LABELS = ['', 'Facile', 'Moyen', 'Difficile'];

  // ==== EXPORT CSV SESSIONS ====

  async function exporterCSV() {
    const sessions = await StudyDB.getToutesSessions();
    if (sessions.length === 0) return false;

    const headers = [
      'Date', 'Heure', 'T\u00e2che', 'Mati\u00e8re',
      'Dur\u00e9e_pr\u00e9vue', 'Dur\u00e9e_r\u00e9elle',
      'Difficult\u00e9', 'Qualit\u00e9', 'R\u00e9sum\u00e9', 'Statut'
    ];
    const rows = [headers.join(';')];

    sessions.forEach((s) => {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString('fr-BE');
      const timeStr = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const diffLabel = DIFFICULTY_LABELS[s.difficulty] || '';
      const summaryClean = s.summary ? '"' + s.summary.replace(/"/g, '""') + '"' : '';
      const qualite = s.qualityRating != null ? s.qualityRating : '';
      const statut = s.completed ? 'Termin\u00e9' : 'Abandonn\u00e9';

      rows.push([
        dateStr, timeStr,
        '"' + (s.taskName || '').replace(/"/g, '""') + '"',
        '"' + (s.subject || '').replace(/"/g, '""') + '"',
        s.duration, s.actualDuration || '',
        diffLabel, qualite, summaryClean, statut
      ].join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    telechargerBlob(blob, 'study-protocol-sessions-' + dateStamp() + '.csv');
    return true;
  }

  // ==== EXPORT JSON COMPLET ====

  async function exporterJSON() {
    const data = await StudyDB.exporterToutesDonnees();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    telechargerBlob(blob, 'study-protocol-backup-' + dateStamp() + '.json');
    return true;
  }

  // ==== IMPORT JSON ====

  function importerJSON(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.name.endsWith('.json')) {
        reject(new Error('Fichier JSON attendu'));
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);

          // Validation du format
          if (!data.userData && !data.appVersion) {
            reject(new Error('Format de sauvegarde non reconnu'));
            return;
          }

          // Si c'est un format partiel (juste userData sans wrapper)
          const normalizedData = data.userData ? data : { userData: data, appVersion: '1.0' };

          const result = await StudyDB.importerDonnees(normalizedData);
          resolve(result);
        } catch (err) {
          reject(new Error('Erreur de lecture : ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
      reader.readAsText(file);
    });
  }

  // ==== STATISTIQUES GDPR ====

  async function getStatistiquesGDPR() {
    const totalSessions = await StudyDB.getNombreTotalSessions();
    const periode = await StudyDB.getPeriodeSessions();
    const taille = await StudyDB.estimerTailleDonnees();
    const stats = await StudyDB.getStatsFlashcards();

    return {
      totalSessions: totalSessions,
      totalFlashcards: stats.total,
      periodeDebut: periode ? new Date(periode.debut).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
      periodeFin: periode ? new Date(periode.fin).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
      tailleKo: taille
    };
  }

  // ==== UTILITAIRES ====

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function telechargerBlob(blob, nom) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nom;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return {
    exporterCSV,
    exporterJSON,
    importerJSON,
    getStatistiquesGDPR
  };
})();
