/**
 * ambient-light.js — Mesure de la luminosité ambiante (lux).
 *
 * Deux sources, dans l'ordre de préférence :
 *   1. AmbientLightSensor (API du capteur de luminosité, si disponible et autorisée),
 *   2. Repli : estimation à partir de la luminance moyenne du flux webcam (les lux
 *      ne sont pas mesurés directement mais on en donne un proxy échelonné).
 *
 * La valeur courante est poussée en continu dans GazeLogger.setLux().
 *
 * API :
 *   AmbientLight.start(videoEl?)  → démarre la mesure (videoEl optionnel pour le proxy webcam)
 *   AmbientLight.stop()
 *   AmbientLight.getLux()         → number | null
 *   AmbientLight.getSource()      → 'sensor' | 'webcam' | null
 */
(function (global) {
  'use strict';

  var _lux = null;
  var _source = null;
  var _sensor = null;
  var _interval = null;
  var _canvas = null, _ctx = null, _video = null;

  function _publish(v) {
    _lux = v;
    try { if (global.GazeLogger && global.GazeLogger.setLux) global.GazeLogger.setLux(v); } catch (_) {}
  }

  function _startSensor() {
    if (typeof global.AmbientLightSensor !== 'function') return false;
    try {
      _sensor = new global.AmbientLightSensor({ frequency: 2 });
      _sensor.addEventListener('reading', function () {
        if (typeof _sensor.illuminance === 'number') { _source = 'sensor'; _publish(_sensor.illuminance); }
      });
      _sensor.addEventListener('error', function () { _stopSensor(); _startWebcam(_video); });
      _sensor.start();
      _source = 'sensor';
      return true;
    } catch (_) { return false; }
  }
  function _stopSensor() {
    if (_sensor) { try { _sensor.stop(); } catch (_) {} _sensor = null; }
  }

  // Proxy webcam : luminance moyenne [0,255] → échelle lux indicative (non absolue).
  function _startWebcam(videoEl) {
    if (!videoEl) return false;
    _video = videoEl;
    _canvas = document.createElement('canvas');
    _canvas.width = 32; _canvas.height = 24;
    _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    _source = 'webcam';
    _interval = setInterval(function () {
      try {
        if (!_video || _video.readyState < 2) return;
        _ctx.drawImage(_video, 0, 0, 32, 24);
        var data = _ctx.getImageData(0, 0, 32, 24).data;
        var total = 0;
        for (var i = 0; i < data.length; i += 4) {
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        var lum = total / (32 * 24); // 0..255
        // Mapping indicatif : 0→0 lux, 255→~800 lux (échelle perçue, non calibrée).
        _publish(Math.round((lum / 255) * 800));
      } catch (_) {}
    }, 700);
    return true;
  }

  var AmbientLight = {
    start: function (videoEl) {
      this.stop();
      _video = videoEl || null;
      if (_startSensor()) return;
      _startWebcam(videoEl);
    },
    stop: function () {
      _stopSensor();
      if (_interval) { clearInterval(_interval); _interval = null; }
      _source = null;
    },
    getLux: function () { return _lux; },
    getSource: function () { return _source; },
  };

  global.AmbientLight = AmbientLight;

})(typeof window !== 'undefined' ? window : global);
