/**
 * test-calibration.js — Tests unitaires pour calibration.js (US-1.1 + améliorations)
 * Exécution : node tests/test-calibration.js
 */

'use strict';

// ── Stubs navigateur ──────────────────────────────────────────────────────────
global.window = global;
global.window.addEventListener = () => {};
global.window.innerWidth  = 1920;
global.window.innerHeight = 1080;
global.localStorage = (() => {
  let store = {};
  return {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      () => { store = {}; },
  };
})();
try { Object.defineProperty(global, 'navigator', { value: { mediaDevices: null }, writable: true, configurable: true }); } catch (_) {}
global.document = {
  createElement: (tag) => ({
    style: { cssText: '' }, dataset: {}, id: '', className: '', innerHTML: '', textContent: '',
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, removeEventListener: () => {}, remove: () => {},
    setAttribute: () => {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  }),
  createElementNS: () => ({
    setAttribute: () => {}, appendChild: () => {},
    style: { cssText: '' },
  }),
  body: { appendChild: () => {} },
  head: { appendChild: () => {} },
  getElementById: () => null,
};

// Charger le module
require('../src/calibration/calibration.js');

const Cal = global.Calibration;
const { distance, mean, stdDev, median, pxFromPct, getSafeScreenPoint, removeOutliers, removeOutliers1D, medianFilterPoints, percentInROI, samplesPerSecond, summarizeValidationQuality, getQuadrant, detectFixations, detectSaccades, linkEvents, checkStability, applySpatialCorrection, correctWithNodes, computeLooError, computeIDWField } = Cal._helpers;
const OneEuroFilter = Cal._oneEuro;
const { CONFIG, CALIBRATION_GRID, VALIDATION_GRID } = Cal;
const KalmanFilter = Cal._kalman;

// ── Utilitaires de test ────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}

function assertApprox(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) console.log(`  ✓  ${msg} (${actual.toFixed(3)} ≈ ${expected})`);
  else    console.error(`  ✗  ${msg} (got ${actual.toFixed(3)}, expected ~${expected} ±${tol})`);
  ok ? passed++ : failed++;
}

function section(title) { console.log(`\n── ${title} ──`); }

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
// TEST 1 — Helpers mathématiques de base
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 1 : Helpers mathématiques');

assert(Math.abs(distance(0, 0, 3, 4) - 5) < 0.001, 'distance(0,0,3,4) = 5');
assert(distance(0, 0, 0, 0) === 0, 'distance(0,0,0,0) = 0');
assertApprox(distance(100, 100, 800, 600), 860.23, 0.5, 'distance(100,100,800,600) ≈ 860.23');
assertApprox(mean([1, 2, 3, 4, 5]), 3, 0.001, 'mean([1..5]) = 3');
assert(mean([]) === 0, 'mean([]) = 0');
assertApprox(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2, 0.01, 'stdDev classique = 2');
assert(stdDev([]) === 0, 'stdDev([]) = 0');
assert(stdDev([42]) === 0, 'stdDev([42]) = 0 (un seul élément)');
assertApprox(mean([10, 20, 30]), 20, 0.001, 'mean([10,20,30]) = 20');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2 — Médiane
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 2 : Médiane');

assertApprox(median([1, 2, 3, 4, 5]), 3, 0.001, 'median([1..5]) = 3');
assertApprox(median([1, 2, 3, 4]), 2.5, 0.001, 'median([1,2,3,4]) = 2.5');
assert(median([]) === 0, 'median([]) = 0');
assertApprox(median([100, 5, 50, 200, 1]), 50, 0.001, 'median non trié = 50');
assertApprox(median([7]), 7, 0.001, 'median([7]) = 7');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3 — pxFromPct
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 3 : pxFromPct (% → pixels)');

assert(pxFromPct(50, 1920) === 960,  'pxFromPct(50%, 1920) = 960');
assert(pxFromPct(10, 1080) === 108,  'pxFromPct(10%, 1080) = 108');
assert(pxFromPct(100, 1920) === 1920, 'pxFromPct(100%, 1920) = 1920');
assert(pxFromPct(0, 1920) === 0,     'pxFromPct(0%, 1920) = 0');
assert(pxFromPct(5, 1920) === 96,    'pxFromPct(5%, 1920) = 96 (bord extrême)');
assert(pxFromPct(95, 1920) === 1824, 'pxFromPct(95%, 1920) = 1824 (bord extrême)');

const safeTopLeft = getSafeScreenPoint({ xPct: 0, yPct: 0 });
const safeBottomRight = getSafeScreenPoint({ xPct: 100, yPct: 100 });
assert(safeTopLeft.x >= CONFIG.SAFE_MARGIN_X, 'Point safe gauche respecte la marge');
assert(safeTopLeft.y >= CONFIG.SAFE_MARGIN_TOP, 'Point safe haut sous le titre');
assert(safeBottomRight.x <= global.window.innerWidth - CONFIG.SAFE_MARGIN_X, 'Point safe droite respecte la marge');
assert(safeBottomRight.y <= global.window.innerHeight - CONFIG.SAFE_MARGIN_BOTTOM, 'Point safe bas respecte la marge');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4 — Grille de 25 points
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 4 : Grille de calibration — 25 points');

assert(CALIBRATION_GRID.length === 25, `Grille = 25 points (actuel: ${CALIBRATION_GRID.length})`);

const allInRange = CALIBRATION_GRID.every(p =>
  p.xPct >= 0 && p.xPct <= 100 && p.yPct >= 0 && p.yPct <= 100
);
assert(allInRange, 'Tous les points dans [0%, 100%]');

