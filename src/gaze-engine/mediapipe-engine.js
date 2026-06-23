/**
 * mediapipe-engine.js — Moteur de suivi du regard basé sur MediaPipe FaceLandmarker.
 *
 * Contrairement à WebGazer, MediaPipe ne fournit PAS un point de regard à l'écran :
 * il fournit 478 landmarks faciaux 3D (iris inclus) + une matrice de transformation
 * faciale 4×4. Ce module construit toute la chaîne :
 *
 *   webcam → FaceLandmarker → extraction de features (iris relatif + vrais angles de
 *   pose tête + termes polynomiaux) → STANDARDISATION (z-score) → régression ridge
 *   apprise à la calibration → champ de correction résiduelle (IDW/LOWESS) → écran
 *
 * Optimisations de précision/performance :
 *   [#1] Standardisation des features (moyenne/écart-type mémorisés) avant le ridge,
 *        pour que la régularisation L2 traite toutes les features équitablement.
 *   [#2] Vrais angles d'Euler (yaw/pitch/roll) extraits de la matrice de rotation
 *        par atan2 — et non des éléments bruts de la matrice.
 *   [#3] Filtrage qualité des échantillons de calibration (rejet des clignements,
 *        moyenne sur une fenêtre de frames autour du clic).
 *   [#4] Features polynomiales (rx², ry², rx·ry…) pour capturer la non-linéarité
 *        iris→écran sans changer le solveur linéaire.
 *   [#5] Champ de correction résiduelle (IDW + LOWESS) appris sur les points de
 *        validation, appliqué après la régression.
 *   [#6] Gating des frames sur video.currentTime : on n'infère pas deux fois la même
 *        frame webcam (économie GPU).
 *   [#7] Centre d'iris : moyenne des 5 points de l'anneau (468-472 / 473-477).
 *
 * API publique (interface "GazeEngine" commune) :
 *   init() start() stop() onGaze(cb) offGaze(cb)
 *   beginCalibrationSample(x,y) / recordCalibrationSample(x,y) trainFromSamples()
 *   clearCalibration() addValidationResidual(predX,predY,targetX,targetY)
 *   buildCorrectionField() saveProfile(meta) loadProfile() getStoredProfile()
 *   getStatus() getCurrentFeatures() getSampleCount() isTrained()
 *
 * Fonctions pures exposées pour les tests (MediaPipeEngine._math) :
 *   extractFeatures, buildPolyFeatures, eulerFromMatrix, standardize, applyStandardize,
 *   ridgeSolve, predictLinear, idwCorrect, lowessCorrect
 */

