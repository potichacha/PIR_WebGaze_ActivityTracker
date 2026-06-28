/**
 * results-view.js
 *
 * Écran de résultats structuré et lisible d'une session de test, présenté en deux
 * onglets :
 *   1. Analyse — un tableau par stimulus : AOI ciblée, page regardée, AOI
 *      réellement la plus regardée, score « sur la cible », nombre de points et
 *      durée.
 *   2. Parcours du regard — une heatmap et un scanpath par page, dessinés sur le
 *      vrai graphique correspondant (et non par-dessus la page courante).
 *
 * Le module est indépendant des moteurs : il ne consomme que les données
 * exportées par GazeLogger. Un bouton flottant permet de rouvrir l'écran à tout
 * moment après le test.
 *
 * Les styles de l'overlay proviennent de results-view.css.
 * Les couleurs dynamiques (moteur, score) sont exprimées via des classes CSS
 * modificatrices (BEM) plutôt que des styles inline JS.
 *
 * API publique : ResultsView.show(sessionData) / ResultsView.hide()
 *                ResultsView.analyze(sessionData)
 *                ResultsView.showButton(data) / ResultsView.hideButton()
 */
(function (global) {
  'use strict';

  var ID     = 'results-view-overlay';
  var BTN_ID = 'results-view-button';

  var HIT_RADIUS = 90;
  var RADIUS_MAX = 450;

  function hide() {
    var e = document.getElementById(ID);
    if (e) {
      e.remove();
    }
  }

  function _chartFor(v) {
    var name = v.chartName;
    var w = (typeof window !== 'undefined') ? window[name] : null;
    if (w && typeof w.init === 'function') {
      return w;
    }
    var g = global[name];
    if (g && typeof g.init === 'function') {
      return g;
    }
    return null;
  }

  function viewDefinitions() {
    return [
      { key: 'bar',     title: 'Bar Chart',    chartName: 'BarChart',     cid: 'rv-bar' },
      { key: 'line',    title: 'Line Chart',   chartName: 'LineChart',    cid: 'rv-line' },
      { key: 'scatter', title: 'Scatter Plot', chartName: 'ScatterChart', cid: 'rv-scatter' },
    ];
  }

  function showButton(data) {
    var old = document.getElementById(BTN_ID);
    if (old) {
      old.remove();
    }
    var b = document.createElement('button');
    b.id = BTN_ID;
    b.textContent = '📊 Voir les résultats du test';
    b.addEventListener('click', function () { show(data); });
    document.body.appendChild(b);
  }

  function hideButton() {
    var b = document.getElementById(BTN_ID);
    if (b) {
      b.remove();
    }
  }

  function _proximityScore(dist) {
    if (dist <= HIT_RADIUS) {
      return 1;
    }
    if (dist >= RADIUS_MAX) {
      return 0;
    }
    return 1 - (dist - HIT_RADIUS) / (RADIUS_MAX - HIT_RADIUS);
  }

  function lookedAtId(p) {
    if (p.viz_state && p.viz_state.current_aoi) {
      return p.viz_state.current_aoi;
    }
    if (p.dom) {
      if (p.dom.data && p.dom.data.aoiId) {
        return p.dom.data.aoiId;
      }
      if (p.dom.id) {
        return p.dom.id;
      }
      if (p.dom.semantic_type) {
        return p.dom.semantic_type;
      }
    }
    return null;
  }

  function accumulatePoint(caseAgg, p) {
    caseAgg.n++;
    if (!caseAgg.view && p.viz_state && p.viz_state.active_view) {
      caseAgg.view = p.viz_state.active_view;
    }
    var lookedId = lookedAtId(p);
    if (lookedId) {
      caseAgg.domCounts[lookedId] = (caseAgg.domCounts[lookedId] || 0) + 1;
    }
    if (typeof p.target_x === 'number' && typeof p.target_y === 'number') {
      var d = Math.hypot(p.x - p.target_x, p.y - p.target_y);
      caseAgg.proxSum += _proximityScore(d);
      caseAgg.proxN++;
    }
    if (caseAgg.tFirst == null) {
      caseAgg.tFirst = p.t_rel_ms;
    }
    caseAgg.tLast = p.t_rel_ms;
  }

  function mostLookedId(domCounts) {
    var mostLooked = null;
    var mostN = 0;
    Object.keys(domCounts).forEach(function (id) {
      if (domCounts[id] > mostN) {
        mostN = domCounts[id];
        mostLooked = id;
      }
    });
    return mostLooked;
  }

  function caseDuration(caseAgg) {
    if (caseAgg.tFirst != null && caseAgg.tLast != null) {
      return Math.round(caseAgg.tLast - caseAgg.tFirst);
    }
    return 0;
  }

  function onTargetPct(caseAgg) {
    if (!caseAgg.proxN) {
      return null;
    }
    return Math.round(100 * caseAgg.proxSum / caseAgg.proxN);
  }

  function analyze(data) {
    var raw = (data.raw_gaze_data || []).filter(function (p) { return p.test_case_id; });
    var byCase = {};
    raw.forEach(function (p) {
      var k = p.test_case_id;
      if (!byCase[k]) {
        byCase[k] = { target: p.target_aoi_id, n: 0, proxSum: 0, proxN: 0, domCounts: {}, tFirst: null, tLast: null, view: null };
      }
      accumulatePoint(byCase[k], p);
    });
    return Object.keys(byCase).map(function (k) {
      var c = byCase[k];
      return {
        stimulus:     k,
        view:         c.view,
        target:       c.target,
        points:       c.n,
        most_looked:  mostLookedId(c.domCounts),
        on_target_pct: onTargetPct(c),
        duration_ms:  caseDuration(c),
      };
    });
  }

  function _esc(s) {
    var value = s;
    if (s == null) {
      value = '—';
    }
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function numericField(points, key) {
    return points.map(function (p) { return p[key]; }).filter(function (v) {
      return typeof v === 'number';
    });
  }

  function meanConfidence(raw) {
    var c = numericField(raw, 'confidence');
    if (!c.length) {
      return '—';
    }
    return (c.reduce(function (a, b) { return a + b; }, 0) / c.length).toFixed(2);
  }

  function medianLux(raw) {
    var luxVals = numericField(raw, 'lux');
    if (!luxVals.length) {
      return '—';
    }
    luxVals.sort(function (a, b) { return a - b; });
    return Math.round(luxVals[Math.floor(luxVals.length / 2)]);
  }

  function engineLabel(engine) {
    if (engine === 'mediapipe') {
      return 'MediaPipe';
    }
    if (engine === 'webgazer') {
      return 'WebGazer';
    }
    return engine;
  }

  function engineClass(engine) {
    if (engine === 'mediapipe') {
      return 'rv-engine-badge--mediapipe';
    }
    if (engine === 'webgazer') {
      return 'rv-engine-badge--webgazer';
    }
    return 'rv-engine-badge--unknown';
  }

  function participantName(sess) {
    var fullName = ((sess.first_name || '') + ' ' + (sess.last_name || '')).trim();
    if (fullName) {
      return fullName;
    }
    return sess.participant_id || 'anonyme';
  }

  function calibrationText(cal) {
    if (cal.mean_error_px != null) {
      return Math.round(cal.mean_error_px) + ' px';
    }
    return '—';
  }

  function createStatCard(label, val) {
    var card = document.createElement('div');
    card.className = 'rv-stat-card';

    var labelEl = document.createElement('div');
    labelEl.className = 'rv-stat-label';
    labelEl.textContent = label;

    var valEl = document.createElement('div');
    valEl.className = 'rv-stat-value';
    valEl.textContent = String(val);

    card.appendChild(labelEl);
    card.appendChild(valEl);
    return card;
  }

  function buildStats(raw, events, cal) {
    var nFix = events.filter(function (e) { return e.type === 'fixation'; }).length;
    var nSac = events.filter(function (e) { return e.type === 'saccade'; }).length;

    var row = document.createElement('div');
    row.className = 'rv-stats-row';

    var cards = [
      createStatCard('Points',         raw.length),
      createStatCard('Fixations',      nFix),
      createStatCard('Saccades',       nSac),
      createStatCard('Confiance moy.', meanConfidence(raw)),
      createStatCard('Calibration',    calibrationText(cal)),
      createStatCard('Luminosité',     medianLux(raw) + ' lux'),
    ];
    cards.forEach(function (c) { row.appendChild(c); });
    return row;
  }

  function scoreClass(hasScore, pct) {
    if (!hasScore) {
      return 'rv-score--none';
    }
    if (pct >= 50) {
      return 'rv-score--good';
    }
    if (pct >= 20) {
      return 'rv-score--ok';
    }
    return 'rv-score--bad';
  }

  function scoreText(hasScore, pct) {
    if (hasScore) {
      return pct + '%';
    }
    return '—';
  }

  function hitMark(r) {
    if (r.target && r.most_looked === r.target) {
      return '✓ ';
    }
    return '';
  }

  function createTh(label) {
    var th = document.createElement('th');
    th.className = 'rv-th';
    th.textContent = label;
    return th;
  }

  function createTd(text) {
    var td = document.createElement('td');
    td.className = 'rv-td';
    td.textContent = _esc(text);
    return td;
  }

  function createRow(r) {
    var hasScore = typeof r.on_target_pct === 'number';
    var tr = document.createElement('tr');

    tr.appendChild(createTd(r.stimulus));
    tr.appendChild(createTd(r.view));
    tr.appendChild(createTd(r.target));

    var mostLookedTd = document.createElement('td');
    mostLookedTd.className = 'rv-td';
    mostLookedTd.textContent = hitMark(r) + _esc(r.most_looked);
    tr.appendChild(mostLookedTd);

    var scoreTd = document.createElement('td');
    scoreTd.className = 'rv-score-cell ' + scoreClass(hasScore, r.on_target_pct);
    scoreTd.textContent = scoreText(hasScore, r.on_target_pct);
    tr.appendChild(scoreTd);

    tr.appendChild(createTd(r.points));
    tr.appendChild(createTd((r.duration_ms / 1000).toFixed(1) + ' s'));

    return tr;
  }

  function buildAnalysisPane(rows, statsEl) {
    var pane = document.createElement('div');

    pane.appendChild(statsEl);

    if (!rows.length) {
      var msg = document.createElement('p');
      msg.className = 'rv-empty-msg';
      msg.textContent = 'Aucun stimulus étiqueté (session sans scénario guidé). '
        + 'Les statistiques globales et le parcours du regard restent disponibles.';
      pane.appendChild(msg);
      return pane;
    }

    var sectionTitle = document.createElement('h3');
    sectionTitle.className = 'rv-section-title';
    sectionTitle.textContent = 'Analyse par stimulus (cercle rouge montré)';
    pane.appendChild(sectionTitle);

    var table = document.createElement('table');
    table.className = 'rv-table';

    var thead = document.createElement('thead');
    thead.className = 'rv-table-head';
    var headerRow = document.createElement('tr');
    var headers = ['Stimulus', 'Page regardée', 'AOI ciblée', 'AOI la plus regardée', 'Sur la cible', 'Points', 'Durée'];
    headers.forEach(function (h) {
      headerRow.appendChild(createTh(h));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(createRow(r));
    });
    table.appendChild(tbody);
    pane.appendChild(table);

    return pane;
  }

  function buildChartBlock(v, res) {
    var block = document.createElement('div');
    block.className = 'rv-chart-block';

    var label = document.createElement('div');
    label.className = 'rv-chart-label';
    label.textContent = v.title;
    block.appendChild(label);

    var wrap = document.createElement('div');
    wrap.id = v.cid + '-wrap';
    wrap.className = 'rv-chart-wrap';
    wrap.style.aspectRatio = res.width + '/' + res.height;
    block.appendChild(wrap);

    var inner = document.createElement('div');
    inner.id = v.cid + '-chart';
    inner.className = 'rv-chart-inner';
    wrap.appendChild(inner);

    var hm = document.createElement('canvas');
    hm.id = v.cid + '-hm';
    hm.className = 'rv-hm-canvas';
    wrap.appendChild(hm);

    return block;
  }

  function buildParcoursPane(res, views) {
    var pane = document.createElement('div');
    pane.style.display = 'none';

    var title = document.createElement('h3');
    title.className = 'rv-section-title';
    title.textContent = 'Parcours du regard — heatmap par page';
    pane.appendChild(title);

    var hasCharts = views.some(function (v) {
      var c = _chartFor(v);
      return c && typeof c.init === 'function';
    });

    if (!hasCharts) {
      var note = document.createElement('p');
      note.className = 'rv-empty-msg';
      note.style.fontSize = '0.82rem';
      note.textContent = 'Les graphiques ne sont pas chargés sur cette page : '
        + 'heatmap affichée sur fond neutre, mise à l\'échelle de l\'écran de test.';
      pane.appendChild(note);
    }

    views.forEach(function (v) {
      pane.appendChild(buildChartBlock(v, res));
    });

    var legend = document.createElement('p');
    legend.className = 'rv-heatmap-legend';

    var textBefore = document.createTextNode('Densité du regard : ');
    legend.appendChild(textBefore);

    var greenSpan = document.createElement('span');
    greenSpan.className = 'rv-legend-good';
    greenSpan.textContent = 'vert = peu regardé';
    legend.appendChild(greenSpan);

    legend.appendChild(document.createTextNode(' → '));

    var warmSpan = document.createElement('span');
    warmSpan.className = 'rv-legend-warm';
    warmSpan.textContent = 'orange';
    legend.appendChild(warmSpan);

    legend.appendChild(document.createTextNode(' → '));

    var hotSpan = document.createElement('span');
    hotSpan.className = 'rv-legend-hot';
    hotSpan.textContent = 'rouge = très regardé';
    legend.appendChild(hotSpan);

    legend.appendChild(document.createTextNode(' · ● fixations (∝ durée) · — chemin temporel'));
    pane.appendChild(legend);

    return pane;
  }

  function buildHeader(sess, data) {
    var pid    = participantName(sess);
    var engine = sess.engine
      || ((data.raw_gaze_data || [])[0] && data.raw_gaze_data[0].source_module)
      || '—';

    var head = document.createElement('div');
    head.className = 'rv-header';

    var titleEl = document.createElement('b');
    titleEl.className = 'rv-header__title';
    titleEl.textContent = 'Résultats — ' + _esc(pid);
    head.appendChild(titleEl);

    var badge = document.createElement('span');
    badge.className = 'rv-engine-badge ' + engineClass(engine);
    badge.textContent = 'Moteur : ' + _esc(engineLabel(engine));
    head.appendChild(badge);

    var meta = document.createElement('span');
    meta.className = 'rv-header__meta';
    var startTime = (sess.start_time || '').replace('T', ' ').slice(0, 19);
    meta.textContent = _esc(startTime) + ' · lunettes: ' + (sess.glasses || '—');
    head.appendChild(meta);

    var spacer = document.createElement('span');
    spacer.className = 'rv-spacer';
    head.appendChild(spacer);

    var tabA = document.createElement('button');
    tabA.id = 'rv-tab-a';
    tabA.className = 'rv-tab';
    tabA.textContent = 'Analyse';
    head.appendChild(tabA);

    var tabP = document.createElement('button');
    tabP.id = 'rv-tab-p';
    tabP.className = 'rv-tab';
    tabP.textContent = 'Parcours du regard';
    head.appendChild(tabP);

    var closeBtn = document.createElement('button');
    closeBtn.id = 'rv-close';
    closeBtn.className = 'rv-close-btn';
    closeBtn.textContent = 'Fermer ✕';
    head.appendChild(closeBtn);

    return head;
  }

  function activateTab(activeEl, tabA, tabP) {
    tabA.classList.toggle('rv-tab--active', tabA === activeEl);
    tabP.classList.toggle('rv-tab--active', tabP === activeEl);
  }

  function wireTabs(paneA, paneP, data, res, views) {
    var tabA = document.getElementById('rv-tab-a');
    var tabP = document.getElementById('rv-tab-p');

    activateTab(tabA, tabA, tabP);

    var drawn = false;
    function ensureParcoursDrawn() {
      if (drawn) {
        return;
      }
      drawn = true;
      setTimeout(function () { drawAllPages(data, res, views); }, 80);
    }

    tabA.addEventListener('click', function () {
      activateTab(tabA, tabA, tabP);
      paneA.style.display = '';
      paneP.style.display = 'none';
    });
    tabP.addEventListener('click', function () {
      activateTab(tabP, tabA, tabP);
      paneA.style.display = 'none';
      paneP.style.display = '';
      drawn = false;
      ensureParcoursDrawn();
    });
    document.getElementById('rv-close').addEventListener('click', hide);

    setTimeout(function () {
      var prev = paneP.style.display;
      paneP.style.visibility = 'hidden';
      paneP.style.display = 'block';
      drawAllPages(data, res, views);
      paneP.style.display = prev;
      paneP.style.visibility = '';
      drawn = true;
    }, 120);
  }

  function show(data) {
    hide();
    if (!data) {
      return;
    }
    var raw    = data.raw_gaze_data || [];
    var events = data.events || [];
    var sess   = data.session || {};
    var cal    = sess.calibration_score || {};
    var rows   = analyze(data);
    var res    = sess.screen_resolution || { width: 1920, height: 1080 };
    var views  = viewDefinitions();

    var ov = document.createElement('div');
    ov.id = ID;

    ov.appendChild(buildHeader(sess, data));

    var body = document.createElement('div');
    body.className = 'rv-body';
    ov.appendChild(body);

    var statsEl = buildStats(raw, events, cal);
    var paneA   = buildAnalysisPane(rows, statsEl);
    var paneP   = buildParcoursPane(res, views);

    body.appendChild(paneA);
    body.appendChild(paneP);
    document.body.appendChild(ov);

    wireTabs(paneA, paneP, data, res, views);
  }

  function drawAllPages(data, res, views) {
    views.forEach(function (v) {
      var wrap = document.getElementById(v.cid + '-wrap');
      if (!wrap) {
        return;
      }
      var rect = wrap.getBoundingClientRect();
      var W = Math.round(rect.width)  || 880;
      var H = Math.round(rect.height) || Math.round(880 * res.height / res.width);

      var chartDiv = document.getElementById(v.cid + '-chart');
      if (chartDiv) {
        chartDiv.style.width  = W + 'px';
        chartDiv.style.height = H + 'px';
      }
      var chart = _chartFor(v);
      if (chart && typeof chart.init === 'function') {
        try {
          chart.init(v.cid + '-chart');
        } catch (e) {}
      }

      var cv = document.getElementById(v.cid + '-hm');
      cv.width  = W;
      cv.height = H;
      drawPageHeatmap(cv, data, v.key, res.width, res.height, W, H);
    });
  }

  function heatColor(t) {
    t = Math.max(0, Math.min(1, t));
    var r, g, b;
    if (t < 0.5) {
      var u = t / 0.5;
      r = Math.round(60  + (230 - 60)  * u);
      g = Math.round(180 + (150 - 180) * u);
      b = Math.round(75  + (40 - 75)   * u);
    } else {
      var u2 = (t - 0.5) / 0.5;
      r = Math.round(230 + (231 - 230) * u2);
      g = Math.round(150 + (40  - 150) * u2);
      b = Math.round(40  + (40  - 40)  * u2);
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',';
  }

  function buildPageHeatGrid(raw, sx, sy, cell, cols, rows2, R) {
    var grid = new Float32Array(cols * rows2);
    var maxV = 0;
    var sigma = R * 0.6;
    raw.forEach(function (p) {
      var gx = Math.floor(p.x * sx / cell);
      var gy = Math.floor(p.y * sy / cell);
      for (var dy = -R; dy <= R; dy++) {
        for (var dx = -R; dx <= R; dx++) {
          var cx = gx + dx;
          var cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows2) {
            continue;
          }
          var w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          var idx = cy * cols + cx;
          grid[idx] += w;
          if (grid[idx] > maxV) {
            maxV = grid[idx];
          }
        }
      }
    });
    return { grid: grid, maxV: maxV };
  }

  function drawHeatCells(ctx, built, cols, rows2, cell) {
    if (built.maxV <= 0) {
      return;
    }
    for (var r2 = 0; r2 < rows2; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var v = built.grid[r2 * cols + c2] / built.maxV;
        if (v < 0.06) {
          continue;
        }
        var alpha = 0.20 + 0.55 * v;
        ctx.fillStyle = heatColor(v) + alpha.toFixed(2) + ')';
        ctx.fillRect(c2 * cell, r2 * cell, cell, cell);
      }
    }
  }

  function pageFixations(raw, sx, sy) {
    if (!global.Calibration || typeof global.Calibration.detectFixations !== 'function') {
      return [];
    }
    var pts = raw.map(function (p) {
      var ts = p.t_rel_ms;
      if (p.timestamp != null) {
        ts = p.timestamp;
      }
      return { x: p.x, y: p.y, timestamp: ts };
    });
    return global.Calibration.detectFixations(pts, 80, 100)
      .map(function (f) {
        return { x: f.x_center * sx, y: f.y_center * sy, d: f.duration };
      })
      .filter(function (f) {
        return isFinite(f.x) && isFinite(f.y);
      });
  }

  function drawScanpath(ctx, fx) {
    ctx.strokeStyle = 'rgba(108,140,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    fx.forEach(function (f, i) {
      if (i === 0) {
        ctx.moveTo(f.x, f.y);
      } else {
        ctx.lineTo(f.x, f.y);
      }
    });
    ctx.stroke();

    fx.forEach(function (f, i) {
      var r = Math.max(5, Math.min(18, 6 + (f.d || 0) / 55));
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(78,205,196,0.28)';
      ctx.fill();
      ctx.strokeStyle = '#4ecdc4';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), f.x, f.y);
    });
  }

  function drawPageHeatmap(cv, data, viewKey, srcW, srcH, W, H) {
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var sx = W / srcW;
    var sy = H / srcH;
    var raw = (data.raw_gaze_data || []).filter(function (p) {
      return p.viz_state && p.viz_state.active_view === viewKey;
    });
    if (!raw.length) {
      ctx.fillStyle = 'rgba(154,166,192,.6)';
      ctx.font = '13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Aucun regard enregistré sur cette page', W / 2, H / 2);
      return;
    }

    var cell  = 8;
    var R     = 5;
    var cols  = Math.ceil(W / cell);
    var rows2 = Math.ceil(H / cell);
    var built = buildPageHeatGrid(raw, sx, sy, cell, cols, rows2, R);
    drawHeatCells(ctx, built, cols, rows2, cell);
    drawScanpath(ctx, pageFixations(raw, sx, sy));
  }

  global.ResultsView = {
    show:        show,
    hide:        hide,
    analyze:     analyze,
    showButton:  showButton,
    hideButton:  hideButton,
    _drawAllPages: drawAllPages,
    _VIEWS:      viewDefinitions,
  };

})(typeof window !== 'undefined' ? window : global);