// Couverture des bords extrêmes (5% et 95%)
const hasExtremeTop    = CALIBRATION_GRID.some(p => p.yPct <= 5);
const hasExtremeBottom = CALIBRATION_GRID.some(p => p.yPct >= 95);
const hasExtremeLeft   = CALIBRATION_GRID.some(p => p.xPct <= 5);
const hasExtremeRight  = CALIBRATION_GRID.some(p => p.xPct >= 95);
assert(hasExtremeTop,    'Point sur bord supérieur extrême (y≤5%)');
assert(hasExtremeBottom, 'Point sur bord inférieur extrême (y≥95%)');
assert(hasExtremeLeft,   'Point sur bord gauche extrême (x≤5%)');
assert(hasExtremeRight,  'Point sur bord droit extrême (x≥95%)');

// Coins
const topLeft     = CALIBRATION_GRID.some(p => p.xPct <= 10 && p.yPct <= 10);
const topRight    = CALIBRATION_GRID.some(p => p.xPct >= 90 && p.yPct <= 10);
const bottomLeft  = CALIBRATION_GRID.some(p => p.xPct <= 10 && p.yPct >= 90);
const bottomRight = CALIBRATION_GRID.some(p => p.xPct >= 90 && p.yPct >= 90);
const center      = CALIBRATION_GRID.some(p => p.xPct === 50 && p.yPct === 50);
assert(topLeft,     'Coin haut-gauche présent');
assert(topRight,    'Coin haut-droite présent');
assert(bottomLeft,  'Coin bas-gauche présent');
assert(bottomRight, 'Coin bas-droite présent');
assert(center,      'Centre exact (50%,50%) présent');

// Unicité
const calCoords = CALIBRATION_GRID.map(p => `${p.xPct},${p.yPct}`);
assert(new Set(calCoords).size === calCoords.length, 'Aucun doublon dans la grille de calibration');

