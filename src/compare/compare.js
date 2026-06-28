/**
 * compare.js
 *
 * Comparaison de sessions de test (logique pure, testable sans navigateur). Le
 * module sait comparer soit deux sessions précises côte à côte, soit deux groupes
 * de sessions (par exemple toutes les sessions WebGazer contre toutes les sessions
 * MediaPipe) en raisonnant sur les moyennes.
 *
 * Les métriques comparées sont : erreur de calibration (px, plus bas = mieux),
 * score moyen « sur la cible » (%, plus haut = mieux), confiance moyenne,
 * luminosité, nombre de points, fixations, saccades et durée.
 *
 * API publique :
 *   Compare.metricsOf(sessionData)                          métriques d'une session
 *   Compare.aggregate(arrayOfSessions)                      moyennes + effectif n
 *   Compare.compare(sideA, sideB, labelA, labelB)           tableau comparatif
 */
(function (global) {
  'use strict';

  var METRICS = [
    { key: 'calib_px',    label: 'Erreur calibration', unit: 'px', lowerBetter: true },
    { key: 'on_target',   label: 'Score sur la cible', unit: '%',  lowerBetter: false },
    { key: 'confidence',  label: 'Confiance moyenne',  unit: '',   lowerBetter: false },
    { key: 'lux',         label: 'Luminosité',         unit: 'lux', lowerBetter: null },
    { key: 'points',      label: 'Points de regard',   unit: '',   lowerBetter: null },
    { key: 'fixations',   label: 'Fixations',          unit: '',   lowerBetter: null },
    { key: 'saccades',    label: 'Saccades',           unit: '',   lowerBetter: null },
    { key: 'duration_s',  label: 'Durée',              unit: 's',  lowerBetter: null },
  ];

  function isFiniteNumber(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function finiteValues(arr) {
    return arr.filter(isFiniteNumber);
  }

  function _mean(arr) {
    var v = finiteValues(arr);
    if (!v.length) {
      return null;
    }
    return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  }

  function _median(arr) {
    var v = finiteValues(arr).sort(function (a, b) { return a - b; });
    if (!v.length) {
      return null;
    }
    return v[Math.floor(v.length / 2)];
  }

  function pluck(points, key) {
    return points.map(function (p) { return p[key]; });
  }

  function targetScore(distance, hit, max) {
    if (distance <= hit) {
      return 1;
    }
    if (distance >= max) {
      return 0;
    }
    return 1 - (distance - hit) / (max - hit);
  }

  function _onTargetAvg(data) {
    var raw = (data.raw_gaze_data || []).filter(function (p) {
      return p.test_case_id && typeof p.target_x === 'number' && typeof p.target_y === 'number';
    });
    if (!raw.length) {
      return null;
    }
    var HIT = 90;
    var MAX = 450;
    var sum = 0;
    raw.forEach(function (p) {
      var dx = p.x - p.target_x;
      var dy = p.y - p.target_y;
      var d = Math.sqrt(dx * dx + dy * dy);
      sum += targetScore(d, HIT, MAX);
    });
    return Math.round(100 * sum / raw.length);
  }

  function countEvents(events, type) {
    return events.filter(function (e) { return e.type === type; }).length;
  }

  function roundedOrNull(value) {
    if (value == null) {
      return null;
    }
    return Math.round(value);
  }

  function durationSeconds(raw) {
    var tRel = finiteValues(pluck(raw, 't_rel_ms'));
    if (!tRel.length) {
      return null;
    }
    return (Math.max.apply(null, tRel) - Math.min.apply(null, tRel)) / 1000;
  }

  function confidenceMean(raw) {
    var confs = finiteValues(pluck(raw, 'confidence'));
    if (!confs.length) {
      return null;
    }
    return +_mean(confs).toFixed(2);
  }

  function luxMedian(raw) {
    var luxVals = finiteValues(pluck(raw, 'lux'));
    if (!luxVals.length) {
      return null;
    }
    return Math.round(_median(luxVals));
  }

  function metricsOf(data) {
    var s = (data && data.session) || {};
    var raw = (data && data.raw_gaze_data) || [];
    var events = (data && data.events) || [];
    var cal = s.calibration_score || {};
    return {
      calib_px:   roundedOrNull(cal.mean_error_px),
      on_target:  _onTargetAvg(data),
      confidence: confidenceMean(raw),
      lux:        luxMedian(raw),
      points:     raw.length,
      fixations:  countEvents(events, 'fixation'),
      saccades:   countEvents(events, 'saccade'),
      duration_s: roundedOrNull(durationSeconds(raw)),
    };
  }

  function aggregatedValue(key, avg) {
    if (avg == null) {
      return null;
    }
    if (key === 'confidence') {
      return +avg.toFixed(2);
    }
    return Math.round(avg);
  }

  function aggregate(sessions) {
    var ms = (sessions || []).map(metricsOf);
    var out = { n: ms.length };
    METRICS.forEach(function (m) {
      var vals = ms.map(function (x) { return x[m.key]; });
      out[m.key] = aggregatedValue(m.key, _mean(vals));
    });
    return out;
  }

  function metricsForSide(side) {
    if (Array.isArray(side)) {
      return aggregate(side);
    }
    return metricsOf(side);
  }

  function diffOf(a, b) {
    if (a != null && b != null) {
      return +(b - a).toFixed(2);
    }
    return null;
  }

  function betterSide(metric, a, b) {
    if (metric.lowerBetter == null || a == null || b == null || a === b) {
      return null;
    }
    var aWins;
    if (metric.lowerBetter) {
      aWins = a < b;
    } else {
      aWins = a > b;
    }
    if (aWins) {
      return 'A';
    }
    return 'B';
  }

  function sideLabel(custom, isGroup, metrics, groupName, sessionName) {
    if (custom) {
      return custom;
    }
    if (isGroup) {
      return groupName + ' (' + (metrics.n || 0) + ')';
    }
    return sessionName;
  }

  function sideCount(isGroup, metrics) {
    if (isGroup) {
      return metrics.n;
    }
    return 1;
  }

  function compare(sideA, sideB, labelA, labelB) {
    var aIsGroup = Array.isArray(sideA);
    var bIsGroup = Array.isArray(sideB);
    var mA = metricsForSide(sideA);
    var mB = metricsForSide(sideB);
    var rows = METRICS.map(function (m) {
      var a = mA[m.key];
      var b = mB[m.key];
      return {
        key: m.key,
        label: m.label,
        unit: m.unit,
        lowerBetter: m.lowerBetter,
        a: a,
        b: b,
        diff: diffOf(a, b),
        better: betterSide(m, a, b),
      };
    });
    return {
      labelA: sideLabel(labelA, aIsGroup, mA, 'Groupe A', 'Session A'),
      labelB: sideLabel(labelB, bIsGroup, mB, 'Groupe B', 'Session B'),
      nA: sideCount(aIsGroup, mA),
      nB: sideCount(bIsGroup, mB),
      rows: rows,
    };
  }

  global.Compare = { METRICS: METRICS, metricsOf: metricsOf, aggregate: aggregate, compare: compare };

})(typeof window !== 'undefined' ? window : global);
