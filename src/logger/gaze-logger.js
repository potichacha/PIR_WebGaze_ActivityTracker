/**
 * gaze-logger.js
 *
 * Journalisation d'une session de suivi du regard. Le module accumule les points
 * de regard bruts, les événements oculomoteurs (fixations, saccades), les hits de
 * zones d'intérêt (AOI), les interactions utilisateur et les états de
 * visualisation, puis les exporte sous plusieurs formats.
 *
 * Chaque point et chaque événement est horodaté avec une horloge monotone
 * (performance.now()) afin que les durées et les vélocités restent fiables même en
 * cas d'ajustement de l'heure système. Les points sont enrichis du contexte
 * disponible : confiance, module source, descripteur DOM observé, état de la
 * visualisation, luminosité ambiante et contexte du test guidé.
 *
 * Exports disponibles : objet JSON, JSON-LD (graphe de connaissances) et CSV à
 * plat, chacun avec sa variante de téléchargement.
 *
 * API publique :
 *   GazeLogger.init(participantId, calibrationScore?, info?)
 *   GazeLogger.logRawPoint(x, y, timestamp, meta?)
 *   GazeLogger.logEvent(event) / logInteraction(type, details) / logVizState(state)
 *   GazeLogger.logAOIHit(aoiId, aoiLabel, eventIndex, timestamp?, extra?)
 *   GazeLogger.export() / exportJsonLd() / exportCsv()
 *   GazeLogger.download() / downloadJsonLd() / downloadCsv()
 *   GazeLogger.setLux/getLux, setModule/getModule, setTestContext/clearTestContext
 *   GazeLogger.describeDom(el) / confidenceColor(conf) / getStats() / clear()
 */