// Couverture des 4 quadrants (au moins 5 points chacun pour 25 points)
const q1 = CALIBRATION_GRID.filter(p => p.xPct <= 50 && p.yPct <= 50).length;
const q2 = CALIBRATION_GRID.filter(p => p.xPct >= 50 && p.yPct <= 50).length;
const q3 = CALIBRATION_GRID.filter(p => p.xPct <= 50 && p.yPct >= 50).length;
const q4 = CALIBRATION_GRID.filter(p => p.xPct >= 50 && p.yPct >= 50).length;
assert(q1 >= 4, `Quadrant haut-gauche ≥ 4 points (${q1})`);
assert(q2 >= 4, `Quadrant haut-droite ≥ 4 points (${q2})`);
assert(q3 >= 4, `Quadrant bas-gauche ≥ 4 points (${q3})`);
assert(q4 >= 4, `Quadrant bas-droite ≥ 4 points (${q4})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5 — Grille de validation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 5 : Grille de validation');

assert(VALIDATION_GRID.length === 9, `9 points de validation (recommandation jsPsych/WebGazer)`);

const calSet = new Set(CALIBRATION_GRID.map(p => `${p.xPct},${p.yPct}`));
const valUnique = VALIDATION_GRID.every(p => !calSet.has(`${p.xPct},${p.yPct}`));
assert(valUnique, 'Points de validation distincts des points de calibration');

const valCoords = VALIDATION_GRID.map(p => `${p.xPct},${p.yPct}`);
assert(new Set(valCoords).size === valCoords.length, 'Aucun doublon dans la grille de validation');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6 — removeOutliers
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 6 : Élimination des outliers');

const pts = [
  { x: 500, y: 300 }, { x: 502, y: 298 }, { x: 498, y: 303 },
  { x: 501, y: 301 }, { x: 499, y: 299 }, { x: 501, y: 300 },
  { x: 900, y: 700 }, // outlier évident
];
const filtered = removeOutliers(pts, 2);
assert(filtered.length < pts.length, 'removeOutliers supprime le point aberrant');
assert(filtered.every(p => Math.abs(p.x - 500) < 50), 'Points restants groupés autour de (500,300)');

// Cas : pas assez de points → retourne tous
const smallArr = [{ x: 100, y: 200 }, { x: 900, y: 800 }];
assert(removeOutliers(smallArr, 2).length === 2, 'removeOutliers < 4 points → retourne tout');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 7 — medianFilterPoints
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 7 : Filtre médian sur points');

const noisyPts = [
  { x: 490, y: 295 }, { x: 505, y: 305 }, { x: 500, y: 300 },
  { x: 495, y: 298 }, { x: 502, y: 301 },
];
const medPts = medianFilterPoints(noisyPts);
assert(medPts.length === 1, 'medianFilterPoints retourne 1 point résumé');
assertApprox(medPts[0].x, 500, 10, 'Médiane X ≈ 500');
assertApprox(medPts[0].y, 300, 10, 'Médiane Y ≈ 300');

assert(medianFilterPoints([{ x: 5, y: 5 }]).length === 1, 'medianFilterPoints([1]) → 1 point');
assert(medianFilterPoints([]).length === 0, 'medianFilterPoints([]) → []');

section('Test 7b : Métriques qualité validation');

const roiPts = [
  { x: 100, y: 100 },
  { x: 120, y: 100 },
  { x: 500, y: 500 },
  { x: 90, y: 90 },
];
assertApprox(percentInROI(roiPts, 100, 100, 50), 75, 0.001,
  'percentInROI calcule le pourcentage dans le rayon');
assertApprox(samplesPerSecond(40, 2000), 20, 0.001,
  'samplesPerSecond(40, 2000ms) = 20Hz');

const quality = summarizeValidationQuality([
  { roiPercent: 80, samplesPerSec: 25 },
  { roiPercent: 40, samplesPerSec: 5, noData: true }, // 5 Hz < MIN_SAMPLES_PER_SEC (8)
]);
assertApprox(quality.meanRoiPercent, 60, 0.001, 'ROI moyenne = 60%');
assert(quality.weakPoints.length === 1, 'Un point faible ROI détecté');
assert(quality.lowSampleRate, 'Fréquence trop basse détectée');
assert(quality.noDataPoints.length === 1, 'Point sans données détecté');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 8 — getQuadrant
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 8 : Détermination du quadrant');

global.window.innerWidth  = 1920;
global.window.innerHeight = 1080;

assert(getQuadrant(200, 200)   === 'topLeft',     'getQuadrant(200,200) = topLeft');
assert(getQuadrant(1500, 200)  === 'topRight',    'getQuadrant(1500,200) = topRight');
assert(getQuadrant(200, 800)   === 'bottomLeft',  'getQuadrant(200,800) = bottomLeft');
assert(getQuadrant(1500, 800)  === 'bottomRight', 'getQuadrant(1500,800) = bottomRight');
assert(getQuadrant(960, 540)   === 'bottomRight', 'getQuadrant(centre exact) → bottomRight (≥ borne)');
assert(getQuadrant(0, 0)       === 'topLeft',     'getQuadrant(0,0) = topLeft');
assert(getQuadrant(1919, 1079) === 'bottomRight', 'getQuadrant(coin bas-droit) = bottomRight');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 9 — Filtre de Kalman
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 9 : Filtre de Kalman 4 états');

const kf = new KalmanFilter();

// Première mesure — initialisation
const r1 = kf.update(500, 300, 33);
assert(r1.x === 500 && r1.y === 300, 'Kalman : initialisation sur première mesure');

// Mesures stables → estimation proche de la vraie valeur
for (let i = 0; i < 20; i++) kf.update(500 + (Math.random() - 0.5) * 10, 300 + (Math.random() - 0.5) * 10, 33);
const stable = kf.update(500, 300, 33);
assertApprox(stable.x, 500, 30, 'Kalman convergence X sur signal stable');
assertApprox(stable.y, 300, 30, 'Kalman convergence Y sur signal stable');

// Reset
kf.reset();
assert(!kf.initialized, 'Kalman.reset() → non initialisé');

// Le filtre lisse les sauts brusques (sortie < amplitude du saut)
kf.update(100, 100, 33);
const afterJump = kf.update(900, 700, 33);
assert(afterJump.x < 900, 'Kalman atténue le saut brusque en X');
assert(afterJump.y < 700, 'Kalman atténue le saut brusque en Y');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 10 — Configuration
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 10 : Configuration');

assert(CONFIG.CLICKS_PER_POINT >= 3, `CLICKS_PER_POINT ≥ 3 (${CONFIG.CLICKS_PER_POINT})`);
assert(CONFIG.RECALIBRATION_THRESHOLD === 250, 'Seuil global = 250 px');
assert(CONFIG.VALIDATION_POINTS === 9, 'Points de validation = 9');
assert(CONFIG.MIN_CLICK_DELAY_MS > 0, `Délai minimum clic > 0 (${CONFIG.MIN_CLICK_DELAY_MS}ms)`);
assert(CONFIG.OUTLIER_SIGMA === 2, 'Seuil outlier = 2σ');
assert(CONFIG.COLLECT_DURATION_MS >= 1000, `Durée de collecte ≥ 1000ms (${CONFIG.COLLECT_DURATION_MS})`);
assert(CONFIG.ADAPTIVE_THRESHOLD > 0, `Seuil adaptatif > 0 (${CONFIG.ADAPTIVE_THRESHOLD})`);
assert(CONFIG.DRIFT_THRESHOLD > 0, `Seuil dérive > 0 (${CONFIG.DRIFT_THRESHOLD})`);
assert(typeof CONFIG.LUMINANCE_MIN === 'number', 'LUMINANCE_MIN défini');
assert(typeof CONFIG.LUMINANCE_MAX === 'number', 'LUMINANCE_MAX défini');
assert(CONFIG.LUMINANCE_MIN < CONFIG.LUMINANCE_MAX, 'LUMINANCE_MIN < LUMINANCE_MAX');
assert(CONFIG.ROI_RADIUS > 0, `ROI_RADIUS > 0 (${CONFIG.ROI_RADIUS}px)`);
assert(CONFIG.MIN_ROI_PERCENT > 0 && CONFIG.MIN_ROI_PERCENT <= 100,
  `MIN_ROI_PERCENT dans ]0,100] (${CONFIG.MIN_ROI_PERCENT}%)`);
assert(CONFIG.MIN_SAMPLES_PER_SEC > 0,
  `MIN_SAMPLES_PER_SEC > 0 (${CONFIG.MIN_SAMPLES_PER_SEC}Hz)`);
assert(CONFIG.LIGHT_BALANCE_MAX_DIFF > 0,
  `LIGHT_BALANCE_MAX_DIFF > 0 (${CONFIG.LIGHT_BALANCE_MAX_DIFF})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 11 — Logique du score de précision
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 11 : Logique du score de précision');

