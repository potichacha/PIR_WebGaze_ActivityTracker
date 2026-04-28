/**
 * test-calibration.js — Tests unitaires pour calibration.js (US-1.1)
 * Exécution : node tests/test-calibration.js
 *
 * Teste les fonctions pures et la logique métier sans navigateur.
 */

'use strict';

// ── Stub minimal pour simuler l'environnement navigateur ──────────────────────
global.window = global;
global.localStorage = (() => {
  let store = {};
  return {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      () => { store = {}; },
  };
})();
global.document = {
  createElement: () => ({
    style: { cssText: '' },
    dataset: {},
    appendChild: () => {},
    querySelector: () => null,
    querySelector: () => null,
    addEventListener: () => {},
    remove: () => {},
    innerHTML: '',
    textContent: '',
    id: '',
    className: '',
  }),
  body: { appendChild: () => {} },
  getElementById: () => null,
  head: { appendChild: () => {} },
};

// Charger le module
require('../src/calibration/calibration.js');
const { _helpers, CONFIG, CALIBRATION_GRID, VALIDATION_GRID } = global.Calibration;
const { distance, mean, stdDev, pxFromPct, detectFixations } = _helpers;

// ── Utilitaires de test ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓  ${message}`);
    passed++;
  } else {
    console.error(`  ✗  ${message}`);
    failed++;
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓  ${message} (valeur: ${actual.toFixed(2)}, attendu: ~${expected})`);
    passed++;
  } else {
    console.error(`  ✗  ${message} (valeur: ${actual.toFixed(2)}, attendu: ~${expected} ±${tolerance})`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generateCluster(centerX, centerY, spreadPx, count, startTimestamp, durationMs, rng) {
  const points = [];
  const step = count > 1 ? durationMs / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    const x = centerX + (rng() * 2 - 1) * spreadPx;
    const y = centerY + (rng() * 2 - 1) * spreadPx;
    points.push({
      x,
      y,
      timestamp: startTimestamp + index * step,
    });
  }
  return points;
}

function generateScattered(width, height, count, startTimestamp, durationMs, rng) {
  const points = [];
  const step = count > 1 ? durationMs / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    points.push({
      x: rng() * width,
      y: rng() * height,
      timestamp: startTimestamp + index * step,
    });
  }
  return points;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1 — Helpers mathématiques
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 1 : Helpers mathématiques');

assert(
  Math.abs(distance(0, 0, 3, 4) - 5) < 0.001,
  'distance(0,0,3,4) = 5 (triangle 3-4-5)'
);

assert(
  Math.abs(distance(0, 0, 0, 0)) < 0.001,
  'distance(0,0,0,0) = 0'
);

assertApprox(
  distance(100, 100, 800, 600),
  860.23,
  0.5,
  'distance(100,100,800,600) ≈ 860.23 px (sqrt(700²+500²))'
);

assertApprox(
  mean([1, 2, 3, 4, 5]),
  3,
  0.001,
  'mean([1,2,3,4,5]) = 3'
);

assert(
  mean([]) === 0,
  'mean([]) = 0 (cas vide)'
);

assertApprox(
  stdDev([2, 4, 4, 4, 5, 5, 7, 9]),
  2,
  0.01,
  'stdDev([2,4,4,4,5,5,7,9]) = 2'
);

assert(
  stdDev([]) === 0,
  'stdDev([]) = 0 (cas vide)'
);

assert(
  stdDev([42]) === 0,
  'stdDev([42]) = 0 (un seul élément)'
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2 — pxFromPct
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 2 : pxFromPct (% → pixels)');

assert(
  pxFromPct(50, 1920) === 960,
  'pxFromPct(50%, 1920) = 960'
);

assert(
  pxFromPct(10, 1080) === 108,
  'pxFromPct(10%, 1080) = 108'
);

assert(
  pxFromPct(100, 1920) === 1920,
  'pxFromPct(100%, 1920) = 1920'
);

assert(
  pxFromPct(0, 1920) === 0,
  'pxFromPct(0%, 1920) = 0'
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3 — Structure de la grille de calibration
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 3 : Structure de la grille de calibration');

assert(
  CALIBRATION_GRID.length >= 9,
  `Grille de calibration ≥ 9 points (actuel: ${CALIBRATION_GRID.length})`
);

assert(
  CALIBRATION_GRID.length === 13,
  `Grille de calibration = 13 points (idéal US-1.1)`
);

const allInRange = CALIBRATION_GRID.every(
  p => p.xPct >= 0 && p.xPct <= 100 && p.yPct >= 0 && p.yPct <= 100
);
assert(allInRange, 'Tous les points de calibration sont dans [0%, 100%]');

// Vérifier couverture des extrémités (coins)
const hasTopLeft     = CALIBRATION_GRID.some(p => p.xPct <= 15 && p.yPct <= 15);
const hasTopRight    = CALIBRATION_GRID.some(p => p.xPct >= 85 && p.yPct <= 15);
const hasBottomLeft  = CALIBRATION_GRID.some(p => p.xPct <= 15 && p.yPct >= 65);
const hasBottomRight = CALIBRATION_GRID.some(p => p.xPct >= 85 && p.yPct >= 65);
const hasCenter      = CALIBRATION_GRID.some(p => p.xPct === 50 && p.yPct === 50);

assert(hasTopLeft,     'Point en haut-gauche présent');
assert(hasTopRight,    'Point en haut-droite présent');
assert(hasBottomLeft,  'Point en bas-gauche présent');
assert(hasBottomRight, 'Point en bas-droite présent');
assert(hasCenter,      'Point central présent');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4 — Structure de la grille de validation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 4 : Structure de la grille de validation');

assert(
  VALIDATION_GRID.length === 5,
  `Grille de validation = 5 points (US-1.1 : 5 points de test)`
);

// Les points de validation doivent être différents des points de calibration
const calSet = new Set(CALIBRATION_GRID.map(p => `${p.xPct},${p.yPct}`));
const valUnique = VALIDATION_GRID.every(p => !calSet.has(`${p.xPct},${p.yPct}`));
assert(valUnique, 'Points de validation distincts des points de calibration');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5 — Configuration
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 5 : Configuration');

assert(
  CONFIG.CLICKS_PER_POINT >= 3,
  `CLICKS_PER_POINT ≥ 3 (valeur: ${CONFIG.CLICKS_PER_POINT})`
);

assert(
  CONFIG.RECALIBRATION_THRESHOLD === 150,
  `Seuil de recalibration = 150 px (US-1.1 : >150px → proposer recalibrer)`
);

assert(
  CONFIG.VALIDATION_POINTS === 5,
  `Nombre de points de validation = 5`
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6 — Logique du score (simulation)
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 6 : Logique de calcul du score de précision');

// Simuler une bonne calibration : erreurs de 50, 60, 55, 70, 65 px
const goodErrors = [50, 60, 55, 70, 65];
const goodMean = mean(goodErrors);
const goodStd  = stdDev(goodErrors);

assertApprox(goodMean, 60, 0.1, 'meanError calibration correcte = 60 px');
assertApprox(goodStd, 7.07, 0.1, 'stdError calibration correcte ≈ 7.07 px');
assert(
  goodMean <= CONFIG.RECALIBRATION_THRESHOLD,
  `Score correct ne déclenche pas recalibration (${goodMean.toFixed(1)} ≤ ${CONFIG.RECALIBRATION_THRESHOLD})`
);

// Simuler une mauvaise calibration : erreurs de 200, 180, 220, 190, 210 px
const badErrors = [200, 180, 220, 190, 210];
const badMean   = mean(badErrors);
assertApprox(badMean, 200, 0.1, 'meanError calibration mauvaise = 200 px');
assert(
  badMean > CONFIG.RECALIBRATION_THRESHOLD,
  `Score insuffisant déclenche recalibration (${badMean.toFixed(1)} > ${CONFIG.RECALIBRATION_THRESHOLD})`
);

// Score exactement au seuil
const borderErrors = Array(5).fill(CONFIG.RECALIBRATION_THRESHOLD);
const borderMean = mean(borderErrors);
assert(
  borderMean <= CONFIG.RECALIBRATION_THRESHOLD,
  `Score = seuil exactement → ne déclenche PAS recalibration (≤)`
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 7 — localStorage (API publique)
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 7 : Stockage localStorage via API publique');

const Cal = global.Calibration;

// Initialement vide
Cal.reset();
assert(Cal.getStoredData() === null, 'getStoredData() = null après reset()');
assert(Cal.getScore() === null, 'getScore() = null sans calibration effectuée');

// Simuler une sauvegarde directe
global.localStorage.setItem('webgaze_calibration', JSON.stringify({
  timestamp: new Date().toISOString(),
  meanError: 87.3,
  stdError: 12.1,
  threshold: 150,
}));
const stored = Cal.getStoredData();
assert(stored !== null, 'getStoredData() retourne les données après écriture directe');
assert(
  Math.abs(stored.meanError - 87.3) < 0.01,
  `meanError lu = 87.3 (lu: ${stored.meanError})`
);

// Reset efface
Cal.reset();
assert(Cal.getStoredData() === null, 'getStoredData() = null après reset()');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 8 — Performance (calculs sur grand volume)
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 8 : Performance sur grand volume de données');

const N = 10000;
const largeErrors = Array.from({ length: N }, () => Math.random() * 200);

const t0 = Date.now();
const largeMean = mean(largeErrors);
const largeStd  = stdDev(largeErrors);
const elapsed = Date.now() - t0;

assert(
  elapsed < 50,
  `mean + stdDev sur ${N} valeurs < 50ms (temps: ${elapsed}ms)`
);

assert(
  typeof largeMean === 'number' && !isNaN(largeMean),
  `mean(${N} valeurs) est un nombre valide (${largeMean.toFixed(2)})`
);

assert(
  typeof largeStd === 'number' && !isNaN(largeStd),
  `stdDev(${N} valeurs) est un nombre valide (${largeStd.toFixed(2)})`
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 9 — Unicité des points de calibration
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 9 : Unicité des points');

const calCoords = CALIBRATION_GRID.map(p => `${p.xPct},${p.yPct}`);
const calUnique = new Set(calCoords).size === calCoords.length;
assert(calUnique, 'Aucun doublon dans la grille de calibration');

const valCoords = VALIDATION_GRID.map(p => `${p.xPct},${p.yPct}`);
const valUniqueCheck = new Set(valCoords).size === valCoords.length;
assert(valUniqueCheck, 'Aucun doublon dans la grille de validation');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 10 — I-DT : cluster concentré => 1 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 10 : I-DT cluster concentré (1 fixation attendue)');

const rngA = createRng(12345);
const clusterA = generateCluster(500, 300, 30, 50, 0, 300, rngA);
const fixA = detectFixations(clusterA, 100, 100);

assert(fixA.length === 1, `detectFixations retourne 1 fixation (actuel: ${fixA.length})`);
if (fixA.length === 1) {
  const f = fixA[0];
  assertApprox(f.x_center, 500, 12, 'x_center proche de 500');
  assertApprox(f.y_center, 300, 12, 'y_center proche de 300');
  assert(f.duration >= 100, `duration >= 100ms (actuel: ${f.duration.toFixed(1)}ms)`);
  assert(f.points_count >= 15, `points_count cohérent (actuel: ${f.points_count})`);
  const hasShape =
    Number.isFinite(f.x_center) &&
    Number.isFinite(f.y_center) &&
    Number.isFinite(f.start_time) &&
    Number.isFinite(f.end_time) &&
    Number.isFinite(f.duration) &&
    Number.isFinite(f.points_count);
  assert(hasShape, 'La fixation contient tous les champs requis');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 11 — I-DT : points éparpillés => 0 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 11 : I-DT points éparpillés (0 fixation attendue)');

const rngB = createRng(999);
const scattered = generateScattered(1920, 1080, 50, 0, 300, rngB);
const fixB = detectFixations(scattered, 100, 100);
assert(fixB.length === 0, `detectFixations retourne 0 fixation (actuel: ${fixB.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 12 — I-DT : deux clusters séparés => 2 fixations
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 12 : I-DT deux clusters (2 fixations attendues)');

const rngC = createRng(2026);
const clusterC1 = generateCluster(200, 200, 20, 40, 0, 220, rngC);
const clusterC2 = generateCluster(800, 600, 20, 40, 400, 220, rngC);
const fixC = detectFixations([...clusterC1, ...clusterC2], 100, 100);

assert(fixC.length === 2, `detectFixations retourne 2 fixations (actuel: ${fixC.length})`);
if (fixC.length === 2) {
  assertApprox(fixC[0].x_center, 200, 15, 'Fixation 1 centrée vers x=200');
  assertApprox(fixC[0].y_center, 200, 15, 'Fixation 1 centrée vers y=200');
  assertApprox(fixC[1].x_center, 800, 15, 'Fixation 2 centrée vers x=800');
  assertApprox(fixC[1].y_center, 600, 15, 'Fixation 2 centrée vers y=600');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 13 — I-DT : durée insuffisante => 0 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 13 : I-DT cluster trop court (0 fixation attendue)');

const rngD = createRng(77);
const shortCluster = generateCluster(500, 300, 15, 20, 0, 20, rngD);
const fixD = detectFixations(shortCluster, 100, 100);
assert(fixD.length === 0, `Cluster de 20ms rejeté (fixations: ${fixD.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 14 — I-DT : paramètres configurables
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 14 : I-DT paramètres configurables');

const rngE = createRng(4242);
const mediumCluster = generateCluster(450, 350, 60, 60, 0, 140, rngE);
const strictThreshold = detectFixations(mediumCluster, 80, 100);
const looseThreshold = detectFixations(mediumCluster, 300, 100);

assert(
  looseThreshold.length >= strictThreshold.length,
  `Seuil dispersion plus large ne réduit pas les fixations (${strictThreshold.length} -> ${looseThreshold.length})`
);

const strictDuration = detectFixations(mediumCluster, 300, 200);
const looseDuration = detectFixations(mediumCluster, 300, 60);
assert(
  looseDuration.length >= strictDuration.length,
  `Durée min plus faible ne réduit pas les fixations (${strictDuration.length} -> ${looseDuration.length})`
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 15 — I-DT : performance sur 10 000 points
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 15 : I-DT performance (10 000 points)');

const rngPerf = createRng(314159);
const perfData = generateScattered(1920, 1080, 10000, 0, 10000, rngPerf);
const tPerf0 = Date.now();
const perfFix = detectFixations(perfData, 100, 100);
const tPerf = Date.now() - tPerf0;

assert(tPerf < 50, `detectFixations < 50ms sur 10 000 points (temps: ${tPerf}ms)`);
assert(Array.isArray(perfFix), 'detectFixations retourne bien un tableau');

// ═══════════════════════════════════════════════════════════════════════════════
// Résumé
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('  Tous les tests passent — US-1.1 et US-1.2 validées.\n');
  process.exit(0);
}