(function (global) {
  'use strict';

  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      if (c === 'x') {
        return r.toString(16);
      }
      return (r & 0x3 | 0x8).toString(16);
    });
  }

  function _browserName() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Edg') !== -1) {
      return 'Edge';
    }
    if (ua.indexOf('Chrome') !== -1) {
      return 'Chrome';
    }
    if (ua.indexOf('Firefox') !== -1) {
      return 'Firefox';
    }
    if (ua.indexOf('Safari') !== -1) {
      return 'Safari';
    }
    return 'Unknown';
  }

  function _calibrationVersion() {
    try {
      if (typeof global.Calibration !== 'undefined' && global.Calibration.CONFIG) {
        return global.Calibration.CONFIG.VERSION || null;
      }
    } catch (_) {}
    return null;
  }

  function _configSnapshot() {
    try {
      if (typeof global.Calibration === 'undefined' || !global.Calibration.CONFIG) {
        return null;
      }
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
    } catch (_) {
      return null;
    }
  }

  function _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function userAgentOrNull() {
    if (typeof navigator !== 'undefined') {
      return navigator.userAgent;
    }
    return null;
  }

  function devicePixelRatio() {
    return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  }

  function nullableValue(value) {
    if (value != null) {
      return value;
    }
    return null;
  }

  function nullableNumber(value) {
    if (typeof value === 'number') {
      return value;
    }
    return null;
  }

  function emptyTestContext() {
    return { test_case_id: null, target_aoi_id: null, target_x: null, target_y: null };
  }

  var _session       = null;
  var _rawGaze       = [];
  var _events        = [];
  var _aoiHits       = [];
  var _interactions  = [];
  var _vizStates     = [];
  var _clockOrigin   = 0;
  var _defaultModuleName = null;
  var _currentLux    = null;
  var _testContext   = emptyTestContext();

  function _defaultModule() {
    return _defaultModuleName || 'unknown';
  }

  function relativeNow() {
    return +(_now() - _clockOrigin).toFixed(1);
  }

  function currentLuxFor(meta) {
    if (meta.lux != null) {
      return meta.lux;
    }
    return _currentLux;
  }

  function applyTestContext(entry) {
    if (_testContext.test_case_id != null) {
      entry.test_case_id = _testContext.test_case_id;
    }
    if (_testContext.target_aoi_id != null) {
      entry.target_aoi_id = _testContext.target_aoi_id;
    }
    if (_testContext.target_x != null) {
      entry.target_x = Math.round(_testContext.target_x);
    }
    if (_testContext.target_y != null) {
      entry.target_y = Math.round(_testContext.target_y);
    }
  }

  function fallbackSession() {
    return {
      id: _uuid(),
      participant_id: 'anonymous',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      screen_resolution: { width: window.innerWidth, height: window.innerHeight },
      device_pixel_ratio: devicePixelRatio(),
      user_agent: userAgentOrNull(),
      browser: _browserName(),
      calibration_score: null,
      calibration_version: _calibrationVersion(),
      config_snapshot: _configSnapshot(),
      format_version: GazeLogger.FORMAT_VERSION,
    };
  }

  function eventNodeType(type) {
    if (type === 'fixation') {
      return 'wga:Fixation';
    }
    if (type === 'saccade') {
      return 'wga:Saccade';
    }
    return 'wga:GazeEvent';
  }

  function screenDimension(session, key) {
    if (session.screen_resolution) {
      return session.screen_resolution[key];
    }
    return null;
  }

  function csvEscape(v) {
    if (v == null) {
      return '';
    }
    var s = String(v);
    if (/[",\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function sanitizeParticipantId(session) {
    return (session.participant_id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function triggerDownload(content, mime, name) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function countEvents(type) {
    return _events.filter(function (e) {
      return e.type === type;
    }).length;
  }

  var GazeLogger = {

    init: function (participantId, calibrationScore, info) {
      _rawGaze       = [];
      _events        = [];
      _aoiHits       = [];
      _interactions  = [];
      _vizStates     = [];
      _testContext   = emptyTestContext();
      _clockOrigin   = _now();
      info = info || {};
      _session = {
        id:             _uuid(),
        format_version: GazeLogger.FORMAT_VERSION,
        participant_id: participantId || 'anonymous',
        first_name:     info.first_name || null,
        last_name:      info.last_name || null,
        glasses:        nullableValue(info.glasses),
        age:            info.age || null,
        lighting:       info.lighting || null,
        engine:         info.engine || _defaultModuleName || null,
        start_time:     new Date().toISOString(),
        end_time:       null,
        clock_origin_ms: _clockOrigin,
        screen_resolution: {
          width:  window.innerWidth,
          height: window.innerHeight,
        },
        device_pixel_ratio: devicePixelRatio(),
        user_agent:         userAgentOrNull(),
        browser:            _browserName(),
        calibration_score:  calibrationScore || null,
        calibration_version: _calibrationVersion(),
        config_snapshot:     _configSnapshot(),
      };
    },

    logRawPoint: function (x, y, timestamp, meta) {
      if (!_session) {
        return;
      }
      meta = meta || {};
      var entry = {
        x: Math.round(x),
        y: Math.round(y),
        timestamp: timestamp || Date.now(),
        t_rel_ms:  relativeNow(),
        source_module: meta.source_module || _defaultModule(),
      };
      if (meta.confidence != null) {
        entry.confidence = +(+meta.confidence).toFixed(4);
      }
      if (meta.raw_x != null) {
        entry.raw_x = Math.round(meta.raw_x);
      }
      if (meta.raw_y != null) {
        entry.raw_y = Math.round(meta.raw_y);
      }
      if (meta.dom) {
        entry.dom = meta.dom;
      }
      if (meta.viz_state) {
        entry.viz_state = meta.viz_state;
      }
      var lux = currentLuxFor(meta);
      if (lux != null) {
        entry.lux = Math.round(lux);
      }
      applyTestContext(entry);
      _rawGaze.push(entry);
    },

    setLux: function (lux) {
      if (typeof lux === 'number' && isFinite(lux)) {
        _currentLux = lux;
      } else {
        _currentLux = null;
      }
    },

    getLux: function () {
      return _currentLux;
    },

    setTestContext: function (testCaseId, targetAoiId, targetX, targetY) {
      _testContext = {
        test_case_id:  nullableValue(testCaseId),
        target_aoi_id: nullableValue(targetAoiId),
        target_x:      nullableNumber(targetX),
        target_y:      nullableNumber(targetY),
      };
    },

    clearTestContext: function () {
      _testContext = emptyTestContext();
    },

    logInteraction: function (type, details) {
      if (!_session) {
        return;
      }
      details = details || {};
      _interactions.push({
        type:      type || 'unknown',
        details:   details,
        source_module: details.source_module || 'ui',
        timestamp: Date.now(),
        t_rel_ms:  relativeNow(),
      });
    },

    setModule: function (name) {
      _defaultModuleName = name || null;
    },

    getModule: function () {
      return _defaultModuleName;
    },

    logVizState: function (state) {
      if (!_session || !state) {
        return;
      }
      _vizStates.push({
        state:     state,
        timestamp: Date.now(),
        t_rel_ms:  relativeNow(),
      });
    },

    getCurrentVizState: function () {
      if (!_vizStates.length) {
        return null;
      }
      return _vizStates[_vizStates.length - 1].state;
    },

    logEvent: function (event) {
      if (!_session || !event) {
        return;
      }
      _events.push({
        type:       event.type       || 'unknown',
        start_time: event.start_time || 0,
        end_time:   event.end_time   || 0,
        duration:   event.duration   || 0,
        details:    event.details    || {},
        source_module: event.source_module || 'post_processing',
      });
    },

    logAOIHit: function (aoiId, aoiLabel, eventIndex, timestamp, extra) {
      if (!_session) {
        return;
      }
      extra = extra || {};
      var hit = {
        aoi_id:      aoiId    || '',
        aoi_label:   aoiLabel || '',
        event_index: nullableNumber(eventIndex) == null ? -1 : eventIndex,
        timestamp:   timestamp || Date.now(),
        t_rel_ms:    relativeNow(),
        source_module: extra.source_module || 'post_processing',
      };
      if (extra.dom) {
        hit.dom = extra.dom;
      }
      if (extra.viz_state) {
        hit.viz_state = extra.viz_state;
      }
      _aoiHits.push(hit);
    },

    export: function () {
      if (_session) {
        _session.end_time = new Date().toISOString();
      }
      return {
        session:       _session || fallbackSession(),
        raw_gaze_data: _rawGaze.slice(),
        events:        _events.slice(),
        aoi_hits:      _aoiHits.slice(),
        interactions:  _interactions.slice(),
        viz_states:    _vizStates.slice(),
      };
    },

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
        'wga:screenWidth': screenDimension(s, 'width'),
        'wga:screenHeight': screenDimension(s, 'height'),
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
          '@type': eventNodeType(e.type),
          'wga:inSession': { '@id': 'urn:wga:session:' + s.id },
          'wga:startTime': e.start_time,
          'wga:endTime': e.end_time,
          'wga:duration': e.duration,
        };
        if (e.details) {
          if (typeof e.details.x === 'number') {
            node['wga:x'] = e.details.x;
          }
          if (typeof e.details.y === 'number') {
            node['wga:y'] = e.details.y;
          }
          if (typeof e.details.amplitude === 'number') {
            node['wga:amplitude'] = e.details.amplitude;
          }
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
        if (h.viz_state) {
          node['wga:vizState'] = h.viz_state;
        }
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

    download: function () {
      var data = this.export();
      var name = 'session_' + sanitizeParticipantId(data.session) + '_' + todayStamp() + '.json';
      triggerDownload(JSON.stringify(data, null, 2), 'application/json', name);
    },

    exportCsv: function () {
      var data = this.export();
      var cols = ['t_rel_ms', 'timestamp', 'x', 'y', 'raw_x', 'raw_y', 'confidence', 'lux',
                  'source_module', 'test_case_id', 'target_aoi_id',
                  'dom_semantic_type', 'dom_text', 'dom_id',
                  'viz_active_view', 'viz_dataset', 'viz_current_aoi'];
      var lines = [cols.join(',')];
      (data.raw_gaze_data || []).forEach(function (p) {
        var dom = p.dom || {};
        var vs = p.viz_state || {};
        lines.push([
          p.t_rel_ms, p.timestamp, p.x, p.y, p.raw_x, p.raw_y, p.confidence, p.lux,
          p.source_module, p.test_case_id, p.target_aoi_id,
          dom.semantic_type, dom.text, dom.id,
          vs.active_view, vs.dataset, vs.current_aoi,
        ].map(csvEscape).join(','));
      });
      return lines.join('\n');
    },

    downloadCsv: function () {
      var csv = this.exportCsv();
      var name = 'session_' + sanitizeParticipantId(this.export().session) + '_' + todayStamp() + '.csv';
      triggerDownload(csv, 'text/csv', name);
    },

    downloadJsonLd: function () {
      var data = this.exportJsonLd();
      var name = 'session_' + sanitizeParticipantId(this.export().session) + '_' + todayStamp() + '.jsonld';
      triggerDownload(JSON.stringify(data, null, 2), 'application/ld+json', name);
    },

    clear: function () {
      _session       = null;
      _rawGaze       = [];
      _events        = [];
      _aoiHits       = [];
      _interactions  = [];
      _vizStates     = [];
      _testContext   = emptyTestContext();
    },

    getStats: function () {
      var withConf = _rawGaze.filter(function (p) {
        return typeof p.confidence === 'number';
      });
      var meanConf = null;
      if (withConf.length) {
        var sum = withConf.reduce(function (s, p) {
          return s + p.confidence;
        }, 0);
        meanConf = +(sum / withConf.length).toFixed(3);
      }
      return {
        rawPoints:    _rawGaze.length,
        fixations:    countEvents('fixation'),
        saccades:     countEvents('saccade'),
        aoiHits:      _aoiHits.length,
        interactions: _interactions.length,
        vizStates:    _vizStates.length,
        meanConfidence: meanConf,
      };
    },

    describeDom: function (el) {
      if (!el || el.nodeType !== 1) {
        return null;
      }
      var rect = { left: 0, top: 0, width: 0, height: 0 };
      if (typeof el.getBoundingClientRect === 'function') {
        rect = el.getBoundingClientRect();
      }
      var classes = [];
      try {
        classes = Array.prototype.slice.call(el.classList || []);
      } catch (_) {}
      var dataAttrs = {};
      try {
        if (el.dataset) {
          for (var k in el.dataset) {
            dataAttrs[k] = el.dataset[k];
          }
        }
      } catch (_) {}
      var text = '';
      try {
        text = (el.textContent || '').trim().slice(0, 120);
      } catch (_) {}
      var data = null;
      if (Object.keys(dataAttrs).length) {
        data = dataAttrs;
      }
      return {
        tag:           (el.tagName || '').toLowerCase(),
        id:            el.id || null,
        classes:       classes,
        semantic_type: _semanticType(el, classes, dataAttrs),
        bbox:          { x: Math.round(rect.left), y: Math.round(rect.top),
                         width: Math.round(rect.width), height: Math.round(rect.height) },
        text:          text || null,
        aria_label:    (el.getAttribute && el.getAttribute('aria-label')) || null,
        data:          data,
        css_selector:  _cssSelector(el),
      };
    },

    confidenceColor: function (conf) {
      var c = 0.5;
      if (typeof conf === 'number' && isFinite(conf)) {
        c = Math.max(0, Math.min(1, conf));
      }
      var r, g, b;
      if (c < 0.5) {
        var t = c / 0.5;
        r = 231 + (230 - 231) * t;
        g = 76 + (126 - 76) * t;
        b = 60 + (34 - 60) * t;
      } else {
        var u = (c - 0.5) / 0.5;
        r = 230 + (39 - 230) * u;
        g = 126 + (174 - 126) * u;
        b = 34 + (96 - 34) * u;
      }
      return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    },

    isInitialized: function () {
      return !!_session;
    },
  };

  function _semanticType(el, classes, data) {
    var hay = (classes.join(' ') + ' ' + (el.id || '') + ' ' +
               Object.keys(data).join(' ')).toLowerCase();
    var tag = (el.tagName || '').toLowerCase();
    if (data.aoiType) {
      return data.aoiType;
    }
    if (/\bbar\b|barre/.test(hay)) {
      return 'bar';
    }
    if (/axis|axe|tick/.test(hay)) {
      return 'axis';
    }
    if (/legend|légende/.test(hay)) {
      return 'legend';
    }
    if (/point|dot|circle|scatter/.test(hay)) {
      return 'point';
    }
    if (/line|courbe|path/.test(hay) || tag === 'path') {
      return 'line';
    }
    if (/label|title|titre/.test(hay)) {
      return 'label';
    }
    if (tag === 'rect') {
      return 'bar';
    }
    if (tag === 'circle') {
      return 'point';
    }
    if (tag === 'text') {
      return 'label';
    }
    return tag || 'unknown';
  }

  function _cssSelector(el) {
    try {
      if (el.id) {
        return '#' + el.id;
      }
      var tag = (el.tagName || '').toLowerCase();
      var cls = '';
      try {
        if (el.classList && el.classList.length) {
          cls = '.' + Array.prototype.slice.call(el.classList).join('.');
        }
      } catch (_) {}
      var idx = '';
      var parent = el.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === el.tagName;
        });
        if (sibs.length > 1) {
          idx = ':nth-of-type(' + (Array.prototype.indexOf.call(sibs, el) + 1) + ')';
        }
      }
      return tag + cls + idx;
    } catch (_) {
      return null;
    }
  }

  GazeLogger.FORMAT_VERSION = '1.3.0';

  global.GazeLogger = GazeLogger;

})(typeof window !== 'undefined' ? window : global);
