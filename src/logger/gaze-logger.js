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

  // Version du module de calibration (si chargé).
  function _calibrationVersion() {
    try {
      if (typeof global.Calibration !== 'undefined' && global.Calibration.CONFIG) {
        return global.Calibration.CONFIG.VERSION || null;
      }
    } catch (_) {}
    return null;
  }

  // Instantané des paramètres de filtrage/correction qui influencent les données.
  function _configSnapshot() {
    try {
      if (typeof global.Calibration === 'undefined' || !global.Calibration.CONFIG) return null;
      var c = global.Calibration.CONFIG;
      return {
        clicks_per_point:          c.CLICKS_PER_POINT,
        recalibration_threshold:   c.RECALIBRATION_THRESHOLD,
        one_euro_min_cutoff:       c.ONE_EURO_MIN_CUTOFF,
        one_euro_beta:             c.ONE_EURO_BETA,
        one_euro_d_cutoff:         c.ONE_EURO_D_CUTOFF,
        ridge_parameter:           c.RIDGE_PARAMETER,
        lowess_enabled:            c.LOWESS_ENABLED,
        lowess_bandwidth:          c.LOWESS_BANDWIDTH,
        bilinear_enabled:          c.BILINEAR_ENABLED,
        synth_enabled:             c.SYNTH_ENABLED,
        head_compensation_enabled: c.HEAD_COMPENSATION_ENABLED,
        head_comp_gain:            c.HEAD_COMP_GAIN,
      };
    } catch (_) { return null; }
  }

  // Horloge monotone : performance.now() ne recule jamais (contrairement à
  // Date.now() sujet aux ajustements NTP/changements d'heure), ce qui est
  // indispensable pour des durées de fixation et des vélocités fiables.
  function _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  // ─── État interne ────────────────────────────────────────────────────────────
  var _session       = null;
  var _rawGaze       = [];
  var _events        = [];
  var _aoiHits       = [];
  var _interactions  = []; // journal d'interactions (clics, survols, navigation…)
  var _clockOrigin   = 0;  // performance.now() au démarrage de la session

  // ─── API publique ────────────────────────────────────────────────────────────
  var GazeLogger = {

    /**
     * Initialise une nouvelle session de log.
     * @param {string} participantId
     * @param {object} [calibrationScore] — { mean_error_px, std_error_px }
     */
    init: function (participantId, calibrationScore) {
      _rawGaze       = [];
      _events        = [];
      _aoiHits       = [];
      _interactions  = [];
      _clockOrigin   = _now();
      _session  = {
        id:             _uuid(),
        format_version: GazeLogger.FORMAT_VERSION,
        participant_id: participantId || 'anonymous',
        start_time:     new Date().toISOString(),
        end_time:       null,
        // Origine de l'horloge monotone : tous les timestamps relatifs (t_rel_ms)
        // sont exprimés par rapport à cet instant.
        clock_origin_ms: _clockOrigin,
        screen_resolution: {
          width:  window.innerWidth,
          height: window.innerHeight,
        },
        device_pixel_ratio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        user_agent:        typeof navigator !== 'undefined' ? navigator.userAgent : null,
        browser:           _browserName(),
        calibration_score: calibrationScore || null,
        // Reproductibilité : version du module et instantané de la config de
        // filtrage/correction utilisée pendant la session. Sans cela, impossible
        // de rejouer ou comparer deux sessions a posteriori.
        calibration_version: _calibrationVersion(),
        config_snapshot:     _configSnapshot(),
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
      _rawGaze.push({
        x: Math.round(x),
        y: Math.round(y),
        timestamp: timestamp || Date.now(),     // epoch ms (rétro-compatible)
        t_rel_ms:  +(_now() - _clockOrigin).toFixed(1), // horloge monotone relative
      });
    },

    /**
     * Enregistre une interaction utilisateur (donnée multimodale : clic, survol,
     * changement d'onglet, scroll, démarrage/arrêt…). Complète le regard pour
     * reconstituer l'activité analytique complète.
     * @param {string} type   — 'click' | 'hover' | 'tab_change' | 'scroll' | 'control' | …
     * @param {object} [details] — charge utile libre (target, value, x, y…)
     */
    logInteraction: function (type, details) {
      if (!_session) return;
      _interactions.push({
        type:      type || 'unknown',
        details:   details || {},
        timestamp: Date.now(),
        t_rel_ms:  +(_now() - _clockOrigin).toFixed(1),
      });
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
        t_rel_ms:    +(_now() - _clockOrigin).toFixed(1),
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
          device_pixel_ratio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          browser: _browserName(), calibration_score: null,
          calibration_version: _calibrationVersion(), config_snapshot: _configSnapshot(),
          format_version: GazeLogger.FORMAT_VERSION,
        },
        raw_gaze_data: _rawGaze.slice(),
        events:        _events.slice(),
        aoi_hits:      _aoiHits.slice(),
        interactions:  _interactions.slice(),
      };
    },

    /**
     * Exporte la session au format JSON-LD orienté graphe de connaissances.
     * Chaque entité (session, participant, fixation, saccade, interaction, AOI)
     * devient un nœud typé, prêt à être intégré dans un knowledge graph (objectif
     * Activity Tracker du PIR). Vocabulaire minimal sous le préfixe `wga:`.
     * @returns {object} document JSON-LD (@context + @graph)
     */
    exportJsonLd: function () {
      var data = this.export();
      var s = data.session;
      var base = 'urn:wga:session:' + s.id + ':';
      var graph = [];

      graph.push({
        '@id': 'urn:wga:session:' + s.id,
        '@type': 'wga:Session',
        'wga:participant': { '@id': 'urn:wga:participant:' + s.participant_id },
        'wga:startTime': s.start_time,
        'wga:endTime': s.end_time,
        'wga:browser': s.browser,
        'wga:screenWidth': s.screen_resolution ? s.screen_resolution.width : null,
        'wga:screenHeight': s.screen_resolution ? s.screen_resolution.height : null,
        'wga:calibrationVersion': s.calibration_version || null,
      });

      graph.push({
        '@id': 'urn:wga:participant:' + s.participant_id,
        '@type': 'wga:Participant',
        'wga:identifier': s.participant_id,
      });

      data.events.forEach(function (e, i) {
        var node = {
          '@id': base + e.type + ':' + i,
          '@type': e.type === 'fixation' ? 'wga:Fixation'
                 : e.type === 'saccade'  ? 'wga:Saccade' : 'wga:GazeEvent',
          'wga:inSession': { '@id': 'urn:wga:session:' + s.id },
          'wga:startTime': e.start_time,
          'wga:endTime': e.end_time,
          'wga:duration': e.duration,
        };
        if (e.details) {
          if (typeof e.details.x === 'number') node['wga:x'] = e.details.x;
          if (typeof e.details.y === 'number') node['wga:y'] = e.details.y;
          if (typeof e.details.amplitude === 'number') node['wga:amplitude'] = e.details.amplitude;
        }
        graph.push(node);
      });

      data.aoi_hits.forEach(function (h, i) {
        graph.push({
          '@id': base + 'aoihit:' + i,
          '@type': 'wga:AOIHit',
          'wga:inSession': { '@id': 'urn:wga:session:' + s.id },
          'wga:aoi': { '@id': 'urn:wga:aoi:' + (h.aoi_id || 'unknown') },
          'wga:aoiLabel': h.aoi_label,
          'wga:atEvent': h.event_index,
          'wga:timeRel': h.t_rel_ms,
        });
      });

      data.interactions.forEach(function (it, i) {
        graph.push({
          '@id': base + 'interaction:' + i,
          '@type': 'wga:Interaction',
          'wga:inSession': { '@id': 'urn:wga:session:' + s.id },
          'wga:interactionType': it.type,
          'wga:timeRel': it.t_rel_ms,
          'wga:details': it.details,
        });
      });

      return {
        '@context': {
          'wga': 'https://i3s.unice.fr/activity-tracker/vocab#',
          'wga:participant': { '@type': '@id' },
          'wga:inSession':   { '@type': '@id' },
          'wga:aoi':         { '@type': '@id' },
        },
        '@graph': graph,
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
     * Déclenche le téléchargement de l'export JSON-LD (graphe de connaissances).
     */
    downloadJsonLd: function () {
      var data = this.exportJsonLd();
      var sess = this.export().session;
      var pid  = (sess.participant_id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');
      var date = new Date().toISOString().slice(0, 10);
      var name = 'session_' + pid + '_' + date + '.jsonld';
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/ld+json' });
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
      _session       = null;
      _rawGaze       = [];
      _events        = [];
      _aoiHits       = [];
      _interactions  = [];
    },

    /**
     * Retourne des stats rapides sur la session en cours.
     * @returns {{ rawPoints: number, fixations: number, saccades: number, aoiHits: number }}
     */
    getStats: function () {
      return {
        rawPoints:    _rawGaze.length,
        fixations:    _events.filter(function (e) { return e.type === 'fixation'; }).length,
        saccades:     _events.filter(function (e) { return e.type === 'saccade';  }).length,
        aoiHits:      _aoiHits.length,
        interactions: _interactions.length,
      };
    },

    isInitialized: function () { return !!_session; },
  };

  // Version du format d'export — à incrémenter à tout changement de schéma.
  GazeLogger.FORMAT_VERSION = '1.1.0';

  global.GazeLogger = GazeLogger;

})(typeof window !== 'undefined' ? window : global);
