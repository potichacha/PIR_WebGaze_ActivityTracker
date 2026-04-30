/**
 * gaze-logger.js — Module de journalisation de session (US-3.1)
 *
 * API publique :
 *   GazeLogger.init(participantId)           → void
 *   GazeLogger.logRawPoint(x, y, timestamp) → void
 *   GazeLogger.logEvent(event)              → void
 *   GazeLogger.logAOIHit(aoiId, aoiLabel, eventIndex, timestamp) → void
 *   GazeLogger.export()                     → object (JSON)
 *   GazeLogger.download()                   → void
 *   GazeLogger.clear()                      → void
 *   GazeLogger.getStats()                   → object
 */

(function (global) {
  'use strict';

  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function _browserName() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Edg') !== -1)     return 'Edge';
    if (ua.indexOf('Chrome') !== -1)  return 'Chrome';
    if (ua.indexOf('Firefox') !== -1) return 'Firefox';
    if (ua.indexOf('Safari') !== -1)  return 'Safari';
    return 'Unknown';
  }

  // ─── État interne ────────────────────────────────────────────────────────────
  var _session     = null;
  var _rawGaze     = [];
  var _events      = [];
  var _aoiHits     = [];

  // ─── API publique ────────────────────────────────────────────────────────────
  var GazeLogger = {

    /**
     * Initialise une nouvelle session de log.
     * @param {string} participantId
     * @param {object} [calibrationScore] — { mean_error_px, std_error_px }
     */
    init: function (participantId, calibrationScore) {
      _rawGaze  = [];
      _events   = [];
      _aoiHits  = [];
      _session  = {
        id:             _uuid(),
        participant_id: participantId || 'anonymous',
        start_time:     new Date().toISOString(),
        end_time:       null,
        screen_resolution: {
          width:  window.innerWidth,
          height: window.innerHeight,
        },
        browser:           _browserName(),
        calibration_score: calibrationScore || null,
      };
    },

    /**
     * Enregistre un point de regard brut.
     * @param {number} x
     * @param {number} y
     * @param {number} timestamp — ms epoch
     */
    logRawPoint: function (x, y, timestamp) {
      if (!_session) return;
      _rawGaze.push({ x: Math.round(x), y: Math.round(y), timestamp: timestamp || Date.now() });
    },

    /**
     * Enregistre un événement (fixation ou saccade).
     * @param {object} event — { type, start_time, end_time, duration, details }
     */
    logEvent: function (event) {
      if (!_session || !event) return;
      _events.push({
        type:       event.type       || 'unknown',
        start_time: event.start_time || 0,
        end_time:   event.end_time   || 0,
        duration:   event.duration   || 0,
        details:    event.details    || {},
      });
    },

    /**
     * Enregistre un hit AOI (fixation dans une zone d'intérêt).
     * @param {string} aoiId
     * @param {string} aoiLabel
     * @param {number} eventIndex — index dans _events
     * @param {number} [timestamp]
     */
    logAOIHit: function (aoiId, aoiLabel, eventIndex, timestamp) {
      if (!_session) return;
      _aoiHits.push({
        aoi_id:      aoiId    || '',
        aoi_label:   aoiLabel || '',
        event_index: typeof eventIndex === 'number' ? eventIndex : -1,
        timestamp:   timestamp || Date.now(),
      });
    },

    /**
     * Exporte la session complète sous forme d'objet JSON.
     * @returns {object}
     */
    export: function () {
      if (_session) _session.end_time = new Date().toISOString();
      return {
        session:       _session || {
          id: _uuid(), participant_id: 'anonymous',
          start_time: new Date().toISOString(), end_time: new Date().toISOString(),
          screen_resolution: { width: window.innerWidth, height: window.innerHeight },
          browser: _browserName(), calibration_score: null,
        },
        raw_gaze_data: _rawGaze.slice(),
        events:        _events.slice(),
        aoi_hits:      _aoiHits.slice(),
      };
    },

    /**
     * Déclenche le téléchargement du fichier JSON.
     */
    download: function () {
      var data = this.export();
      var pid  = (data.session.participant_id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');
      var date = new Date().toISOString().slice(0, 10);
      var name = 'session_' + pid + '_' + date + '.json';
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    /**
     * Remet le logger à zéro (sans re-init de session).
     */
    clear: function () {
      _session  = null;
      _rawGaze  = [];
      _events   = [];
      _aoiHits  = [];
    },

    /**
     * Retourne des stats rapides sur la session en cours.
     * @returns {{ rawPoints: number, fixations: number, saccades: number, aoiHits: number }}
     */
    getStats: function () {
      return {
        rawPoints: _rawGaze.length,
        fixations: _events.filter(function (e) { return e.type === 'fixation'; }).length,
        saccades:  _events.filter(function (e) { return e.type === 'saccade';  }).length,
        aoiHits:   _aoiHits.length,
      };
    },

    isInitialized: function () { return !!_session; },
  };

  global.GazeLogger = GazeLogger;

})(typeof window !== 'undefined' ? window : global);
