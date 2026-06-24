/**
 * session-store.js — « Base de données » locale des sessions de test.
 *
 * Le projet étant 100 % statique (aucun serveur), on ne peut pas écrire de fichier
 * dans data/ depuis le navigateur. localStorage joue donc le rôle de BDD : les
 * sessions de test y sont persistées, listées et rejouées par la page viewer, qui
 * se met à jour automatiquement. Un export/import fichier permet d'archiver ou de
 * transférer les sessions entre machines.
 *
 * API :
 *   SessionStore.save(sessionData)      → id (string)
 *   SessionStore.list()                 → [{ id, summary }]  (résumés, triés récents d'abord)
 *   SessionStore.get(id)                → sessionData | null
 *   SessionStore.delete(id)             → bool
 *   SessionStore.clear()                → void
 *   SessionStore.exportAll()            → object  (toutes les sessions, pour fichier)
 *   SessionStore.importAll(obj, merge)  → number  (nb importées)
 *   SessionStore.summarize(sessionData) → résumé tabulaire (date, nom, lux, px…)
 */
(function (global) {
  'use strict';

  var KEY = 'webgaze_sessions';

  function _read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }
  function _write(map) {
    try { global.localStorage.setItem(KEY, JSON.stringify(map)); return true; }
    catch (_) { return false; }
  }
  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Extrait un résumé tabulaire d'une session (pour la liste du viewer).
  function summarize(data) {
    var s = (data && data.session) || {};
    var raw = (data && data.raw_gaze_data) || [];
    var events = (data && data.events) || [];
    var cal = s.calibration_score || {};
    // lux : on prend la médiane des lux des points (si présents).
    var luxVals = raw.map(function (p) { return p.lux; }).filter(function (v) { return typeof v === 'number'; });
    var lux = luxVals.length ? Math.round(luxVals.sort(function (a, b) { return a - b; })[Math.floor(luxVals.length / 2)]) : null;
    var confs = raw.map(function (p) { return p.confidence; }).filter(function (v) { return typeof v === 'number'; });
    var meanConf = confs.length ? +(confs.reduce(function (a, b) { return a + b; }, 0) / confs.length).toFixed(2) : null;
    return {
      id:            data._id || null,
      participant:   ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || s.participant_id || 'anonyme',
      participant_id: s.participant_id || null,
      first_name:    s.first_name || null,
      last_name:     s.last_name || null,
      date:          (s.start_time || '').slice(0, 10) || null,
      start_time:    s.start_time || null,
      glasses:       s.glasses != null ? s.glasses : null,
      engine:        s.engine || (raw[0] && raw[0].source_module) || null,
      calib_error_px: typeof cal.mean_error_px === 'number' ? Math.round(cal.mean_error_px) : null,
      lux:           lux,
      mean_confidence: meanConf,
      n_points:      raw.length,
      n_fixations:   events.filter(function (e) { return e.type === 'fixation'; }).length,
      n_saccades:    events.filter(function (e) { return e.type === 'saccade'; }).length,
      n_aoi_hits:    (data.aoi_hits || []).length,
    };
  }

  var SessionStore = {
    STORAGE_KEY: KEY,

    save: function (data) {
      if (!data || !data.session) return null;
      var map = _read();
      var id = data._id || _uuid();
      data._id = id;
      data._saved_at = new Date().toISOString();
      map[id] = data;
      _write(map);
      return id;
    },

    list: function () {
      var map = _read();
      return Object.keys(map).map(function (id) {
        var d = map[id]; d._id = id;
        return { id: id, summary: summarize(d) };
      }).sort(function (a, b) {
        return (b.summary.start_time || '').localeCompare(a.summary.start_time || '');
      });
    },

    get: function (id) {
      var map = _read();
      var d = map[id] || null;
      if (d) d._id = id;
      return d;
    },

    delete: function (id) {
      var map = _read();
      if (!map[id]) return false;
      delete map[id]; _write(map); return true;
    },

    clear: function () { _write({}); },

    count: function () { return Object.keys(_read()).length; },

    exportAll: function () {
      return { format: 'webgaze-sessions', version: 1, exported_at: new Date().toISOString(), sessions: _read() };
    },

    importAll: function (obj, merge) {
      if (!obj || !obj.sessions) return 0;
      var map = merge ? _read() : {};
      var n = 0;
      Object.keys(obj.sessions).forEach(function (id) {
        map[id] = obj.sessions[id]; n++;
      });
      _write(map);
      return n;
    },

    summarize: summarize,
  };

  global.SessionStore = SessionStore;

})(typeof window !== 'undefined' ? window : global);
