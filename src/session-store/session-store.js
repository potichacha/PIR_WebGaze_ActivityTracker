/**
 * session-store.js
 *
 * « Base de données » locale des sessions de test. Le projet étant entièrement
 * statique (aucun serveur), le navigateur ne peut pas écrire de fichier dans
 * data/. localStorage joue donc le rôle de base de données : les sessions y sont
 * persistées, listées et rejouées par la page viewer. Un export/import fichier
 * permet d'archiver les sessions ou de les transférer entre machines.
 *
 * API publique :
 *   SessionStore.save(sessionData)      id (string)
 *   SessionStore.list()                 [{ id, summary }] triés du plus récent
 *   SessionStore.get(id)                sessionData | null
 *   SessionStore.delete(id)             bool
 *   SessionStore.clear()                void
 *   SessionStore.count()                number
 *   SessionStore.exportAll()            object (toutes les sessions)
 *   SessionStore.importAll(obj, merge)  number (nombre de sessions importées)
 *   SessionStore.summarize(sessionData) résumé tabulaire (date, lux, px…)
 */
(function (global) {
  'use strict';

  var KEY = 'webgaze_sessions';

  function _read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) {
        return {};
      }
      var obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        return obj;
      }
      return {};
    } catch (_) {
      return {};
    }
  }

  function _write(map) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(map));
      return true;
    } catch (_) {
      return false;
    }
  }

  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      if (c === 'x') {
        return r.toString(16);
      }
      return (r & 0x3 | 0x8).toString(16);
    });
  }

  function numericValues(points, key) {
    return points.map(function (p) {
      return p[key];
    }).filter(function (v) {
      return typeof v === 'number';
    });
  }

  function medianLux(raw) {
    var luxVals = numericValues(raw, 'lux');
    if (!luxVals.length) {
      return null;
    }
    luxVals.sort(function (a, b) {
      return a - b;
    });
    return Math.round(luxVals[Math.floor(luxVals.length / 2)]);
  }

  function meanConfidence(raw) {
    var confs = numericValues(raw, 'confidence');
    if (!confs.length) {
      return null;
    }
    var sum = confs.reduce(function (a, b) {
      return a + b;
    }, 0);
    return +(sum / confs.length).toFixed(2);
  }

  function participantLabel(s) {
    var fullName = ((s.first_name || '') + ' ' + (s.last_name || '')).trim();
    if (fullName) {
      return fullName;
    }
    return s.participant_id || 'anonyme';
  }

  function calibError(cal) {
    if (typeof cal.mean_error_px === 'number') {
      return Math.round(cal.mean_error_px);
    }
    return null;
  }

  function nullableValue(value) {
    if (value != null) {
      return value;
    }
    return null;
  }

  function countEvents(events, type) {
    return events.filter(function (e) {
      return e.type === type;
    }).length;
  }

  function summarize(data) {
    var s = (data && data.session) || {};
    var raw = (data && data.raw_gaze_data) || [];
    var events = (data && data.events) || [];
    var cal = s.calibration_score || {};
    return {
      id:             data._id || null,
      participant:    participantLabel(s),
      participant_id: s.participant_id || null,
      first_name:     s.first_name || null,
      last_name:      s.last_name || null,
      date:           (s.start_time || '').slice(0, 10) || null,
      start_time:     s.start_time || null,
      glasses:        nullableValue(s.glasses),
      engine:         s.engine || (raw[0] && raw[0].source_module) || null,
      calib_error_px: calibError(cal),
      lux:            medianLux(raw),
      mean_confidence: meanConfidence(raw),
      n_points:       raw.length,
      n_fixations:    countEvents(events, 'fixation'),
      n_saccades:     countEvents(events, 'saccade'),
      n_aoi_hits:     (data.aoi_hits || []).length,
    };
  }

  var SessionStore = {
    STORAGE_KEY: KEY,

    save: function (data) {
      if (!data || !data.session) {
        return null;
      }
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
        var d = map[id];
        d._id = id;
        return { id: id, summary: summarize(d) };
      }).sort(function (a, b) {
        return (b.summary.start_time || '').localeCompare(a.summary.start_time || '');
      });
    },

    get: function (id) {
      var map = _read();
      var d = map[id] || null;
      if (d) {
        d._id = id;
      }
      return d;
    },

    delete: function (id) {
      var map = _read();
      if (!map[id]) {
        return false;
      }
      delete map[id];
      _write(map);
      return true;
    },

    clear: function () {
      _write({});
    },

    count: function () {
      return Object.keys(_read()).length;
    },

    exportAll: function () {
      return {
        format: 'webgaze-sessions',
        version: 1,
        exported_at: new Date().toISOString(),
        sessions: _read(),
      };
    },

    importAll: function (obj, merge) {
      if (!obj || !obj.sessions) {
        return 0;
      }
      var map = {};
      if (merge) {
        map = _read();
      }
      var n = 0;
      Object.keys(obj.sessions).forEach(function (id) {
        map[id] = obj.sessions[id];
        n++;
      });
      _write(map);
      return n;
    },

    summarize: summarize,
  };

  global.SessionStore = SessionStore;

})(typeof window !== 'undefined' ? window : global);
