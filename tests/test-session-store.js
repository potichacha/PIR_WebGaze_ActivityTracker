/**
 * test-session-store.js — Tests du store de sessions (BDD localStorage).
 * Exécution : node tests/test-session-store.js
 */
'use strict';

global.window = global;
global.localStorage = (function () {
  var s = {};
  return {
    getItem: function (k) { return k in s ? s[k] : null; },
    setItem: function (k, v) { s[k] = String(v); },
    removeItem: function (k) { delete s[k]; },
    clear: function () { s = {}; },
  };
})();
require('../src/session-store/session-store.js');
var S = global.SessionStore;

var passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log('  ✓  ' + m); passed++; } else { console.error('  ✗  ' + m); failed++; } }
function section(t) { console.log('\n── ' + t + ' ──'); }

function makeSession(name, lux, px) {
  return {
    session: {
      id: 'x', participant_id: name.toLowerCase(), first_name: name, last_name: 'Test',
      glasses: 'lunettes', engine: 'webgazer',
      start_time: '2026-06-2' + (Math.floor(Math.random() * 9)) + 'T10:00:00.000Z',
      screen_resolution: { width: 1920, height: 1080 },
      calibration_score: { mean_error_px: px },
    },
    raw_gaze_data: [
      { x: 10, y: 20, confidence: 0.8, lux: lux },
      { x: 30, y: 40, confidence: 0.6, lux: lux },
    ],
    events: [ { type: 'fixation', details: { x: 10, y: 20 }, duration: 200 },
              { type: 'saccade', duration: 30 } ],
    aoi_hits: [ { aoi_id: 'bar-q3' } ],
    interactions: [], viz_states: [],
  };
}

section('Test 1 : API');
['save','list','get','delete','clear','count','exportAll','importAll','summarize']
  .forEach(function (m) { assert(typeof S[m] === 'function', 'SessionStore.' + m); });

section('Test 2 : save / list / count');
S.clear();
assert(S.count() === 0, 'store vide au départ');
var id1 = S.save(makeSession('Alice', 300, 90));
var id2 = S.save(makeSession('Bob', 500, 140));
assert(typeof id1 === 'string' && id1.length === 36, 'save renvoie un UUID');
assert(S.count() === 2, '2 sessions enregistrées');
var list = S.list();
assert(list.length === 2, 'list renvoie 2 entrées');
assert(list[0].summary && list[0].summary.participant, 'résumé contient le participant');

section('Test 3 : résumé tabulaire');
var sum = S.summarize(S.get(id1));
assert(sum.participant === 'Alice Test', 'nom complet');
assert(sum.glasses === 'lunettes', 'lunettes');
assert(sum.calib_error_px === 90, 'erreur calibration');
assert(sum.lux === 300, 'lux médian');
assert(sum.n_fixations === 1 && sum.n_saccades === 1, 'compte fixations/saccades');
assert(sum.mean_confidence === 0.7, 'confiance moyenne');

section('Test 4 : get / delete');
assert(S.get(id1) !== null, 'get récupère la session');
assert(S.get('inconnu') === null, 'get(id inconnu) → null');
assert(S.delete(id2) === true, 'delete réussit');
assert(S.count() === 1, 'count décrémenté');
assert(S.delete('inconnu') === false, 'delete(id inconnu) → false');

section('Test 5 : export / import');
S.clear();
S.save(makeSession('Carol', 200, 110));
S.save(makeSession('Dan', 400, 130));
var dump = S.exportAll();
assert(dump.sessions && Object.keys(dump.sessions).length === 2, 'exportAll contient 2 sessions');
S.clear();
assert(S.count() === 0, 'store vidé');
var n = S.importAll(dump, false);
assert(n === 2, 'importAll restaure 2 sessions');
assert(S.count() === 2, 'count après import');
assert(S.importAll(null) === 0, 'importAll(null) → 0');

section('Test 6 : robustesse');
assert(S.save(null) === null, 'save(null) → null');
assert(S.save({}) === null, 'save sans session → null');

console.log('\n════════════════════════════════════');
console.log('  Résultats : ' + passed + ' ✓ réussis / ' + failed + ' ✗ échoués');
console.log('════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests SessionStore passent.\n'); process.exit(0); }
