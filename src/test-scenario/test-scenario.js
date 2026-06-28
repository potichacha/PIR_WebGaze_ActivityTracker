/**
 * test-scenario.js
 *
 * Scénario de test guidé, automatique et réutilisable, indépendant du moteur
 * (WebGazer ou MediaPipe). La page hôte continue de journaliser le regard via son
 * propre gazeListener ; ce module se contente d'orchestrer le déroulé.
 *
 * Pour chaque page (graphique en barres, en courbes, puis nuage de points) :
 *   1. Amorçage : un cercle rouge s'affiche successivement sur quelques AOI
 *      réelles pendant amorceMs, en demandant au participant de le fixer ;
 *   2. Exploration libre : le cercle disparaît et le participant explore la page
 *      librement pendant exploreMs ;
 *   3. passage automatique à la page suivante.
 *
 * À chaque étape, le contexte (test_case_id, target_aoi_id, position de la cible)
 * est transmis via les callbacks onPhase afin que l'hôte puisse étiqueter chaque
 * point de regard pour l'analyse a posteriori.
 *
 * Les styles de la cible et du bandeau proviennent de test-scenario.css.
 * La couleur de bordure du bandeau est mise à jour via style.borderColor
 * pour distinguer la phase cible (rouge) de la phase libre (turquoise).
 *
 * API publique :
 *   TestScenario.run(opts)
 *     opts.pages       liste de pages { id, label, activate(), getAOIs() }
 *     opts.amorceMs, opts.exploreMs, opts.targetsPerPage
 *     opts.onPhase(phase, info)   'amorce' | 'free' | 'page'
 *     opts.onProgress(text)       texte du bandeau d'état
 *     opts.onDone()               fin du scénario
 *   TestScenario.stop()
 */
(function (global) {
  'use strict';

  var _running = false;
  var _timers = [];
  var _target = null;
  var _banner = null;

  function optionOr(value, fallback) {
    if (value != null) {
      return value;
    }
    return fallback;
  }

  function _clearTimers() {
    _timers.forEach(clearTimeout);
    _timers = [];
  }

  function ensureTarget() {
    if (_target) {
      return;
    }
    _target = document.createElement('div');
    _target.id = 'scenario-target';
    document.body.appendChild(_target);

    if (!document.getElementById('scenario-style')) {
      var st = document.createElement('style');
      st.id = 'scenario-style';
      st.textContent = '@keyframes scenPulse{'
        + '0%,100%{transform:translate(-50%,-50%) scale(1);}'
        + '50%{transform:translate(-50%,-50%) scale(1.25);}}';
      document.head.appendChild(st);
    }
  }

  function ensureBanner() {
    if (_banner) {
      return;
    }
    _banner = document.createElement('div');
    _banner.id = 'scenario-banner';
    document.body.appendChild(_banner);
  }

  function _ensureEls() {
    ensureTarget();
    ensureBanner();
  }

  function _hideEls() {
    if (_target) {
      _target.style.display = 'none';
    }
    if (_banner) {
      _banner.style.display = 'none';
    }
  }

  function showBanner(text, color) {
    _banner.style.display = 'block';
    _banner.style.borderColor = color || 'rgba(231,76,60,.5)';
    _banner.textContent = text;
  }

  function realAOIs(aois) {
    var real = aois.filter(function (a) {
      return /^(bar-|point-|col-)/.test(a.id);
    });
    if (real.length) {
      return real;
    }
    return aois;
  }

  function selectTargets(real, count) {
    var targets = [];
    if (!real.length) {
      return targets;
    }
    var step = Math.max(1, Math.floor(real.length / count));
    for (var i = 0; i < real.length && targets.length < count; i += step) {
      targets.push(real[i]);
    }
    return targets;
  }

  function run(opts) {
    opts = opts || {};
    var pages = opts.pages || [];
    var AMORCE = optionOr(opts.amorceMs, 3000);
    var EXPLORE = optionOr(opts.exploreMs, 15000);
    var N_TARGETS = optionOr(opts.targetsPerPage, 3);
    if (!pages.length) {
      if (opts.onDone) {
        opts.onDone();
      }
      return;
    }

    _running = true;
    _ensureEls();

    var pageIdx = 0;

    function nextPage() {
      if (!_running) {
        return;
      }
      if (pageIdx >= pages.length) {
        finish();
        return;
      }
      var page = pages[pageIdx];
      if (page.activate) {
        page.activate();
      }
      if (opts.onPhase) {
        opts.onPhase('page', { index: pageIdx, page: page });
      }

      _timers.push(setTimeout(function () {
        if (!_running) {
          return;
        }
        var aois = (page.getAOIs ? page.getAOIs() : []) || [];
        var targets = selectTargets(realAOIs(aois), N_TARGETS);
        runTargets(page, targets, 0);
      }, 600));
    }

    function runTargets(page, targets, i) {
      if (!_running) {
        return;
      }
      if (i >= targets.length) {
        _target.style.display = 'none';
        startFree(page);
        return;
      }
      var aoi = targets[i];
      var caseId = page.id + '-cible' + (i + 1);
      var cx = aoi.x + aoi.width / 2;
      var cy = aoi.y + aoi.height / 2;
      _target.style.left = cx + 'px';
      _target.style.top = cy + 'px';
      _target.style.display = 'block';
      showBanner('Cible ' + (i + 1) + '/' + targets.length + ' — regardez le cercle rouge');
      if (opts.onPhase) {
        opts.onPhase('amorce', { page: page, aoi: aoi, test_case_id: caseId, index: i, target_x: cx, target_y: cy });
      }
      _timers.push(setTimeout(function () {
        if (!_running) {
          return;
        }
        runTargets(page, targets, i + 1);
      }, AMORCE));
    }

    function startFree(page) {
      var caseId = page.id + '-free';
      if (opts.onPhase) {
        opts.onPhase('free', { page: page, test_case_id: caseId });
      }
      var remaining = Math.round(EXPLORE / 1000);
      showBanner('Explorez librement — ' + remaining + ' s', 'rgba(78,205,196,.5)');
      var iv = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(iv);
        } else {
          showBanner('Explorez librement — ' + remaining + ' s', 'rgba(78,205,196,.5)');
        }
      }, 1000);
      _timers.push(setTimeout(function () {
        if (!_running) {
          return;
        }
        clearInterval(iv);
        pageIdx++;
        nextPage();
      }, EXPLORE));
    }

    function finish() {
      _running = false;
      _hideEls();
      if (opts.onDone) {
        opts.onDone();
      }
    }

    if (opts.onProgress) {
      opts.onProgress('Scénario de test en cours…');
    }
    nextPage();
  }

  function stop() {
    _running = false;
    _clearTimers();
    _hideEls();
  }

  global.TestScenario = { run: run, stop: stop };

})(typeof window !== 'undefined' ? window : global);
