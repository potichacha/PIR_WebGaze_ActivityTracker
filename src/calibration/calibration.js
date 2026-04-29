/**
 * calibration.js — Module de calibration WebGazer (US-1.1 + améliorations)
 *
 * Améliorations vs version initiale :
 *   - 25 points de calibration (vs 13)
 *   - Filtre Kalman custom 4 états (x, y, vx, vy)
 *   - Correction de biais systématique X/Y (global + par quadrant)
 *   - saveDataAcrossSessions via webgazer.saveDataAcrossSessions(true)
 *   - Miroir webcam + guidance de positionnement avant calibration
 *   - Animation pulse + délai minimum avant premier clic
 *   - Élimination des outliers (2σ) pendant la validation
 *   - Score de précision par quadrant (4 zones)
 *   - Calibration adaptative : points supplémentaires sur zones faibles
 *   - Détection luminosité (luminance webcam)
 *   - Recalibration partielle (seulement les quadrants défaillants)
 *   - setRegression('ridge') + sélection automatique du meilleur modèle
 *   - Dérive temporelle : surveillance via clics implicites
 *   - Filtre médian sur les prédictions de validation
 *
 * Améliorations niveau code (post-WebGazer) :
 *   [A] trailTime = 0  — désactive le mousemove comme données d'entraînement WebGazer
 *   [B] ridgeParameter = 1e-2  — régularisation plus forte (évite overfit sur ~125 samples)
 *   [C] Augmentation de données synthétiques  — interpole des points entre voisins de grille
 *   [D] Correction bilinéaire continue  — champ de correction 2D sur les 5 pts de validation
 *   [E] LOWESS post-processing  — régression locale pondérée par distance au carré inversée
 *
 * API publique :
 *   Calibration.start(onComplete)
 *   Calibration.getScore()
 *   Calibration.getStoredData()
 *   Calibration.reset()
 *   Calibration.applyBiasCorrection(x, y) → {x, y}
 *   Calibration.getDriftScore()
 *   Calibration.CONFIG
 */

