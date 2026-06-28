/**
 * mediapipe-engine.js
 *
 * Moteur de suivi du regard basé sur MediaPipe FaceLandmarker. Contrairement à
 * WebGazer, MediaPipe ne fournit pas un point de regard à l'écran : il fournit
 * 478 landmarks faciaux 3D (iris inclus) et une matrice de transformation faciale
 * 4×4. Ce module construit toute la chaîne de traitement :
 *
 *   webcam → FaceLandmarker → extraction de features (iris relatif, vrais angles
 *   de pose de tête, termes polynomiaux) → standardisation (z-score) → régression
 *   ridge apprise à la calibration → champ de correction résiduelle (IDW/LOWESS)
 *   → coordonnées écran.
 *
 * Choix de précision et de performance :
 *   - Standardisation des features avant le ridge, pour que la régularisation L2
 *     traite toutes les features équitablement.
 *   - Vrais angles d'Euler (yaw/pitch/roll) extraits de la matrice de rotation.
 *   - Filtrage qualité des échantillons de calibration (rejet des clignements,
 *     moyenne sur une fenêtre de frames autour du clic).
 *   - Features polynomiales pour capturer la non-linéarité iris→écran.
 *   - Champ de correction résiduelle (IDW + LOWESS) appris sur la validation.
 *   - Gating des frames sur video.currentTime pour ne pas inférer deux fois la
 *     même frame.
 *   - Warp 3D des landmarks dans un repère frontal pour découpler la pose du regard.
 *   - Normalisation de profondeur par l'échelle inter-oculaire.
 *   - Ridge pondéré par la qualité des échantillons et sélection de λ par
 *     validation croisée k-fold.
 *   - Blendshapes (eyeLook*) comme features de regard.
 *   - Apprentissage continu à partir des clics réels en usage.
 *   - Lissage temporel (EMA) des landmarks bruts avant extraction.
 *
 * API publique (interface "GazeEngine" commune) :
 *   init() start() stop() onGaze(cb) offGaze(cb)
 *   recordCalibrationSample(x,y) recordPursuitSample(x,y) trainFromSamples()
 *   addOnlineSample(x,y) clearCalibration() addValidationResidual(...)
 *   predictFromFeatures(f) saveProfile(meta) loadProfile() getStoredProfile()
 *   getStatus() getCurrentFeatures() getSampleCount() isTrained()
 *
 * Fonctions pures exposées pour les tests (MediaPipeEngine._math) :
 *   extractFeatures, buildPolyFeatures, eulerFromMatrix, standardize,
 *   applyStandardize, ridgeSolve, predictLinear, idwCorrect, lowessCorrect, …
 */

