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

section('Test 2 : score de proximité continu (distance à la cible)');
// Cible à (500,300). Point 1 = pile dessus (100%), point 2 = à 90px (limite, 100%),
// point 3 = très loin (0%).
var data = { raw_gaze_data: [
  { test_case_id:'tc1', target_aoi_id:'bar-q3', x:500, y:300, target_x:500, target_y:300, t_rel_ms:0,   viz_state:{current_aoi:'bar-q3',active_view:'bar'}, dom:{id:'bar-q3'} },
  { test_case_id:'tc1', target_aoi_id:'bar-q3', x:560, y:300, target_x:500, target_y:300, t_rel_ms:100, viz_state:{current_aoi:'bar-q3',active_view:'bar'}, dom:{id:'bar-q3'} },
  { test_case_id:'tc1', target_aoi_id:'bar-q3', x:1500, y:900, target_x:500, target_y:300, t_rel_ms:200, viz_state:{active_view:'bar'}, dom:{id:'svg'} },
  { x:1, y:1 }, // point hors stimulus → ignoré
]};
var rows = R.analyze(data);
assert(rows.length === 1, '1 stimulus analysé');
var tc1 = rows.find(function (r){ return r.stimulus==='tc1'; });
assert(tc1.target === 'bar-q3', 'cible tc1');
assert(tc1.points === 3, '3 points pour tc1');
assert(tc1.view === 'bar', 'page regardée = bar');
// Proximités : 100% (d=0), 100% (d=60<90), 0% (d très grand) → moyenne 67%
assert(tc1.on_target_pct === 67, 'score continu = 67% (deux points proches, un loin)');
assert(tc1.duration_ms === 200, 'durée 200 ms');

section('Test 2b : 100% si toujours sur la cible, baisse si on s\'éloigne');
var near = R.analyze({ raw_gaze_data: [
  { test_case_id:'a', x:300, y:300, target_x:300, target_y:300, t_rel_ms:0 },
  { test_case_id:'a', x:310, y:305, target_x:300, target_y:300, t_rel_ms:50 },
]});
assert(near[0].on_target_pct === 100, 'pile sur la cible → 100%');
var far = R.analyze({ raw_gaze_data: [
  { test_case_id:'b', x:300, y:300, target_x:800, target_y:600, t_rel_ms:0 },
]});
assert(far[0].on_target_pct < 100 && far[0].on_target_pct >= 0, 'loin de la cible → score réduit (' + far[0].on_target_pct + '%)');
// Sans target_x/y (phase libre) → score null
var freeRows = R.analyze({ raw_gaze_data: [ { test_case_id:'free', x:1, y:1, t_rel_ms:0 } ]});
assert(freeRows[0].on_target_pct === null, 'phase sans cible → score null');

section('Test 3 : robustesse');
assert(R.analyze({}).length === 0, 'aucune donnée → []');
assert(R.analyze({ raw_gaze_data: [{ x:1, y:1 }] }).length === 0, 'aucun stimulus étiqueté → []');

console.log('\n════════════════════════════════════');
console.log('  Résultats : ' + passed + ' ✓ réussis / ' + failed + ' ✗ échoués');
console.log('════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests ResultsView passent.\n'); process.exit(0); }