(function (global) {
  'use strict';

  // ─── Configuration ─────────────────────────────────────────────────────────
  const CONFIG = {
    CLICKS_PER_POINT:          5,
    MIN_CLICK_DELAY_MS:        800,   // délai minimum avant premier clic autorisé
    RECALIBRATION_THRESHOLD:   150,   // px : seuil global
    QUADRANT_THRESHOLD:        180,   // px : seuil par quadrant (plus tolérant)
    VALIDATION_POINTS:         5,
    COLLECT_DURATION_MS:       1200,  // durée de collecte par point de validation
    OUTLIER_SIGMA:             2,     // supprimer prédictions hors N*σ
    STORAGE_KEY:               'webgaze_calibration',
    DRIFT_WINDOW:              10,    // nombre de clics implicites pour estimer la dérive
    DRIFT_THRESHOLD:           200,   // px : dérive > seuil → alerte
    LUMINANCE_MIN:             40,    // luminance webcam minimale (0-255)
    LUMINANCE_MAX:             220,   // luminance webcam maximale
    REGRESSION_MODELS:         ['ridge', 'weightedRidge'],
    ADAPTIVE_EXTRA_POINTS:     3,     // points supplémentaires par zone faible
    ADAPTIVE_THRESHOLD:        160,   // px : erreur quadrant > seuil → zone faible
    // Mode animé
    ANIMATED_STOP_MS:          900,   // durée d'arrêt sur chaque point (collecte WebGazer)
    ANIMATED_TRAVEL_MS:        700,   // durée de déplacement entre deux points
    ANIMATED_COLLECT_RATE_MS:  40,    // intervalle d'échantillonnage pendant l'arrêt
    ANIMATED_BALL_RADIUS:      18,    // rayon de la balle en px
    ANIMATED_TRAIL_LENGTH:     12,    // nombre de positions conservées pour le sillage
    // [B] Régularisation ridge renforcée
    RIDGE_PARAMETER:           1e-2,  // défaut WebGazer : 1e-5 — on force la généralisation
    // [C] Augmentation de données synthétiques
    SYNTH_INTERPOLATION_STEPS: 2,     // points intermédiaires entre chaque paire de voisins
    SYNTH_ENABLED:             true,
    // [D] Correction bilinéaire
    BILINEAR_ENABLED:          true,
    // [E] LOWESS post-processing
    LOWESS_ENABLED:            true,
    LOWESS_BANDWIDTH:          0.45,  // fraction de points utilisés pour chaque prédiction locale
    // ── Lissage temps réel — One Euro Filter uniquement ────────────────────
    // On laisse WebGazer gérer son propre Kalman interne (applyKalmanFilter).
    // On ajoute seulement One Euro par-dessus : lisse fort au repos,
    // laisse passer les saccades rapides sans lag.
    ONE_EURO_MIN_CUTOFF:       1.0,   // Hz — plus haut = moins de lag, moins de lissage
    ONE_EURO_BETA:             0.007, // réactivité saccades : augmenter si encore trop lent
    ONE_EURO_D_CUTOFF:         1.0,   // Hz — coupure sur la dérivée (laisser à 1.0)
    // Kalman conservé uniquement pour l'API interne (non utilisé dans getFilteredPrediction)
    KALMAN_Q:                  0.05,
    KALMAN_R:                  200,
    KALMAN_ADAPTIVE:           false,
    KALMAN_ADAPTIVE_SCALE:     300,
    // Validation étendue
    COLLECT_DURATION_MS_EXTENDED: 2000,
    VALIDATION_POINTS_EXTENDED:   9
  };

  // ─── Grille de 25 points en % du viewport ──────────────────────────────────
  // Disposition 5×5 avec densification aux bords et coins extrêmes
  const CALIBRATION_GRID = [
    // Ligne 1 (y=5%) — bord supérieur extrême
    { xPct:  5, yPct:  5 }, { xPct: 27, yPct:  5 }, { xPct: 50, yPct:  5 }, { xPct: 73, yPct:  5 }, { xPct: 95, yPct:  5 },
    // Ligne 2 (y=27%)
    { xPct:  5, yPct: 27 }, { xPct: 27, yPct: 27 }, { xPct: 50, yPct: 27 }, { xPct: 73, yPct: 27 }, { xPct: 95, yPct: 27 },
    // Ligne 3 (y=50%) — milieu
    { xPct:  5, yPct: 50 }, { xPct: 27, yPct: 50 }, { xPct: 50, yPct: 50 }, { xPct: 73, yPct: 50 }, { xPct: 95, yPct: 50 },
    // Ligne 4 (y=73%)
    { xPct:  5, yPct: 73 }, { xPct: 27, yPct: 73 }, { xPct: 50, yPct: 73 }, { xPct: 73, yPct: 73 }, { xPct: 95, yPct: 73 },
    // Ligne 5 (y=95%) — bord inférieur extrême
    { xPct:  5, yPct: 95 }, { xPct: 27, yPct: 95 }, { xPct: 50, yPct: 95 }, { xPct: 73, yPct: 95 }, { xPct: 95, yPct: 95 },
  ];

  // Points de validation intercalés (hors grille de calibration)
  const VALIDATION_GRID = [
    { xPct: 16, yPct: 16 },
    { xPct: 84, yPct: 16 },
    { xPct: 50, yPct: 42 },
    { xPct: 16, yPct: 84 },
    { xPct: 84, yPct: 84 },
  ];

  // ─── I-DT : détection de fixations (US-1.2) ───────────────────────────────
  // Algorithme fenêtre glissante avec deques pour dispersion O(n)

  function detectFixations(gazeData, dispersionThreshold, minDuration) {
    if (!Array.isArray(gazeData) || gazeData.length === 0) return [];
    const threshold   = Number(dispersionThreshold);
    const durationMin = Number(minDuration);
    if (!Number.isFinite(threshold)   || threshold   < 0) return [];
    if (!Number.isFinite(durationMin) || durationMin < 0) return [];

    const points = gazeData.filter(
      p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.timestamp)
    );
    if (points.length === 0) return [];

    const fixations = [];
    let i = 0, j = -1, sumX = 0, sumY = 0;
    const minXDq = [], maxXDq = [], minYDq = [], maxYDq = [];

    function pushIdx(idx) {
      const p = points[idx];
      while (minXDq.length && points[minXDq[minXDq.length-1]].x >= p.x) minXDq.pop();
      minXDq.push(idx);
      while (maxXDq.length && points[maxXDq[maxXDq.length-1]].x <= p.x) maxXDq.pop();
      maxXDq.push(idx);
      while (minYDq.length && points[minYDq[minYDq.length-1]].y >= p.y) minYDq.pop();
      minYDq.push(idx);
      while (maxYDq.length && points[maxYDq[maxYDq.length-1]].y <= p.y) maxYDq.pop();
      maxYDq.push(idx);
      sumX += p.x; sumY += p.y; j = idx;
    }

    function dropIdx(idx) {
      if (minXDq.length && minXDq[0] === idx) minXDq.shift();
      if (maxXDq.length && maxXDq[0] === idx) maxXDq.shift();
      if (minYDq.length && minYDq[0] === idx) minYDq.shift();
      if (maxYDq.length && maxYDq[0] === idx) maxYDq.shift();
      sumX -= points[idx].x; sumY -= points[idx].y;
    }

    function resetWin(next) {
      minXDq.length = maxXDq.length = minYDq.length = maxYDq.length = 0;
      sumX = sumY = 0; j = next - 1;
    }

    function disp() {
      if (!minXDq.length) return Infinity;
      return (points[maxXDq[0]].x - points[minXDq[0]].x) +
             (points[maxYDq[0]].y - points[minYDq[0]].y);
    }

    while (i < points.length) {
      if (j < i) resetWin(i);

      while (j + 1 < points.length) {
        const dur = j >= i ? points[j].timestamp - points[i].timestamp : 0;
        if (dur >= durationMin) break;
        pushIdx(j + 1);
      }

      if (j < i || points[j].timestamp - points[i].timestamp < durationMin) break;

      let d = disp();
      if (d <= threshold) {
        while (j + 1 < points.length) {
          const np = points[j + 1];
          const nd = (Math.max(points[maxXDq[0]].x, np.x) - Math.min(points[minXDq[0]].x, np.x)) +
                     (Math.max(points[maxYDq[0]].y, np.y) - Math.min(points[minYDq[0]].y, np.y));
          if (nd > threshold) break;
          pushIdx(j + 1); d = nd;
        }
        const cnt = j - i + 1;
        const dur = points[j].timestamp - points[i].timestamp;
        if (dur >= durationMin && cnt > 0 && Number.isFinite(d)) {
          fixations.push({
            x_center:    sumX / cnt,
            y_center:    sumY / cnt,
            start_time:  points[i].timestamp,
            end_time:    points[j].timestamp,
            duration:    dur,
            points_count: cnt,
          });
        }
        i = j + 1; resetWin(i); continue;
      }
      dropIdx(i); i++;
    }
    return fixations;
  }

  function detectSaccades(gazeData, velocityThreshold) {
    if (!Array.isArray(gazeData) || gazeData.length === 0) return [];

    const threshold = Number(velocityThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) return [];

    const points = gazeData.filter(
      p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.timestamp)
    ).slice().sort((a, b) => a.timestamp - b.timestamp);

    if (points.length < 2) return [];

    const saccades = [];
    let startIndex = -1;
    let peakVelocity = 0;

    function finalize(endIndex) {
      if (startIndex < 0 || endIndex <= startIndex) return;
      const start = points[startIndex];
      const end = points[endIndex];
      const duration = end.timestamp - start.timestamp;
      if (duration <= 0) return;

      saccades.push({
        start_x: start.x,
        start_y: start.y,
        end_x: end.x,
        end_y: end.y,
        start_time: start.timestamp,
        end_time: end.timestamp,
        duration,
        amplitude: distance(start.x, start.y, end.x, end.y),
        peak_velocity: peakVelocity,
      });
    }

    for (let index = 1; index < points.length; index++) {
      const prev = points[index - 1];
      const curr = points[index];
      const dt = curr.timestamp - prev.timestamp;
      if (dt <= 0) continue;

      const velocity = distance(prev.x, prev.y, curr.x, curr.y) / dt;

      if (velocity > threshold) {
        if (startIndex < 0) startIndex = index - 1;
        peakVelocity = Math.max(peakVelocity, velocity);
      } else if (startIndex >= 0) {
        finalize(index - 1);
        startIndex = -1;
        peakVelocity = 0;
      }
    }

    if (startIndex >= 0) {
      finalize(points.length - 1);
    }

    return saccades;
  }

  function linkEvents(fixations, saccades) {
    const fixList = Array.isArray(fixations) ? fixations.slice().sort((a, b) => a.start_time - b.start_time) : [];
    const sacList = Array.isArray(saccades) ? saccades.slice().sort((a, b) => a.start_time - b.start_time) : [];

    const timeline = [];
    let i = 0;
    let j = 0;

    while (i < fixList.length || j < sacList.length) {
      const nextFix = fixList[i];
      const nextSac = sacList[j];

      if (!nextSac || (nextFix && nextFix.start_time <= nextSac.start_time)) {
        timeline.push({ type: 'fixation', ...nextFix });
        i++;
      } else {
        timeline.push({ type: 'saccade', ...nextSac });
        j++;
      }
    }

    return timeline;
  }

  // ─── Stabilité du regard (pour le curseur personnalisé) ───────────────────

  function checkStability(stabilityQueue, point, maxWidth, maxHeight, requiredCount) {
    maxWidth     = maxWidth     !== undefined ? maxWidth     : 100;
    maxHeight    = maxHeight    !== undefined ? maxHeight    : 80;
    requiredCount = requiredCount !== undefined ? requiredCount : 5;
    if (!Array.isArray(stabilityQueue)) return false;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      stabilityQueue.length = 0; return false;
    }
    stabilityQueue.push(point);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const item of stabilityQueue) {
      if (item.x < minX) minX = item.x; if (item.x > maxX) maxX = item.x;
      if (item.y < minY) minY = item.y; if (item.y > maxY) maxY = item.y;
    }
    if ((maxX - minX) > maxWidth || (maxY - minY) > maxHeight) {
      stabilityQueue.length = 0; stabilityQueue.push(point); return false;
    }
    if (stabilityQueue.length > requiredCount) stabilityQueue.shift();
    return stabilityQueue.length === requiredCount;
  }

  // ─── Curseur de regard personnalisé (grand cercle, vert si stable) ─────────

  function createGazeCoordPanel() {
    if (typeof document === 'undefined') return;
    const coords = document.createElement('div');
    coords.id = 'cal-point-coords';
    coords.style.cssText = `
      position: fixed; right: 20px; bottom: 20px; z-index: 10002;
      min-width: 190px; padding: 12px 16px; border-radius: 10px;
      background: rgba(15,15,26,0.92); border: 1px solid rgba(78,205,196,0.45);
      color: #eee; font-size: 0.95rem; line-height: 1.4;
      box-shadow: 0 8px 24px rgba(0,0,0,0.28); pointer-events: none;
    `;
    coords.innerHTML = `
      <div style="font-weight:bold;color:#4ecdc4;margin-bottom:4px;">Curseur WebGazer</div>
      <div id="cal-point-coords-text">—</div>
      <div id="cal-saccade-status" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(78,205,196,0.25);color:#95a5a6;">Saccades: —</div>
    `;
    document.body.appendChild(coords);
  }

  function preventHomeTextSelection() {
    if (typeof document === 'undefined') return;

    document.addEventListener('dblclick', function (event) {
      const home = document.getElementById('home-screen');
      if (home && home.contains(event.target)) {
        event.preventDefault();
      }
    }, true);
  }

  function updateGazeCursorCoords(x, y) {
    const el = typeof document !== 'undefined' && document.getElementById('cal-point-coords-text');
    if (el) el.textContent = `x : ${Math.round(x)}px · y : ${Math.round(y)}px`;
  }

  function updateSaccadeStatus(isSaccade) {
    const el = typeof document !== 'undefined' && document.getElementById('cal-saccade-status');
    if (el) {
      const text = isSaccade ? 'oui' : 'non';
      const color = isSaccade ? '#e74c3c' : '#95a5a6';
      el.style.color = color;
      el.textContent = `Saccades: ${text}`;
    }
  }

  function setupCustomGazeCursor() {
    if (typeof webgazer === 'undefined' || typeof document === 'undefined') return;
    try { webgazer.showPredictionPoints(false); } catch (_) {}

    let cursor = null;
    const cursorSize = 100;
    const gazeBuffer = [];
    const stabilityQueue = [];
    let lastPoint = null;
    const velocityThreshold = 0.7; // px/ms — seuil de saccade

    try {
      webgazer.setGazeListener((data) => {
        if (data == null || data.x == null) {
          if (cursor) cursor.style.display = 'none';
          stabilityQueue.length = 0;
          lastPoint = null;
          updateSaccadeStatus(false);
          return;
        }
        const now = Date.now();
        gazeBuffer.push({ x: data.x, y: data.y, timestamp: now });
        while (gazeBuffer.length && now - gazeBuffer[0].timestamp > 300) gazeBuffer.shift();
        if (!gazeBuffer.length) return;
        const avgX = gazeBuffer.reduce((s, p) => s + p.x, 0) / gazeBuffer.length;
        const avgY = gazeBuffer.reduce((s, p) => s + p.y, 0) / gazeBuffer.length;
        const stable = checkStability(stabilityQueue, { x: avgX, y: avgY }, 100, 80, 5);

        // Détection de saccade basée sur la vélocité instantanée
        let isSaccade = false;
        if (lastPoint) {
          const dt = now - lastPoint.timestamp;
          if (dt > 0) {
            const velocity = distance(lastPoint.x, lastPoint.y, avgX, avgY) / dt;
            isSaccade = velocity > velocityThreshold;
          }
        }
        lastPoint = { x: avgX, y: avgY, timestamp: now };
        updateSaccadeStatus(isSaccade);

        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = 'custom-gaze-cursor';
          cursor.style.cssText = `
            position: fixed; width: ${cursorSize}px; height: ${cursorSize}px;
            border: 2px solid #000; border-radius: 50%; pointer-events: none;
            z-index: 10001; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
          `;
          document.body.appendChild(cursor);
        }
        cursor.style.display = 'block';
        cursor.style.left    = (avgX - cursorSize / 2) + 'px';
        cursor.style.top     = (avgY - cursorSize / 2) + 'px';
        cursor.style.background = stable ? 'rgba(39,174,96,0.1)' : 'rgba(255,255,255,0.1)';
        updateGazeCursorCoords(avgX, avgY);
      });
    } catch (e) {
      console.warn('[Calibration] Impossible de configurer le curseur :', e);
    }
  }

  // ─── Filtre de Kalman 4 états (x, y, vx, vy) ───────────────────────────────
  // Q et R configurables depuis CONFIG pour permettre le retuning sans toucher
  // à la classe. KALMAN_ADAPTIVE module R selon la vitesse estimée du regard.
  function KalmanFilter(Q, R) {
    this.x  = 0; this.y  = 0;
    this.vx = 0; this.vy = 0;
    this.px  = 1000; this.py  = 1000;
    this.pvx = 100;  this.pvy = 100;
    this.Q  = (Q !== undefined) ? Q : CONFIG.KALMAN_Q;
    this.R  = (R !== undefined) ? R : CONFIG.KALMAN_R;
    this.initialized = false;
  }

  KalmanFilter.prototype.update = function (mx, my, dt) {
    dt = dt || 33;
    if (!this.initialized) {
      this.x = mx; this.y = my;
      this.initialized = true;
      return { x: mx, y: my };
    }
    // Prédiction
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.px  += this.Q;
    this.py  += this.Q;
    this.pvx += this.Q * 0.1;
    this.pvy += this.Q * 0.1;
    // R adaptatif selon vitesse — lisse plus quand le regard est fixe
    let Rx = this.R, Ry = this.R;
    if (CONFIG.KALMAN_ADAPTIVE) {
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      const extra = speed * CONFIG.KALMAN_ADAPTIVE_SCALE;
      Rx = this.R + extra;
      Ry = this.R + extra;
    }
    // Gain de Kalman
    const kx = this.px / (this.px + Rx);
    const ky = this.py / (this.py + Ry);
    // Mise à jour
    const innX = mx - this.x;
    const innY = my - this.y;
    this.x  += kx * innX;
    this.y  += ky * innY;
    this.vx += (kx * innX) / dt * 0.1;
    this.vy += (ky * innY) / dt * 0.1;
    this.px  *= (1 - kx);
    this.py  *= (1 - ky);
    return { x: this.x, y: this.y };
  };

  KalmanFilter.prototype.reset = function () {
    this.initialized = false;
    this.px = 1000; this.py = 1000;
    this.pvx = 100; this.pvy = 100;
    this.vx = 0; this.vy = 0;
  };

  // ─── One Euro Filter ────────────────────────────────────────────────────────
  // Filtre spécialisé pour le tracking temps réel : lisse fort au repos,
  // laisse passer les mouvements rapides. Référence : Casiez et al. 2012.
  function OneEuroFilter(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff || CONFIG.ONE_EURO_MIN_CUTOFF;
    this.beta      = beta      || CONFIG.ONE_EURO_BETA;
    this.dCutoff   = dCutoff   || CONFIG.ONE_EURO_D_CUTOFF;
    this.xPrev  = null; this.yPrev  = null;
    this.dxPrev = 0;    this.dyPrev = 0;
    this.tPrev  = null;
  }

  OneEuroFilter.prototype._alpha = function (cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };

  OneEuroFilter.prototype.filter = function (x, y, ts) {
    if (this.xPrev === null) {
      this.xPrev = x; this.yPrev = y; this.tPrev = ts;
      return { x, y };
    }
    const dt = Math.max((ts - this.tPrev) / 1000, 1e-6); // secondes
    this.tPrev = ts;

    // Dérivée filtrée
    const aD  = this._alpha(this.dCutoff, dt);
    const dxRaw = (x - this.xPrev) / dt;
    const dyRaw = (y - this.yPrev) / dt;
    const dx = aD * dxRaw + (1 - aD) * this.dxPrev;
    const dy = aD * dyRaw + (1 - aD) * this.dyPrev;
    this.dxPrev = dx; this.dyPrev = dy;

    // Fréquence de coupure adaptée à la vitesse
    const speed   = Math.sqrt(dx * dx + dy * dy);
    const cutoffX = this.minCutoff + this.beta * speed;
    const cutoffY = this.minCutoff + this.beta * speed;

    // Filtrage position
    const aX = this._alpha(cutoffX, dt);
    const aY = this._alpha(cutoffY, dt);
    const fx = aX * x + (1 - aX) * this.xPrev;
    const fy = aY * y + (1 - aY) * this.yPrev;
    this.xPrev = fx; this.yPrev = fy;
    return { x: fx, y: fy };
  };

  OneEuroFilter.prototype.reset = function () {
    this.xPrev = null; this.yPrev = null;
    this.dxPrev = 0;   this.dyPrev = 0;
    this.tPrev  = null;
  };

  // ─── État interne ──────────────────────────────────────────────────────────
  let overlay            = null;
  let currentPointIndex  = 0;
  let lastScore          = null;
  let onCompleteCallback = null;
  let kalman             = new KalmanFilter();   // conservé pour l'API interne
  let oneEuro            = new OneEuroFilter();
  let lastPredTime       = 0;

  // Correction de biais
  let biasX = 0;
  let biasY = 0;
  let quadrantBias = {
    topLeft:     { x: 0, y: 0 },
    topRight:    { x: 0, y: 0 },
    bottomLeft:  { x: 0, y: 0 },
    bottomRight: { x: 0, y: 0 },
  };

  // Dérive temporelle
  let implicitClicks = [];

  // Grille courante (peut être augmentée par calibration adaptative)
  let activeGrid = null;

  // ─── Helpers mathématiques ─────────────────────────────────────────────────

  function pxFromPct(pct, dimension) {
    return Math.round((pct / 100) * dimension);
  }

  function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Filtre médian glissant sur tableau de points {x, y}
  function medianFilterPoints(points) {
    if (points.length < 3) return points;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return [{ x: median(xs), y: median(ys) }];
  }

  // Supprimer les outliers au-delà de N*σ
  function removeOutliers(points, sigma) {
    if (points.length < 4) return points;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const mx = mean(xs), my = mean(ys);
    const sx = stdDev(xs), sy = stdDev(ys);
    return points.filter(p =>
      Math.abs(p.x - mx) <= sigma * sx &&
      Math.abs(p.y - my) <= sigma * sy
    );
  }

  // Détermine le quadrant d'un point écran
  function getQuadrant(x, y) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    if (x < cx && y < cy) return 'topLeft';
    if (x >= cx && y < cy) return 'topRight';
    if (x < cx && y >= cy) return 'bottomLeft';
    return 'bottomRight';
  }

  // ─── Pipeline de lissage temps réel ───────────────────────────────────────
  //
  // Ordre des étapes :
  //   raw WebGazer
  //   → [1] EMA pré-Kalman
  //   → [2] Fenêtre glissante (moyenne)
  //   → [3] Filtre médian
  //   → [4] Kalman adaptatif principal
  //   → [5] One Euro Filter
  //   → [6] Double Kalman (cascade)
  //   → [7] Correction IDW + LOWESS
  //   → [8] Zone morte
  //   → [9] Snap-to-fixation I-DT temps réel

  function getFilteredPrediction() {
    if (typeof webgazer === 'undefined') return null;
    const raw = webgazer.getCurrentPrediction();
    if (!raw || raw.x == null) return null;

    const now = Date.now();
    lastPredTime = now;

    let x = raw.x, y = raw.y;

    // ── [1] One Euro Filter ───────────────────────────────────────────────
    // Seul filtre appliqué par-dessus le Kalman natif de WebGazer.
    // Lisse les micro-tremblements au repos sans ajouter de lag sur les saccades.
    const oe = oneEuro.filter(x, y, now);
    x = oe.x; y = oe.y;

    // ── [2] Correction spatiale IDW + LOWESS (après validation) ──────────
    if (idwNodes.length > 0) {
      const idw    = applyIDWCorrection(x, y);
      const lowess = applyLOWESS(idw.x, idw.y);
      x = lowess.x; y = lowess.y;
    } else {
      // Avant la première validation : biais global + quadrant
      const q = getQuadrant(x, y);
      x = x - biasX - quadrantBias[q].x;
      y = y - biasY - quadrantBias[q].y;
    }

    return { x, y };
  }

  // ─── Overlay ───────────────────────────────────────────────────────────────

  function createOverlay() {
    removeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: #1a1a2e;
      z-index: 99999;
      cursor: crosshair;
      overflow: hidden;
      font-family: Arial, sans-serif;
    `;

    // Injecter les animations CSS
    if (!document.getElementById('cal-styles')) {
      const style = document.createElement('style');
      style.id = 'cal-styles';
      style.textContent = `
        @keyframes cal-pulse {
          0%   { transform: scale(1);   box-shadow: 0 0 0 0 rgba(78,205,196,0.6); }
          50%  { transform: scale(1.25); box-shadow: 0 0 0 10px rgba(78,205,196,0); }
          100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(78,205,196,0); }
        }
        @keyframes cal-appear {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes cal-val-pulse {
          from { transform: scale(1); }
          to   { transform: scale(1.35); }
        }
        @keyframes cal-ring-fill {
          from { stroke-dashoffset: 100; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes cal-shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-4px); }
          40%     { transform: translateX(4px); }
          60%     { transform: translateX(-4px); }
          80%     { transform: translateX(4px); }
        }
        .cal-point-wrapper {
          position: absolute;
          animation: cal-appear 0.25s ease-out;
        }
        .cal-gaze-dot {
          position: fixed;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: rgba(231,76,60,0.7);
          pointer-events: none;
          z-index: 100000;
          transform: translate(-50%,-50%);
          transition: left 0.05s, top 0.05s;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay() {
    const existing = document.getElementById('calibration-overlay');
    if (existing) existing.remove();
    overlay = null;
  }


  // ─── Affichage du titre d'étape ────────────────────────────────────────────

  function showTitle(text, subtext) {
    const existing = overlay.querySelector('.cal-title');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'cal-title';
    div.style.cssText = `
      position: absolute; top: 18px; left: 50%;
      transform: translateX(-50%);
      color: #eee; text-align: center; pointer-events: none;
    `;
    div.innerHTML = `<h2 style="margin:0;font-size:1.2rem;">${text}</h2>
      ${subtext ? `<p style="margin:4px 0 0;font-size:.85rem;color:#aaa;">${subtext}</p>` : ''}`;
    overlay.appendChild(div);
  }

  // Dot rouge qui suit le regard en temps réel pendant la calibration
  function startGazeDot() {
    let dot = document.getElementById('cal-gaze-dot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'cal-gaze-dot';
      dot.className = 'cal-gaze-dot';
      document.body.appendChild(dot);
    }
    const iv = setInterval(() => {
      const pred = getFilteredPrediction();
      if (pred) {
        dot.style.left = pred.x + 'px';
        dot.style.top  = pred.y + 'px';
        dot.style.display = 'block';
      }
    }, 50);
    dot._interval = iv;
    return dot;
  }

  function stopGazeDot() {
    const dot = document.getElementById('cal-gaze-dot');
    if (dot) {
      clearInterval(dot._interval);
      dot.remove();
    }
  }

  // ─── PHASE -1 : Questionnaire pré-calibration ────────────────────────────
  // Collecte les informations participant avant de démarrer.
  // Les données sont stockées dans calibrationSession et accessibles via
  // Calibration.getSessionData().

  let calibrationSession = null;

  function startPreQuestionnairePhase(onDone) {
    // Si les données viennent de index.html via sessionStorage, on saute le formulaire
    try {
      const stored = sessionStorage.getItem('calibration_session');
      if (stored) {
        calibrationSession = JSON.parse(stored);
        sessionStorage.removeItem('calibration_session');
        onDone();
        return;
      }
    } catch (_) {}

    createOverlay();
    showTitle('Informations participant', 'Remplissez ce formulaire avant de commencer');

    const form = document.createElement('div');
    form.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: #16213e; border-radius: 16px;
      padding: 32px 40px; max-width: 520px; width: 90%;
      color: #eee; font-family: Arial, sans-serif;
      overflow-y: auto; max-height: 80vh;
    `;

    const fieldStyle = 'margin-bottom:16px;';
    const labelStyle = 'display:block;font-size:0.85rem;color:#aaa;margin-bottom:6px;';
    const inputStyle = `
      width:100%; background:#0d1b2a; border:1px solid #2c3e50;
      border-radius:8px; color:#eee; font-size:0.9rem;
      padding:9px 12px; outline:none; box-sizing:border-box;
    `;
    const radioGroupStyle = 'display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;';
    const radioLabelStyle = 'display:flex;align-items:center;gap:6px;font-size:0.88rem;color:#ccc;cursor:pointer;';

    function field(labelTxt, inputHtml) {
      return `<div style="${fieldStyle}">
        <label style="${labelStyle}">${labelTxt}</label>
        ${inputHtml}
      </div>`;
    }

    function radioGroup(name, options) {
      return `<div style="${radioGroupStyle}">${options.map(o =>
        `<label style="${radioLabelStyle}">
          <input type="radio" name="${name}" value="${o.v}"
            style="accent-color:#4ecdc4;width:15px;height:15px;" />
          ${o.l}
        </label>`
      ).join('')}</div>`;
    }

    form.innerHTML = `
      <h3 style="margin:0 0 20px;color:#4ecdc4;font-size:1.1rem;">Session de test — Données participant</h3>
      ${field('ID participant <span style="color:#e74c3c">*</span>',
        `<input type="text" id="q-pid" placeholder="P01, P02…" style="${inputStyle}" />`)}
      ${field('Âge',
        `<input type="number" id="q-age" min="16" max="80" placeholder="—" style="${inputStyle}" />`)}
      ${field('Genre', radioGroup('q-gender', [
        {v:'homme',l:'Homme'},{v:'femme',l:'Femme'},
        {v:'non-binaire',l:'Non-binaire'},{v:'nr',l:'Préfère ne pas répondre'}
      ]))}
      ${field('Port de lunettes / lentilles', radioGroup('q-glasses', [
        {v:'non',l:'Non'},{v:'lunettes',l:'Lunettes'},{v:'lentilles',l:'Lentilles'}
      ]))}
      ${field('Navigateur', `<select id="q-browser" style="${inputStyle}">
        <option value="">—</option>
        <option>Chrome</option><option>Firefox</option>
        <option>Edge</option><option>Safari</option><option>Autre</option>
      </select>`)}
      ${field('Conditions d\'éclairage', radioGroup('q-lighting', [
        {v:'sombre',l:'Sombre'},{v:'normal',l:'Normal'},
        {v:'lumineux',l:'Lumineux'},{v:'contre-jour',l:'Contre-jour'}
      ]))}
      <div id="q-error" style="color:#e74c3c;font-size:0.85rem;margin-bottom:12px;display:none;">
        L'ID participant est obligatoire.
      </div>
      <button id="q-submit" style="${_btnStyle('#4ecdc4')}color:#0f0f1a;font-weight:bold;width:100%;margin:0;">
        Continuer vers la calibration →
      </button>
    `;

    overlay.appendChild(form);

    document.getElementById('q-submit').addEventListener('click', () => {
      const pid = document.getElementById('q-pid').value.trim();
      if (!pid) {
        document.getElementById('q-error').style.display = 'block';
        document.getElementById('q-pid').focus();
        return;
      }
      const getRadio = name => {
        const el = form.querySelector(`input[name="${name}"]:checked`);
        return el ? el.value : null;
      };
      calibrationSession = {
        participant_id: pid,
        date:           new Date().toISOString().slice(0, 10),
        age:            document.getElementById('q-age').value || null,
        gender:         getRadio('q-gender'),
        glasses:        getRadio('q-glasses'),
        browser:        document.getElementById('q-browser').value || null,
        lighting:       getRadio('q-lighting'),
        screen_resolution: typeof screen !== 'undefined'
          ? screen.width + 'x' + screen.height : null,
      };
      removeOverlay();
      onDone();
    });
  }

  // ─── PHASE 0 : Guidance / miroir webcam ───────────────────────────────────

  function startGuidancePhase(onReady) {
    createOverlay();
    showTitle('Positionnement', 'Centrez votre visage dans le cadre ovale avant de commencer');

    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      text-align: center; color: #eee;
    `;

    // ── Miroir webcam avec cadre ovale ────────────────────────────────────
    const videoWrap = document.createElement('div');
    videoWrap.style.cssText = `
      position: relative; width: 320px; height: 240px;
      margin: 0 auto 16px; display: inline-block;
    `;

    const video = document.createElement('video');
    video.id = 'cal-mirror-video';
    video.autoplay = true;
    video.muted = true;
    video.style.cssText = `
      width: 320px; height: 240px;
      border-radius: 12px;
      border: 3px solid #4ecdc4;
      transform: scaleX(-1);
      display: block;
    `;

    // Ovale cible — le visage doit tenir dedans pour valider la distance
    // Dimensions calibrées pour ~60 cm de distance avec webcam standard.
    const faceOval = document.createElement('div');
    faceOval.id = 'cal-face-oval';
    faceOval.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 120px; height: 160px;
      border-radius: 50%;
      border: 3px dashed #e74c3c;
      pointer-events: none;
      transition: border-color 0.3s, box-shadow 0.3s;
      box-shadow: 0 0 0 0 rgba(231,76,60,0);
    `;

    // Label sous l'ovale
    const ovalLabel = document.createElement('div');
    ovalLabel.id = 'cal-oval-label';
    ovalLabel.style.cssText = `
      position: absolute; bottom: -24px; left: 50%;
      transform: translateX(-50%);
      font-size: 0.75rem; color: #e74c3c;
      white-space: nowrap; pointer-events: none;
    `;
    ovalLabel.textContent = 'Alignez votre visage ici';

    videoWrap.appendChild(video);
    videoWrap.appendChild(faceOval);
    videoWrap.appendChild(ovalLabel);

    // Canvas caché pour analyse luminance + détection visage approx.
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 60;
    canvas.style.display = 'none';

    const statusBox = document.createElement('div');
    statusBox.style.cssText = `
      background: #16213e; border-radius: 10px;
      padding: 12px 20px; margin-bottom: 16px;
      font-size: 0.88rem; line-height: 1.9;
      min-width: 320px;
    `;

    const btnReady = document.createElement('button');
    btnReady.textContent = 'Je suis prêt — Démarrer la calibration';
    btnReady.style.cssText = _btnStyle('#4ecdc4') + 'color:#0f0f1a;font-weight:bold;';
    // Désactivé tant que la distance n'est pas validée
    btnReady.disabled = true;
    btnReady.style.opacity = '0.45';

    container.appendChild(videoWrap);
    container.appendChild(canvas);
    container.appendChild(statusBox);
    container.appendChild(btnReady);
    overlay.appendChild(container);

    let stream       = null;
    let luminanceOk  = false;
    let distanceOk   = false;

    // Seuils de luminance du centre du visage pour estimer la distance.
    // Quand le visage est trop proche le centre sature (luminance centrale élevée),
    // trop loin il est foncé. On utilise la zone centrale 30% comme proxy.
    const DIST_BRIGHT_MIN = 80;   // trop sombre → trop loin ou mal éclairé
    const DIST_BRIGHT_MAX = 210;  // trop brillant → trop près

    function updateOval(ok) {
      const color     = ok ? '#27ae60' : '#e74c3c';
      const shadow    = ok ? '0 0 12px 4px rgba(39,174,96,0.45)' : '0 0 0 0 rgba(231,76,60,0)';
      faceOval.style.borderColor = color;
      faceOval.style.boxShadow   = shadow;
      ovalLabel.style.color      = color;
      ovalLabel.textContent      = ok
        ? '✓ Distance correcte'
        : 'Alignez votre visage ici';
    }

    function checkReadiness() {
      const ready = luminanceOk && distanceOk;
      btnReady.disabled     = !ready;
      btnReady.style.opacity = ready ? '1' : '0.45';
    }

    function updateStatus(lum, centerLum) {
      let lumMsg, lumColor;
      if (lum < CONFIG.LUMINANCE_MIN) {
        lumMsg = '⚠️ Trop sombre — allumez une lumière devant vous';
        lumColor = '#e74c3c'; luminanceOk = false;
      } else if (lum > CONFIG.LUMINANCE_MAX) {
        lumMsg = '⚠️ Trop lumineux — évitez la lumière directe dans le dos';
        lumColor = '#e67e22'; luminanceOk = false;
      } else {
        lumMsg = '✓ Luminosité correcte';
        lumColor = '#27ae60'; luminanceOk = true;
      }

      // Estimation distance via luminance centrale
      let distMsg, distColor;
      if (centerLum < DIST_BRIGHT_MIN) {
        distMsg = '↔️ Rapprochez-vous de l\'écran (~60 cm)';
        distColor = '#e67e22'; distanceOk = false;
      } else if (centerLum > DIST_BRIGHT_MAX) {
        distMsg = '↔️ Éloignez-vous légèrement de l\'écran';
        distColor = '#e67e22'; distanceOk = false;
      } else {
        distMsg = '✓ Distance correcte (~60 cm)';
        distColor = '#27ae60'; distanceOk = true;
      }

      updateOval(distanceOk);
      checkReadiness();

      statusBox.innerHTML = `
        <div style="color:${lumColor}">${lumMsg}</div>
        <div style="color:${distColor}">${distMsg}</div>
        <div style="color:#aaa;">👤 Centrez votre visage dans l'ovale</div>
        <div style="color:#aaa;">📐 Ne bougez pas la tête pendant la calibration</div>
      `;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true }).then(s => {
        stream = s;
        video.srcObject = s;

        const ctx = canvas.getContext('2d');
        const lumInterval = setInterval(() => {
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

            // Luminance globale
            let total = 0;
            for (let i = 0; i < data.length; i += 4) {
              total += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
            }
            const globalLum = total / (canvas.width * canvas.height);

            // Luminance zone centrale 30% (proxy distance)
            const cx = Math.floor(canvas.width * 0.35);
            const cy = Math.floor(canvas.height * 0.25);
            const cw = Math.floor(canvas.width * 0.30);
            const ch = Math.floor(canvas.height * 0.50);
            const center = ctx.getImageData(cx, cy, cw, ch).data;
            let cTotal = 0;
            for (let i = 0; i < center.length; i += 4) {
              cTotal += 0.299 * center[i] + 0.587 * center[i+1] + 0.114 * center[i+2];
            }
            const centerLum = cTotal / (cw * ch);

            updateStatus(globalLum, centerLum);
          } catch (_) {}
        }, 600);
        video._lumInterval = lumInterval;
      }).catch(() => {
        statusBox.innerHTML = '<div style="color:#e67e22">⚠️ Miroir webcam non disponible — continuez manuellement</div>';
        luminanceOk = true; distanceOk = true; checkReadiness();
      });
    } else {
      statusBox.innerHTML = '<div style="color:#aaa">Miroir non supporté — continuez manuellement</div>';
      luminanceOk = true; distanceOk = true; checkReadiness();
    }

    btnReady.addEventListener('click', () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(video._lumInterval);
      }
      removeOverlay();
      onReady();
    });
  }

  // ─── PHASE 1 : Calibration ─────────────────────────────────────────────────

  function startCalibrationPhase(grid, onDone) {
    createOverlay();
    activeGrid = grid || [...CALIBRATION_GRID];

    // Mélanger l'ordre des points pour réduire les biais de fatigue
    const shuffled = activeGrid
      .map((p, i) => ({ p, i, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(o => o.p);

    currentPointIndex = 0;
    showTitle('Phase 1 — Points cliquables', `Cliquez ${CONFIG.CLICKS_PER_POINT} fois sur chaque point — ${shuffled.length} points au total`);
    startGazeDot();

    function showNext(index) {
      const old = overlay.querySelector('.cal-point-wrapper');
      if (old) old.remove();

      if (index >= shuffled.length) {
        stopGazeDot();
        // [C] Injecter des points synthétiques entre voisins de grille
        injectSyntheticCalibrationData(CALIBRATION_GRID);
        if (typeof onDone === 'function') onDone();
        else startValidationPhase(null, null);
        return;
      }

      const { xPct, yPct } = shuffled[index];
      const x = pxFromPct(xPct, window.innerWidth);
      const y = pxFromPct(yPct, window.innerHeight);

      showTitle(
        `Calibration — ${index + 1} / ${shuffled.length}`,
        `Cliquez ${CONFIG.CLICKS_PER_POINT} fois sur le point`
      );

      const wrapper = document.createElement('div');
      wrapper.className = 'cal-point-wrapper';
      wrapper.style.left = (x - 20) + 'px';
      wrapper.style.top  = (y - 20) + 'px';

      // SVG anneau de progression
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '40');
      svg.setAttribute('height', '40');
      svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '20'); circle.setAttribute('cy', '20'); circle.setAttribute('r', '15');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#4ecdc4');
      circle.setAttribute('stroke-width', '3');
      circle.setAttribute('stroke-dasharray', '100');
      circle.setAttribute('stroke-dashoffset', '100');
      circle.setAttribute('transform', 'rotate(-90 20 20)');
      svg.appendChild(circle);

      const point = document.createElement('div');
      point.style.cssText = `
        position: absolute;
        width: 28px; height: 28px;
        border-radius: 50%;
        background: #e74c3c;
        border: 3px solid #fff;
        left: 6px; top: 6px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        animation: cal-pulse 1.2s ease-in-out infinite;
      `;
      point.style.pointerEvents = 'none'; // bloqué pendant délai initial

      const counter = document.createElement('span');
      counter.style.cssText = 'color:#fff;font-size:10px;font-weight:bold;pointer-events:none;';
      counter.textContent = `0/${CONFIG.CLICKS_PER_POINT}`;
      point.appendChild(counter);

      wrapper.appendChild(svg);
      wrapper.appendChild(point);
      overlay.appendChild(wrapper);

      // Délai minimum avant d'activer le clic
      let clicksOnPoint = 0;
      let clickable = false;
      const appearTime = Date.now();

      setTimeout(() => {
        clickable = true;
        point.style.pointerEvents = 'auto';
        point.style.animationName = 'none'; // arrêter le pulse d'attente
        point.style.cursor = 'pointer';
      }, CONFIG.MIN_CLICK_DELAY_MS);

      function handleClick(e) {
        e.stopPropagation();
        if (!clickable) {
          // Clic trop rapide → shake
          point.style.animation = 'cal-shake 0.3s ease';
          setTimeout(() => { point.style.animation = ''; }, 300);
          return;
        }
        // Vérifier que le regard est près du point (si WebGazer disponible)
        const pred = getFilteredPrediction();
        if (pred && distance(pred.x, pred.y, x, y) > 250) {
          // regard trop loin — shake discret mais accepter quand même
          point.style.animation = 'cal-shake 0.2s ease';
          setTimeout(() => { point.style.animation = ''; }, 200);
        }

        clicksOnPoint++;
        counter.textContent = `${clicksOnPoint}/${CONFIG.CLICKS_PER_POINT}`;

        // Progression couleur rouge → vert
        const prog = clicksOnPoint / CONFIG.CLICKS_PER_POINT;
        const r = Math.round(231 - (231 - 39)  * prog);
        const g = Math.round(76  + (174 - 76)  * prog);
        const b = Math.round(60  + (96  - 60)  * prog);
        point.style.background = `rgb(${r},${g},${b})`;

        // Mise à jour anneau SVG
        const offset = 100 - Math.round(100 * prog);
        circle.setAttribute('stroke-dashoffset', String(offset));

        // Flash scale
        point.style.transform = 'scale(1.25)';
        setTimeout(() => { point.style.transform = ''; }, 150);

        if (clicksOnPoint >= CONFIG.CLICKS_PER_POINT) {
          point.style.background = '#27ae60';
          point.style.pointerEvents = 'none';
          wrapper.removeEventListener('click', handleClick);
          setTimeout(() => {
            currentPointIndex = index + 1;
            showNext(currentPointIndex);
          }, 280);
        }
      }

      wrapper.addEventListener('click', handleClick);

      // Enregistrer les clics comme données d'entraînement implicites (dérive)
      wrapper.addEventListener('click', () => {
        const pred = getFilteredPrediction();
        if (pred) {
          implicitClicks.push({ pred, target: { x, y }, ts: Date.now() });
          if (implicitClicks.length > CONFIG.DRIFT_WINDOW * 3) {
            implicitClicks.shift();
          }
        }
      });
    }

    showNext(0);
  }

  // ─── PHASE 1b : Calibration animée (smooth pursuit) ──────────────────────
  //
  // La balle se déplace de point en point de CALIBRATION_GRID (ordre aléatoire).
  // Sur chaque point elle s'arrête ANIMATED_STOP_MS ms et appelle
  // webgazer.recordScreenPosition(x, y) toutes les ANIMATED_COLLECT_RATE_MS ms.
  // Un sillage de cercles décroissants montre la trajectoire récente.
  // Pas de clic requis — l'utilisateur suit simplement la balle du regard.

  function showPhaseSplash(title, subtitle, color, delayMs, onReady) {
    createOverlay();
    const box = document.createElement('div');
    box.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      text-align: center; color: #eee;
      animation: cal-appear 0.3s ease-out;
    `;
    box.innerHTML = `
      <div style="font-size:3rem;margin-bottom:16px;">${color}</div>
      <h2 style="font-size:1.5rem;margin-bottom:10px;color:#4ecdc4;">${title}</h2>
      <p style="font-size:0.95rem;color:#aaa;max-width:420px;line-height:1.7;">${subtitle}</p>
      <p style="margin-top:24px;font-size:0.8rem;color:#666;">Démarrage dans ${Math.round(delayMs / 1000)}s…</p>
    `;
    overlay.appendChild(box);
    setTimeout(() => { removeOverlay(); onReady(); }, delayMs);
  }

  function startAnimatedCalibrationPhase(onDone) {
    createOverlay();

    // Ordre randomisé de la grille
    const shuffled = [...CALIBRATION_GRID]
      .map(p => ({ p, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(o => o.p);

    // Barre de progression en haut
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      position: absolute; top: 0; left: 0;
      height: 4px; width: 0%;
      background: #4ecdc4;
      transition: width 0.3s ease;
      z-index: 2;
    `;
    overlay.appendChild(progressBar);

    showTitle('Calibration animée', 'Suivez la balle du regard sans bouger la tête');

    // Compteur de points
    const counter = document.createElement('div');
    counter.style.cssText = `
      position: absolute; bottom: 24px; left: 50%;
      transform: translateX(-50%);
      color: #aaa; font-size: 0.85rem;
    `;
    overlay.appendChild(counter);

    // Canvas pour le sillage
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
    `;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    overlay.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // Balle principale
    const ball = document.createElement('div');
    ball.id = 'cal-anim-ball';
    ball.style.cssText = `
      position: absolute;
      width:  ${CONFIG.ANIMATED_BALL_RADIUS * 2}px;
      height: ${CONFIG.ANIMATED_BALL_RADIUS * 2}px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #6ee7e0, #4ecdc4 60%, #1a9e97);
      box-shadow: 0 0 18px 6px rgba(78,205,196,0.55);
      pointer-events: none;
      z-index: 3;
      transition: left ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1),
                  top  ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1);
    `;
    overlay.appendChild(ball);

    // Anneau de compte-à-rebours autour de la balle
    const svgRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const R = CONFIG.ANIMATED_BALL_RADIUS + 8;
    const D = R * 2 + 6;
    svgRing.setAttribute('width',  String(D));
    svgRing.setAttribute('height', String(D));
    svgRing.style.cssText = `
      position: absolute; pointer-events: none; z-index: 4;
      transition: left ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1),
                  top  ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1);
    `;
    const ringBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ringBg.setAttribute('cx', String(R + 3)); ringBg.setAttribute('cy', String(R + 3));
    ringBg.setAttribute('r', String(R));
    ringBg.setAttribute('fill', 'none'); ringBg.setAttribute('stroke', '#2c3e50');
    ringBg.setAttribute('stroke-width', '3');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const circ = +(2 * Math.PI * R).toFixed(2);
    ring.setAttribute('cx', String(R + 3)); ring.setAttribute('cy', String(R + 3));
    ring.setAttribute('r', String(R));
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#4ecdc4');
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('stroke-dasharray', String(circ));
    ring.setAttribute('stroke-dashoffset', String(circ));
    ring.setAttribute('transform', `rotate(-90 ${R + 3} ${R + 3})`);
    svgRing.appendChild(ringBg); svgRing.appendChild(ring);
    overlay.appendChild(svgRing);

    // Historique des positions pour le sillage
    const trail = [];

    function drawTrail() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      trail.forEach((pos, i) => {
        const alpha  = (i + 1) / trail.length * 0.45;
        const radius = CONFIG.ANIMATED_BALL_RADIUS * ((i + 1) / trail.length) * 0.7;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(78,205,196,${alpha})`;
        ctx.fill();
      });
    }

    function placeBall(x, y) {
      const r = CONFIG.ANIMATED_BALL_RADIUS;
      ball.style.left    = (x - r) + 'px';
      ball.style.top     = (y - r) + 'px';
      svgRing.style.left = (x - R - 3) + 'px';
      svgRing.style.top  = (y - R - 3) + 'px';
    }

    function animateRing(durationMs, onComplete) {
      ring.setAttribute('stroke-dashoffset', String(circ));
      const start = performance.now();
      function tick(now) {
        const p = Math.min((now - start) / durationMs, 1);
        ring.setAttribute('stroke-dashoffset', String(circ * (1 - p)));
        if (p < 1) requestAnimationFrame(tick);
        else onComplete();
      }
      requestAnimationFrame(tick);
    }

    let currentIdx = 0;
    // Positionner la balle sur le premier point sans transition
    const first = shuffled[0];
    const fx = pxFromPct(first.xPct, window.innerWidth);
    const fy = pxFromPct(first.yPct, window.innerHeight);
    ball.style.transition = 'none';
    svgRing.style.transition = 'none';
    placeBall(fx, fy);

    // Ré-activer la transition après le premier placement
    requestAnimationFrame(() => {
      ball.style.transition = `left ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1), top ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1)`;
      svgRing.style.transition = `left ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1), top ${CONFIG.ANIMATED_TRAVEL_MS}ms cubic-bezier(0.45,0,0.55,1)`;
    });

    function visitPoint(idx) {
      if (idx >= shuffled.length) {
        // Fin — nettoyer et passer à la validation
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        stopGazeDot();
        // [C] Injecter des points synthétiques entre voisins de grille
        injectSyntheticCalibrationData(CALIBRATION_GRID);
        if (typeof onDone === 'function') onDone();
        return;
      }

      const { xPct, yPct } = shuffled[idx];
      const x = pxFromPct(xPct, window.innerWidth);
      const y = pxFromPct(yPct, window.innerHeight);

      // Mise à jour progression
      progressBar.style.width = ((idx / shuffled.length) * 100) + '%';
      counter.textContent = `Point ${idx + 1} / ${shuffled.length}`;

      // Déplacer la balle (transition CSS)
      placeBall(x, y);

      // Ajouter au sillage
      trail.push({ x, y });
      if (trail.length > CONFIG.ANIMATED_TRAIL_LENGTH) trail.shift();
      drawTrail();

      // Attendre la fin du déplacement, puis collecter
      setTimeout(() => {
        // Lancer l'anneau de compte-à-rebours
        animateRing(CONFIG.ANIMATED_STOP_MS, () => {
          // Passer au point suivant
          visitPoint(idx + 1);
        });

        // Pendant l'arrêt : enregistrer le regard dans WebGazer
        let collectCount = 0;
        const maxCollects = Math.floor(CONFIG.ANIMATED_STOP_MS / CONFIG.ANIMATED_COLLECT_RATE_MS);
        const collectIv = setInterval(() => {
          collectCount++;
          if (collectCount > maxCollects) { clearInterval(collectIv); return; }

          if (typeof webgazer !== 'undefined') {
            try { webgazer.recordScreenPosition(x, y, 'click'); } catch (_) {}
          }

          // Aussi alimenter la dérive
          const pred = getFilteredPrediction();
          if (pred) {
            implicitClicks.push({ pred, target: { x, y }, ts: Date.now() });
            if (implicitClicks.length > CONFIG.DRIFT_WINDOW * 3) implicitClicks.shift();
          }
        }, CONFIG.ANIMATED_COLLECT_RATE_MS);

      }, CONFIG.ANIMATED_TRAVEL_MS);
    }

    // Démarrer le dot regard temps réel
    startGazeDot();

    // Démarrer la visite après un court délai (laisse l'utilisateur se préparer)
    setTimeout(() => visitPoint(0), 600);
  }

  // ─── PHASE 2 : Validation ──────────────────────────────────────────────────

  function startValidationPhase(validationGrid, onDone) {
    const grid = validationGrid || VALIDATION_GRID;

    showTitle('Validation', 'Fixez chaque point orange sans cliquer');

    let idx = 0;
    const errors = [];
    const rawPredsByPoint = []; // prédictions brutes pour calcul biais

    function showNext() {
      const old = overlay.querySelector('.val-point-wrap');
      if (old) old.remove();

      if (idx >= grid.length) {
        const filtered = removeOutliers(errors.map((e, i) => ({ x: e, y: i })), CONFIG.OUTLIER_SIGMA)
                         .map(o => o.x);
        const meanErr = mean(filtered.length ? filtered : errors.map(o => o.err));
        const stdErr  = stdDev(filtered.length ? filtered : errors.map(o => o.err));

        // Calcul biais global et par quadrant
        computeBiasCorrection(rawPredsByPoint, grid);

        const score = {
          meanError:    meanErr,
          stdError:     stdErr,
          quadrantErrors: computeQuadrantErrors(rawPredsByPoint, grid),
          perPoint:     errors,
        };

        lastScore = score;
        saveToStorage(score);
        if (typeof onDone === 'function') onDone(score);
        else showScore(score);
        return;
      }

      const { xPct, yPct } = grid[idx];
      const x = pxFromPct(xPct, window.innerWidth);
      const y = pxFromPct(yPct, window.innerHeight);

      const wrap = document.createElement('div');
      wrap.className = 'val-point-wrap';
      wrap.style.cssText = `position:absolute;left:${x-20}px;top:${y-20}px;width:40px;height:40px;`;

      const pt = document.createElement('div');
      pt.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%;
        background: #e67e22; border: 3px solid #fff;
        position: absolute; left: 6px; top: 6px;
        pointer-events: none;
        animation: cal-val-pulse 0.6s ease-in-out infinite alternate;
      `;
      wrap.appendChild(pt);
      overlay.appendChild(wrap);

      showTitle(
        `Validation — ${idx + 1} / ${grid.length}`,
        'Fixez le point orange, restez immobile...'
      );

      // Compte à rebours visuel (anneau qui se remplit)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width','40'); svg.setAttribute('height','40');
      svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      const ringBg = document.createElementNS('http://www.w3.org/2000/svg','circle');
      ringBg.setAttribute('cx','20'); ringBg.setAttribute('cy','20'); ringBg.setAttribute('r','17');
      ringBg.setAttribute('fill','none'); ringBg.setAttribute('stroke','#444'); ringBg.setAttribute('stroke-width','3');
      const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
      ring.setAttribute('cx','20'); ring.setAttribute('cy','20'); ring.setAttribute('r','17');
      ring.setAttribute('fill','none'); ring.setAttribute('stroke','#e67e22'); ring.setAttribute('stroke-width','3');
      const circ = 2 * Math.PI * 17;
      ring.setAttribute('stroke-dasharray', String(circ));
      ring.setAttribute('stroke-dashoffset', String(circ));
      ring.setAttribute('transform','rotate(-90 20 20)');
      svg.appendChild(ringBg); svg.appendChild(ring);
      wrap.appendChild(svg);

      const collected = [];
      const start = Date.now();
      const total = CONFIG.COLLECT_DURATION_MS;

      const iv = setInterval(() => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / total, 1);
        ring.setAttribute('stroke-dashoffset', String(circ * (1 - progress)));

        const pred = getFilteredPrediction();
        if (pred) collected.push({ x: pred.x, y: pred.y });

        if (elapsed >= total) {
          clearInterval(iv);

          // Filtre médian puis outliers
          let pts = collected;
          pts = medianFilterPoints(pts.length ? pts : [{ x, y }]);
          pts = removeOutliers(pts, CONFIG.OUTLIER_SIGMA);

          const avgX = mean(pts.map(p => p.x));
          const avgY = mean(pts.map(p => p.y));
          const err  = distance(avgX, avgY, x, y);

          errors.push({ err, x: avgX, y: avgY, targetX: x, targetY: y, xPct, yPct });
          rawPredsByPoint.push({ predX: avgX, predY: avgY, targetX: x, targetY: y, xPct, yPct });

          idx++;
          setTimeout(showNext, 300);
        }
      }, 50);
    }

    showNext();
  }

  // ─── Calcul de la correction de biais ─────────────────────────────────────

  function computeBiasCorrection(predsByPoint, grid) {
    if (!predsByPoint.length) return;

    // Biais global (conservé comme fallback pré-validation)
    const errorsX = predsByPoint.map(p => p.predX - p.targetX);
    const errorsY = predsByPoint.map(p => p.predY - p.targetY);
    biasX = mean(errorsX);
    biasY = mean(errorsY);

    // Biais par quadrant (fallback)
    const quads = { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] };
    predsByPoint.forEach(p => {
      const q = getQuadrant(p.targetX, p.targetY);
      quads[q].push({ ex: p.predX - p.targetX, ey: p.predY - p.targetY });
    });
    Object.keys(quads).forEach(q => {
      const pts = quads[q];
      if (pts.length) {
        quadrantBias[q].x = mean(pts.map(p => p.ex)) - biasX;
        quadrantBias[q].y = mean(pts.map(p => p.ey)) - biasY;
      }
    });

    // [D] Construire le champ de correction IDW à partir des points de validation
    computeIDWField(predsByPoint);
  }

  // ─── Score par quadrant ────────────────────────────────────────────────────

  function computeQuadrantErrors(predsByPoint, grid) {
    const quads = { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] };
    predsByPoint.forEach(p => {
      const q = getQuadrant(p.targetX, p.targetY);
      quads[q].push(distance(p.predX, p.predY, p.targetX, p.targetY));
    });
    const result = {};
    Object.keys(quads).forEach(q => {
      result[q] = quads[q].length ? mean(quads[q]) : null;
    });
    return result;
  }

  // ─── Calibration adaptative ────────────────────────────────────────────────

  function buildAdaptiveGrid(baseScore) {
    const extra = [];
    const qErrors = baseScore.quadrantErrors;
    const quadrantPoints = {
      topLeft:     [{ xPct: 15, yPct: 15 }, { xPct:  5, yPct: 20 }, { xPct: 20, yPct:  5 }],
      topRight:    [{ xPct: 85, yPct: 15 }, { xPct: 95, yPct: 20 }, { xPct: 80, yPct:  5 }],
      bottomLeft:  [{ xPct: 15, yPct: 85 }, { xPct:  5, yPct: 80 }, { xPct: 20, yPct: 95 }],
      bottomRight: [{ xPct: 85, yPct: 85 }, { xPct: 95, yPct: 80 }, { xPct: 80, yPct: 95 }],
    };
    Object.keys(qErrors).forEach(q => {
      if (qErrors[q] !== null && qErrors[q] > CONFIG.ADAPTIVE_THRESHOLD) {
        const pts = quadrantPoints[q].slice(0, CONFIG.ADAPTIVE_EXTRA_POINTS);
        extra.push(...pts);
      }
    });
    return extra;
  }

  // ─── Dérive temporelle ─────────────────────────────────────────────────────

  function getDriftScore() {
    if (implicitClicks.length < 3) return null;
    const recent = implicitClicks.slice(-CONFIG.DRIFT_WINDOW);
    const errors = recent.map(c => distance(c.pred.x, c.pred.y, c.target.x, c.target.y));
    return { meanError: mean(errors), stdError: stdDev(errors), n: errors.length };
  }

  // ─── Sélection du meilleur modèle de régression ───────────────────────────

  function selectBestRegression(onSelected) {
    if (typeof webgazer === 'undefined') { onSelected('ridge'); return; }
    try { webgazer.setRegression('ridge'); } catch (_) {}
    // [A] Désactiver le trail mousemove + [B] renforcer la régularisation L2
    try {
      const regs = webgazer.getRegression ? webgazer.getRegression() : null;
      if (regs && regs[0]) {
        regs[0].trailTime      = 0;                     // [A] mousemove trail → 0
        regs[0].ridgeParameter = CONFIG.RIDGE_PARAMETER; // [B] 1e-2 au lieu de 1e-5
      }
    } catch (_) {}
    onSelected('ridge');
  }

  // ─── [C] Augmentation de données synthétiques ──────────────────────────────
  // Interpole des points intermédiaires entre voisins de grille pour densifier
  // le jeu d'entraînement sans demander d'effort supplémentaire à l'utilisateur.

  function injectSyntheticCalibrationData(grid) {
    if (!CONFIG.SYNTH_ENABLED) return;
    if (typeof webgazer === 'undefined') return;
    const steps = CONFIG.SYNTH_INTERPOLATION_STEPS;
    // Voisins horizontaux et verticaux (grille 5×5)
    const cols = 5, rows = 5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const pt  = grid[idx];
        const x0  = pxFromPct(pt.xPct, window.innerWidth);
        const y0  = pxFromPct(pt.yPct, window.innerHeight);

        // Voisin à droite
        if (c + 1 < cols) {
          const nb  = grid[r * cols + c + 1];
          const x1  = pxFromPct(nb.xPct, window.innerWidth);
          const y1  = pxFromPct(nb.yPct, window.innerHeight);
          for (let s = 1; s <= steps; s++) {
            const t = s / (steps + 1);
            try { webgazer.recordScreenPosition(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 'click'); } catch (_) {}
          }
        }
        // Voisin en dessous
        if (r + 1 < rows) {
          const nb  = grid[(r + 1) * cols + c];
          const x1  = pxFromPct(nb.xPct, window.innerWidth);
          const y1  = pxFromPct(nb.yPct, window.innerHeight);
          for (let s = 1; s <= steps; s++) {
            const t = s / (steps + 1);
            try { webgazer.recordScreenPosition(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 'click'); } catch (_) {}
          }
        }
      }
    }
  }

  // ─── [D] Champ de correction IDW (Inverse Distance Weighting) ─────────────
  // Remplace le système quadrant : correction continue 2D à partir des 5 pts de validation.

  let idwNodes = []; // [{targetX, targetY, errX, errY}, ...]

  function computeIDWField(predsByPoint) {
    idwNodes = predsByPoint.map(p => ({
      targetX: p.targetX,
      targetY: p.targetY,
      errX:    p.predX - p.targetX,  // correction à soustraire
      errY:    p.predY - p.targetY,
    }));
  }

  function applyIDWCorrection(x, y) {
    if (!CONFIG.BILINEAR_ENABLED || !idwNodes.length) return { x, y };
    const EPS = 1e-6;
    let sumW = 0, sumEX = 0, sumEY = 0;
    for (const nd of idwNodes) {
      const d2 = (x - nd.targetX) ** 2 + (y - nd.targetY) ** 2;
      const w  = 1 / (d2 + EPS);
      sumW  += w;
      sumEX += w * nd.errX;
      sumEY += w * nd.errY;
    }
    return {
      x: x - sumEX / sumW,
      y: y - sumEY / sumW,
    };
  }

  // ─── [E] LOWESS post-correction ────────────────────────────────────────────
  // Régression locale pondérée par distance aux points de validation.
  // Affine la correction IDW avec un lissage tricubique.

  function applyLOWESS(x, y) {
    if (!CONFIG.LOWESS_ENABLED || !idwNodes.length) return { x, y };
    const EPS = 1e-6;

    // Distance de chaque nœud de validation au point courant
    const dists = idwNodes.map(nd =>
      Math.sqrt((x - nd.targetX) ** 2 + (y - nd.targetY) ** 2)
    );
    const maxDist = Math.max(...dists, EPS);

    // Noyau tricubique : w = (1 - (d/h)^3)^3 pour d < h
    const h = maxDist * (1 + CONFIG.LOWESS_BANDWIDTH); // bandwidth adaptatif
    let sumW = 0, sumEX = 0, sumEY = 0;
    idwNodes.forEach((nd, i) => {
      const u = dists[i] / h;
      if (u >= 1) return;
      const w = Math.pow(1 - Math.pow(u, 3), 3);
      sumW  += w;
      sumEX += w * nd.errX;
      sumEY += w * nd.errY;
    });
    if (sumW < EPS) return { x, y };
    return {
      x: x - sumEX / sumW,
      y: y - sumEY / sumW,
    };
  }

  // ─── Affichage du score final ──────────────────────────────────────────────

  function showScore(score) {
    removeOverlay();
    createOverlay();

    const needsRecal = score.meanError > CONFIG.RECALIBRATION_THRESHOLD;
    const color  = needsRecal ? '#e74c3c' : '#27ae60';
    const verdict = needsRecal ? 'Calibration insuffisante' : 'Calibration réussie !';

    // Identifier les quadrants défaillants
    const weakQuads = [];
    if (score.quadrantErrors) {
      Object.entries(score.quadrantErrors).forEach(([q, err]) => {
        if (err !== null && err > CONFIG.ADAPTIVE_THRESHOLD) weakQuads.push(q);
      });
    }

    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: #16213e; border: 2px solid ${color};
      border-radius: 16px; padding: 36px 52px;
      text-align: center; color: #eee; min-width: 420px; max-width: 560px;
    `;

    const qNames = { topLeft: 'Haut-gauche', topRight: 'Haut-droite', bottomLeft: 'Bas-gauche', bottomRight: 'Bas-droite' };
    const qRows = score.quadrantErrors
      ? Object.entries(score.quadrantErrors).map(([q, err]) => {
          const c = err === null ? '#888' : err > CONFIG.ADAPTIVE_THRESHOLD ? '#e74c3c' : '#27ae60';
          return `<tr>
            <td style="padding:5px 14px;text-align:left;color:#aaa;">${qNames[q]}</td>
            <td style="padding:5px 14px;text-align:right;font-weight:bold;color:${c};">
              ${err !== null ? err.toFixed(1) + ' px' : '—'}
            </td>
          </tr>`;
        }).join('')
      : '';

    const drift = getDriftScore();
    const driftRow = drift
      ? `<tr>
          <td style="padding:5px 14px;text-align:left;color:#aaa;">Dérive estimée</td>
          <td style="padding:5px 14px;text-align:right;font-weight:bold;color:${drift.meanError > CONFIG.DRIFT_THRESHOLD ? '#e74c3c' : '#27ae60'};">
            ${drift.meanError.toFixed(1)} px
          </td>
        </tr>`
      : '';

    container.innerHTML = `
      <h2 style="color:${color};margin-top:0;">Résultats de calibration</h2>
      <table style="margin:0 auto 16px;border-collapse:collapse;width:100%;font-size:.95rem;">
        <tr>
          <td style="padding:7px 14px;text-align:left;color:#aaa;">Erreur moyenne (global)</td>
          <td style="padding:7px 14px;text-align:right;font-weight:bold;color:${color};">${score.meanError.toFixed(1)} px</td>
        </tr>
        <tr>
          <td style="padding:7px 14px;text-align:left;color:#aaa;">Écart-type</td>
          <td style="padding:7px 14px;text-align:right;font-weight:bold;">${score.stdError.toFixed(1)} px</td>
        </tr>
        <tr><td colspan="2" style="padding:6px 14px;color:#4ecdc4;font-size:.8rem;text-align:left;">— Précision par quadrant —</td></tr>
        ${qRows}
        ${driftRow}
        <tr>
          <td style="padding:7px 14px;text-align:left;color:#aaa;">Seuil accepté</td>
          <td style="padding:7px 14px;text-align:right;">≤ ${CONFIG.RECALIBRATION_THRESHOLD} px</td>
        </tr>
      </table>
      <p style="font-size:1.05rem;font-weight:bold;color:${color};margin-bottom:16px;">${verdict}</p>
    `;

    // Bouton Continuer
    if (!needsRecal) {
      const btnOk = document.createElement('button');
      btnOk.textContent = 'Continuer';
      btnOk.style.cssText = _btnStyle('#27ae60');
      btnOk.addEventListener('click', () => {
        removeOverlay();
        if (typeof onCompleteCallback === 'function') onCompleteCallback(score);
      });
      container.appendChild(btnOk);
    }

    // Bouton recalibration adaptative (zones faibles seulement)
    if (weakQuads.length > 0) {
      const btnAdapt = document.createElement('button');
      btnAdapt.textContent = `Recalibrer les zones faibles (${weakQuads.length})`;
      btnAdapt.style.cssText = _btnStyle('#e67e22');
      btnAdapt.addEventListener('click', () => {
        const extraGrid = buildAdaptiveGrid(score);
        if (extraGrid.length) {
          removeOverlay();
          createOverlay();
          showTitle('Recalibration adaptative', `${extraGrid.length} points supplémentaires sur les zones faibles`);
          setTimeout(() => {
            startCalibrationPhase(extraGrid, () => {
              startValidationPhase(null, (newScore) => {
                const merged = {
                  meanError: (score.meanError + newScore.meanError) / 2,
                  stdError:  (score.stdError  + newScore.stdError)  / 2,
                  quadrantErrors: newScore.quadrantErrors,
                  perPoint:  newScore.perPoint,
                };
                lastScore = merged;
                saveToStorage(merged);
                showScore(merged);
              });
            });
          }, 200);
        }
      });
      container.appendChild(btnAdapt);
    }

    // Bouton recalibration complète
    const btnRecal = document.createElement('button');
    btnRecal.textContent = needsRecal ? 'Recalibrer complètement' : 'Recalibrer quand même';
    btnRecal.style.cssText = _btnStyle(needsRecal ? '#e74c3c' : '#7f8c8d');
    btnRecal.addEventListener('click', () => {
      if (typeof webgazer !== 'undefined') { try { webgazer.clearData(); } catch (_) {} }
      kalman.reset(); biasX = 0; biasY = 0;
      Object.keys(quadrantBias).forEach(q => { quadrantBias[q] = { x: 0, y: 0 }; });
      implicitClicks = [];
      removeOverlay();
      setTimeout(() => Calibration.start(onCompleteCallback), 100);
    });
    container.appendChild(btnRecal);

    overlay.appendChild(container);
  }

  function _btnStyle(bg) {
    return `
      display:inline-block; margin:6px 8px 0;
      padding:11px 24px; background:${bg};
      color:#fff; border:none; border-radius:8px;
      font-size:.95rem; cursor:pointer;
    `;
  }

  // ─── Stockage localStorage ─────────────────────────────────────────────────

  function saveToStorage(score) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        timestamp:      new Date().toISOString(),
        meanError:      score.meanError,
        stdError:       score.stdError,
        quadrantErrors: score.quadrantErrors || null,
        threshold:      CONFIG.RECALIBRATION_THRESHOLD,
        biasX,
        biasY,
        quadrantBias:   JSON.parse(JSON.stringify(quadrantBias)),
        idwNodes:       JSON.parse(JSON.stringify(idwNodes)),
      }));
    } catch (e) {
      console.warn('[Calibration] localStorage non disponible :', e);
    }
  }

  function loadBiasFromStorage() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.biasX === 'number') biasX = d.biasX;
      if (typeof d.biasY === 'number') biasY = d.biasY;
      if (d.quadrantBias) {
        Object.keys(d.quadrantBias).forEach(q => {
          if (quadrantBias[q]) quadrantBias[q] = d.quadrantBias[q];
        });
      }
      if (Array.isArray(d.idwNodes)) idwNodes = d.idwNodes;
    } catch (_) {}
  }

  // ─── API publique ──────────────────────────────────────────────────────────

  const Calibration = {
    start(onComplete) {
      onCompleteCallback = onComplete || null;
      kalman.reset(); oneEuro.reset();
      implicitClicks = [];

      // Activer saveDataAcrossSessions et Kalman WebGazer natif
      if (typeof webgazer !== 'undefined') {
        try { webgazer.saveDataAcrossSessions(true); } catch (_) {}
        try { webgazer.applyKalmanFilter(true); }      catch (_) {}
      }

      // Restaurer biais d'une session précédente
      loadBiasFromStorage();

      selectBestRegression(() => {
        startPreQuestionnairePhase(() => {
          startGuidancePhase(() => {
            startCalibrationPhase(null, () => {
              showPhaseSplash(
                'Phase 2 — Balle animée',
                'Les points cliquables sont terminés. Maintenant, suivez la balle du regard sans bouger la tête ni cliquer.',
                '🔵',
                3000,
                () => startAnimatedCalibrationPhase(() => {
                  createOverlay();
                  startValidationPhase(null, (score) => showScore(score));
                })
              );
            });
          });
        });
      });
    },

    startAnimated(onComplete) {
      onCompleteCallback = onComplete || null;
      kalman.reset(); oneEuro.reset();
      implicitClicks = [];

      if (typeof webgazer !== 'undefined') {
        try { webgazer.saveDataAcrossSessions(true); } catch (_) {}
        try { webgazer.applyKalmanFilter(true); }      catch (_) {}
      }

      loadBiasFromStorage();
      selectBestRegression(() => {
        startPreQuestionnairePhase(() => {
          startGuidancePhase(() => {
            startAnimatedCalibrationPhase(() => {
              createOverlay();
              startValidationPhase(null, (score) => showScore(score));
            });
          });
        });
      });
    },

    getScore() { return lastScore; },

    getSessionData() { return calibrationSession; },

    getStoredData() {
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    },

    reset() {
      try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (_) {}
      lastScore = null;
      biasX = 0; biasY = 0;
      Object.keys(quadrantBias).forEach(q => { quadrantBias[q] = { x: 0, y: 0 }; });
      idwNodes = [];
      implicitClicks = [];
      kalman.reset();
      oneEuro.reset();
    },

    // Appliquer la correction de biais à une prédiction externe
    applyBiasCorrection(x, y) {
      if (idwNodes.length > 0) {
        const idw = applyIDWCorrection(x, y);
        return applyLOWESS(idw.x, idw.y);
      }
      const q = getQuadrant(x, y);
      return {
        x: x - biasX - quadrantBias[q].x,
        y: y - biasY - quadrantBias[q].y,
      };
    },

    getDriftScore,

    detectFixations,
    detectSaccades,
    linkEvents,
    setupCustomGazeCursor,

    CONFIG,
    CALIBRATION_GRID,
    VALIDATION_GRID,
    _helpers: { distance, mean, stdDev, median, pxFromPct, removeOutliers, medianFilterPoints, getQuadrant, detectFixations, detectSaccades, linkEvents, checkStability, applyIDWCorrection, applyLOWESS, computeIDWField, injectSyntheticCalibrationData },
    _kalman: KalmanFilter,
    _oneEuro: OneEuroFilter,
    _internal: {
      startAnimatedCalibrationPhase,
      get idwNodes() { return idwNodes; },
    },
  };

  global.Calibration = Calibration;

  // Auto-setup curseur et panneau de coordonnées au chargement de la page
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('load', function () {
      preventHomeTextSelection();
      createGazeCoordPanel();
      if (typeof webgazer !== 'undefined') {
        setTimeout(() => setupCustomGazeCursor(), 100);
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