(function (global) {
  'use strict';

  const CONFIG = {
    WASM_ROOT:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    MODEL_URL:   'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    RIDGE_LAMBDA: 1e-2,
    NUM_FACES:    1,
    VIDEO_W:      640,
    VIDEO_H:      480,
    DELEGATE:     'GPU',
    SAMPLE_WINDOW_FRAMES: 8,
    EYE_OPEN_MIN:         0.012,
    SAMPLE_STD_MAX:       0.05,
    POLY_ENABLED:         true,
    CORRECTION_ENABLED:   true,
    LOWESS_BANDWIDTH:     0.45,
    STORAGE_KEY:          'mediapipe_calibration',
    WARP_3D_ENABLED:      true,
    DEPTH_FEATURE_ENABLED: true,
    WEIGHTED_RIDGE_ENABLED: true,
    AUTO_LAMBDA_ENABLED:  true,
    LAMBDA_GRID:          [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1],
    KFOLD:                5,
    BLENDSHAPES_ENABLED:  true,
    ONLINE_LEARNING_ENABLED: true,
    ONLINE_MAX_SAMPLES:   400,
    LANDMARK_SMOOTHING_ENABLED: true,
    LANDMARK_SMOOTHING_ALPHA:   0.5,
  };

  const LM = {
    leftIrisRing:  [468, 469, 470, 471, 472],
    rightIrisRing: [473, 474, 475, 476, 477],
    leftEyeOuter:  33,  leftEyeInner:  133,
    rightEyeOuter: 263, rightEyeInner: 362,
    leftEyeTop:    159, leftEyeBottom: 145,
    rightEyeTop:   386, rightEyeBottom:374,
    noseTip:        1,
  };

  let _status       = 'idle';
  let _landmarker   = null;
  let _video        = null;
  let _stream       = null;
  let _rafId        = null;
  let _lastVideoTime = -1;
  let _callbacks    = [];
  let _errorMsg     = null;
  let _lastFeatures = null;
  let _weightsX     = null;
  let _weightsY     = null;
  let _standardizer = null;
  let _lambda       = null;
  let _samples      = [];
  let _recentFrames = [];
  let _corrNodes    = [];
  let _smoothedLandmarks = null;

  function _mean(values) {
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function _std(values) {
    if (values.length < 2) {
      return 0;
    }
    const m = _mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
  }

  function _centroid(landmarks, indices) {
    let sx = 0, sy = 0, sz = 0;
    for (const i of indices) {
      sx += landmarks[i].x;
      sy += landmarks[i].y;
      sz += landmarks[i].z || 0;
    }
    const n = indices.length;
    return { x: sx / n, y: sy / n, z: sz / n };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function viewportWidth() {
    if (typeof window === 'undefined') {
      return 1920;
    }
    return window.innerWidth;
  }

  function viewportHeight() {
    if (typeof window === 'undefined') {
      return 1080;
    }
    return window.innerHeight;
  }

  // MediaPipe fournit la matrice en colonne-major (16 nombres). Le bloc 3×3
  // supérieur-gauche est la rotation R, dont on extrait yaw/pitch/roll en gérant
  // le gimbal lock.
  function eulerFromMatrix(m) {
    if (!Array.isArray(m) || m.length < 16) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }
    const r10 = m[1];
    const r11 = m[5];
    const r12 = m[9];
    const r02 = m[8];
    const r22 = m[10];

    const sinPitch = clamp(-r12, -1, 1);
    const pitch = Math.asin(sinPitch);

    if (Math.abs(r12) < 0.99999) {
      return { yaw: Math.atan2(r02, r22), pitch, roll: Math.atan2(r10, r11) };
    }
    return { yaw: Math.atan2(-r02, r22), pitch, roll: 0 };
  }

  function rotationFromMatrix(m) {
    if (!Array.isArray(m) || m.length < 16) {
      return null;
    }
    return [
      [m[0], m[4], m[8]],
      [m[1], m[5], m[9]],
      [m[2], m[6], m[10]],
    ];
  }

  function applyInverseRotation(R, v) {
    return [
      R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
      R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
      R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
    ];
  }

  // Projette les landmarks dans un repère frontal : on centre sur le nez, on
  // annule la rotation de tête par Rᵀ, puis on re-centre.
  function warpToFrontal(landmarks, transformMatrix) {
    const R = rotationFromMatrix(transformMatrix);
    if (!R) {
      return landmarks;
    }
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

  function interOcularScale(landmarks) {
    const a = landmarks[LM.leftEyeOuter];
    const b = landmarks[LM.rightEyeOuter];
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)) || 1e-6;
  }

  function copyLandmarks(landmarks) {
    return landmarks.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
  }

  // EMA légère sur les landmarks bruts : réduit le bruit frame à frame sans lag
  // perceptible. alpha ∈ ]0,1], 1 = aucun lissage.
  function smoothLandmarks(prev, curr, alpha) {
    if (!prev || prev.length !== curr.length) {
      return copyLandmarks(curr);
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

  function buildPolyFeatures(gx, gy) {
    return [gx * gx, gy * gy, gx * gy, gx * gx * gy, gx * gy * gy];
  }

  function blendshapeScore(map, key) {
    if (typeof map[key] === 'number') {
      return map[key];
    }
    return 0;
  }

  function blendshapeGazeFeatures(blendshapes) {
    const want = [
      'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
      'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight',
    ];
    const map = {};
    if (Array.isArray(blendshapes)) {
      for (const b of blendshapes) {
        if (b && b.categoryName != null) {
          map[b.categoryName] = b.score;
        }
      }
    }
    return want.map(key => blendshapeScore(map, key));
  }

  function eyeRelative(src, iris, outer, inner, top, bottom) {
    const ox = src[outer].x;
    const ix = src[inner].x;
    const ty = src[top].y;
    const by = src[bottom].y;
    const left = Math.min(ox, ix);
    const wx = Math.abs(ix - ox) || 1e-6;
    const hy = Math.abs(by - ty) || 1e-6;
    return {
      rx: (iris.x - left) / wx,
      ry: (iris.y - Math.min(ty, by)) / hy,
      open: Math.abs(by - ty),
    };
  }

  function headPose(landmarks, transformMatrix) {
    if (Array.isArray(transformMatrix) && transformMatrix.length >= 16) {
      return eulerFromMatrix(transformMatrix);
    }
    return {
      yaw:   landmarks[LM.noseTip].x - 0.5,
      pitch: landmarks[LM.noseTip].y - 0.5,
      roll:  landmarks[LM.noseTip].z || 0,
    };
  }

  function warpedLandmarks(landmarks, transformMatrix) {
    if (CONFIG.WARP_3D_ENABLED) {
      return warpToFrontal(landmarks, transformMatrix);
    }
    return landmarks;
  }

  function depthScale(landmarks) {
    if (CONFIG.DEPTH_FEATURE_ENABLED) {
      return interOcularScale(landmarks);
    }
    return 0;
  }

  function extractFeatures(landmarks, transformMatrix, blendshapes) {
    if (!Array.isArray(landmarks) || landmarks.length < 478) {
      return null;
    }

    const lmW = warpedLandmarks(landmarks, transformMatrix);
    const li = _centroid(lmW, LM.leftIrisRing);
    const ri = _centroid(lmW, LM.rightIrisRing);

    const l = eyeRelative(lmW, li, LM.leftEyeOuter, LM.leftEyeInner, LM.leftEyeTop, LM.leftEyeBottom);
    const r = eyeRelative(lmW, ri, LM.rightEyeOuter, LM.rightEyeInner, LM.rightEyeTop, LM.rightEyeBottom);

    const gx = (l.rx + r.rx) / 2;
    const gy = (l.ry + r.ry) / 2;

    const pose = headPose(landmarks, transformMatrix);
    const depth = depthScale(landmarks);

    let feat = [
      l.rx, l.ry, r.rx, r.ry,
      gx, gy,
      pose.yaw, pose.pitch, pose.roll,
      pose.yaw * gx, pose.pitch * gy,
    ];

    if (CONFIG.DEPTH_FEATURE_ENABLED) {
      feat.push(depth, gx * depth, gy * depth);
    }
    if (CONFIG.POLY_ENABLED) {
      feat = feat.concat(buildPolyFeatures(gx, gy));
    }
    if (CONFIG.BLENDSHAPES_ENABLED) {
      const bs = blendshapeGazeFeatures(blendshapes);
      feat = feat.concat(bs);
      const bsX = (bs[1] + bs[5]) - (bs[0] + bs[4]);
      const bsY = (bs[2] + bs[6]) - (bs[3] + bs[7]);
      feat.push(bsX, bsY);
    }

    feat._eyeOpen = (l.open + r.open) / 2;
    return feat;
  }

  function safeStd(value) {
    if (value < 1e-9) {
      return 1;
    }
    return value;
  }

  function standardize(X) {
    const d = X[0].length;
    const mean = new Array(d).fill(0);
    const std = new Array(d).fill(0);
    for (let j = 0; j < d; j++) {
      const col = X.map(row => row[j]);
      mean[j] = _mean(col);
      std[j] = safeStd(_std(col));
    }
    return { mean, std };
  }

  function applyStandardize(features, stdz) {
    if (!stdz) {
      return features.slice();
    }
    const out = new Array(features.length);
    for (let j = 0; j < features.length; j++) {
      out[j] = (features[j] - stdz.mean[j]) / stdz.std[j];
    }
    return out;
  }

  function sampleWeight(weights, i) {
    if (weights && Number.isFinite(weights[i])) {
      return weights[i];
    }
    return 1;
  }

  //   w = (XᵀWX + λI)⁻¹ XᵀWy — la régularisation ne pénalise pas le biais.
  function ridgeSolveWeighted(X, y, lambda, weights) {
    if (!Array.isArray(X) || !X.length || !Array.isArray(y) || y.length !== X.length) {
      return null;
    }
    const n = X.length;
    const d = X[0].length;
    const p = d + 1;

    const A = X.map(row => [1, ...row]);
    const M = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const ai = A[i];
      const wi = sampleWeight(weights, i);
      const wy = wi * y[i];
      for (let j = 0; j < p; j++) {
        b[j] += ai[j] * wy;
        const wij = wi * ai[j];
        for (let k = 0; k < p; k++) {
          M[j][k] += wij * ai[k];
        }
      }
    }
    for (let j = 1; j < p; j++) {
      M[j][j] += lambda;
    }
    return _solveLinearSystem(M, b);
  }

  function ridgeSolve(X, y, lambda) {
    return ridgeSolveWeighted(X, y, lambda, null);
  }

  function defaultLambda(lambdaGrid) {
    if (lambdaGrid && lambdaGrid.length) {
      return lambdaGrid[Math.floor(lambdaGrid.length / 2)];
    }
    return 1e-2;
  }

  // Validation croisée k-fold : renvoie le λ minimisant l'erreur hors-fold.
  function selectLambdaCV(X, yx, yy, lambdaGrid, kfold, weights) {
    if (!X || X.length < 4 || !Array.isArray(lambdaGrid) || !lambdaGrid.length) {
      return defaultLambda(lambdaGrid);
    }
    const n = X.length;
    const k = Math.max(2, Math.min(kfold || 5, n));
    const folds = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) {
      folds[i % k].push(i);
    }

    let bestLambda = lambdaGrid[0];
    let bestErr = Infinity;
    for (const lambda of lambdaGrid) {
      const err = foldError(X, yx, yy, folds, k, lambda, weights);
      if (err < bestErr) {
        bestErr = err;
        bestLambda = lambda;
      }
    }
    return bestLambda;
  }

  function foldError(X, yx, yy, folds, k, lambda, weights) {
    const n = X.length;
    let sse = 0;
    let cnt = 0;
    for (let f = 0; f < k; f++) {
      const testIdx = new Set(folds[f]);
      const trX = [], trYx = [], trYy = [], trW = [];
      for (let i = 0; i < n; i++) {
        if (testIdx.has(i)) {
          continue;
        }
        trX.push(X[i]);
        trYx.push(yx[i]);
        trYy.push(yy[i]);
        trW.push(sampleWeight(weights, i));
      }
      const wX = ridgeSolveWeighted(trX, trYx, lambda, trW);
      const wY = ridgeSolveWeighted(trX, trYy, lambda, trW);
      if (!wX || !wY) {
        return Infinity;
      }
      for (const i of folds[f]) {
        const px = predictLinear(wX, X[i]);
        const py = predictLinear(wY, X[i]);
        sse += (px - yx[i]) ** 2 + (py - yy[i]) ** 2;
        cnt++;
      }
    }
    if (!cnt) {
      return Infinity;
    }
    return sse / cnt;
  }

  function _solveLinearSystem(M, b) {
    const n = b.length;
    const A = M.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) {
          pivot = r;
        }
      }
      if (Math.abs(A[pivot][col]) < 1e-12) {
        return null;
      }
      [A[col], A[pivot]] = [A[pivot], A[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) {
          continue;
        }
        const factor = A[r][col] / A[col][col];
        for (let c = col; c <= n; c++) {
          A[r][c] -= factor * A[col][c];
        }
      }
    }
    return A.map((row, i) => row[n] / row[i]);
  }

  function predictLinear(weights, features) {
    if (!Array.isArray(weights) || !Array.isArray(features)) {
      return null;
    }
    if (weights.length !== features.length + 1) {
      return null;
    }
    let acc = weights[0];
    for (let i = 0; i < features.length; i++) {
      acc += weights[i + 1] * features[i];
    }
    return acc;
  }

  function idwCorrect(x, y, nodes) {
    if (!nodes.length) {
      return { x, y };
    }
    const EPS = 1e-6;
    let sw = 0, sex = 0, sey = 0;
    for (const nd of nodes) {
      const w = 1 / ((x - nd.tx) ** 2 + (y - nd.ty) ** 2 + EPS);
      sw += w;
      sex += w * nd.ex;
      sey += w * nd.ey;
    }
    return { x: x - sex / sw, y: y - sey / sw };
  }

  function lowessCorrect(x, y, nodes, bandwidth) {
    if (!nodes.length) {
      return { x, y };
    }
    const EPS = 1e-6;
    const dists = nodes.map(nd => Math.sqrt((x - nd.tx) ** 2 + (y - nd.ty) ** 2));
    const h = Math.max(...dists, EPS) * (1 + bandwidth);
    let sw = 0, sex = 0, sey = 0;
    nodes.forEach((nd, i) => {
      const u = dists[i] / h;
      if (u >= 1) {
        return;
      }
      const w = Math.pow(1 - Math.pow(u, 3), 3);
      sw += w;
      sex += w * nd.ex;
      sey += w * nd.ey;
    });
    if (sw < EPS) {
      return { x, y };
    }
    return { x: x - sex / sw, y: y - sey / sw };
  }

  function _applyCorrection(x, y) {
    if (!CONFIG.CORRECTION_ENABLED || !_corrNodes.length) {
      return { x, y };
    }
    const lo = lowessCorrect(x, y, _corrNodes, CONFIG.LOWESS_BANDWIDTH);
    if (lo.x !== x || lo.y !== y) {
      return lo;
    }
    return idwCorrect(x, y, _corrNodes);
  }

  function _predictScreen(features) {
    if (!_weightsX || !_weightsY) {
      return null;
    }
    const z = applyStandardize(features, _standardizer);
    const x = predictLinear(_weightsX, z);
    const y = predictLinear(_weightsY, z);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return _applyCorrection(x, y);
  }

  function _setStatus(s) {
    _status = s;
  }

  function _emit(point) {
    for (let i = 0; i < _callbacks.length; i++) {
      try {
        _callbacks[i](point);
      } catch (_) {}
    }
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
      outputFaceBlendshapes: CONFIG.BLENDSHAPES_ENABLED,
    });
  }

  function firstMatrix(result) {
    if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[0]) {
      return result.facialTransformationMatrixes[0].data;
    }
    return null;
  }

  function firstBlendshapes(result) {
    if (result.faceBlendshapes && result.faceBlendshapes[0]) {
      return result.faceBlendshapes[0].categories;
    }
    return null;
  }

  function matrixArray(mtx) {
    if (mtx) {
      return Array.from(mtx);
    }
    return null;
  }

  function _processFrame() {
    if (_status !== 'running' || !_landmarker || !_video) {
      return;
    }
    if (_video.currentTime === _lastVideoTime) {
      return;
    }
    _lastVideoTime = _video.currentTime;

    const now = performance.now();
    let result = null;
    try {
      result = _landmarker.detectForVideo(_video, now);
    } catch (_) {}
    if (!result || !result.faceLandmarks || !result.faceLandmarks.length) {
      return;
    }

    let lms = result.faceLandmarks[0];
    const mtx = firstMatrix(result);
    const bs = firstBlendshapes(result);

    if (CONFIG.LANDMARK_SMOOTHING_ENABLED) {
      _smoothedLandmarks = smoothLandmarks(_smoothedLandmarks, lms, CONFIG.LANDMARK_SMOOTHING_ALPHA);
      lms = _smoothedLandmarks;
    }

    _lastFeatures = extractFeatures(lms, matrixArray(mtx), bs);

    if (_lastFeatures) {
      _recentFrames.push(_lastFeatures);
      if (_recentFrames.length > CONFIG.SAMPLE_WINDOW_FRAMES) {
        _recentFrames.shift();
      }
    }

    if (!_lastFeatures) {
      return;
    }
    const pred = _predictScreen(_lastFeatures);
    if (pred) {
      _emit({
        x: pred.x,
        y: pred.y,
        timestamp: Date.now(),
        confidence: _predictionConfidence(_lastFeatures, pred),
      });
    }
  }

  // Confiance ∈ [0,1] : combine l'ouverture des yeux et la plausibilité du point
  // à l'écran (un point hors viewport signale une extrapolation hasardeuse).
  function _predictionConfidence(features, pred) {
    let conf = 1;
    const open = features && features._eyeOpen;
    if (typeof open === 'number') {
      conf *= clamp(open / (CONFIG.EYE_OPEN_MIN * 3), 0, 1);
    }
    const W = viewportWidth();
    const H = viewportHeight();
    const inside = pred.x >= 0 && pred.x <= W && pred.y >= 0 && pred.y <= H;
    if (!inside) {
      conf *= 0.5;
    }
    return +clamp(conf, 0, 1).toFixed(4);
  }

  // requestVideoFrameCallback se déclenche à chaque nouvelle frame webcam ; repli
  // sur requestAnimationFrame si l'API n'est pas supportée.
  function _scheduleNext() {
    if (_status !== 'running' || !_video) {
      return;
    }
    if (typeof _video.requestVideoFrameCallback === 'function') {
      _rafId = _video.requestVideoFrameCallback(_loop);
    } else {
      _rafId = global.requestAnimationFrame(_loop);
    }
  }

  function _loop() {
    if (_status !== 'running' || !_landmarker || !_video) {
      return;
    }
    _processFrame();
    _scheduleNext();
  }

  function frameDispersion(frames, d) {
    let dispSum = 0;
    let dispN = 0;
    for (let j = 0; j < Math.min(6, d); j++) {
      dispSum += _std(frames.map(f => f[j]));
      dispN++;
    }
    if (!dispN) {
      return 0;
    }
    return dispSum / dispN;
  }

  // Moyenne les features de la fenêtre récente, rejette les clignements et les
  // regards instables, et renvoie un poids qualité borné dans [0.1, 1].
  function _collectFilteredSample() {
    const frames = _recentFrames.filter(f => f && f._eyeOpen >= CONFIG.EYE_OPEN_MIN);
    if (frames.length < Math.ceil(CONFIG.SAMPLE_WINDOW_FRAMES / 2)) {
      return null;
    }

    const d = frames[0].length;
    const avg = new Array(d).fill(0);
    for (const f of frames) {
      for (let j = 0; j < d; j++) {
        avg[j] += f[j];
      }
    }
    for (let j = 0; j < d; j++) {
      avg[j] /= frames.length;
    }

    const disp = frameDispersion(frames, d);
    if (disp > CONFIG.SAMPLE_STD_MAX) {
      return null;
    }

    const openMean = _mean(frames.map(f => f._eyeOpen));
    const openScore = Math.min(1, openMean / (CONFIG.EYE_OPEN_MIN * 3));
    const stabScore = 1 - Math.min(1, disp / CONFIG.SAMPLE_STD_MAX);
    const weight = clamp(0.5 * openScore + 0.5 * stabScore, 0.1, 1);
    return { features: avg, weight };
  }

  function weightVector() {
    if (CONFIG.WEIGHTED_RIDGE_ENABLED) {
      return _samples.map(s => s.weight);
    }
    return null;
  }

  function chosenLambda(Z, yx, yy, weights) {
    if (CONFIG.AUTO_LAMBDA_ENABLED) {
      return selectLambdaCV(Z, yx, yy, CONFIG.LAMBDA_GRID, CONFIG.KFOLD, weights);
    }
    return CONFIG.RIDGE_LAMBDA;
  }

  function storedLambda(value) {
    if (typeof value === 'number') {
      return value;
    }
    return null;
  }

  function storedCorrNodes(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  }

  const MediaPipeEngine = {
    name: 'mediapipe',

    async init() {
      if (_status === 'ready' || _status === 'running') {
        return;
      }
      _setStatus('loading');
      try {
        await _loadModel();
        _setStatus('ready');
      } catch (err) {
        _errorMsg = err.message;
        _setStatus('error');
        throw err;
      }
    },

    async start() {
      if (_status === 'running') {
        return;
      }
      if (_status !== 'ready') {
        await this.init();
      }
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CONFIG.VIDEO_W, height: CONFIG.VIDEO_H, facingMode: 'user' },
        });
        _video = document.getElementById('mp-video') || document.createElement('video');
        _video.id = 'mp-video';
        _video.autoplay = true;
        _video.playsInline = true;
        _video.muted = true;
        _video.srcObject = _stream;
        await _video.play();
        _lastVideoTime = -1;
        _smoothedLandmarks = null;
        _setStatus('running');
        _scheduleNext();
      } catch (err) {
        _errorMsg = err.message;
        _setStatus('error');
        throw err;
      }
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
      if (_stream) {
        _stream.getTracks().forEach(track => track.stop());
        _stream = null;
      }
      _setStatus('ready');
    },

    onGaze(cb) {
      if (typeof cb === 'function' && !_callbacks.includes(cb)) {
        _callbacks.push(cb);
      }
    },

    offGaze(cb) {
      _callbacks = _callbacks.filter(c => c !== cb);
    },

    recordCalibrationSample(x, y) {
      const s = _collectFilteredSample();
      if (!s) {
        return false;
      }
      _samples.push({ features: s.features, weight: s.weight, x, y });
      return true;
    },

    recordPursuitSample(x, y) {
      const f = _lastFeatures;
      if (!f || f._eyeOpen < CONFIG.EYE_OPEN_MIN) {
        return false;
      }
      _samples.push({ features: f.slice(), weight: 0.6, x, y });
      return true;
    },

    trainFromSamples() {
      if (_samples.length < 8) {
        return false;
      }
      const X = _samples.map(s => s.features);
      _standardizer = standardize(X);
      const Z = X.map(f => applyStandardize(f, _standardizer));
      const yx = _samples.map(s => s.x);
      const yy = _samples.map(s => s.y);
      const w = weightVector();

      _lambda = chosenLambda(Z, yx, yy, w);
      _weightsX = ridgeSolveWeighted(Z, yx, _lambda, w);
      _weightsY = ridgeSolveWeighted(Z, yy, _lambda, w);
      return !!(_weightsX && _weightsY);
    },

    addOnlineSample(x, y) {
      if (!CONFIG.ONLINE_LEARNING_ENABLED) {
        return false;
      }
      const s = _collectFilteredSample();
      if (!s) {
        return false;
      }
      _samples.push({ features: s.features, weight: s.weight, x, y, online: true });
      if (_samples.length > CONFIG.ONLINE_MAX_SAMPLES) {
        _samples.shift();
      }
      return this.trainFromSamples();
    },

    getLambda() {
      return _lambda;
    },

    clearCalibration() {
      _samples = [];
      _weightsX = null;
      _weightsY = null;
      _standardizer = null;
      _lambda = null;
      _corrNodes = [];
      _recentFrames = [];
      _smoothedLandmarks = null;
    },

    addValidationResidual(predX, predY, targetX, targetY) {
      _corrNodes.push({ tx: targetX, ty: targetY, ex: predX - targetX, ey: predY - targetY });
    },

    clearCorrectionField() {
      _corrNodes = [];
    },

    getCorrectionNodeCount() {
      return _corrNodes.length;
    },

    predictFromFeatures(features) {
      return _predictScreen(features);
    },

    STORAGE_KEY: CONFIG.STORAGE_KEY,

    saveProfile(meta) {
      if (!_weightsX || !_weightsY) {
        return false;
      }
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          timestamp:    new Date().toISOString(),
          featureDim:   _weightsX.length - 1,
          weightsX:     _weightsX,
          weightsY:     _weightsY,
          standardizer: _standardizer,
          lambda:       _lambda,
          corrNodes:    _corrNodes,
          sampleCount:  _samples.length,
          meta:         meta || null,
        }));
        return true;
      } catch (_) {
        return false;
      }
    },

    loadProfile() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) {
          return false;
        }
        const d = JSON.parse(raw);
        if (Array.isArray(d.weightsX) && Array.isArray(d.weightsY)) {
          _weightsX = d.weightsX;
          _weightsY = d.weightsY;
          _standardizer = d.standardizer || null;
          _lambda = storedLambda(d.lambda);
          _corrNodes = storedCorrNodes(d.corrNodes);
          return true;
        }
      } catch (_) {}
      return false;
    },

    getStoredProfile() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    },

    getStatus() {
      return _status;
    },

    getErrorMessage() {
      return _errorMsg;
    },

    getCurrentFeatures() {
      if (!_lastFeatures) {
        return null;
      }
      return _lastFeatures.slice();
    },

    isFaceDetected() {
      return !!_lastFeatures;
    },

    getFaceScale() {
      if (!_smoothedLandmarks) {
        return null;
      }
      try {
        return interOcularScale(_smoothedLandmarks);
      } catch (_) {
        return null;
      }
    },

    getSampleCount() {
      return _samples.length;
    },

    isTrained() {
      return !!(_weightsX && _weightsY);
    },

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
