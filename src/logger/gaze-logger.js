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
  var _vizStates     = []; // historique des états de visualisation (zoom, vue, filtres…)
  var _clockOrigin   = 0;  // performance.now() au démarrage de la session
  var _defaultModuleName = null; // module de capture courant ('webgazer'|'mediapipe')

  // Module émetteur par défaut (gaze engine actif), utilisé si non précisé.
  function _defaultModule() { return _defaultModuleName || 'unknown'; }

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
      _vizStates     = [];
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
     * Enregistre un point de regard brut, enrichi de toutes les informations
     * contextuelles disponibles (demandées par l'encadrante PIR) :
     *   - confiance de la prédiction,
     *   - module source (webgazer / mediapipe),
     *   - objet DOM observé (descripteur détaillé),
     *   - état de la visualisation au moment du regard.
     * @param {number} x
     * @param {number} y
     * @param {number} timestamp — ms epoch
     * @param {object} [meta] — { confidence, source_module, dom, viz_state, raw_x, raw_y }
     */
    logRawPoint: function (x, y, timestamp, meta) {
      if (!_session) return;
      meta = meta || {};
      var entry = {
        x: Math.round(x),
        y: Math.round(y),
        timestamp: timestamp || Date.now(),     // epoch ms (rétro-compatible)
        t_rel_ms:  +(_now() - _clockOrigin).toFixed(1), // horloge monotone relative
        source_module: meta.source_module || _defaultModule(),
      };
      if (meta.confidence != null) entry.confidence = +(+meta.confidence).toFixed(4);
      if (meta.raw_x != null) entry.raw_x = Math.round(meta.raw_x);
      if (meta.raw_y != null) entry.raw_y = Math.round(meta.raw_y);
      if (meta.dom) entry.dom = meta.dom;
      if (meta.viz_state) entry.viz_state = meta.viz_state;
      _rawGaze.push(entry);
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
      details = details || {};
      _interactions.push({
        type:      type || 'unknown',
        details:   details,
        source_module: details.source_module || 'ui',
        timestamp: Date.now(),
        t_rel_ms:  +(_now() - _clockOrigin).toFixed(1),
      });
    },

    /**
     * Définit le module de capture courant ('webgazer' | 'mediapipe').
     * Sert de source_module par défaut pour les points de regard.
     */
    setModule: function (name) { _defaultModuleName = name || null; },
    getModule: function () { return _defaultModuleName; },

    /**
     * Enregistre un instantané de l'état de la visualisation (vue active, dataset,
     * zoom, sélection, filtres…). À appeler à chaque changement d'état pertinent.
     * @param {object} state
     */
    logVizState: function (state) {
      if (!_session || !state) return;
      _vizStates.push({
        state:     state,
        timestamp: Date.now(),
        t_rel_ms:  +(_now() - _clockOrigin).toFixed(1),
      });
    },

    /** Dernier état de visualisation connu (pour annoter les points de regard). */
    getCurrentVizState: function () {
      return _vizStates.length ? _vizStates[_vizStates.length - 1].state : null;
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
        source_module: event.source_module || 'post_processing',
      });
    },

    /**
     * Enregistre un hit AOI (fixation dans une zone d'intérêt).
     * @param {string} aoiId
     * @param {string} aoiLabel
     * @param {number} eventIndex — index dans _events
     * @param {number} [timestamp]
     */
    logAOIHit: function (aoiId, aoiLabel, eventIndex, timestamp, extra) {
      if (!_session) return;
      extra = extra || {};
      var hit = {
        aoi_id:      aoiId    || '',
        aoi_label:   aoiLabel || '',
        event_index: typeof eventIndex === 'number' ? eventIndex : -1,
        timestamp:   timestamp || Date.now(),
        t_rel_ms:    +(_now() - _clockOrigin).toFixed(1),
        source_module: extra.source_module || 'post_processing',
      };
      // Descripteur DOM détaillé + état de la visu au moment du hit (PIR).
      if (extra.dom) hit.dom = extra.dom;
      if (extra.viz_state) hit.viz_state = extra.viz_state;
      _aoiHits.push(hit);
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
        viz_states:    _vizStates.slice(),
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
        var node = {
          '@id': base + 'aoihit:' + i,
          '@type': 'wga:AOIHit',
          'wga:inSession': { '@id': 'urn:wga:session:' + s.id },
          'wga:aoi': { '@id': 'urn:wga:aoi:' + (h.aoi_id || 'unknown') },
          'wga:aoiLabel': h.aoi_label,
          'wga:atEvent': h.event_index,
          'wga:timeRel': h.t_rel_ms,
          'wga:sourceModule': h.source_module || null,
        };
        if (h.dom) {
          node['wga:domTag'] = h.dom.tag || null;
          node['wga:domRole'] = h.dom.semantic_type || null;
          node['wga:domText'] = h.dom.text || null;
        }
        if (h.viz_state) node['wga:vizState'] = h.viz_state;
        graph.push(node);
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
     * Exporte les points de regard au format CSV (à plat), pratique pour l'analyse
     * tabulaire (pandas, R, Excel). Colonnes : temps, position, confiance, module,
     * et l'objet DOM / l'état de visu observés.
     * @returns {string} contenu CSV
     */
    exportCsv: function () {
      var data = this.export();
      var cols = ['t_rel_ms', 'timestamp', 'x', 'y', 'raw_x', 'raw_y', 'confidence',
                  'source_module', 'dom_semantic_type', 'dom_text', 'dom_id',
                  'viz_active_view', 'viz_dataset', 'viz_current_aoi'];
      function esc(v) {
        if (v == null) return '';
        var s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      var lines = [cols.join(',')];
      (data.raw_gaze_data || []).forEach(function (p) {
        var dom = p.dom || {}, vs = p.viz_state || {};
        lines.push([
          p.t_rel_ms, p.timestamp, p.x, p.y, p.raw_x, p.raw_y, p.confidence,
          p.source_module, dom.semantic_type, dom.text, dom.id,
          vs.active_view, vs.dataset, vs.current_aoi,
        ].map(esc).join(','));
      });
      return lines.join('\n');
    },

    /** Déclenche le téléchargement du CSV des points de regard. */
    downloadCsv: function () {
      var csv = this.exportCsv();
      var sess = this.export().session;
      var pid  = (sess.participant_id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');
      var date = new Date().toISOString().slice(0, 10);
      var blob = new Blob([csv], { type: 'text/csv' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = 'session_' + pid + '_' + date + '.csv'; a.click();
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
      _vizStates     = [];
    },

    /**
     * Retourne des stats rapides sur la session en cours.
     */
    getStats: function () {
      var withConf = _rawGaze.filter(function (p) { return typeof p.confidence === 'number'; });
      var meanConf = withConf.length
        ? withConf.reduce(function (s, p) { return s + p.confidence; }, 0) / withConf.length : null;
      return {
        rawPoints:    _rawGaze.length,
        fixations:    _events.filter(function (e) { return e.type === 'fixation'; }).length,
        saccades:     _events.filter(function (e) { return e.type === 'saccade';  }).length,
        aoiHits:      _aoiHits.length,
        interactions: _interactions.length,
        vizStates:    _vizStates.length,
        meanConfidence: meanConf != null ? +meanConf.toFixed(3) : null,
      };
    },

    /**
     * Construit un descripteur DOM détaillé d'un élément (objet observé par le
     * regard) : balise, identifiants, type sémantique, géométrie, texte, data-*.
     * Demandé par l'encadrante : « le plus d'informations possibles pour identifier
     * s'il s'agissait d'une barre, de l'axe, etc. »
     * @param {Element} el
     * @returns {object|null}
     */
    describeDom: function (el) {
      if (!el || el.nodeType !== 1) return null;
      var rect = (typeof el.getBoundingClientRect === 'function')
        ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      var classes = [];
      try { classes = Array.prototype.slice.call(el.classList || []); } catch (_) {}
      var dataAttrs = {};
      try {
        if (el.dataset) { for (var k in el.dataset) dataAttrs[k] = el.dataset[k]; }
      } catch (_) {}
      var text = '';
      try { text = (el.textContent || '').trim().slice(0, 120); } catch (_) {}
      return {
        tag:           (el.tagName || '').toLowerCase(),
        id:            el.id || null,
        classes:       classes,
        semantic_type: _semanticType(el, classes, dataAttrs),
        bbox:          { x: Math.round(rect.left), y: Math.round(rect.top),
                         width: Math.round(rect.width), height: Math.round(rect.height) },
        text:          text || null,
        aria_label:    (el.getAttribute && el.getAttribute('aria-label')) || null,
        data:          Object.keys(dataAttrs).length ? dataAttrs : null,
        css_selector:  _cssSelector(el),
      };
    },

    /**
     * Couleur représentant un niveau de confiance ∈ [0,1] : rouge (faible) →
     * orange → vert (élevée). Partagé par les deux moteurs pour colorer le point
     * de regard en direct. Retourne une chaîne rgb().
     */
    confidenceColor: function (conf) {
      var c = (typeof conf === 'number' && isFinite(conf)) ? Math.max(0, Math.min(1, conf)) : 0.5;
      // 0 → rouge (231,76,60), 0.5 → orange (230,126,34), 1 → vert (39,174,96)
      var r, g, b;
      if (c < 0.5) { var t = c / 0.5; r = 231 + (230-231)*t; g = 76 + (126-76)*t; b = 60 + (34-60)*t; }
      else         { var u = (c-0.5)/0.5; r = 230 + (39-230)*u; g = 126 + (174-126)*u; b = 34 + (96-34)*u; }
      return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    },

    isInitialized: function () { return !!_session; },
  };

  // Devine le type sémantique d'un élément de visualisation (barre, axe, point,
  // légende, ligne…) à partir de la balise, des classes et des data-*.
  function _semanticType(el, classes, data) {
    var hay = (classes.join(' ') + ' ' + (el.id || '') + ' ' +
               Object.keys(data).join(' ')).toLowerCase();
    if (data.aoiType) return data.aoiType;
    if (/\bbar\b|barre/.test(hay)) return 'bar';
    if (/axis|axe|tick/.test(hay)) return 'axis';
    if (/legend|légende/.test(hay)) return 'legend';
    if (/point|dot|circle|scatter/.test(hay)) return 'point';
    if (/line|courbe|path/.test(hay) || (el.tagName || '').toLowerCase() === 'path') return 'line';
    if (/label|title|titre/.test(hay)) return 'label';
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'rect') return 'bar';
    if (tag === 'circle') return 'point';
    if (tag === 'text') return 'label';
    return tag || 'unknown';
  }

  // Sélecteur CSS court et lisible pour re-localiser l'élément.
  function _cssSelector(el) {
    try {
      if (el.id) return '#' + el.id;
      var tag = (el.tagName || '').toLowerCase();
      var cls = '';
      try { if (el.classList && el.classList.length) cls = '.' + Array.prototype.slice.call(el.classList).join('.'); } catch (_) {}
      var parent = el.parentElement;
      var idx = '';
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
        if (sibs.length > 1) idx = ':nth-of-type(' + (Array.prototype.indexOf.call(sibs, el) + 1) + ')';
      }
      return tag + cls + idx;
    } catch (_) { return null; }
  }

  // Version du format d'export — à incrémenter à tout changement de schéma.
  GazeLogger.FORMAT_VERSION = '1.2.0';

  global.GazeLogger = GazeLogger;

})(typeof window !== 'undefined' ? window : global);
