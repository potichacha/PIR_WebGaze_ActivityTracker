/**
 * ambient-light.js
 *
 * Mesure de la luminosité ambiante exprimée en lux. Deux sources sont utilisées,
 * dans l'ordre de préférence :
 *   1. AmbientLightSensor, l'API matérielle du capteur de luminosité, quand elle
 *      est disponible et autorisée par le navigateur ;
 *   2. à défaut, une estimation calculée à partir de la luminance moyenne du flux
 *      webcam. Cette valeur n'est pas une mesure absolue mais un proxy échelonné.
 *
 * La valeur courante est poussée en continu dans GazeLogger.setLux().
 *
 * API publique :
 *   AmbientLight.start(videoEl?)  démarre la mesure (videoEl sert au proxy webcam)
 *   AmbientLight.stop()
 *   AmbientLight.getLux()         number | null
 *   AmbientLight.getSource()      'sensor' | 'webcam' | null
 */
(function (global) {
  'use strict';

  var lux = null;
  var source = null;
  var sensor = null;
  var interval = null;
  var video = null;
  var canvas = null;
  var ctx = null;

  function publish(value) {
    lux = value;
    try {
      if (global.GazeLogger && global.GazeLogger.setLux) {
        global.GazeLogger.setLux(value);
      }
    } catch (_) {}
  }

  function stopSensor() {
    if (!sensor) {
      return;
    }
    try {
      sensor.stop();
    } catch (_) {}
    sensor = null;
  }

  function startSensor() {
    if (typeof global.AmbientLightSensor !== 'function') {
      return false;
    }
    try {
      sensor = new global.AmbientLightSensor({ frequency: 2 });
      sensor.addEventListener('reading', onSensorReading);
      sensor.addEventListener('error', onSensorError);
      sensor.start();
      source = 'sensor';
      return true;
    } catch (_) {
      return false;
    }
  }

  function onSensorReading() {
    if (typeof sensor.illuminance === 'number') {
      source = 'sensor';
      publish(sensor.illuminance);
    }
  }

  function onSensorError() {
    stopSensor();
    startWebcam(video);
  }

  function averageLuminance(pixels) {
    var total = 0;
    for (var i = 0; i < pixels.length; i += 4) {
      total += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    return total / (32 * 24);
  }

  function luminanceToLux(luminance) {
    return Math.round((luminance / 255) * 800);
  }

  function sampleWebcamLuminance() {
    try {
      if (!video || video.readyState < 2) {
        return;
      }
      ctx.drawImage(video, 0, 0, 32, 24);
      var pixels = ctx.getImageData(0, 0, 32, 24).data;
      publish(luminanceToLux(averageLuminance(pixels)));
    } catch (_) {}
  }

  function startWebcam(videoEl) {
    if (!videoEl) {
      return false;
    }
    video = videoEl;
    canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    source = 'webcam';
    interval = setInterval(sampleWebcamLuminance, 700);
    return true;
  }

  var AmbientLight = {
    start: function (videoEl) {
      this.stop();
      video = videoEl || null;
      if (startSensor()) {
        return;
      }
      startWebcam(videoEl);
    },
    stop: function () {
      stopSensor();
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      source = null;
    },
    getLux: function () {
      return lux;
    },
    getSource: function () {
      return source;
    },
  };

  global.AmbientLight = AmbientLight;

})(typeof window !== 'undefined' ? window : global);