const goodErrors = [50, 60, 55, 70, 65];
assertApprox(mean(goodErrors), 60, 0.1, 'Bonne calibration : moyenne = 60 px');
assert(mean(goodErrors) <= CONFIG.RECALIBRATION_THRESHOLD, 'Score correct ne déclenche pas recalibration');

const badErrors = [300, 280, 320, 290, 310];
assertApprox(mean(badErrors), 300, 0.1, 'Mauvaise calibration : moyenne = 300 px');
assert(mean(badErrors) > CONFIG.RECALIBRATION_THRESHOLD, 'Score insuffisant déclenche recalibration');

const borderErrors = Array(5).fill(CONFIG.RECALIBRATION_THRESHOLD);
assert(mean(borderErrors) <= CONFIG.RECALIBRATION_THRESHOLD, 'Score au seuil exact → ne déclenche pas recalibration');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 12 — API publique localStorage
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 12 : API publique — localStorage');

Cal.reset();
assert(Cal.getStoredData() === null, 'getStoredData() = null après reset()');
assert(Cal.getScore() === null, 'getScore() = null sans calibration');

localStorage.setItem('webgaze_calibration', JSON.stringify({
  timestamp:      new Date().toISOString(),
  meanError:      87.3,
  stdError:       12.1,
  threshold:      150,
  biasX:          5.4,
  biasY:          -3.2,
  quadrantErrors: { topLeft: 90, topRight: 95, bottomLeft: 85, bottomRight: 88 },
  quadrantBias:   { topLeft: { x: 1, y: 2 }, topRight: { x: -1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 2, y: -1 } },
}));

const stored = Cal.getStoredData();
assert(stored !== null, 'getStoredData() retourne les données');
assertApprox(stored.meanError, 87.3, 0.01, 'meanError lu = 87.3');
assert(typeof stored.biasX === 'number', 'biasX présent dans les données stockées');
assert(stored.quadrantErrors !== null, 'quadrantErrors présent dans les données stockées');

Cal.reset();
assert(Cal.getStoredData() === null, 'getStoredData() = null après reset()');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 13 — applyBiasCorrection (API publique)
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 13 : applyBiasCorrection');

// Sans calibration — biais = 0
const noBias = Cal.applyBiasCorrection(500, 300);
assertApprox(noBias.x, 500, 0.001, 'applyBiasCorrection sans biais → x inchangé');
assertApprox(noBias.y, 300, 0.001, 'applyBiasCorrection sans biais → y inchangé');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 14 — getDriftScore sans données
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 14 : getDriftScore');

const drift = Cal.getDriftScore();
assert(drift === null, 'getDriftScore() = null sans clics implicites');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 15 — Performance sur grand volume
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 15 : Performance');

const N = 10000;
const largeArr = Array.from({ length: N }, () => Math.random() * 300);
const largePoints = Array.from({ length: N }, () => ({
  x: Math.random() * 1920, y: Math.random() * 1080,
}));

const t0 = Date.now();
const m = mean(largeArr);
const s = stdDev(largeArr);
const med = median(largeArr);
const t1 = Date.now();
assert(t1 - t0 < 50, `mean + stdDev + median sur ${N} valeurs < 50ms (${t1 - t0}ms)`);

const t2 = Date.now();
removeOutliers(largePoints, 2);
const t3 = Date.now();
assert(t3 - t2 < 100, `removeOutliers sur ${N} points < 100ms (${t3 - t2}ms)`);

assert(typeof m === 'number' && !isNaN(m), 'mean sur grand volume = nombre valide');
assert(typeof s === 'number' && !isNaN(s), 'stdDev sur grand volume = nombre valide');
assert(typeof med === 'number' && !isNaN(med), 'median sur grand volume = nombre valide');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 16 — Cohérence de la grille 5×5
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 16 : Cohérence grille 5×5');

// Vérifier que les 5 colonnes X et 5 lignes Y sont bien représentées
const xValues = [...new Set(CALIBRATION_GRID.map(p => p.xPct))].sort((a, b) => a - b);
const yValues = [...new Set(CALIBRATION_GRID.map(p => p.yPct))].sort((a, b) => a - b);
assert(xValues.length === 5, `5 valeurs X distinctes dans la grille (${xValues.join(', ')})`);
assert(yValues.length === 5, `5 valeurs Y distinctes dans la grille (${yValues.join(', ')})`);

// Chaque colonne doit avoir 5 points
const byX = {};
CALIBRATION_GRID.forEach(p => { byX[p.xPct] = (byX[p.xPct] || 0) + 1; });
const allColsFull = Object.values(byX).every(c => c === 5);
assert(allColsFull, 'Chaque colonne X contient exactement 5 points');

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers générateurs pour tests I-DT (RNG déterministe)
// ═══════════════════════════════════════════════════════════════════════════════

function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generateCluster(centerX, centerY, spreadPx, count, startTimestamp, durationMs, rng) {
  const step = count > 1 ? durationMs / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => ({
    x:         centerX + (rng() * 2 - 1) * spreadPx,
    y:         centerY + (rng() * 2 - 1) * spreadPx,
    timestamp: startTimestamp + i * step,
  }));
}

function generateScattered(width, height, count, startTimestamp, durationMs, rng) {
  const step = count > 1 ? durationMs / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => ({
    x:         rng() * width,
    y:         rng() * height,
    timestamp: startTimestamp + i * step,
  }));
}

