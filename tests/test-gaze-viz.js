/**
 * test-gaze-viz.js — Tests des fonctions pures de gaze-viz.js.
 * Le rendu canvas n'est pas testable sans DOM ; on teste la palette heatmap.
 * Exécution : node tests/test-gaze-viz.js
 */
'use strict';

global.window = global;
require('../src/gaze-viz/gaze-viz.js');
const Viz = global.GazeViz;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ──`); }

section('Test 1 : API publique');
assert(typeof Viz.show === 'function', 'GazeViz.show est une fonction');
assert(typeof Viz.hide === 'function', 'GazeViz.hide est une fonction');

section('Test 2 : palette heatmap (_heatColor)');
const c0 = Viz._heatColor(0, 1);
const c1 = Viz._heatColor(1, 1);
assert(/^rgba\(0,0,255/.test(c0), 'valeur 0 → bleu');
assert(/^rgba\(255,0,0/.test(c1), 'valeur 1 → rouge');
assert(/rgba\(/.test(Viz._heatColor(0.5, 0.5)), 'valeur médiane → couleur rgba valide');
// Bornage des entrées hors [0,1]
assert(/^rgba\(0,0,255/.test(Viz._heatColor(-5, 1)), 'valeur < 0 bornée à 0 (bleu)');
assert(/^rgba\(255,0,0/.test(Viz._heatColor(5, 1)), 'valeur > 1 bornée à 1 (rouge)');

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests GazeViz passent.\n'); process.exit(0); }
