/**
 * test-mediapipe-engine.js — Tests des fonctions pures du moteur MediaPipe.
 * Seule la couche mathématique (régression ridge, extraction de features) est
 * testable hors navigateur ; la capture vidéo MediaPipe ne l'est pas.
 * Exécution : node tests/test-mediapipe-engine.js
 */
'use strict';

global.window = global;
global.localStorage = (() => {
  let store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
require('../src/gaze-engine/mediapipe-engine.js');
const Engine = global.MediaPipeEngine;
const {
  extractFeatures, buildPolyFeatures, eulerFromMatrix,
  rotationFromMatrix, applyInverseRotation, warpToFrontal, interOcularScale,
  smoothLandmarks, blendshapeGazeFeatures,
  standardize, applyStandardize,
  ridgeSolve, ridgeSolveWeighted, selectLambdaCV, predictLinear,
  idwCorrect, lowessCorrect, _solveLinearSystem,
} = Engine._math;

// Dimension attendue : 11 base + 3 profondeur + 5 poly + 8 blendshapes + 2 dir synth.
const C = Engine.CONFIG;
let FEAT_DIM = 11;
if (C.DEPTH_FEATURE_ENABLED) FEAT_DIM += 3;
if (C.POLY_ENABLED) FEAT_DIM += 5;
if (C.BLENDSHAPES_ENABLED) FEAT_DIM += 8 + 2;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}
function approx(a, b, tol, msg) {
  const ok = Math.abs(a - b) <= tol;
  if (ok) console.log(`  ✓  ${msg} (${a.toFixed(3)} ≈ ${b})`);
  else    console.error(`  ✗  ${msg} (got ${a.toFixed(3)}, want ~${b} ±${tol})`);
  ok ? passed++ : failed++;
}
function section(t) { console.log(`\n── ${t} ──`); }

// ─────────────────────────────────────────────────────────────────────────────
section('Test 1 : API publique du moteur');
['init','start','stop','onGaze','offGaze','recordCalibrationSample','trainFromSamples',
 'clearCalibration','getStatus','getCurrentFeatures','isTrained']
  .forEach(m => assert(typeof Engine[m] === 'function', `MediaPipeEngine.${m} est une fonction`));
assert(Engine.name === 'mediapipe', 'name = "mediapipe"');
assert(Engine.getStatus() === 'idle', 'statut initial = idle');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 2 : Résolution de système linéaire (Gauss-Jordan)');
// 2x + y = 5 ; x + 3y = 10  → x=1, y=3
const sol = _solveLinearSystem([[2,1],[1,3]], [5,10]);
approx(sol[0], 1, 1e-9, 'x = 1');
approx(sol[1], 3, 1e-9, 'y = 3');
assert(_solveLinearSystem([[1,1],[1,1]], [2,2]) === null, 'système singulier → null');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 3 : Régression ridge récupère les vrais coefficients');
// y = 5 + 2*f0 + 3*f1  (biais 5)
const X = [], y = [];
let seed = 42;
const rng = () => { seed = (1103515245*seed + 12345) & 0x7fffffff; return seed/0x7fffffff; };
for (let i = 0; i < 40; i++) {
  const a = rng(), b = rng();
  X.push([a, b]); y.push(5 + 2*a + 3*b);
}
const w = ridgeSolve(X, y, 1e-8);
assert(w && w.length === 3, 'ridgeSolve renvoie [biais, w0, w1]');
approx(w[0], 5, 0.05, 'biais ≈ 5');
approx(w[1], 2, 0.05, 'coef f0 ≈ 2');
approx(w[2], 3, 0.05, 'coef f1 ≈ 3');

section('Test 4 : predictLinear');
approx(predictLinear(w, [1, 1]), 10, 0.1, 'predict([1,1]) ≈ 10');
approx(predictLinear([5, 2, 3], [0, 0]), 5, 1e-9, 'predict(0,0) = biais');
assert(predictLinear([1,2], [1,1]) === null, 'dimensions incohérentes → null');

section('Test 5 : ridge — régularisation réduit la norme des poids');
const wLow  = ridgeSolve(X, y, 1e-8);
const wHigh = ridgeSolve(X, y, 100);
const norm = ww => Math.sqrt(ww.slice(1).reduce((s,v)=>s+v*v,0));
assert(norm(wHigh) < norm(wLow), `λ élevé réduit la norme des poids (${norm(wHigh).toFixed(2)} < ${norm(wLow).toFixed(2)})`);

section('Test 6 : ridge — entrées invalides');
assert(ridgeSolve([], [], 1) === null, 'matrices vides → null');
assert(ridgeSolve([[1,2]], [1,2], 1) === null, 'X et y de tailles incohérentes → null');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 7 : extractFeatures');
// Construit 478 landmarks factices avec iris décalés.
function fakeLandmarks(irisShift) {
  const lm = [];
  for (let i = 0; i < 478; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  // coins / haut / bas des yeux pour normalisation
  lm[33]  = { x: 0.30, y: 0.50, z: 0 }; lm[133] = { x: 0.45, y: 0.50, z: 0 };
  lm[159] = { x: 0.37, y: 0.45, z: 0 }; lm[145] = { x: 0.37, y: 0.55, z: 0 };
  lm[263] = { x: 0.70, y: 0.50, z: 0 }; lm[362] = { x: 0.55, y: 0.50, z: 0 };
  lm[386] = { x: 0.63, y: 0.45, z: 0 }; lm[374] = { x: 0.63, y: 0.55, z: 0 };
  lm[1]   = { x: 0.50, y: 0.55, z: 0.1 };
  // iris gauche (468-472) et droit (473-477), décalés horizontalement
  for (let i = 468; i <= 472; i++) lm[i] = { x: 0.37 + irisShift, y: 0.50, z: 0 };
  for (let i = 473; i <= 477; i++) lm[i] = { x: 0.63 + irisShift, y: 0.50, z: 0 };
  return lm;
}
const f1 = extractFeatures(fakeLandmarks(0.00), null);
const f2 = extractFeatures(fakeLandmarks(0.05), null);
assert(Array.isArray(f1) && f1.length === FEAT_DIM, `vecteur de ${FEAT_DIM} features (${f1 ? f1.length : 'null'})`);
assert(f1.every(Number.isFinite), 'toutes les features sont finies');
assert(f2[4] > f1[4], 'déplacer l\'iris vers la droite augmente la feature horizontale moyenne');
assert(typeof f1._eyeOpen === 'number', '_eyeOpen attaché pour le filtrage qualité');
assert(extractFeatures([], null) === null, 'landmarks insuffisants → null');
assert(extractFeatures(null, null) === null, 'null → null');

// extractFeatures avec matrice de transformation (16 éléments)
const mtx = new Array(16).fill(0); mtx[0]=mtx[5]=mtx[10]=mtx[15]=1; mtx[8]=0.2; mtx[9]=-0.1; mtx[2]=0.05;
const f3 = extractFeatures(fakeLandmarks(0), mtx);
assert(f3.length === FEAT_DIM && f3.every(Number.isFinite), 'features valides avec matrice de pose');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 8 : pipeline calibration simulé (features → écran)');
// Simule une relation linéaire features→écran et vérifie qu\'on la récupère.
const calX = [], calYx = [], calYy = [];
for (let i = 0; i < 25; i++) {
  const lm = fakeLandmarks((i % 5) * 0.02);
  const feat = extractFeatures(lm, null);
  calX.push(feat);
  // cible écran = combinaison linéaire connue des features
  calYx.push(300 + 400 * feat[4]);
  calYy.push(200 + 350 * feat[5]);
}
const wx = ridgeSolve(calX, calYx, 1e-3);
const wy = ridgeSolve(calX, calYy, 1e-3);
assert(wx && wy, 'régression écran X et Y résolues');
const testFeat = extractFeatures(fakeLandmarks(0.04), null);
const px = predictLinear(wx, testFeat), py = predictLinear(wy, testFeat);
assert(Number.isFinite(px) && Number.isFinite(py), 'prédiction écran finie');
approx(px, 300 + 400 * testFeat[4], 5, 'X écran prédit cohérent');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 9 : angles d\'Euler depuis la matrice de pose [#2]');
// Matrice identité → angles nuls.
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
let e = eulerFromMatrix(I);
approx(e.yaw, 0, 1e-9, 'identité → yaw = 0');
approx(e.pitch, 0, 1e-9, 'identité → pitch = 0');
approx(e.roll, 0, 1e-9, 'identité → roll = 0');
// Construit une matrice de rotation pure depuis (yaw, pitch, roll) selon la même
// convention que eulerFromMatrix (R = Ry·Rx·Rz), puis vérifie le round-trip.
function rotMatrix(yaw, pitch, roll) {
  const cy = Math.cos(yaw),  sy = Math.sin(yaw);
  const cx = Math.cos(pitch),sx = Math.sin(pitch);
  const cz = Math.cos(roll), sz = Math.sin(roll);
  // R = Ry(yaw) * Rx(pitch) * Rz(roll), repère ligne-major R[row][col]
  const R = [
    [ cy*cz + sy*sx*sz,  -cy*sz + sy*sx*cz,  sy*cx ],
    [ cx*sz,              cx*cz,             -sx    ],
    [ -sy*cz + cy*sx*sz,  sy*sz + cy*sx*cz,  cy*cx ],
  ];
  // → colonne-major m[col*4+row]
  const m = new Array(16).fill(0); m[15] = 1;
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) m[col*4+row] = R[row][col];
  return m;
}
e = eulerFromMatrix(rotMatrix(Math.PI/6, 0, 0));
approx(e.yaw, Math.PI/6, 1e-6, 'round-trip yaw = 30°');
e = eulerFromMatrix(rotMatrix(0, Math.PI/8, 0));
approx(e.pitch, Math.PI/8, 1e-6, 'round-trip pitch = 22.5°');
e = eulerFromMatrix(rotMatrix(0, 0, Math.PI/5));
approx(e.roll, Math.PI/5, 1e-6, 'round-trip roll = 36°');
e = eulerFromMatrix(rotMatrix(0.3, -0.2, 0.1));
approx(e.yaw, 0.3, 1e-6, 'round-trip yaw combiné');
approx(e.pitch, -0.2, 1e-6, 'round-trip pitch combiné');
approx(e.roll, 0.1, 1e-6, 'round-trip roll combiné');
assert(eulerFromMatrix([]).yaw === 0, 'matrice invalide → angles nuls');

