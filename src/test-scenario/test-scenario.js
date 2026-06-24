/**
 * test-scenario.js — Scénario de test guidé, automatique et réutilisable.
 *
 * Indépendant du moteur (WebGazer / MediaPipe). La page hôte continue de logger le
 * regard via son propre gazeListener ; le scénario se contente d'orchestrer :
 *   pour chaque page (bar → line → scatter) :
 *     1. AMORÇAGE  : un cercle rouge ~AMORCE_MS sur une AOI réelle (« regardez ici »),
 *     2. LIBRE     : exploration libre EXPLORE_MS (15 s) — le cercle disparaît,
 *     3. passage automatique à la page suivante.
 * Le contexte (test_case_id, target_aoi_id) est posé dans GazeLogger pour étiqueter
 * chaque point de regard, ce qui permet l'analyse a posteriori.
 *
 * API :
 *   TestScenario.run(opts) où opts = {
 *     pages: [{ id, label, activate(): void, getAOIs(): [{id,x,y,width,height,label}] }],
 *     amorceMs, exploreMs,
 *     onPhase(phase, info): void,   // 'amorce'|'free'|'page' — pour MAJ UI/log
 *     onProgress(text): void,       // bandeau d'état
 *     onDone(): void,               // fin du scénario
 *   }
 *   TestScenario.stop()
 */
(function (global) {
  'use strict';

  var _running = false;
  var _timers = [];
  var _target = null, _ring = null, _banner = null;

  function _clearTimers() { _timers.forEach(clearTimeout); _timers = []; }

  function _ensureEls() {
    if (!_target) {
      _target = document.createElement('div');
      _target.id = 'scenario-target';
      _target.style.cssText =
        'position:fixed;width:64px;height:64px;border-radius:50%;z-index:9500;pointer-events:none;'
        + 'transform:translate(-50%,-50%);display:none;'
        + 'background:radial-gradient(circle at 50% 50%, rgba(231,76,60,.95), rgba(231,76,60,.35) 60%, transparent 72%);'
        + 'box-shadow:0 0 26px 9px rgba(231,76,60,.5);animation:scenPulse 1s ease-in-out infinite;';
      document.body.appendChild(_target);
      if (!document.getElementById('scenario-style')) {
        var st = document.createElement('style'); st.id = 'scenario-style';
        st.textContent = '@keyframes scenPulse{0%,100%{transform:translate(-50%,-50%) scale(1);}50%{transform:translate(-50%,-50%) scale(1.25);}}';
        document.head.appendChild(st);
      }
    }
    if (!_banner) {
      _banner = document.createElement('div');
      _banner.id = 'scenario-banner';
      _banner.style.cssText =
        'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9501;'
        + 'background:rgba(15,15,26,.92);border:1px solid rgba(231,76,60,.5);border-radius:10px;'
        + 'padding:9px 20px;font-size:.95rem;color:#eee;font-family:Arial,sans-serif;display:none;';
      document.body.appendChild(_banner);
    }
  }

  function _hideEls() {
    if (_target) _target.style.display = 'none';
    if (_banner) _banner.style.display = 'none';
  }

  function _banr(text, color) {
    _banner.style.display = 'block';
    _banner.style.borderColor = color || 'rgba(231,76,60,.5)';
    _banner.textContent = text;
  }

  function run(opts) {
    opts = opts || {};
    var pages = opts.pages || [];
    var AMORCE = opts.amorceMs != null ? opts.amorceMs : 3000;
    var EXPLORE = opts.exploreMs != null ? opts.exploreMs : 15000;
    var N_TARGETS = opts.targetsPerPage != null ? opts.targetsPerPage : 3;
    if (!pages.length) { if (opts.onDone) opts.onDone(); return; }

    _running = true;
    _ensureEls();

    var pageIdx = 0;
    function nextPage() {
      if (!_running) return;
      if (pageIdx >= pages.length) { finish(); return; }
      var page = pages[pageIdx];
      if (page.activate) page.activate();
      if (opts.onPhase) opts.onPhase('page', { index: pageIdx, page: page });

      // Laisser la visualisation se rendre, puis choisir N AOI bien réparties.
      _timers.push(setTimeout(function () {
        if (!_running) return;
        var aois = (page.getAOIs ? page.getAOIs() : []) || [];
        // Filtrer les AOI « réelles » (barres/points/colonnes), pas les axes.
        var real = aois.filter(function (a) {
          return /^(bar-|point-|col-)/.test(a.id);
        });
        if (!real.length) real = aois;
        // Sélection répartie de N cibles.
        var targets = [];
        if (real.length) {
          var step = Math.max(1, Math.floor(real.length / N_TARGETS));
          for (var i = 0; i < real.length && targets.length < N_TARGETS; i += step) targets.push(real[i]);
        }
        runTargets(page, targets, 0);
      }, 600));
    }

    // Affiche successivement chaque cercle rouge (~AMORCE ms), chacun étiqueté.
    function runTargets(page, targets, i) {
      if (!_running) return;
      if (i >= targets.length) { _target.style.display = 'none'; startFree(page); return; }
      var aoi = targets[i];
      var caseId = page.id + '-cible' + (i + 1);
      var cx = aoi.x + aoi.width / 2, cy = aoi.y + aoi.height / 2;
      _target.style.left = cx + 'px'; _target.style.top = cy + 'px';
      _target.style.display = 'block';
      _banr('Cible ' + (i + 1) + '/' + targets.length + ' — regardez le cercle rouge');
      if (opts.onPhase) opts.onPhase('amorce', { page: page, aoi: aoi, test_case_id: caseId, index: i, target_x: cx, target_y: cy });
      _timers.push(setTimeout(function () {
        if (!_running) return;
        runTargets(page, targets, i + 1);
      }, AMORCE));
    }

    function startFree(page) {
      var caseId = page.id + '-free';
      if (opts.onPhase) opts.onPhase('free', { page: page, test_case_id: caseId });
      var total = Math.round(EXPLORE / 1000);
      var remaining = total;
      _banr('Explorez librement — ' + remaining + ' s', 'rgba(78,205,196,.5)');
      var iv = setInterval(function () {
        remaining--;
        if (remaining <= 0) { clearInterval(iv); }
        else _banr('Explorez librement — ' + remaining + ' s', 'rgba(78,205,196,.5)');
      }, 1000);
      _timers.push(setTimeout(function () {
        if (!_running) return;
        clearInterval(iv);
        pageIdx++;
        nextPage();
      }, EXPLORE));
    }

    function finish() {
      _running = false;
      _hideEls();
      if (opts.onDone) opts.onDone();
    }

    if (opts.onProgress) opts.onProgress('Scénario de test en cours…');
    nextPage();
  }

  function stop() { _running = false; _clearTimers(); _hideEls(); }

  global.TestScenario = { run: run, stop: stop };

})(typeof window !== 'undefined' ? window : global);