function generateLinearMotion(startX, startY, deltaX, deltaY, count, startTimestamp, durationMs) {
  const step = count > 1 ? durationMs / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + (deltaX * i) / Math.max(count - 1, 1),
    y: startY + (deltaY * i) / Math.max(count - 1, 1),
    timestamp: startTimestamp + i * step,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 17 — I-DT : cluster concentré => 1 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 17 : I-DT cluster concentré (1 fixation attendue)');

const rngA   = createRng(12345);
const clusterA = generateCluster(500, 300, 30, 50, 0, 300, rngA);
const fixA   = detectFixations(clusterA, 100, 100);

assert(fixA.length === 1, `detectFixations retourne 1 fixation (actuel: ${fixA.length})`);
if (fixA.length === 1) {
  const f = fixA[0];
  assertApprox(f.x_center, 500, 12, 'x_center proche de 500');
  assertApprox(f.y_center, 300, 12, 'y_center proche de 300');
  assert(f.duration >= 100, `duration >= 100ms (${f.duration.toFixed(1)}ms)`);
  assert(f.points_count >= 15, `points_count cohérent (${f.points_count})`);
  assert(
    Number.isFinite(f.x_center) && Number.isFinite(f.y_center) &&
    Number.isFinite(f.start_time) && Number.isFinite(f.end_time) &&
    Number.isFinite(f.duration) && Number.isFinite(f.points_count),
    'La fixation contient tous les champs requis'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 18 — I-DT : points éparpillés => 0 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 18 : I-DT points éparpillés (0 fixation attendue)');

const rngB     = createRng(999);
const scattered = generateScattered(1920, 1080, 50, 0, 300, rngB);
const fixB     = detectFixations(scattered, 100, 100);
assert(fixB.length === 0, `detectFixations retourne 0 fixation (actuel: ${fixB.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 19 — I-DT : deux clusters séparés => 2 fixations
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 19 : I-DT deux clusters (2 fixations attendues)');

const rngC    = createRng(2026);
const clusterC1 = generateCluster(200, 200, 20, 40, 0,   220, rngC);
const clusterC2 = generateCluster(800, 600, 20, 40, 400, 220, rngC);
const fixC    = detectFixations([...clusterC1, ...clusterC2], 100, 100);

assert(fixC.length === 2, `detectFixations retourne 2 fixations (actuel: ${fixC.length})`);
if (fixC.length === 2) {
  assertApprox(fixC[0].x_center, 200, 15, 'Fixation 1 centrée vers x=200');
  assertApprox(fixC[0].y_center, 200, 15, 'Fixation 1 centrée vers y=200');
  assertApprox(fixC[1].x_center, 800, 15, 'Fixation 2 centrée vers x=800');
  assertApprox(fixC[1].y_center, 600, 15, 'Fixation 2 centrée vers y=600');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 20 — I-DT : durée insuffisante => 0 fixation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 20 : I-DT cluster trop court (0 fixation attendue)');

const rngD       = createRng(77);
const shortCluster = generateCluster(500, 300, 15, 20, 0, 20, rngD);
const fixD       = detectFixations(shortCluster, 100, 100);
assert(fixD.length === 0, `Cluster de 20ms rejeté (fixations: ${fixD.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 21 — I-DT : paramètres configurables
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 21 : I-DT paramètres configurables');

const rngE        = createRng(4242);
const mediumCluster = generateCluster(450, 350, 60, 60, 0, 140, rngE);

const strictThreshold = detectFixations(mediumCluster, 80, 100);
const looseThreshold  = detectFixations(mediumCluster, 300, 100);
assert(looseThreshold.length >= strictThreshold.length,
  `Seuil dispersion plus large ne réduit pas les fixations (${strictThreshold.length} → ${looseThreshold.length})`);

const strictDuration = detectFixations(mediumCluster, 300, 200);
const looseDuration  = detectFixations(mediumCluster, 300, 60);
assert(looseDuration.length >= strictDuration.length,
  `Durée min plus faible ne réduit pas les fixations (${strictDuration.length} → ${looseDuration.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 22 — I-DT : performance sur 10 000 points
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 22 : I-DT performance (10 000 points)');

const rngPerf  = createRng(314159);
const perfData = generateScattered(1920, 1080, 10000, 0, 10000, rngPerf);
const tP0      = Date.now();
const perfFix  = detectFixations(perfData, 100, 100);
const tP       = Date.now() - tP0;

assert(tP < 50, `detectFixations < 50ms sur 10 000 points (${tP}ms)`);
assert(Array.isArray(perfFix), 'detectFixations retourne bien un tableau');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 23 — I-DT : entrées invalides
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 23 : I-DT entrées invalides');

assert(detectFixations([], 100, 100).length === 0,           'tableau vide → []');
assert(detectFixations(null, 100, 100).length === 0,         'null → []');
assert(detectFixations(clusterA, -1, 100).length === 0,      'seuil négatif → []');
assert(detectFixations(clusterA, 100, -1).length === 0,      'durée négative → []');
assert(detectFixations(clusterA, NaN, 100).length === 0,     'seuil NaN → []');
assert(detectFixations([{ x: 1, y: 1 }], 100, 100).length === 0,
  'point sans timestamp → filtré → []');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 24 — checkStability
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 24 : checkStability');

const sq = [];
// 4 premiers points stables → pas encore stable (requiredCount=5)
for (let k = 0; k < 4; k++) assert(!checkStability(sq, { x: 500, y: 300 }, 100, 80, 5),
  `checkStability faux avant ${k+1}/5 points`);
// 5e point → stable
assert(checkStability(sq, { x: 500, y: 300 }, 100, 80, 5), 'checkStability vrai au 5e point stable');

// Saut brusque → remet à zéro
assert(!checkStability(sq, { x: 900, y: 700 }, 100, 80, 5), 'checkStability faux après saut brusque');

// Point invalide → reset
const sq2 = [{ x: 1, y: 1 }];
assert(!checkStability(sq2, null, 100, 80, 5), 'checkStability faux si point null');
assert(sq2.length === 0, 'queue vidée après point invalide');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 25 — Mode calibration animée : config et API
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 25 : Mode calibration animée — configuration');

assert(typeof CONFIG.ANIMATED_STOP_MS === 'number' && CONFIG.ANIMATED_STOP_MS > 0,
  `ANIMATED_STOP_MS défini et > 0 (${CONFIG.ANIMATED_STOP_MS}ms)`);
assert(typeof CONFIG.ANIMATED_TRAVEL_MS === 'number' && CONFIG.ANIMATED_TRAVEL_MS > 0,
  `ANIMATED_TRAVEL_MS défini et > 0 (${CONFIG.ANIMATED_TRAVEL_MS}ms)`);
assert(typeof CONFIG.ANIMATED_COLLECT_RATE_MS === 'number' && CONFIG.ANIMATED_COLLECT_RATE_MS > 0,
  `ANIMATED_COLLECT_RATE_MS défini et > 0 (${CONFIG.ANIMATED_COLLECT_RATE_MS}ms)`);
assert(typeof CONFIG.ANIMATED_BALL_RADIUS === 'number' && CONFIG.ANIMATED_BALL_RADIUS > 0,
  `ANIMATED_BALL_RADIUS défini et > 0 (${CONFIG.ANIMATED_BALL_RADIUS}px)`);
assert(typeof CONFIG.ANIMATED_TRAIL_LENGTH === 'number' && CONFIG.ANIMATED_TRAIL_LENGTH > 0,
  `ANIMATED_TRAIL_LENGTH défini et > 0 (${CONFIG.ANIMATED_TRAIL_LENGTH})`);

// ANIMATED_COLLECT_RATE_MS doit être inférieur à ANIMATED_STOP_MS pour collecter
assert(CONFIG.ANIMATED_COLLECT_RATE_MS < CONFIG.ANIMATED_STOP_MS,
  'ANIMATED_COLLECT_RATE_MS < ANIMATED_STOP_MS (au moins 1 échantillon par arrêt)');

// Nombre d'échantillons collectés par point ≥ 5 (qualité minimale)
const samplesPerPoint = Math.floor(CONFIG.ANIMATED_STOP_MS / CONFIG.ANIMATED_COLLECT_RATE_MS);
assert(samplesPerPoint >= 5,
  `Échantillons par point ≥ 5 (${samplesPerPoint} avec stop=${CONFIG.ANIMATED_STOP_MS}ms, rate=${CONFIG.ANIMATED_COLLECT_RATE_MS}ms)`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 18 — Mode animé : API publique exposée
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 26 : Mode calibration animée — API publique');

assert(typeof Cal.startAnimated === 'function',
  'Calibration.startAnimated est une fonction');
assert(typeof Cal.startMicroRecalibration === 'function',
  'Calibration.startMicroRecalibration est une fonction');
assert(typeof Cal._internal === 'object',
  'Calibration._internal exposé pour les tests');
assert(typeof Cal._internal.startAnimatedCalibrationPhase === 'function',
  '_internal.startAnimatedCalibrationPhase est une fonction');
assert(typeof Cal._internal.startMicroRecalibration === 'function',
  '_internal.startMicroRecalibration est une fonction');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 19 — Mode animé : temps total estimé
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 27 : Mode animé — durée estimée raisonnable');

const totalMs = CALIBRATION_GRID.length * (CONFIG.ANIMATED_TRAVEL_MS + CONFIG.ANIMATED_STOP_MS);
const totalSec = totalMs / 1000;

// La calibration complète doit durer entre 20s et 90s (ni trop courte, ni trop longue)
assert(totalSec >= 20,
  `Durée totale estimée ≥ 20s (${totalSec.toFixed(1)}s pour ${CALIBRATION_GRID.length} points)`);
assert(totalSec <= 90,
  `Durée totale estimée ≤ 90s (${totalSec.toFixed(1)}s) — acceptable pour l'utilisateur`);

// Le temps d'arrêt est ≥ 2x le délai de collecte (marge pour stabilisation du regard)
assert(CONFIG.ANIMATED_STOP_MS >= CONFIG.ANIMATED_COLLECT_RATE_MS * 2,
  `ANIMATED_STOP_MS (${CONFIG.ANIMATED_STOP_MS}ms) ≥ 2 × ANIMATED_COLLECT_RATE_MS (${CONFIG.ANIMATED_COLLECT_RATE_MS * 2}ms)`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 20 — Mode animé utilise la même grille que le mode clics
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 28 : Mode animé — cohérence avec la grille 25 points');

// Le mode animé doit parcourir les mêmes 25 points (couverture identique)
// On vérifie que la grille exposée est la même
assert(CALIBRATION_GRID.length === 25,
  `Le mode animé parcourt les 25 points de CALIBRATION_GRID (${CALIBRATION_GRID.length})`);

// Vérifier que la grille couvre bien tout l'écran (points extrêmes)
const minX = Math.min(...CALIBRATION_GRID.map(p => p.xPct));
const maxX = Math.max(...CALIBRATION_GRID.map(p => p.xPct));
const minY = Math.min(...CALIBRATION_GRID.map(p => p.yPct));
const maxY = Math.max(...CALIBRATION_GRID.map(p => p.yPct));
assert(minX <= 10, `Point le plus à gauche ≤ 10% (${minX}%) — bord bien couvert`);
assert(maxX >= 90, `Point le plus à droite ≥ 90% (${maxX}%) — bord bien couvert`);
assert(minY <= 10, `Point le plus en haut ≤ 10% (${minY}%) — bord bien couvert`);
assert(maxY >= 90, `Point le plus en bas ≥ 90% (${maxY}%) — bord bien couvert`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 21 — I-VT : saut brusque => 1 saccade
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 29 : I-VT saut brusque (1 saccade attendue)');

const jumpData = [
  ...generateLinearMotion(400, 300, 0, 0, 5, 0, 80),
  { x: 800, y: 600, timestamp: 110 },
  ...generateLinearMotion(800, 600, 0, 0, 4, 140, 60),
];
const saccadesJump = detectSaccades(jumpData, 0.7);
assert(saccadesJump.length === 1, `1 saccade détectée (actuel: ${saccadesJump.length})`);
if (saccadesJump.length === 1) {
  const s = saccadesJump[0];
  assertApprox(s.start_x, 400, 0.01, 'start_x = 400');
  assertApprox(s.start_y, 300, 0.01, 'start_y = 300');
  assertApprox(s.end_x, 800, 0.01, 'end_x = 800');
  assertApprox(s.end_y, 600, 0.01, 'end_y = 600');
  assert(s.duration > 0, `duration > 0 (${s.duration}ms)`);
  assertApprox(s.amplitude, 500, 1, 'amplitude ≈ 500px');
  assert(s.peak_velocity > 0.7, `peak_velocity > seuil (${s.peak_velocity.toFixed(3)})`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 22 — I-VT : mouvement lent => 0 saccade
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 30 : I-VT mouvement lent (0 saccade attendue)');

const slowData = generateLinearMotion(400, 300, 40, 0, 50, 0, 500);
const saccadesSlow = detectSaccades(slowData, 0.7);
assert(saccadesSlow.length === 0, `0 saccade détectée sur mouvement lent (actuel: ${saccadesSlow.length})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 23 — linkEvents : alternance fixations / saccades
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 31 : linkEvents alternance fixation/saccade');

const fixationsTimeline = [
  { start_time: 0,   end_time: 100, x_center: 100, y_center: 100, duration: 100, points_count: 10 },
  { start_time: 220, end_time: 320, x_center: 300, y_center: 300, duration: 100, points_count: 10 },
];
const saccadesTimeline = [
  { start_time: 110, end_time: 160, start_x: 100, start_y: 100, end_x: 200, end_y: 200, duration: 50, amplitude: 141.4, peak_velocity: 2.8 },
  { start_time: 330, end_time: 360, start_x: 300, start_y: 300, end_x: 500, end_y: 500, duration: 30, amplitude: 282.8, peak_velocity: 9.4 },
];
const timeline = linkEvents(fixationsTimeline, saccadesTimeline);
assert(timeline.length === 4, `timeline de 4 événements (actuel: ${timeline.length})`);
assert(timeline.map(e => e.type).join(' > ') === 'fixation > saccade > fixation > saccade', 'Ordre alterné correct');
assert(timeline[0].start_time <= timeline[1].start_time && timeline[1].start_time <= timeline[2].start_time,
  'timeline triée par start_time');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 24 — I-VT : seuil de vélocité configurable
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 32 : I-VT seuil configurable');

const mediumJump = [
  ...generateLinearMotion(400, 300, 0, 0, 5, 0, 80),
  { x: 520, y: 300, timestamp: 120 },
  ...generateLinearMotion(520, 300, 0, 0, 4, 150, 60),
];
const lowThresholdCount = detectSaccades(mediumJump, 0.2).length;
const highThresholdCount = detectSaccades(mediumJump, 3).length;
assert(lowThresholdCount >= highThresholdCount, `seuil bas détecte au moins autant de saccades (${lowThresholdCount} >= ${highThresholdCount})`);
assert(lowThresholdCount !== highThresholdCount, 'Changer le seuil modifie bien le résultat');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 25 — I-VT : performance sur 10 000 points
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 33 : I-VT performance (10 000 points)');

const perfSaccData = Array.from({ length: 10000 }, (_, i) => ({
  x: 400 + i * 0.05,
  y: 300,
  timestamp: i,
}));
const tS0 = Date.now();
const perfSaccades = detectSaccades(perfSaccData, 0.7);
const tS = Date.now() - tS0;
assert(tS < 50, `detectSaccades < 50ms sur 10 000 points (${tS}ms)`);
assert(Array.isArray(perfSaccades), 'detectSaccades retourne bien un tableau');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 34 — removeOutliers1D
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 34 : removeOutliers1D');

const errs1d = [100, 105, 98, 102, 101, 99, 900]; // 900 = outlier
const filtered1d = removeOutliers1D(errs1d, 2);
assert(filtered1d.length === errs1d.length - 1, 'removeOutliers1D retire l\'outlier 1D');
assert(!filtered1d.includes(900), 'L\'outlier 900 est bien retiré');
assert(removeOutliers1D([1, 2], 2).length === 2, 'removeOutliers1D < 4 valeurs → retourne tout');
assert(removeOutliers1D([5, 5, 5, 5], 2).length === 4, 'stdDev=0 → aucune suppression (pas de division par 0)');
assert(Array.isArray(removeOutliers1D(null, 2)), 'removeOutliers1D(null) → tableau');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 35 — applySpatialCorrection : pas de double correction
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 35 : Correction spatiale unique (anti sur-correction)');

// Sans nœuds ni biais → identité
Cal.reset();
const idn = applySpatialCorrection(800, 450);
assertApprox(idn.x, 800, 0.001, 'Sans correction → x inchangé');
assertApprox(idn.y, 450, 0.001, 'Sans correction → y inchangé');

// Avec un champ de correction : la correction sur un nœud doit ramener vers la cible,
// PAS au-delà (ce qui serait le signe d'une double correction IDW+LOWESS).
const preds = [
  { targetX: 200, targetY: 200, predX: 230, predY: 210 },
  { targetX: 1600, targetY: 200, predX: 1630, predY: 215 },
  { targetX: 200, targetY: 800, predX: 225, predY: 815 },
  { targetX: 1600, targetY: 800, predX: 1625, predY: 820 },
  { targetX: 900, targetY: 500, predX: 928, predY: 512 },
];
computeIDWField(preds);
// Sur un nœud exact, la correction doit annuler ~exactement l'erreur (pas la doubler)
const corrAtNode = applySpatialCorrection(928, 512); // pred du dernier nœud
const errBefore = distance(928, 512, 900, 500);
const errAfter  = distance(corrAtNode.x, corrAtNode.y, 900, 500);
assert(errAfter < errBefore, 'La correction réduit l\'erreur sur un nœud');
assert(errAfter < errBefore * 0.6, `La correction ne sur-corrige pas (err ${errAfter.toFixed(1)} < ${(errBefore*0.6).toFixed(1)})`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 36 — computeLooError : erreur de généralisation
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 36 : Leave-one-out cross-validation');

const loo = computeLooError(preds);
assert(loo !== null, 'computeLooError retourne un résultat avec ≥3 points');
assert(typeof loo.meanError === 'number' && loo.meanError >= 0, 'meanError LOO est un nombre positif');
assert(loo.n >= 3, `LOO utilise au moins 3 points (${loo.n})`);
// La LOO doit être ≥ l'erreur résiduelle sur les points eux-mêmes (généralisation plus dure)
assert(computeLooError([{ targetX: 0, targetY: 0, predX: 1, predY: 1 }]) === null,
  'computeLooError < 3 points → null');
Cal.reset();

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 37 — One Euro Filter : lissage et réactivité
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 37 : One Euro Filter');

const oe = new OneEuroFilter();
const f0 = oe.filter(500, 300, 1000);
assert(f0.x === 500 && f0.y === 300, 'One Euro : 1re mesure renvoyée telle quelle');
// Bruit autour d'une position fixe → sortie proche de la moyenne, variance réduite
let oeOut = null;
for (let i = 1; i <= 30; i++) {
  oeOut = oe.filter(500 + (Math.random() - 0.5) * 20, 300 + (Math.random() - 0.5) * 20, 1000 + i * 33);
}
assertApprox(oeOut.x, 500, 15, 'One Euro lisse le bruit autour de X=500');
assertApprox(oeOut.y, 300, 15, 'One Euro lisse le bruit autour de Y=300');
oe.reset();
const fr = oe.filter(100, 100, 2000);
assert(fr.x === 100, 'One Euro.reset() réinitialise l\'état');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 38 — smoothPrediction / resetSmoothing (API runtime)
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 38 : API runtime smoothPrediction');

assert(typeof Cal.smoothPrediction === 'function', 'Calibration.smoothPrediction exposé');
assert(typeof Cal.resetSmoothing === 'function', 'Calibration.resetSmoothing exposé');
assert(typeof Cal.captureHeadReference === 'function', 'Calibration.captureHeadReference exposé');
Cal.reset(); Cal.resetSmoothing();
const sp0 = Cal.smoothPrediction(640, 360, 1000);
assert(sp0 && sp0.x === 640 && sp0.y === 360, 'smoothPrediction : 1re valeur sans correction = entrée');
assert(Cal.smoothPrediction(null, 360, 1000) === null, 'smoothPrediction(null) → null');
assert(Cal.smoothPrediction(NaN, 1, 1) === null, 'smoothPrediction(NaN) → null');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 39 — Compensation tête : no-op sans tracker WebGazer
// ═══════════════════════════════════════════════════════════════════════════════
section('Test 39 : Compensation tête sans WebGazer');

assert(typeof Cal.getHeadCompensation === 'function', 'getHeadCompensation exposé');
const hc = Cal.getHeadCompensation();
assert(hc.dx === 0 && hc.dy === 0, 'Sans tracker WebGazer → compensation nulle (dx=dy=0)');
assert(typeof CONFIG.HEAD_COMPENSATION_ENABLED === 'boolean', 'HEAD_COMPENSATION_ENABLED défini');
assert(CONFIG.HEAD_COMP_GAIN > 0, `HEAD_COMP_GAIN > 0 (${CONFIG.HEAD_COMP_GAIN})`);
assert(CONFIG.HEAD_COMP_MAX_PX > 0, `HEAD_COMP_MAX_PX > 0 (${CONFIG.HEAD_COMP_MAX_PX})`);

// ═══════════════════════════════════════════════════════════════════════════════
// Résumé
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
else { console.log('  Tous les tests passent.\n'); process.exit(0); }