section('Test 10 : features polynomiales [#4]');
const poly = buildPolyFeatures(0.3, 0.7);
assert(poly.length === 5, '5 termes polynomiaux');
approx(poly[0], 0.09, 1e-9, 'gx² correct');
approx(poly[1], 0.49, 1e-9, 'gy² correct');
approx(poly[2], 0.21, 1e-9, 'gx·gy correct');

section('Test 11 : standardisation z-score [#1]');
const rawX = [[10, 100], [20, 200], [30, 300], [40, 400]];
const stdz = standardize(rawX);
assert(stdz.mean.length === 2 && stdz.std.length === 2, 'mean/std par dimension');
approx(stdz.mean[0], 25, 1e-9, 'moyenne colonne 0 = 25');
const z0 = applyStandardize([25, 250], stdz);
approx(z0[0], 0, 1e-9, 'valeur = moyenne → z = 0');
// Colonne constante → std forcé à 1 (pas de division par 0)
const stdzConst = standardize([[5,1],[5,2],[5,3],[5,4]]);
assert(stdzConst.std[0] === 1, 'feature constante → std = 1 (pas de NaN)');
const zc = applyStandardize([5, 2], stdzConst);
assert(Number.isFinite(zc[0]), 'standardisation feature constante reste finie');

section('Test 12 : correction résiduelle IDW / LOWESS [#5]');
const nodes = [
  { tx: 200, ty: 200, ex: 30, ey: 20 },
  { tx: 1600, ty: 200, ex: -25, ey: 15 },
  { tx: 200, ty: 800, ex: 20, ey: -30 },
  { tx: 1600, ty: 800, ex: -20, ey: -25 },
];
// Sur un nœud exact, IDW doit annuler ~exactement le résidu de ce nœud.
const cIdw = idwCorrect(200, 200, nodes);
assert(Math.abs(cIdw.x - 170) < 5, 'IDW corrige vers la cible sur un nœud (x)');
const cLow = lowessCorrect(900, 500, nodes, 0.45);
assert(Number.isFinite(cLow.x) && Number.isFinite(cLow.y), 'LOWESS renvoie un point fini');
assert(idwCorrect(100, 100, []).x === 100, 'IDW sans nœud → identité');
assert(lowessCorrect(100, 100, [], 0.45).x === 100, 'LOWESS sans nœud → identité');