(function (global) {
  'use strict';

  // ─── Configuration ───────────────────────────────────────────────────────────
  const CONFIG = {
    WASM_ROOT:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    MODEL_URL:   'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    RIDGE_LAMBDA: 1e-2,        // régularisation L2 (sur features standardisées)
    NUM_FACES:    1,
    VIDEO_W:      640,
    VIDEO_H:      480,
    DELEGATE:     'GPU',       // 'GPU' ou 'CPU'
    // [#3] Qualité des échantillons de calibration
    SAMPLE_WINDOW_FRAMES: 8,   // frames moyennées autour du clic
    EYE_OPEN_MIN:         0.012,// ouverture min (proxy clignement, coords normalisées)
    SAMPLE_STD_MAX:       0.05, // dispersion max des features pendant la fenêtre
    // [#4] Features polynomiales
    POLY_ENABLED:         true,
    // [#5] Correction résiduelle
    CORRECTION_ENABLED:   true,
    LOWESS_BANDWIDTH:     0.45,
    STORAGE_KEY:          'mediapipe_calibration',
    // [#1bis] Warp 3D : projection des landmarks dans un repère frontal canonique
    WARP_3D_ENABLED:      true,
    // [#2bis] Profondeur : normalisation par l'échelle inter-oculaire
    DEPTH_FEATURE_ENABLED:true,
    // [#4bis] Ridge pondéré par la qualité des échantillons
    WEIGHTED_RIDGE_ENABLED:true,
    // [#5bis] Sélection automatique de λ par validation croisée k-fold
    AUTO_LAMBDA_ENABLED:  true,
    LAMBDA_GRID:          [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1],
    KFOLD:                5,
    // [#6bis] Blendshapes (eyeLook*) comme features de regard
    BLENDSHAPES_ENABLED:  true,
    // [#3bis] Apprentissage continu (online) à partir des clics réels en usage
    ONLINE_LEARNING_ENABLED: true,
    ONLINE_MAX_SAMPLES:   400,
    // [#8] Lissage temporel des landmarks bruts avant extraction
    LANDMARK_SMOOTHING_ENABLED: true,
    LANDMARK_SMOOTHING_ALPHA:   0.5, // 1 = aucun lissage, →0 = très lissé
  };

  // Landmarks MediaPipe FaceMesh (478 points). Iris : 468-472 (œil image gauche),
  // 473-477 (œil image droit).
  const LM = {
    leftIrisRing:  [468, 469, 470, 471, 472],
    rightIrisRing: [473, 474, 475, 476, 477],
    leftEyeOuter:  33,  leftEyeInner:  133,
    rightEyeOuter: 263, rightEyeInner: 362,
    leftEyeTop:    159, leftEyeBottom: 145,
    rightEyeTop:   386, rightEyeBottom:374,
    noseTip:        1,
  };

  // ─── État interne ────────────────────────────────────────────────────────────
  let _status       = 'idle';
  let _landmarker   = null;
  let _video        = null;
  let _stream       = null;
  let _rafId        = null;
  let _lastVideoTime = -1;          // [#6] gating des frames
  let _callbacks    = [];
  let _errorMsg     = null;
  let _lastFeatures = null;         // features brutes (pré-standardisation)
  let _weightsX     = null;
  let _weightsY     = null;
  let _standardizer = null;         // [#1] { mean:[], std:[] }
  let _lambda       = null;         // [#5bis] λ choisi par CV
  let _samples      = [];           // [{ features, weight, x, y }]
  let _recentFrames = [];           // [#3] fenêtre glissante de features récentes
  let _corrNodes    = [];           // [#5] [{ tx, ty, ex, ey }]
  let _smoothedLandmarks = null;    // [#8] EMA des landmarks bruts

  // ─── Helpers de base ──────────────────────────────────────────────────────────

  function _mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
  function _std(a) {
    if (a.length < 2) return 0;
    const m = _mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  }
  function _centroid(landmarks, indices) {
    let sx = 0, sy = 0, sz = 0;
    for (const i of indices) { sx += landmarks[i].x; sy += landmarks[i].y; sz += landmarks[i].z || 0; }
    const n = indices.length;
    return { x: sx / n, y: sy / n, z: sz / n };
  }

  // ─── [#2] Angles d'Euler depuis la matrice de transformation 4×4 ──────────────
  // MediaPipe fournit la matrice en colonne-major (16 nombres). Le bloc 3×3
  // supérieur-gauche est la rotation R. On extrait yaw (Y), pitch (X), roll (Z)
  // par la convention standard, en gérant le gimbal lock.
  function eulerFromMatrix(m) {
    if (!Array.isArray(m) || m.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
    // Colonne-major : R[row][col] = m[col*4 + row].
    const r10 = m[1];   // R[1][0]
    const r11 = m[5];   // R[1][1]
    const r12 = m[9];   // R[1][2]
    const r02 = m[8];   // R[0][2]
    const r22 = m[10];  // R[2][2]
    // Convention tête : R = Ry(yaw)·Rx(pitch)·Rz(roll), avec
    //   R[1][2] = -sin(pitch)
    //   R[0][2] =  sin(yaw)·cos(pitch),  R[2][2] = cos(yaw)·cos(pitch)
    //   R[1][0] =  cos(pitch)·sin(roll), R[1][1] = cos(pitch)·cos(roll)
    // d'où :
    //   pitch = asin(-R[1][2])
    //   yaw   = atan2(R[0][2], R[2][2])
    //   roll  = atan2(R[1][0], R[1][1])
    let yaw, pitch, roll;
    const sinPitch = Math.max(-1, Math.min(1, -r12));
    pitch = Math.asin(sinPitch);
    if (Math.abs(r12) < 0.99999) {
      yaw  = Math.atan2(r02, r22);
      roll = Math.atan2(r10, r11);
    } else {
      // Gimbal lock (cos(pitch)≈0) : roll indéterminé, on le fixe à 0.
      yaw  = Math.atan2(-r02, r22);
      roll = 0;
    }
    return { yaw, pitch, roll };
  }

  // ─── [#1bis] Warp 3D vers un repère frontal canonique ─────────────────────────
  // Idée : on annule la rotation de tête en appliquant Rᵀ (inverse d'une rotation)
  // aux landmarks centrés sur le visage. Le modèle « voit » alors toujours un visage
  // de face, ce qui stabilise fortement la relation iris→écran (approche des
  // eye-trackers : découpler la pose de la tête du regard).
  //
  // Extrait la rotation 3×3 (ligne-major) depuis la matrice colonne-major MediaPipe.
  function rotationFromMatrix(m) {
    if (!Array.isArray(m) || m.length < 16) return null;
    return [
      [m[0], m[4], m[8]],
      [m[1], m[5], m[9]],
      [m[2], m[6], m[10]],
    ];
  }

  // Applique Rᵀ à un vecteur 3D (Rᵀ = inverse pour une rotation orthonormale).
  function applyInverseRotation(R, v) {
    // (Rᵀ v)_i = Σ_j R[j][i] v[j]
    return [
      R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
      R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
      R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
    ];
  }

  // Renvoie une COPIE des landmarks projetés dans le repère frontal : on centre sur
  // le nez, on dé-tourne par Rᵀ, on re-centre. Si pas de matrice, renvoie l'entrée.
  function warpToFrontal(landmarks, transformMatrix) {
    const R = rotationFromMatrix(transformMatrix);
    if (!R) return landmarks;
    const c = landmarks[LM.noseTip];
    const out = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const v = [p.x - c.x, p.y - c.y, (p.z || 0) - (c.z || 0)];
      const w = applyInverseRotation(R, v);
      out[i] = { x: w[0] + c.x, y: w[1] + c.y, z: w[2] + (c.z || 0) };
    }
    return out;
  }

  // Échelle inter-oculaire (distance entre coins externes des yeux) — proxy de
  // profondeur : plus l'utilisateur est proche, plus elle est grande.
  function interOcularScale(landmarks) {
    const a = landmarks[LM.leftEyeOuter], b = landmarks[LM.rightEyeOuter];
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)) || 1e-6;
  }

  // ─── [#8] Lissage temporel des landmarks (EMA) ────────────────────────────────
  // Les landmarks MediaPipe sont bruités frame à frame ; une EMA légère avant
  // extraction réduit le bruit sans ajouter de lag perceptible. prev est l'état
  // lissé précédent (ou null). alpha ∈ ]0,1] : 1 = aucun lissage.
  function smoothLandmarks(prev, curr, alpha) {
    if (!prev || prev.length !== curr.length) {
      return curr.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
    }
    const out = new Array(curr.length);
    for (let i = 0; i < curr.length; i++) {
      out[i] = {
        x: alpha * curr[i].x + (1 - alpha) * prev[i].x,
        y: alpha * curr[i].y + (1 - alpha) * prev[i].y,
        z: alpha * (curr[i].z || 0) + (1 - alpha) * prev[i].z,
      };
    }
    return out;
  }

  // ─── [#4] Features polynomiales ────────────────────────────────────────────────
  // Étend un vecteur de base [gx, gy, ...] avec des termes quadratiques pour
  // capturer la courbure de la relation iris→écran (perspective, géométrie de l'œil).
  function buildPolyFeatures(gx, gy) {
    return [gx * gx, gy * gy, gx * gy, gx * gx * gy, gx * gy * gy];
  }

  // Extrait les blendshapes de regard (eyeLook*) si fournies par MediaPipe.
  // Retourne 8 valeurs ∈ [0,1] (4 directions × 2 yeux) ou des zéros.
  function blendshapeGazeFeatures(blendshapes) {
    const want = [
      'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
      'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight',
    ];
    const map = {};
    if (Array.isArray(blendshapes)) {
      for (const b of blendshapes) {
        if (b && b.categoryName != null) map[b.categoryName] = b.score;
      }
    }
    return want.map(k => (typeof map[k] === 'number' ? map[k] : 0));
  }

  // ─── Extraction du vecteur de features complet ────────────────────────────────
  // landmarks : tableau de {x,y,z}. transformMatrix : 16 nombres colonne-major.
  // blendshapes : tableau {categoryName, score} (optionnel).
  function extractFeatures(landmarks, transformMatrix, blendshapes) {
    if (!Array.isArray(landmarks) || landmarks.length < 478) return null;

    // [#1bis] Warp 3D : on extrait l'iris dans un repère frontal canonique pour
    // découpler la pose de tête du regard. On garde aussi les landmarks d'origine
    // pour l'échelle de profondeur (qui doit refléter la vraie distance).
    const lmW = CONFIG.WARP_3D_ENABLED ? warpToFrontal(landmarks, transformMatrix) : landmarks;

    const li = _centroid(lmW, LM.leftIrisRing);
    const ri = _centroid(lmW, LM.rightIrisRing);

    function eyeRel(src, iris, outer, inner, top, bottom) {
      const ox = src[outer].x, ix = src[inner].x;
      const ty = src[top].y,   by = src[bottom].y;
      const left = Math.min(ox, ix);
      const wx = Math.abs(ix - ox) || 1e-6;
      const hy = Math.abs(by - ty) || 1e-6;
      return {
        rx: (iris.x - left) / wx,
        ry: (iris.y - Math.min(ty, by)) / hy,
        open: Math.abs(by - ty),
      };
    }

    const l = eyeRel(lmW, li, LM.leftEyeOuter, LM.leftEyeInner, LM.leftEyeTop, LM.leftEyeBottom);
    const r = eyeRel(lmW, ri, LM.rightEyeOuter, LM.rightEyeInner, LM.rightEyeTop, LM.rightEyeBottom);

    const gx = (l.rx + r.rx) / 2;
    const gy = (l.ry + r.ry) / 2;

    // [#2] Vrais angles de pose ; repli sur translation du nez si pas de matrice.
    let yaw, pitch, roll;
    if (Array.isArray(transformMatrix) && transformMatrix.length >= 16) {
      const e = eulerFromMatrix(transformMatrix);
      yaw = e.yaw; pitch = e.pitch; roll = e.roll;
    } else {
      yaw   = landmarks[LM.noseTip].x - 0.5;
      pitch = landmarks[LM.noseTip].y - 0.5;
      roll  = landmarks[LM.noseTip].z || 0;
    }

    // [#2bis] Profondeur : échelle inter-oculaire sur les landmarks d'ORIGINE.
    const depth = CONFIG.DEPTH_FEATURE_ENABLED ? interOcularScale(landmarks) : 0;

    let feat = [
      l.rx, l.ry, r.rx, r.ry,      // iris relatif (repère frontal)
      gx, gy,                       // regard global
      yaw, pitch, roll,             // pose de tête
      yaw * gx, pitch * gy,         // termes croisés tête × regard
    ];

    if (CONFIG.DEPTH_FEATURE_ENABLED) {
      feat.push(depth, gx * depth, gy * depth); // profondeur + interactions
    }
    if (CONFIG.POLY_ENABLED) {
      feat = feat.concat(buildPolyFeatures(gx, gy));
    }
    if (CONFIG.BLENDSHAPES_ENABLED) {
      const bs = blendshapeGazeFeatures(blendshapes);
      feat = feat.concat(bs);
      // Direction de regard synthétique depuis les blendshapes (gauche-droite, haut-bas)
      const bsX = (bs[1] + bs[5]) - (bs[0] + bs[4]); // out - in
      const bsY = (bs[2] + bs[6]) - (bs[3] + bs[7]); // up - down
      feat.push(bsX, bsY);
    }

    feat._eyeOpen = (l.open + r.open) / 2;
    return feat;
  }

  // ─── [#1] Standardisation (z-score) ────────────────────────────────────────────
  // Calcule moyenne/écart-type par dimension sur la matrice d'entraînement.
  function standardize(X) {
    const n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0), std = new Array(d).fill(0);
    for (let j = 0; j < d; j++) {
      const col = X.map(r => r[j]);
      mean[j] = _mean(col);
      const s = _std(col);
      std[j] = s < 1e-9 ? 1 : s; // évite la division par 0 (feature constante)
    }
    return { mean, std };
  }
  function applyStandardize(features, stdz) {
    if (!stdz) return features.slice();
    const out = new Array(features.length);
    for (let j = 0; j < features.length; j++) out[j] = (features[j] - stdz.mean[j]) / stdz.std[j];
    return out;
  }

  // ─── Régression ridge pondérée (équations normales + Gauss-Jordan) ────────────
  // [#4bis] weights : poids par échantillon (qualité). Si omis → poids 1 (ridge std).
  //   w = (XᵀWX + λI)⁻¹ XᵀWy
  function ridgeSolveWeighted(X, y, lambda, weights) {
    if (!Array.isArray(X) || !X.length || !Array.isArray(y) || y.length !== X.length) return null;
    const n = X.length;
    const d = X[0].length;
    const p = d + 1; // biais

    const A = X.map(row => [1, ...row]);
    const M = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const ai = A[i];
      const wi = (weights && Number.isFinite(weights[i])) ? weights[i] : 1;
      const wy = wi * y[i];
      for (let j = 0; j < p; j++) {
        b[j] += ai[j] * wy;
        const wij = wi * ai[j];
        for (let k = 0; k < p; k++) M[j][k] += wij * ai[k];
      }
    }
    // Régularisation : on ne pénalise PAS le biais (j=0).
    for (let j = 1; j < p; j++) M[j][j] += lambda;
    return _solveLinearSystem(M, b);
  }

  // Ridge non pondéré (compatibilité / tests).
  function ridgeSolve(X, y, lambda) {
    return ridgeSolveWeighted(X, y, lambda, null);
  }

  // ─── [#5bis] Sélection de λ par validation croisée k-fold ─────────────────────
  // Teste chaque λ de la grille, mesure l'erreur quadratique moyenne hors-fold,
  // renvoie le λ minimisant l'erreur de généralisation. Entrées déjà standardisées.
  function selectLambdaCV(X, yx, yy, lambdaGrid, kfold, weights) {
    if (!X || X.length < 4 || !Array.isArray(lambdaGrid) || !lambdaGrid.length) {
      return lambdaGrid && lambdaGrid.length ? lambdaGrid[Math.floor(lambdaGrid.length / 2)] : 1e-2;
    }
    const n = X.length;
    const k = Math.max(2, Math.min(kfold || 5, n));
    // Indices répartis en k plis (round-robin pour homogénéité).
    const folds = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) folds[i % k].push(i);

    let bestLambda = lambdaGrid[0], bestErr = Infinity;
    for (const lambda of lambdaGrid) {
      let sse = 0, cnt = 0;
      for (let f = 0; f < k; f++) {
        const testIdx = new Set(folds[f]);
        const trX = [], trYx = [], trYy = [], trW = [];
        for (let i = 0; i < n; i++) {
          if (testIdx.has(i)) continue;
          trX.push(X[i]); trYx.push(yx[i]); trYy.push(yy[i]);
          trW.push(weights ? weights[i] : 1);
        }
        const wX = ridgeSolveWeighted(trX, trYx, lambda, trW);
        const wY = ridgeSolveWeighted(trX, trYy, lambda, trW);
        if (!wX || !wY) { sse = Infinity; break; }
        for (const i of folds[f]) {
          const px = predictLinear(wX, X[i]), py = predictLinear(wY, X[i]);
          sse += (px - yx[i]) ** 2 + (py - yy[i]) ** 2; cnt++;
        }
      }
      const err = cnt ? sse / cnt : Infinity;
      if (err < bestErr) { bestErr = err; bestLambda = lambda; }
    }
    return bestLambda;
  }

  function _solveLinearSystem(M, b) {
    const n = b.length;
    const A = M.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      }
      if (Math.abs(A[pivot][col]) < 1e-12) return null;
      [A[col], A[pivot]] = [A[pivot], A[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
      }
    }
    return A.map((row, i) => row[n] / row[i]);
  }

  function predictLinear(weights, features) {
    if (!Array.isArray(weights) || !Array.isArray(features)) return null;
    if (weights.length !== features.length + 1) return null;
    let acc = weights[0];
    for (let i = 0; i < features.length; i++) acc += weights[i + 1] * features[i];
    return acc;
  }

  // ─── [#5] Champ de correction résiduelle ──────────────────────────────────────
  // IDW global avec repli, et LOWESS tricubique local (le meilleur des deux selon
  // le support local, comme côté WebGazer — un seul estimateur, pas de cascade).
  function idwCorrect(x, y, nodes) {
    if (!nodes.length) return { x, y };
    const EPS = 1e-6;
    let sw = 0, sex = 0, sey = 0;
    for (const nd of nodes) {
      const w = 1 / ((x - nd.tx) ** 2 + (y - nd.ty) ** 2 + EPS);
      sw += w; sex += w * nd.ex; sey += w * nd.ey;
    }
    return { x: x - sex / sw, y: y - sey / sw };
  }
  function lowessCorrect(x, y, nodes, bandwidth) {
    if (!nodes.length) return { x, y };
    const EPS = 1e-6;
    const dists = nodes.map(nd => Math.sqrt((x - nd.tx) ** 2 + (y - nd.ty) ** 2));
    const h = Math.max(...dists, EPS) * (1 + bandwidth);
    let sw = 0, sex = 0, sey = 0;
    nodes.forEach((nd, i) => {
      const u = dists[i] / h;
      if (u >= 1) return;
      const w = Math.pow(1 - Math.pow(u, 3), 3);
      sw += w; sex += w * nd.ex; sey += w * nd.ey;
    });
    if (sw < EPS) return { x, y };
    return { x: x - sex / sw, y: y - sey / sw };
  }
  function _applyCorrection(x, y) {
    if (!CONFIG.CORRECTION_ENABLED || !_corrNodes.length) return { x, y };
    const lo = lowessCorrect(x, y, _corrNodes, CONFIG.LOWESS_BANDWIDTH);
    if (lo.x !== x || lo.y !== y) return lo;
    return idwCorrect(x, y, _corrNodes);
  }

  // ─── Prédiction écran complète ────────────────────────────────────────────────
  function _predictScreen(features) {
    if (!_weightsX || !_weightsY) return null;
    const z = applyStandardize(features, _standardizer);
    let x = predictLinear(_weightsX, z);
    let y = predictLinear(_weightsY, z);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const c = _applyCorrection(x, y);
    return { x: c.x, y: c.y };
  }

  // ─── Runtime MediaPipe (navigateur) ───────────────────────────────────────────
  function _setStatus(s) { _status = s; }
  function _emit(point) {
    for (let i = 0; i < _callbacks.length; i++) { try { _callbacks[i](point); } catch (_) {} }
  }

  async function _loadModel() {
    const vision = global.MediaPipeVision;
    if (!vision || !vision.FilesetResolver || !vision.FaceLandmarker) {
      throw new Error('MediaPipe tasks-vision non chargé. Incluez le bundle avant ce module.');
    }
    const fileset = await vision.FilesetResolver.forVisionTasks(CONFIG.WASM_ROOT);
    _landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: CONFIG.MODEL_URL, delegate: CONFIG.DELEGATE },
      runningMode: 'VIDEO',
      numFaces: CONFIG.NUM_FACES,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: CONFIG.BLENDSHAPES_ENABLED, // [#6bis]
    });
  }

  // Traite une frame : inférence MediaPipe → features → prédiction → émission.
  function _processFrame() {
    if (_status !== 'running' || !_landmarker || !_video) return;

    // [#6] N'inférer que sur une nouvelle frame webcam.
    if (_video.currentTime === _lastVideoTime) return;
    _lastVideoTime = _video.currentTime;

    const now = performance.now();
    let result = null;
    try { result = _landmarker.detectForVideo(_video, now); } catch (_) {}
    if (!result || !result.faceLandmarks || !result.faceLandmarks.length) return;

    let lms = result.faceLandmarks[0];
    const mtx = result.facialTransformationMatrixes &&
                result.facialTransformationMatrixes[0] &&
                result.facialTransformationMatrixes[0].data;
    const bs = result.faceBlendshapes &&
               result.faceBlendshapes[0] &&
               result.faceBlendshapes[0].categories;

    // [#8] Lissage temporel des landmarks bruts avant extraction.
    if (CONFIG.LANDMARK_SMOOTHING_ENABLED) {
      _smoothedLandmarks = smoothLandmarks(_smoothedLandmarks, lms, CONFIG.LANDMARK_SMOOTHING_ALPHA);
      lms = _smoothedLandmarks;
    }

    _lastFeatures = extractFeatures(lms, mtx ? Array.from(mtx) : null, bs || null);

    // [#3] Fenêtre glissante de features pour moyenner à la collecte.
    if (_lastFeatures) {
      _recentFrames.push(_lastFeatures);
      if (_recentFrames.length > CONFIG.SAMPLE_WINDOW_FRAMES) _recentFrames.shift();
    }

    const pred = _lastFeatures ? _predictScreen(_lastFeatures) : null;
    if (pred) {
      _emit({
        x: pred.x, y: pred.y, timestamp: Date.now(),
        confidence: _predictionConfidence(_lastFeatures, pred),
      });
    }
  }

  // Confiance de la prédiction MediaPipe ∈ [0,1] : combine l'ouverture des yeux
  // (yeux fermés → peu fiable) et la plausibilité à l'écran (un point hors viewport
  // signale une extrapolation hasardeuse).
  function _predictionConfidence(features, pred) {
    let conf = 1;
    const open = features && features._eyeOpen;
    if (typeof open === 'number') {
      conf *= Math.max(0, Math.min(1, open / (CONFIG.EYE_OPEN_MIN * 3)));
    }
    if (_video || (typeof window !== 'undefined')) {
      const W = (typeof window !== 'undefined' ? window.innerWidth : 1920);
      const H = (typeof window !== 'undefined' ? window.innerHeight : 1080);
      const inside = pred.x >= 0 && pred.x <= W && pred.y >= 0 && pred.y <= H;
      if (!inside) conf *= 0.5;
    }
    return +Math.max(0, Math.min(1, conf)).toFixed(4);
  }

  // [#7] Boucle de cadencement. requestVideoFrameCallback se déclenche exactement
  // quand une NOUVELLE frame vidéo est disponible (synchronisé à la cadence réelle
  // de la webcam, sans inférence redondante et sans bloquer le rAF de l'UI). Repli
  // sur requestAnimationFrame si l'API n'est pas supportée.
  function _scheduleNext() {
    if (_status !== 'running' || !_video) return;
    if (typeof _video.requestVideoFrameCallback === 'function') {
      _rafId = _video.requestVideoFrameCallback(_loop);
    } else {
      _rafId = global.requestAnimationFrame(_loop);
    }
  }
  function _loop() {
    if (_status !== 'running' || !_landmarker || !_video) return;
    _processFrame();
    _scheduleNext();
  }

  // ─── [#3] Collecte d'un échantillon de calibration filtré ─────────────────────
  // Moyenne les features de la fenêtre récente, rejette si l'œil est trop fermé
  // (clignement) ou si la dispersion est trop forte (regard instable / saccade).
  function _collectFilteredSample() {
    const frames = _recentFrames.filter(f => f && f._eyeOpen >= CONFIG.EYE_OPEN_MIN);
    if (frames.length < Math.ceil(CONFIG.SAMPLE_WINDOW_FRAMES / 2)) return null;

    const d = frames[0].length;
    const avg = new Array(d).fill(0);
    for (const f of frames) for (let j = 0; j < d; j++) avg[j] += f[j];
    for (let j = 0; j < d; j++) avg[j] /= frames.length;

    // Dispersion : écart-type moyen des 6 premières features (iris + regard).
    let dispSum = 0, dispN = 0;
    for (let j = 0; j < Math.min(6, d); j++) {
      dispSum += _std(frames.map(f => f[j])); dispN++;
    }
    const disp = dispN ? dispSum / dispN : 0;
    if (disp > CONFIG.SAMPLE_STD_MAX) return null; // trop instable

    // [#4bis] Poids qualité de l'échantillon : élevé si yeux bien ouverts et regard
    // stable (faible dispersion). Borné dans [0.1, 1].
    const openMean = _mean(frames.map(f => f._eyeOpen));
    const openScore = Math.min(1, openMean / (CONFIG.EYE_OPEN_MIN * 3));
    const stabScore = 1 - Math.min(1, disp / CONFIG.SAMPLE_STD_MAX);
    const weight = Math.max(0.1, Math.min(1, 0.5 * openScore + 0.5 * stabScore));
    return { features: avg, weight };
  }

  const MediaPipeEngine = {
    name: 'mediapipe',

    async init() {
      if (_status === 'ready' || _status === 'running') return;
      _setStatus('loading');
      try { await _loadModel(); _setStatus('ready'); }
      catch (err) { _errorMsg = err.message; _setStatus('error'); throw err; }
    },

    async start() {
      if (_status === 'running') return;
      if (_status !== 'ready') await this.init();
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CONFIG.VIDEO_W, height: CONFIG.VIDEO_H, facingMode: 'user' },
        });
        _video = document.getElementById('mp-video') || document.createElement('video');
        _video.id = 'mp-video';
        _video.autoplay = true; _video.playsInline = true; _video.muted = true;
        _video.srcObject = _stream;
        await _video.play();
        _lastVideoTime = -1;
        _smoothedLandmarks = null;
        _setStatus('running');
        _scheduleNext();
      } catch (err) { _errorMsg = err.message; _setStatus('error'); throw err; }
    },

    stop() {
      if (_rafId != null) {
        if (_video && typeof _video.cancelVideoFrameCallback === 'function') {
          try { _video.cancelVideoFrameCallback(_rafId); } catch (_) {}
        } else {
          try { global.cancelAnimationFrame(_rafId); } catch (_) {}
        }
        _rafId = null;
      }
      if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
      _setStatus('ready');
    },

    onGaze(cb) { if (typeof cb === 'function' && !_callbacks.includes(cb)) _callbacks.push(cb); },
    offGaze(cb) { _callbacks = _callbacks.filter(c => c !== cb); },

    // Enregistre un échantillon de calibration filtré (moyenné, anti-clignement).
    // Retourne false si la qualité est insuffisante → l'UI peut demander un re-clic.
    recordCalibrationSample(x, y) {
      const s = _collectFilteredSample();
      if (!s) return false;
      _samples.push({ features: s.features, weight: s.weight, x, y });
      return true;
    },

    // Résout la régression ridge sur features STANDARDISÉES, pondérée par la qualité
    // des échantillons [#4bis], avec λ choisi par validation croisée [#5bis].
    trainFromSamples() {
      if (_samples.length < 8) return false;
      const X = _samples.map(s => s.features);
      _standardizer = standardize(X);
      const Z = X.map(f => applyStandardize(f, _standardizer));
      const yx = _samples.map(s => s.x);
      const yy = _samples.map(s => s.y);
      const w  = CONFIG.WEIGHTED_RIDGE_ENABLED ? _samples.map(s => s.weight) : null;

      _lambda = CONFIG.AUTO_LAMBDA_ENABLED
        ? selectLambdaCV(Z, yx, yy, CONFIG.LAMBDA_GRID, CONFIG.KFOLD, w)
        : CONFIG.RIDGE_LAMBDA;

      _weightsX = ridgeSolveWeighted(Z, yx, _lambda, w);
      _weightsY = ridgeSolveWeighted(Z, yy, _lambda, w);
      return !!(_weightsX && _weightsY);
    },

    // [#3bis] Apprentissage continu : ajoute un échantillon réel (clic utilisateur
    // pendant l'usage) et ré-entraîne le modèle. Permet de corriger la dérive sans
    // recalibration explicite.
    addOnlineSample(x, y) {
      if (!CONFIG.ONLINE_LEARNING_ENABLED) return false;
      const s = _collectFilteredSample();
      if (!s) return false;
      _samples.push({ features: s.features, weight: s.weight, x, y, online: true });
      // Borne la taille pour garder le coût d'entraînement constant.
      if (_samples.length > CONFIG.ONLINE_MAX_SAMPLES) _samples.shift();
      return this.trainFromSamples();
    },

    getLambda() { return _lambda; },

    clearCalibration() {
      _samples = []; _weightsX = null; _weightsY = null; _standardizer = null;
      _lambda = null; _corrNodes = []; _recentFrames = []; _smoothedLandmarks = null;
    },

    // [#5] Construction du champ de correction résiduelle à partir des résidus de
    // validation. À appeler pour chaque point de validation mesuré.
    addValidationResidual(predX, predY, targetX, targetY) {
      _corrNodes.push({ tx: targetX, ty: targetY, ex: predX - targetX, ey: predY - targetY });
    },
    clearCorrectionField() { _corrNodes = []; },
    getCorrectionNodeCount() { return _corrNodes.length; },

    // Prédiction écran depuis des features (exposée pour la validation côté page).
    predictFromFeatures(features) { return _predictScreen(features); },

    // ── Persistance du profil ───────────────────────────────────────────────────
    STORAGE_KEY: CONFIG.STORAGE_KEY,
    saveProfile(meta) {
      if (!_weightsX || !_weightsY) return false;
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          timestamp:   new Date().toISOString(),
          featureDim:  _weightsX.length - 1,
          weightsX:    _weightsX,
          weightsY:    _weightsY,
          standardizer:_standardizer,
          lambda:      _lambda,
          corrNodes:   _corrNodes,
          sampleCount: _samples.length,
          meta:        meta || null,
        }));
        return true;
      } catch (_) { return false; }
    },
    loadProfile() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return false;
        const d = JSON.parse(raw);
        if (Array.isArray(d.weightsX) && Array.isArray(d.weightsY)) {
          _weightsX = d.weightsX; _weightsY = d.weightsY;
          _standardizer = d.standardizer || null;
          _lambda = typeof d.lambda === 'number' ? d.lambda : null;
          _corrNodes = Array.isArray(d.corrNodes) ? d.corrNodes : [];
          return true;
        }
      } catch (_) {}
      return false;
    },
    getStoredProfile() {
      try { const raw = localStorage.getItem(this.STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
      catch (_) { return null; }
    },

    getStatus() { return _status; },
    getErrorMessage() { return _errorMsg; },
    getCurrentFeatures() { return _lastFeatures ? _lastFeatures.slice() : null; },
    // Un visage est-il actuellement détecté ? (features produites récemment)
    isFaceDetected() { return !!_lastFeatures; },
    // Échelle inter-oculaire courante (proxy de distance). null si pas de visage.
    getFaceScale() {
      if (!_smoothedLandmarks && !_lastFeatures) return null;
      try {
        return _smoothedLandmarks ? interOcularScale(_smoothedLandmarks) : null;
      } catch (_) { return null; }
    },
    getSampleCount() { return _samples.length; },
    isTrained() { return !!(_weightsX && _weightsY); },

    CONFIG,
    _math: {
      extractFeatures, buildPolyFeatures, eulerFromMatrix,
      rotationFromMatrix, applyInverseRotation, warpToFrontal, interOcularScale,
      smoothLandmarks, blendshapeGazeFeatures,
      standardize, applyStandardize,
      ridgeSolve, ridgeSolveWeighted, selectLambdaCV, predictLinear,
      idwCorrect, lowessCorrect, _solveLinearSystem, _centroid,
    },
  };

  global.MediaPipeEngine = MediaPipeEngine;

})(typeof window !== 'undefined' ? window : global);
