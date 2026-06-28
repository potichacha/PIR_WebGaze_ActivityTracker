/**
 * gaze-capture.js
 *
 * Capture du flux de regard via WebGazer. Le module vérifie d'abord l'accès à la
 * webcam, initialise WebGazer, puis diffuse chaque point de regard aux callbacks
 * enregistrés tout en les accumulant dans un buffer de données brutes.
 *
 * Un petit indicateur de statut est affiché en bas à gauche de la page pour
 * refléter l'état courant (inactif, en cours, erreur). Son style provient de
 * gaze-capture.css ; seules la couleur du point et son animation sont mises à
 * jour dynamiquement via JS.
 *
 * API publique :
 *   GazeCapture.start()               Promise<void>
 *   GazeCapture.stop()                void
 *   GazeCapture.onGazeData(callback)  void  (callback reçoit {x, y, timestamp})
 *   GazeCapture.offGazeData(callback) void
 *   GazeCapture.getStatus()           'idle' | 'running' | 'error'
 *   GazeCapture.getErrorMessage()     string | null
 *   GazeCapture.getRawData()          Array<{x, y, timestamp}>
 *   GazeCapture.clearRawData()        void
 */

(function (global) {
  'use strict';

  let status = 'idle';
  let rawData = [];
  let callbacks = [];
  let errorMessage = null;

  const CAMERA_CONSTRAINTS = {
    video: {
      width:      { min: 640, ideal: 1280, max: 1920 },
      height:     { min: 480, ideal: 720,  max: 1080 },
      frameRate:  { ideal: 30, max: 60 },
      facingMode: 'user'
    }
  };

  function setStatus(next) {
    status = next;
    updateStatusUI(next);
  }

  function emit(point) {
    rawData.push(point);
    for (let i = 0; i < callbacks.length; i++) {
      try {
        callbacks[i](point);
      } catch (_) {}
    }
  }

  function ensureStatusIndicator() {
    if (typeof document === 'undefined') {
      return;
    }
    if (document.getElementById('gc-status-indicator')) {
      return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'gc-status-indicator';

    const dot = document.createElement('span');
    dot.id = 'gc-status-dot';

    const text = document.createElement('span');
    text.id = 'gc-status-text';
    text.textContent = 'Webcam inactive';

    indicator.appendChild(dot);
    indicator.appendChild(text);
    document.body.appendChild(indicator);
  }

  function statusAppearance(current) {
    if (current === 'running') {
      return { color: '#3B82F6', label: 'Regard capturé' };
    }
    if (current === 'error') {
      return { color: '#9CA3AF', label: errorMessage || 'Erreur webcam' };
    }
    return { color: '#374151', label: 'Webcam inactive' };
  }

  function updateStatusUI(current) {
    if (typeof document === 'undefined') {
      return;
    }
    const dot  = document.getElementById('gc-status-dot');
    const text = document.getElementById('gc-status-text');
    if (!dot || !text) {
      return;
    }

    const appearance = statusAppearance(current);
    dot.style.background = appearance.color;
    text.textContent = appearance.label;

    if (current === 'running') {
      dot.style.animation = 'gc-blink 1.4s infinite';
    } else {
      dot.style.animation = 'none';
    }
  }

  function webcamErrorMessage(err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Permission webcam refusée. Autorisez l\'accès dans les paramètres du navigateur.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'Aucune webcam détectée.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Webcam utilisée par une autre application.';
    }
    return 'Erreur webcam : ' + err.message;
  }

  function getUserMediaSupported() {
    return typeof navigator !== 'undefined'
      && navigator.mediaDevices
      && navigator.mediaDevices.getUserMedia;
  }

  function checkWebcamAvailable() {
    return new Promise((resolve, reject) => {
      if (!getUserMediaSupported()) {
        reject(new Error('getUserMedia non supporté sur ce navigateur.'));
        return;
      }
      navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        .then(stream => {
          stream.getTracks().forEach(track => track.stop());
          resolve();
        })
        .catch(err => {
          reject(new Error(webcamErrorMessage(err)));
        });
    });
  }

  function configureWebgazer() {
    try { webgazer.setCameraConstraints(CAMERA_CONSTRAINTS); } catch (_) {}
    try { webgazer.setInternalVideoBufferSizes(640, 480); } catch (_) {}
    try { webgazer.removeMouseEventListeners(); } catch (_) {}
  }

  function onWebgazerGaze(data) {
    if (!data || data.x == null || data.y == null) {
      return;
    }
    if (status !== 'running') {
      return;
    }
    emit({ x: data.x, y: data.y, timestamp: Date.now() });
  }

  function hideWebgazerOverlays() {
    webgazer.showVideo(false)
            .showFaceOverlay(false)
            .showFaceFeedbackBox(false)
            .showPredictionPoints(false);
  }

  const GazeCapture = {

    start() {
      if (status === 'running') {
        return Promise.resolve();
      }

      ensureStatusIndicator();
      setStatus('idle');

      return checkWebcamAvailable()
        .then(() => {
          if (typeof webgazer === 'undefined') {
            throw new Error('WebGazer non chargé. Incluez webgazer.min.js avant ce module.');
          }
          configureWebgazer();
          webgazer.setGazeListener(onWebgazerGaze);
          return webgazer.begin();
        })
        .then(() => {
          hideWebgazerOverlays();
          setStatus('running');
        })
        .catch(err => {
          errorMessage = err.message;
          setStatus('error');
          throw err;
        });
    },

    stop() {
      if (typeof webgazer !== 'undefined') {
        try { webgazer.clearGazeListener(); } catch (_) {}
        try { webgazer.end(); } catch (_) {}
      }
      setStatus('idle');
      errorMessage = null;
    },

    onGazeData(callback) {
      if (typeof callback !== 'function') {
        return;
      }
      if (!callbacks.includes(callback)) {
        callbacks.push(callback);
      }
    },

    offGazeData(callback) {
      callbacks = callbacks.filter(cb => cb !== callback);
    },

    getStatus() {
      return status;
    },

    getErrorMessage() {
      return errorMessage;
    },

    getRawData() {
      return rawData.slice();
    },

    clearRawData() {
      rawData = [];
    },
  };

  global.GazeCapture = GazeCapture;

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () {
      if (status === 'running') {
        GazeCapture.stop();
      }
    });
  }

})(typeof window !== 'undefined' ? window : global);
