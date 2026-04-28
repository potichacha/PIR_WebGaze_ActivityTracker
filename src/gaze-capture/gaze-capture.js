/**
 * gaze-capture.js — Module de capture du flux de regard (US-2.1)
 *
 * API publique :
 *   GazeCapture.start()               → Promise<void>
 *   GazeCapture.stop()                → void
 *   GazeCapture.onGazeData(callback)  → void  (callback: {x, y, timestamp})
 *   GazeCapture.offGazeData(callback) → void
 *   GazeCapture.getStatus()           → 'idle' | 'running' | 'error'
 *   GazeCapture.getRawData()          → Array<{x, y, timestamp}>
 *   GazeCapture.clearRawData()        → void
 */

(function (global) {
  'use strict';

  // ─── État interne ──────────────────────────────────────────────────────────
  let _status    = 'idle';      // 'idle' | 'running' | 'error'
  let _rawData   = [];
  let _callbacks = [];
  let _errorMsg  = null;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function _setStatus(s) {
    _status = s;
    _updateStatusUI(s);
  }

  function _emit(point) {
    _rawData.push(point);
    for (let i = 0; i < _callbacks.length; i++) {
      try { _callbacks[i](point); } catch (_) {}
    }
  }

  // ─── UI d'indicateur de statut ─────────────────────────────────────────────

  function _ensureStatusIndicator() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gc-status-indicator')) return;

    const el = document.createElement('div');
    el.id = 'gc-status-indicator';
    el.style.cssText = `
      position: fixed; bottom: 16px; left: 16px;
      z-index: 99998;
      display: flex; align-items: center; gap: 8px;
      background: rgba(15,15,26,0.88);
      border: 1px solid rgba(78,205,196,0.3);
      border-radius: 20px;
      padding: 6px 14px;
      font-family: Arial, sans-serif;
      font-size: 0.8rem; color: #bbb;
      pointer-events: none;
      transition: opacity 0.3s;
    `;
    el.innerHTML = `
      <span id="gc-status-dot" style="
        display:inline-block; width:8px; height:8px;
        border-radius:50%; background:#888; flex-shrink:0;
      "></span>
      <span id="gc-status-text">Webcam inactive</span>
    `;
    document.body.appendChild(el);
  }

  function _updateStatusUI(status) {
    if (typeof document === 'undefined') return;
    const dot  = document.getElementById('gc-status-dot');
    const text = document.getElementById('gc-status-text');
    if (!dot || !text) return;

    const map = {
      idle:    { color: '#888',    label: 'Webcam inactive' },
      running: { color: '#27ae60', label: 'Regard capturé' },
      error:   { color: '#e74c3c', label: _errorMsg || 'Erreur webcam' },
    };
    const s = map[status] || map.idle;
    dot.style.background  = s.color;
    text.textContent      = s.label;

    if (status === 'running') {
      dot.style.animation = 'gc-blink 1.4s infinite';
    } else {
      dot.style.animation = 'none';
    }
  }

  function _injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gc-styles')) return;
    const style = document.createElement('style');
    style.id = 'gc-styles';
    style.textContent = `
      @keyframes gc-blink {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Vérification webcam via getUserMedia ─────────────────────────────────

  function _checkWebcamAvailable() {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia) {
        reject(new Error('getUserMedia non supporté sur ce navigateur.'));
        return;
      }
      // Demande une permission minimale pour valider l'accès
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
          // Libérer immédiatement — WebGazer gère sa propre capture
          stream.getTracks().forEach(t => t.stop());
          resolve();
        })
        .catch(err => {
          let msg;
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            msg = 'Permission webcam refusée. Autorisez l\'accès dans les paramètres du navigateur.';
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            msg = 'Aucune webcam détectée.';
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            msg = 'Webcam utilisée par une autre application.';
          } else {
            msg = 'Erreur webcam : ' + err.message;
          }
          reject(new Error(msg));
        });
    });
  }

  // ─── API publique ──────────────────────────────────────────────────────────

  const GazeCapture = {

    /**
     * Démarre la capture.
     * Vérifie la permission webcam puis initialise WebGazer.
     * @returns {Promise<void>}
     */
    start() {
      if (_status === 'running') return Promise.resolve();

      _injectStyles();
      _ensureStatusIndicator();
      _setStatus('idle');

      return _checkWebcamAvailable()
        .then(() => {
          if (typeof webgazer === 'undefined') {
            throw new Error('WebGazer non chargé. Incluez webgazer.min.js avant ce module.');
          }

          // Désactiver le mouse-move comme source d'entraînement
          // (mouse-move pollue le modèle — issue #39 WebGazer)
          try { webgazer.removeMouseEventListeners(); } catch (_) {}

          webgazer.setGazeListener((data, elapsed) => {
            if (!data || data.x == null || data.y == null) return;
            if (_status !== 'running') return;
            _emit({ x: data.x, y: data.y, timestamp: Date.now() });
          });

          return webgazer.begin();
        })
        .then(() => {
          webgazer.showVideo(false)
                  .showFaceOverlay(false)
                  .showFaceFeedbackBox(false)
                  .showPredictionPoints(false);
          _setStatus('running');
        })
        .catch(err => {
          _errorMsg = err.message;
          _setStatus('error');
          throw err;
        });
    },

    /**
     * Arrête la capture et libère les ressources.
     */
    stop() {
      if (typeof webgazer !== 'undefined') {
        try { webgazer.clearGazeListener(); } catch (_) {}
        try { webgazer.end();               } catch (_) {}
      }
      _setStatus('idle');
      _errorMsg = null;
    },

    /**
     * Enregistre un callback appelé à chaque point de regard.
     * @param {function({x: number, y: number, timestamp: number}): void} callback
     */
    onGazeData(callback) {
      if (typeof callback !== 'function') return;
      if (!_callbacks.includes(callback)) _callbacks.push(callback);
    },

    /**
     * Supprime un callback précédemment enregistré.
     */
    offGazeData(callback) {
      _callbacks = _callbacks.filter(cb => cb !== callback);
    },

    /**
     * @returns {'idle'|'running'|'error'}
     */
    getStatus() { return _status; },

    /**
     * @returns {string|null} Message d'erreur si status === 'error'
     */
    getErrorMessage() { return _errorMsg; },

    /**
     * @returns {Array<{x: number, y: number, timestamp: number}>}
     */
    getRawData() { return _rawData.slice(); },

    /**
     * Vide le buffer de données brutes.
     */
    clearRawData() { _rawData = []; },
  };

  global.GazeCapture = GazeCapture;

  // Nettoyage automatique à la fermeture de la page
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () {
      if (_status === 'running') GazeCapture.stop();
    });
  }

})(typeof window !== 'undefined' ? window : global);