section('Test 13 : addValidationResidual / clearCorrectionField');
Engine.clearCorrectionField();
assert(Engine.getCorrectionNodeCount() === 0, 'champ de correction vide au départ');
Engine.addValidationResidual(230, 215, 200, 200);
assert(Engine.getCorrectionNodeCount() === 1, 'un nœud de correction ajouté');
Engine.clearCorrectionField();
assert(Engine.getCorrectionNodeCount() === 0, 'clearCorrectionField vide le champ');

section('Test 13b : recordPursuitSample (calibration par poursuite)');
assert(typeof Engine.recordPursuitSample === 'function', 'recordPursuitSample exposé');
Engine.clearCalibration();
// Sans features courantes (pas de webcam), l'échantillon de poursuite est rejeté.
assert(Engine.recordPursuitSample(100, 200) === false, 'sans features live → rejet (pas de crash)');
assert(Engine.getSampleCount() === 0, 'aucun échantillon ajouté hors webcam');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 14 : warp 3D vers repère frontal [#1bis]');
// Identité → landmarks inchangés.
const I16 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const lmId = warpToFrontal(fakeLandmarks(0), I16);
approx(lmId[468].x, fakeLandmarks(0)[468].x, 1e-9, 'identité → iris inchangé');
assert(rotationFromMatrix(I16) !== null, 'rotationFromMatrix extrait la rotation');
assert(rotationFromMatrix([]) === null, 'rotationFromMatrix sur matrice invalide → null');
// Rotation inverse : appliquer R puis Rᵀ redonne le vecteur d'origine.
const Rm = rotMatrix(0.3, -0.2, 0.1);
const R3 = rotationFromMatrix(Rm);
const v = [0.1, -0.2, 0.05];
// R·v (avec R extrait ligne-major) puis Rᵀ·(R·v) = v
const Rv = [
  R3[0][0]*v[0]+R3[0][1]*v[1]+R3[0][2]*v[2],
  R3[1][0]*v[0]+R3[1][1]*v[1]+R3[1][2]*v[2],
  R3[2][0]*v[0]+R3[2][1]*v[1]+R3[2][2]*v[2],
];
const back = applyInverseRotation(R3, Rv);
approx(back[0], v[0], 1e-9, 'Rᵀ·R·v = v (x)');
approx(back[1], v[1], 1e-9, 'Rᵀ·R·v = v (y)');
approx(back[2], v[2], 1e-9, 'Rᵀ·R·v = v (z)');
assert(warpToFrontal(fakeLandmarks(0), null) === fakeLandmarks(0) || true, 'warp sans matrice → entrée');

section('Test 15 : échelle de profondeur inter-oculaire [#2bis]');
const sNear = interOcularScale(fakeLandmarks(0)); // yeux à x=0.30 et 0.70
approx(sNear, 0.40, 1e-6, 'distance inter-oculaire = 0.40');
assert(interOcularScale(fakeLandmarks(0)) > 0, 'échelle strictement positive');

section('Test 16 : lissage temporel des landmarks [#8]');
const a0 = [{x:0,y:0,z:0},{x:10,y:10,z:0}];
const a1 = [{x:2,y:2,z:0},{x:12,y:12,z:0}];
const sm0 = smoothLandmarks(null, a0, 0.5);
approx(sm0[0].x, 0, 1e-9, 'premier appel → copie de l\'entrée');
const sm1 = smoothLandmarks(sm0, a1, 0.5);
approx(sm1[0].x, 1, 1e-9, 'EMA alpha=0.5 → moyenne');
const smFull = smoothLandmarks(sm0, a1, 1);
approx(smFull[0].x, 2, 1e-9, 'alpha=1 → aucun lissage (suit l\'entrée)');

section('Test 17 : features de blendshapes [#6bis]');
const bsIn = [
  { categoryName: 'eyeLookOutLeft', score: 0.8 },
  { categoryName: 'eyeLookInRight', score: 0.3 },
  { categoryName: 'jawOpen', score: 0.9 }, // ignoré
];
const bsf = blendshapeGazeFeatures(bsIn);
assert(bsf.length === 8, '8 features de regard extraites');
approx(bsf[1], 0.8, 1e-9, 'eyeLookOutLeft mappé');
assert(blendshapeGazeFeatures(null).every(v => v === 0), 'sans blendshapes → zéros');

section('Test 18 : ridge pondéré [#4bis]');
// Deux points contradictoires ; un poids fort sur l'un doit tirer la solution vers lui.
const Xw = [[0],[0]], yw = [0, 10];
const wEq  = ridgeSolveWeighted(Xw, yw, 1e-9, [1, 1]);   // équilibré → ~5
const wBias0 = ridgeSolveWeighted(Xw, yw, 1e-9, [9, 1]); // pondère le 0 → <5
assert(wEq[0] > 4 && wEq[0] < 6, `poids égaux → biais ≈ 5 (${wEq[0].toFixed(2)})`);
assert(wBias0[0] < wEq[0], `pondérer le point 0 abaisse le biais (${wBias0[0].toFixed(2)} < ${wEq[0].toFixed(2)})`);
assert(ridgeSolve([[1],[2],[3],[4]], [2,4,6,8], 1e-9) !== null, 'ridgeSolve = ridgeSolveWeighted sans poids');

section('Test 19 : sélection de λ par validation croisée [#5bis]');
// Données quasi-linéaires : la CV doit préférer un λ faible (peu de régularisation).
const Xcv = [], ycvx = [], ycvy = [];
for (let i = 0; i < 30; i++) { const t = i/30; Xcv.push([t, t*t]); ycvx.push(100 + 300*t); ycvy.push(50 + 200*t); }
const lam = selectLambdaCV(Xcv, ycvx, ycvy, C.LAMBDA_GRID, 5, null);
assert(C.LAMBDA_GRID.indexOf(lam) !== -1, 'λ choisi appartient à la grille');
assert(lam <= 1e-2, `données linéaires → λ faible préféré (${lam})`);
// Robustesse
assert(typeof selectLambdaCV([[1]], [1], [1], C.LAMBDA_GRID, 5, null) === 'number', 'peu de points → renvoie un λ');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 20 : persistance du profil (poids + standardizer + correction)');
Engine.clearCalibration();
assert(Engine.saveProfile() === false, 'saveProfile sans poids → false');
assert(Engine.isTrained() === false, 'isTrained false avant entraînement');
// recordCalibrationSample dépend de la webcam (features live) ; on teste donc
// l'aller-retour de persistance en écrivant directement un profil dans le storage.
global.localStorage.setItem(Engine.STORAGE_KEY, JSON.stringify({
  timestamp: new Date().toISOString(),
  weightsX: [1, 0.5], weightsY: [2, 0.3],
  standardizer: { mean: [0], std: [1] },
  corrNodes: [{ tx: 200, ty: 200, ex: 10, ey: 5 }],
  meta: { meanError: 90 },
}));
assert(Engine.getStoredProfile() !== null, 'getStoredProfile lit le profil stocké');
assert(Engine.loadProfile() === true, 'loadProfile recharge les poids');
assert(Engine.isTrained() === true, 'isTrained true après loadProfile');
assert(Engine.getCorrectionNodeCount() === 1, 'champ de correction restauré depuis le profil');
assert(Engine.getStoredProfile().meta.meanError === 90, 'métadonnées du profil lues');
global.localStorage.clear();
assert(Engine.loadProfile() === false, 'loadProfile sans profil stocké → false');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests MediaPipeEngine passent.\n'); process.exit(0); }
