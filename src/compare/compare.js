/**
 * compare.js — Comparaison de sessions de test (logique pure, testable).
 *
 * Permet de comparer :
 *   - 2 sessions précises (côte à côte), ou
 *   - 2 groupes de sessions (ex. toutes WebGazer vs toutes MediaPipe) en moyennes.
 *
 * Métriques comparées (les « plus bas est meilleur » sont marquées lowerBetter) :
 *   calibration (px, ↓), confiance moyenne (↑), lux, points, fixations, saccades,
 *   score moyen « sur la cible » (%, ↑), durée (s).
 *
 * API :
 *   Compare.metricsOf(sessionData)        → { calib_px, confidence, lux, ... }
 *   Compare.aggregate(arrayOfSessions)    → moyennes + n (pour un groupe)
 *   Compare.compare(aOrSession, bOrSession, labelA, labelB) → tableau comparatif
 */
(function (global) {
  'use strict';

  // Définition des métriques : clé, libellé, unité, sens (plus bas = mieux ?).
  var METRICS = [
    { key: 'calib_px',    label: 'Erreur calibration', unit: 'px', lowerBetter: true },
    { key: 'on_target',   label: 'Score sur la cible', unit: '%',  lowerBetter: false },
    { key: 'confidence',  label: 'Confiance moyenne',  unit: '',   lowerBetter: false },
    { key: 'lux',         label: 'Luminosité',         unit: 'lux', lowerBetter: null }, // ni mieux ni pire
    { key: 'points',      label: 'Points de regard',   unit: '',   lowerBetter: null },
    { key: 'fixations',   label: 'Fixations',          unit: '',   lowerBetter: null },
    { key: 'saccades',    label: 'Saccades',           unit: '',   lowerBetter: null },
    { key: 'duration_s',  label: 'Durée',              unit: 's',  lowerBetter: null },
  ];

  function _num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function _mean(arr) {
    var v = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }
  function _median(arr) {
    var v = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (a, b) { return a - b; });
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }

  // Score moyen « sur la cible » d'une session (réutilise la logique de proximité
  // si ResultsView est chargé ; sinon repli interne identique).
  function _onTargetAvg(data) {
    var raw = (data.raw_gaze_data || []).filter(function (p) {
      return p.test_case_id && typeof p.target_x === 'number' && typeof p.target_y === 'number';
    });
    if (!raw.length) return null;
    var HIT = 90, MAX = 450, sum = 0;
    raw.forEach(function (p) {
      var d = Math.sqrt((p.x - p.target_x) * (p.x - p.target_x) + (p.y - p.target_y) * (p.y - p.target_y));
      var s = d <= HIT ? 1 : d >= MAX ? 0 : 1 - (d - HIT) / (MAX - HIT);
      sum += s;
    });
    return Math.round(100 * sum / raw.length);
  }

  // Métriques d'UNE session.
  function metricsOf(data) {
    var s = (data && data.session) || {};
    var raw = (data && data.raw_gaze_data) || [];
    var events = (data && data.events) || [];
    var cal = s.calibration_score || {};
    var confs = raw.map(function (p) { return p.confidence; }).filter(function (v) { return typeof v === 'number'; });
    var luxVals = raw.map(function (p) { return p.lux; }).filter(function (v) { return typeof v === 'number'; });
    var tRel = raw.map(function (p) { return p.t_rel_ms; }).filter(function (v) { return typeof v === 'number'; });
    var dur = tRel.length ? (Math.max.apply(null, tRel) - Math.min.apply(null, tRel)) / 1000 : null;
    return {
      calib_px:   cal.mean_error_px != null ? Math.round(cal.mean_error_px) : null,
      on_target:  _onTargetAvg(data),
      confidence: confs.length ? +( _mean(confs).toFixed(2) ) : null,
      lux:        luxVals.length ? Math.round(_median(luxVals)) : null,
      points:     raw.length,
      fixations:  events.filter(function (e) { return e.type === 'fixation'; }).length,
      saccades:   events.filter(function (e) { return e.type === 'saccade'; }).length,
      duration_s: dur != null ? Math.round(dur) : null,
    };
  }

  // Agrège les métriques d'un GROUPE de sessions (moyenne de chaque métrique).
  function aggregate(sessions) {
    var ms = (sessions || []).map(metricsOf);
    var out = { n: ms.length };
    METRICS.forEach(function (m) {
      var vals = ms.map(function (x) { return x[m.key]; });
      var avg = _mean(vals);
      out[m.key] = (avg == null) ? null : (m.key === 'confidence' ? +avg.toFixed(2) : Math.round(avg));
    });
    return out;
  }

  // Compare deux côtés. Chaque côté = soit une session (objet avec .session),
  // soit un tableau de sessions (groupe). Retourne un tableau de lignes prêtes à
  // afficher : { key, label, unit, a, b, diff, better }.
  function compare(sideA, sideB, labelA, labelB) {
    var aIsGroup = Array.isArray(sideA), bIsGroup = Array.isArray(sideB);
    var mA = aIsGroup ? aggregate(sideA) : metricsOf(sideA);
    var mB = bIsGroup ? aggregate(sideB) : metricsOf(sideB);
    var rows = METRICS.map(function (m) {
      var a = mA[m.key], b = mB[m.key];
      var diff = (a != null && b != null) ? +(b - a).toFixed(2) : null;
      var better = null;
      if (m.lowerBetter != null && a != null && b != null && a !== b) {
        var aWins = m.lowerBetter ? (a < b) : (a > b);
        better = aWins ? 'A' : 'B';
      }
      return { key: m.key, label: m.label, unit: m.unit, lowerBetter: m.lowerBetter, a: a, b: b, diff: diff, better: better };
    });
    return {
      labelA: labelA || (aIsGroup ? 'Groupe A (' + (mA.n||0) + ')' : 'Session A'),
      labelB: labelB || (bIsGroup ? 'Groupe B (' + (mB.n||0) + ')' : 'Session B'),
      nA: aIsGroup ? mA.n : 1,
      nB: bIsGroup ? mB.n : 1,
      rows: rows,
    };
  }

  global.Compare = { METRICS: METRICS, metricsOf: metricsOf, aggregate: aggregate, compare: compare };

})(typeof window !== 'undefined' ? window : global);
