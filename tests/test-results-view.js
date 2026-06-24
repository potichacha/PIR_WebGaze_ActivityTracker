/**
 * test-results-view.js — Tests de l'analyse par stimulus (fonction pure).
 * Exécution : node tests/test-results-view.js
 */
'use strict';
global.window = global;
require('../src/results-view/results-view.js');
var R = global.ResultsView;

var passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log('  ✓  ' + m); passed++; } else { console.error('  ✗  ' + m); failed++; } }
function section(t) { console.log('\n── ' + t + ' ──'); }

section('Test 1 : API');
assert(typeof R.show === 'function', 'show');
assert(typeof R.hide === 'function', 'hide');
assert(typeof R.analyze === 'function', 'analyze');

section('Test 2 : analyse par stimulus');
var data = { raw_gaze_data: [
  { test_case_id:'tc1', target_aoi_id:'bar-q3', t_rel_ms:0,   viz_state:{current_aoi:'bar-q3'}, dom:{id:'bar-q3'} },
  { test_case_id:'tc1', target_aoi_id:'bar-q3', t_rel_ms:100, viz_state:{current_aoi:'bar-q3'}, dom:{id:'bar-q3'} },
  { test_case_id:'tc1', target_aoi_id:'bar-q3', t_rel_ms:200, viz_state:{current_aoi:'y-axis'}, dom:{id:'y-axis'} },
  { test_case_id:'tc2', target_aoi_id:'point-3', t_rel_ms:300, viz_state:{current_aoi:'point-5'}, dom:{id:'point-5'} },
  { x:1, y:1 }, // point hors stimulus → ignoré
]};
var rows = R.analyze(data);
assert(rows.length === 2, '2 stimuli analysés');
var tc1 = rows.find(function (r){ return r.stimulus==='tc1'; });
assert(tc1.target === 'bar-q3', 'cible tc1');
assert(tc1.points === 3, '3 points pour tc1');
assert(tc1.on_target_pct === 67, '67% sur la cible (2/3)');
assert(tc1.most_looked === 'bar-q3', 'AOI la plus regardée = bar-q3');
assert(tc1.duration_ms === 200, 'durée 200 ms');
var tc2 = rows.find(function (r){ return r.stimulus==='tc2'; });
assert(tc2.on_target_pct === 0, 'tc2 : 0% (jamais sur la cible)');

section('Test 3 : robustesse');
assert(R.analyze({}).length === 0, 'aucune donnée → []');
assert(R.analyze({ raw_gaze_data: [{ x:1, y:1 }] }).length === 0, 'aucun stimulus étiqueté → []');

console.log('\n════════════════════════════════════');
console.log('  Résultats : ' + passed + ' ✓ réussis / ' + failed + ' ✗ échoués');
console.log('════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests ResultsView passent.\n'); process.exit(0); }
