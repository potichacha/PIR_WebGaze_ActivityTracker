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

    /**
     * Expose la config pour les tests.
     */
    CONFIG,
    CALIBRATION_GRID,
    VALIDATION_GRID,

    // Méthodes internes exposées pour les tests unitaires
    _helpers: { distance, mean, stdDev, pxFromPct },
  };

  global.Calibration = Calibration;
})(typeof window !== 'undefined' ? window : global);
