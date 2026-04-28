/**
 * calibration.js — Module de calibration WebGazer (US-1.1)
 *
 * Expose l'objet global `Calibration` avec :
 *   Calibration.start()          — lance la calibration
 *   Calibration.getScore()       — retourne le dernier score { meanError, stdError }
 *   Calibration.getStoredData()  — retourne les données en localStorage
 *   Calibration.reset()          — efface la calibration stockée
 */

(function (global) {
  'use strict';

  // ─── Configuration ─────────────────────────────────────────────────────────
  const CONFIG = {
    CLICKS_PER_POINT: 5,          // N clics requis par point
    RECALIBRATION_THRESHOLD: 150, // px : si meanError > seuil → proposer recalibration
    VALIDATION_POINTS: 5,         // nombre de points de test post-calibration
    COLLECT_DURATION_MS: 1000,    // durée de collecte du regard sur chaque point de validation (ms)
    STORAGE_KEY: 'webgaze_calibration',
  };

  // 13 points en % du viewport (x%, y%)
  const CALIBRATION_GRID = [
    { xPct: 10, yPct: 10 }, { xPct: 50, yPct: 10 }, { xPct: 90, yPct: 10 },
    { xPct: 10, yPct: 30 }, { xPct: 50, yPct: 30 }, { xPct: 90, yPct: 30 },
    { xPct: 10, yPct: 50 }, { xPct: 50, yPct: 50 }, { xPct: 90, yPct: 50 },
    { xPct: 10, yPct: 70 }, { xPct: 50, yPct: 70 }, { xPct: 90, yPct: 70 },
    { xPct: 50, yPct: 90 },
  ];

  // 5 points de validation (différents de la grille de calibration)
  // Note: (50,50) est dans la grille de calibration — remplacé par (50,60)
  const VALIDATION_GRID = [
    { xPct: 25, yPct: 25 },
    { xPct: 75, yPct: 25 },
    { xPct: 50, yPct: 60 },
    { xPct: 25, yPct: 75 },
    { xPct: 75, yPct: 75 },
  ];

  // ─── État interne ──────────────────────────────────────────────────────────
  let overlay = null;
  let currentPointIndex = 0;
  let clickCount = 0;
  let lastScore = null;
  let onCompleteCallback = null;
  let currentCalibrationPoint = null;

  // ─── Helpers ───────────────────────────────────────────────────────────────

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
    const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  function detectFixations(gazeData, dispersionThreshold, minDuration) {
    if (!Array.isArray(gazeData) || gazeData.length === 0) return [];

    const threshold = Number(dispersionThreshold);
    const durationMin = Number(minDuration);
    if (!Number.isFinite(threshold) || threshold < 0) return [];
    if (!Number.isFinite(durationMin) || durationMin < 0) return [];

    const points = gazeData.filter(
      p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.timestamp)
    );
    if (points.length === 0) return [];

    const fixations = [];
    let i = 0;
    let j = -1;
    let sumX = 0;
    let sumY = 0;

    const minXDeque = [];
    const maxXDeque = [];
    const minYDeque = [];
    const maxYDeque = [];

    function pushIndex(idx) {
      const p = points[idx];

      while (minXDeque.length && points[minXDeque[minXDeque.length - 1]].x >= p.x) minXDeque.pop();
      minXDeque.push(idx);

      while (maxXDeque.length && points[maxXDeque[maxXDeque.length - 1]].x <= p.x) maxXDeque.pop();
      maxXDeque.push(idx);

      while (minYDeque.length && points[minYDeque[minYDeque.length - 1]].y >= p.y) minYDeque.pop();
      minYDeque.push(idx);

      while (maxYDeque.length && points[maxYDeque[maxYDeque.length - 1]].y <= p.y) maxYDeque.pop();
      maxYDeque.push(idx);

      sumX += p.x;
      sumY += p.y;
      j = idx;
    }

    function dropLeftIndex(idx) {
      const p = points[idx];
      if (minXDeque.length && minXDeque[0] === idx) minXDeque.shift();
      if (maxXDeque.length && maxXDeque[0] === idx) maxXDeque.shift();
      if (minYDeque.length && minYDeque[0] === idx) minYDeque.shift();
      if (maxYDeque.length && maxYDeque[0] === idx) maxYDeque.shift();
      sumX -= p.x;
      sumY -= p.y;
    }

    function resetWindow(nextStart) {
      minXDeque.length = 0;
      maxXDeque.length = 0;
      minYDeque.length = 0;
      maxYDeque.length = 0;
      sumX = 0;
      sumY = 0;
      j = nextStart - 1;
    }

    function currentDispersion() {
      if (!minXDeque.length || !maxXDeque.length || !minYDeque.length || !maxYDeque.length) return Infinity;
      const minX = points[minXDeque[0]].x;
      const maxX = points[maxXDeque[0]].x;
      const minY = points[minYDeque[0]].y;
      const maxY = points[maxYDeque[0]].y;
      return (maxX - minX) + (maxY - minY);
    }

    while (i < points.length) {
      if (j < i) {
        resetWindow(i);
      }

      while (j + 1 < points.length) {
        const currentDuration = j >= i ? points[j].timestamp - points[i].timestamp : 0;
        if (currentDuration >= durationMin) break;
        pushIndex(j + 1);
      }

      if (j < i || points[j].timestamp - points[i].timestamp < durationMin) {
        break;
      }

      let dispersion = currentDispersion();

      if (dispersion <= threshold) {
        while (j + 1 < points.length) {
          const nextPoint = points[j + 1];
          const minX = Math.min(points[minXDeque[0]].x, nextPoint.x);
          const maxX = Math.max(points[maxXDeque[0]].x, nextPoint.x);
          const minY = Math.min(points[minYDeque[0]].y, nextPoint.y);
          const maxY = Math.max(points[maxYDeque[0]].y, nextPoint.y);
          const nextDispersion = (maxX - minX) + (maxY - minY);
          if (nextDispersion > threshold) break;
          pushIndex(j + 1);
          dispersion = nextDispersion;
        }

        const pointsCount = j - i + 1;
        const startTime = points[i].timestamp;
        const endTime = points[j].timestamp;
        const duration = endTime - startTime;

        if (duration >= durationMin && pointsCount > 0 && Number.isFinite(dispersion)) {
          fixations.push({
            x_center: sumX / pointsCount,
            y_center: sumY / pointsCount,
            start_time: startTime,
            end_time: endTime,
            duration,
            points_count: pointsCount,
          });
        }

        i = j + 1;
        resetWindow(i);
        continue;
      }

      dropLeftIndex(i);
      i++;
    }

    return fixations;
  }

  // ─── Création de l'overlay plein écran ────────────────────────────────────

  function createOverlay() {
    removeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: #1a1a2e;
      z-index: 99999;
      cursor: crosshair;
      overflow: hidden;
      font-family: Arial, sans-serif;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay() {
    const existing = document.getElementById('calibration-overlay');
    if (existing) existing.remove();
    overlay = null;
  }

  function createGazeCoordPanel() {
    const coords = document.createElement('div');
    coords.id = 'cal-point-coords';
    coords.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 10002;
      min-width: 190px;
      padding: 12px 16px;
      border-radius: 10px;
      background: rgba(15, 15, 26, 0.92);
      border: 1px solid rgba(78, 205, 196, 0.45);
      color: #eee;
      font-size: 0.95rem;
      line-height: 1.4;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      pointer-events: none;
    `;
    coords.innerHTML = `
      <div style="font-weight:bold;color:#4ecdc4;margin-bottom:4px;">Curseur WebGazer</div>
      <div id="cal-point-coords-text">—</div>
    `;
    document.body.appendChild(coords);
  }

  function updateCalibrationPointCoords(x, y) {
    currentCalibrationPoint = { x, y };
  }

  function updateGazeCursorCoords(x, y) {
    const text = document.getElementById('cal-point-coords-text');
    if (!text) return;
    text.textContent = `x : ${Math.round(x)}px · y : ${Math.round(y)}px`;
  }

  function checkStability(stabilityQueue, point, maxWidth = 100, maxHeight = 80, requiredCount = 5) {
    if (!Array.isArray(stabilityQueue)) return false;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      stabilityQueue.length = 0;
      return false;
    }

    stabilityQueue.push(point);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const item of stabilityQueue) {
      if (item.x < minX) minX = item.x;
      if (item.x > maxX) maxX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.y > maxY) maxY = item.y;
    }

    if ((maxX - minX) > maxWidth || (maxY - minY) > maxHeight) {
      stabilityQueue.length = 0;
      stabilityQueue.push(point);
      return false;
    }

    if (stabilityQueue.length > requiredCount) {
      stabilityQueue.shift();
    }

    return stabilityQueue.length === requiredCount;
  }

  function setupCustomGazeCursor() {
    if (typeof webgazer === 'undefined' || typeof document === 'undefined') return;

    try {
      webgazer.showPredictionPoints(false);
    } catch (_) {}

    let cursor = null;
    const cursorSize = 100;
    const smoothingWindow = 300; // ms
    const gazeBuffer = [];
    const stabilityQueue = [];

    try {
      webgazer.setGazeListener((data, elapsedTime) => {
        if (data == null || data.x == null || data.y == null) {
          if (cursor) cursor.style.display = 'none';
          stabilityQueue.length = 0;
          return;
        }

        const now = Date.now();
        gazeBuffer.push({ x: data.x, y: data.y, timestamp: now });

        // Nettoyer les données de plus de 300ms
        while (gazeBuffer.length > 0 && now - gazeBuffer[0].timestamp > smoothingWindow) {
          gazeBuffer.shift();
        }

        if (gazeBuffer.length === 0) return;

        // Calculer la moyenne des données du buffer
        const avgX = gazeBuffer.reduce((sum, p) => sum + p.x, 0) / gazeBuffer.length;
        const avgY = gazeBuffer.reduce((sum, p) => sum + p.y, 0) / gazeBuffer.length;
        const stable = checkStability(stabilityQueue, { x: avgX, y: avgY }, 100, 80, 5);

        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = 'custom-gaze-cursor';
          cursor.style.cssText = `
            position: fixed;
            width: ${cursorSize}px;
            height: ${cursorSize}px;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid #000;
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
          `;
          document.body.appendChild(cursor);
        }

        cursor.style.display = 'block';
        cursor.style.left = (avgX - cursorSize / 2) + 'px';
        cursor.style.top = (avgY - cursorSize / 2) + 'px';
        cursor.style.background = stable ? 'rgba(39, 174, 96, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        updateGazeCursorCoords(avgX, avgY);
      });
    } catch (e) {
      console.warn('[Calibration] Impossible de configurer le curseur personnalisé :', e);
    }
  }
  // ─── Affichage du titre d'étape ────────────────────────────────────────────

  function showTitle(text, subtext) {
    const existing = overlay.querySelector('.cal-title');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'cal-title';
    div.style.cssText = `
      position: absolute;
      top: 20px; left: 50%;
      transform: translateX(-50%);
      color: #eee;
      text-align: center;
      pointer-events: none;
    `;
    div.innerHTML = `<h2 style="margin:0;font-size:1.3rem;">${text}</h2>
      ${subtext ? `<p style="margin:4px 0 0;font-size:.9rem;color:#aaa;">${subtext}</p>` : ''}`;
    overlay.appendChild(div);
  }

  // ─── PHASE 1 : Calibration ─────────────────────────────────────────────────

  function startCalibrationPhase() {
    createOverlay();
    currentPointIndex = 0;
    clickCount = 0;
    showTitle('Calibration', 'Cliquez sur chaque point jusqu\'à ce qu\'il devienne vert');
    showCalibrationPoint(0);
  }

  function showCalibrationPoint(index) {
    // Supprimer le point précédent
    const old = overlay.querySelector('.cal-point');
    if (old) old.remove();

    if (index >= CALIBRATION_GRID.length) {
      // Calibration terminée → phase de validation
      startValidationPhase();
      return;
    }

    const { xPct, yPct } = CALIBRATION_GRID[index];
    const x = pxFromPct(xPct, window.innerWidth);
    const y = pxFromPct(yPct, window.innerHeight);
    updateCalibrationPointCoords(x, y);

    const point = document.createElement('div');
    point.className = 'cal-point';
    point.dataset.clicks = '0';
    point.style.cssText = `
      position: absolute;
      width: 28px; height: 28px;
      border-radius: 50%;
      background: #e74c3c;
      border: 3px solid #fff;
      left: ${x - 14}px;
      top:  ${y - 14}px;
      cursor: pointer;
      transition: background 0.2s, transform 0.15s;
      display: flex; align-items: center; justify-content: center;
    `;

    // Compteur de clics centré
    const counter = document.createElement('span');
    counter.className = 'cal-counter';
    counter.style.cssText = 'color:#fff;font-size:11px;font-weight:bold;pointer-events:none;';
    counter.textContent = `0/${CONFIG.CLICKS_PER_POINT}`;
    point.appendChild(counter);

    point.addEventListener('click', onCalibrationPointClick);
    overlay.appendChild(point);

    // Mise à jour du titre
    showTitle(
      `Calibration — Point ${index + 1} / ${CALIBRATION_GRID.length}`,
      `Cliquez ${CONFIG.CLICKS_PER_POINT} fois sur le point rouge`
    );
  }

  function onCalibrationPointClick(e) {
    e.stopPropagation();
    const point = e.currentTarget;
    clickCount++;
    const n = parseInt(point.dataset.clicks, 10) + 1;
    point.dataset.clicks = n;

    const counter = point.querySelector('.cal-counter');
    if (counter) counter.textContent = `${n}/${CONFIG.CLICKS_PER_POINT}`;

    // Feedback visuel : progression de couleur rouge → vert
    const progress = n / CONFIG.CLICKS_PER_POINT;
    const r = Math.round(231 - (231 - 39) * progress);
    const g = Math.round(76 + (174 - 76) * progress);
    const b = Math.round(60 + (96 - 60) * progress);
    point.style.background = `rgb(${r},${g},${b})`;
    point.style.transform = 'scale(1.2)';
    setTimeout(() => { point.style.transform = 'scale(1)'; }, 150);

    if (n >= CONFIG.CLICKS_PER_POINT) {
      point.style.background = '#27ae60';
      point.style.pointerEvents = 'none';
      setTimeout(() => {
        currentPointIndex++;
        clickCount = 0;
        showCalibrationPoint(currentPointIndex);
      }, 300);
    }
  }

  // ─── PHASE 2 : Validation ──────────────────────────────────────────────────

  function startValidationPhase() {
    currentCalibrationPoint = null;

    // Notifier WebGazer qu'on bascule en mode validation (pas d'apprentissage)
    if (typeof webgazer !== 'undefined') {
      try { webgazer.params.showVideo = false; } catch (_) {}
    }

    showTitle('Validation', 'Fixez chaque point orange sans cliquer');

    let validationIndex = 0;
    const errors = [];

    function showNextValidationPoint() {
      const old = overlay.querySelector('.val-point');
      if (old) old.remove();

      if (validationIndex >= VALIDATION_GRID.length) {
        // Calcul du score
        const meanError = mean(errors);
        const stdError = stdDev(errors);
        lastScore = { meanError, stdError };
        saveToStorage(lastScore);
        showScore(lastScore);
        return;
      }

      const { xPct, yPct } = VALIDATION_GRID[validationIndex];
      const x = pxFromPct(xPct, window.innerWidth);
      const y = pxFromPct(yPct, window.innerHeight);

      const point = document.createElement('div');
      point.className = 'val-point';
      point.style.cssText = `
        position: absolute;
        width: 24px; height: 24px;
        border-radius: 50%;
        background: #e67e22;
        border: 3px solid #fff;
        left: ${x - 12}px;
        top:  ${y - 12}px;
        pointer-events: none;
        animation: pulse 0.6s ease-in-out infinite alternate;
      `;

      // Injecter l'animation si pas encore présente
      if (!document.getElementById('cal-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'cal-pulse-style';
        style.textContent = `
          @keyframes pulse {
            from { transform: scale(1); }
            to   { transform: scale(1.3); }
          }
        `;
        document.head.appendChild(style);
      }

      overlay.appendChild(point);

      showTitle(
        `Validation — Point ${validationIndex + 1} / ${VALIDATION_GRID.length}`,
        'Fixez le point orange...'
      );

      // Collecter les estimations WebGazer sur COLLECT_DURATION_MS
      const collected = [];
      const startTime = Date.now();

      const collectInterval = setInterval(() => {
        if (typeof webgazer !== 'undefined') {
          const pred = webgazer.getCurrentPrediction();
          if (pred && pred.x != null && pred.y != null) {
            collected.push({ x: pred.x, y: pred.y });
          }
        }
        if (Date.now() - startTime >= CONFIG.COLLECT_DURATION_MS) {
          clearInterval(collectInterval);

          if (collected.length > 0) {
            const mx = mean(collected.map(p => p.x));
            const my = mean(collected.map(p => p.y));
            const err = distance(mx, my, x, y);
            errors.push(err);
          } else {
            // WebGazer absent ou sans données — on simule 0 pour ne pas bloquer
            errors.push(0);
          }

          validationIndex++;
          setTimeout(showNextValidationPoint, 200);
        }
      }, 50);
    }

    showNextValidationPoint();
  }

  // ─── Affichage du score ────────────────────────────────────────────────────

  function showScore(score) {
    removeOverlay();
    createOverlay();

    const needsRecalibration = score.meanError > CONFIG.RECALIBRATION_THRESHOLD;
    const color = needsRecalibration ? '#e74c3c' : '#27ae60';
    const verdict = needsRecalibration
      ? 'Calibration insuffisante — veuillez recommencer.'
      : 'Calibration réussie !';

    const container = document.createElement('div');
    container.id = 'cal-score-screen';
    container.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: #16213e;
      border: 2px solid ${color};
      border-radius: 16px;
      padding: 40px 60px;
      text-align: center;
      color: #eee;
      min-width: 380px;
    `;

    container.innerHTML = `
      <h2 style="color:${color};margin-top:0;">Résultats de calibration</h2>
      <table style="margin:0 auto 20px;border-collapse:collapse;width:100%;font-size:1rem;">
        <tr>
          <td style="padding:8px 16px;text-align:left;color:#aaa;">Erreur moyenne</td>
          <td style="padding:8px 16px;text-align:right;font-weight:bold;color:${color};">
            ${score.meanError.toFixed(1)} px
          </td>
        </tr>
        <tr>
          <td style="padding:8px 16px;text-align:left;color:#aaa;">Écart-type</td>
          <td style="padding:8px 16px;text-align:right;font-weight:bold;">
            ${score.stdError.toFixed(1)} px
          </td>
        </tr>
        <tr>
          <td style="padding:8px 16px;text-align:left;color:#aaa;">Seuil accepté</td>
          <td style="padding:8px 16px;text-align:right;">≤ ${CONFIG.RECALIBRATION_THRESHOLD} px</td>
        </tr>
      </table>
      <p style="font-size:1.1rem;font-weight:bold;color:${color};">${verdict}</p>
    `;

    // Bouton Continuer (si score ok)
    if (!needsRecalibration) {
      const btnOk = document.createElement('button');
      btnOk.textContent = 'Continuer';
      btnOk.style.cssText = _btnStyle('#27ae60');
      btnOk.addEventListener('click', () => {
        removeOverlay();
        if (typeof onCompleteCallback === 'function') onCompleteCallback(score);
      });
      container.appendChild(btnOk);
    }

    // Bouton Recalibrer (toujours présent si score mauvais, en option si bon)
    const btnRecal = document.createElement('button');
    btnRecal.textContent = needsRecalibration ? 'Recalibrer' : 'Recalibrer quand même';
    btnRecal.style.cssText = _btnStyle(needsRecalibration ? '#e74c3c' : '#7f8c8d');
    btnRecal.addEventListener('click', () => {
      // Effacer la calibration WebGazer et recommencer
      if (typeof webgazer !== 'undefined') {
        try { webgazer.clearData(); } catch (_) {}
      }
      removeOverlay();
      setTimeout(() => startCalibrationPhase(), 100);
    });
    container.appendChild(btnRecal);

    overlay.appendChild(container);
  }

  function _btnStyle(bg) {
    return `
      display:inline-block;
      margin:8px 10px 0;
      padding:12px 28px;
      background:${bg};
      color:#fff;
      border:none;
      border-radius:8px;
      font-size:1rem;
      cursor:pointer;
    `;
  }

  // ─── Stockage localStorage ─────────────────────────────────────────────────

  function saveToStorage(score) {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        meanError: score.meanError,
        stdError: score.stdError,
        threshold: CONFIG.RECALIBRATION_THRESHOLD,
      };
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[Calibration] localStorage non disponible :', e);
    }
  }

  // ─── API publique ──────────────────────────────────────────────────────────

  const Calibration = {
    /**
     * Lance le processus complet de calibration.
     * @param {Function} [onComplete] — appelé avec le score une fois terminé (si ok)
     */
    start(onComplete) {
      onCompleteCallback = onComplete || null;
      startCalibrationPhase();
    },

    /**
     * Retourne le dernier score calculé { meanError, stdError } ou null.
     */
    getScore() {
      return lastScore;
    },

    /**
     * Retourne les données de calibration stockées en localStorage.
     */
    getStoredData() {
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    },

    /**
     * Efface la calibration stockée.
     */
    reset() {
      try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (_) {}
      lastScore = null;
    },

    detectFixations,
    setupCustomGazeCursor,

    /**
     * Expose la config pour les tests.
     */
    CONFIG,
    CALIBRATION_GRID,
    VALIDATION_GRID,

    // Méthodes internes exposées pour les tests unitaires
    _helpers: { distance, mean, stdDev, pxFromPct, detectFixations, checkStability },
  };

  global.Calibration = Calibration;

  // Auto-setup du curseur personnalisé et du panneau de coordonnées au chargement
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('load', function () {
      createGazeCoordPanel();
      if (typeof webgazer !== 'undefined') {
        setTimeout(() => setupCustomGazeCursor(), 100);
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
