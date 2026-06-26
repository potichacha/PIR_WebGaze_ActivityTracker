/**
 * test-compare.js — Tests du module de comparaison de sessions.
 * Exécution : node tests/test-compare.js
 */
'use strict';
global.window = global;
require('../src/compare/compare.js');
var C = global.Compare;

var passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log('  ✓  ' + m); passed++; } else { console.error('  ✗  ' + m); failed++; } }
function section(t) { console.log('\n── ' + t + ' ──'); }

function mk(engine, calib, glasses, onTargetX) {
  // onTargetX : si fourni, le 2e point est à cette distance de la cible.
  return {
    session: { engine: engine, glasses: glasses, calibration_score: { mean_error_px: calib } },
    raw_gaze_data: [
      { x:500, y:300, target_x:500, target_y:300, test_case_id:'t', confidence:0.8, lux:400, t_rel_ms:0 },
      { x:(onTargetX!=null?onTargetX:500), y:300, target_x:500, target_y:300, test_case_id:'t', confidence:0.6, lux:400, t_rel_ms:2000 },
    ],
    events: [ { type:'fixation' }, { type:'saccade' } ],
  };
}

section('Test 1 : API');
['METRICS','metricsOf','aggregate','compare'].forEach(function (k) { assert(C[k] != null, 'Compare.' + k); });

section('Test 2 : metricsOf');
var m = C.metricsOf(mk('webgazer', 120, 'non'));
assert(m.calib_px === 120, 'calib_px');
assert(m.on_target === 100, 'score sur cible 100% (les 2 points sur la cible)');
assert(m.confidence === 0.7, 'confiance moyenne (0.8+0.6)/2');
assert(m.lux === 400, 'lux médian');
assert(m.points === 2, '2 points');
assert(m.fixations === 1 && m.saccades === 1, 'fix/sacc');
assert(m.duration_s === 2, 'durée 2s');

section('Test 3 : score sur cible baisse si on s\'éloigne');
var far = C.metricsOf(mk('mediapipe', 400, 'non', 1500)); // 2e point très loin
assert(far.on_target < 100, 'score < 100% si un point est loin (' + far.on_target + '%)');

section('Test 4 : compare 2 sessions — meilleur par métrique');
var cmp = C.compare(mk('webgazer',120,'non'), mk('mediapipe',400,'lunettes'), 'WG', 'MP');
var calRow = cmp.rows.find(function (r){ return r.key==='calib_px'; });
assert(calRow.a === 120 && calRow.b === 400, 'valeurs calibration');
assert(calRow.diff === 280, 'diff = B−A = 280');
assert(calRow.better === 'A', 'A meilleur (calibration plus basse)');
assert(cmp.nA === 1 && cmp.nB === 1, 'sessions individuelles');

section('Test 5 : compare 2 groupes — moyennes');
var grp = C.compare([mk('webgazer',100,'non'), mk('webgazer',200,'non')],
                    [mk('mediapipe',400,'non'), mk('mediapipe',500,'non')], 'tous WG', 'tous MP');
assert(grp.nA === 2 && grp.nB === 2, 'tailles de groupes');
var gCal = grp.rows.find(function (r){ return r.key==='calib_px'; });
assert(gCal.a === 150, 'moyenne WG calibration = 150');
assert(gCal.b === 450, 'moyenne MP calibration = 450');
assert(gCal.better === 'A', 'groupe WG meilleur en calibration');

section('Test 6 : robustesse');
assert(C.aggregate([]).n === 0, 'aggregate([]) → n=0');
var empty = C.metricsOf({});
assert(empty.points === 0 && empty.calib_px === null, 'metricsOf({}) sans crash');

console.log('\n════════════════════════════════════');
console.log('  Résultats : ' + passed + ' ✓ réussis / ' + failed + ' ✗ échoués');
console.log('════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests Compare passent.\n'); process.exit(0); }
