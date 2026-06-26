/**
 * results-view.js — Écran de résultats structuré et lisible d'une session de test.
 *
 * Deux onglets :
 *   1. ANALYSE — tableau par stimulus : AOI ciblée, temps passé sur la cible,
 *      AOI réellement la plus regardée, taux de réussite (regard sur la bonne AOI).
 *   2. PARCOURS — heatmap + scanpath sur un fond propre (pas par-dessus la page).
 *
 * Indépendant des moteurs : ne consomme que les données exportées par GazeLogger.
 *
 * API : ResultsView.show(sessionData) / ResultsView.hide()
 */
(function (global) {
  'use strict';

  var ID = 'results-view-overlay';
  var BTN_ID = 'results-view-button';

  function hide() { var e = document.getElementById(ID); if (e) e.remove(); }

  // Bouton flottant persistant « Voir les résultats du test » : permet de rouvrir
  // l'écran de résultats à tout moment après le test.
  function showButton(data) {
    var old = document.getElementById(BTN_ID); if (old) old.remove();
    var b = document.createElement('button');
    b.id = BTN_ID;
    b.textContent = '📊 Voir les résultats du test';
    b.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99000;'
      + 'background:#6c8cff;color:#fff;border:none;border-radius:10px;padding:12px 22px;'
      + 'font-weight:700;font-size:.95rem;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);';
    b.addEventListener('click', function () { show(data); });
    document.body.appendChild(b);
  }
  function hideButton() { var b = document.getElementById(BTN_ID); if (b) b.remove(); }

  // ── Analyse par stimulus à partir de test_case_id / target_aoi_id ──────────────
  // Pour chaque stimulus (cercle rouge montré), on regarde les points de regard
  // étiquetés avec ce test_case_id : combien sont tombés dans la bonne AOI ?
  // Score de proximité continu d'un point au centre de la cible : 100% si dans le
  // rayon « plein » (HIT_RADIUS), décroît linéairement jusqu'à 0% au RADIUS_MAX.
  var HIT_RADIUS = 90;    // px : pleinement « sur la cible »
  var RADIUS_MAX = 450;   // px : au-delà, score nul
  function _proximityScore(dist) {
    if (dist <= HIT_RADIUS) return 1;
    if (dist >= RADIUS_MAX) return 0;
    return 1 - (dist - HIT_RADIUS) / (RADIUS_MAX - HIT_RADIUS);
  }

  function analyze(data) {
    var raw = (data.raw_gaze_data || []).filter(function (p) { return p.test_case_id; });
    var byCase = {};
    raw.forEach(function (p) {
      var k = p.test_case_id;
      if (!byCase[k]) byCase[k] = { target: p.target_aoi_id, n: 0, proxSum: 0, proxN: 0, domCounts: {}, tFirst: null, tLast: null, view: null };
      var c = byCase[k];
      c.n++;
      if (!c.view && p.viz_state && p.viz_state.active_view) c.view = p.viz_state.active_view;
      // AOI réellement regardée : on se base sur le DOM observé (aoi data ou id).
      var lookedId = null;
      if (p.dom) {
        if (p.dom.data && p.dom.data.aoiId) lookedId = p.dom.data.aoiId;
        else if (p.dom.id) lookedId = p.dom.id;
        else if (p.dom.semantic_type) lookedId = p.dom.semantic_type;
      }
      if (p.viz_state && p.viz_state.current_aoi) lookedId = p.viz_state.current_aoi;
      if (lookedId) c.domCounts[lookedId] = (c.domCounts[lookedId] || 0) + 1;
      // Proximité continue à la cible : 100% si pile dessus, dégradé en s'éloignant.
      if (typeof p.target_x === 'number' && typeof p.target_y === 'number') {
        var d = Math.hypot(p.x - p.target_x, p.y - p.target_y);
        c.proxSum += _proximityScore(d); c.proxN++;
      }
      if (c.tFirst == null) c.tFirst = p.t_rel_ms;
      c.tLast = p.t_rel_ms;
    });
    return Object.keys(byCase).map(function (k) {
      var c = byCase[k];
      var mostLooked = null, mostN = 0;
      Object.keys(c.domCounts).forEach(function (id) { if (c.domCounts[id] > mostN) { mostN = c.domCounts[id]; mostLooked = id; } });
      var durMs = (c.tFirst != null && c.tLast != null) ? Math.round(c.tLast - c.tFirst) : 0;
      // Score « sur la cible » = moyenne des proximités (continu, 0–100%).
      var rate = c.proxN ? Math.round(100 * c.proxSum / c.proxN) : null;
      return {
        stimulus: k, view: c.view, target: c.target, points: c.n,
        most_looked: mostLooked, on_target_pct: rate, duration_ms: durMs,
      };
    });
  }

  function _esc(s) { return String(s == null ? '—' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  function show(data) {
    hide();
    if (!data) return;
    var raw = data.raw_gaze_data || [];
    var events = data.events || [];
    var sess = data.session || {};
    var rows = analyze(data);

    var ov = document.createElement('div');
    ov.id = ID;
    ov.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:#0d1424;color:#eee;'
      + 'font-family:Arial,sans-serif;display:flex;flex-direction:column;';

    // En-tête
    var pid = ((sess.first_name||'') + ' ' + (sess.last_name||'')).trim() || sess.participant_id || 'anonyme';
    // Badge moteur bien visible (couleur selon le moteur).
    var engine = sess.engine || ((data.raw_gaze_data||[])[0] && data.raw_gaze_data[0].source_module) || '—';
    var engLabel = engine === 'mediapipe' ? 'MediaPipe' : engine === 'webgazer' ? 'WebGazer' : engine;
    var engBg = engine === 'mediapipe' ? '#6c8cff' : engine === 'webgazer' ? '#4ecdc4' : '#7f8c8d';
    var engFg = engine === 'mediapipe' ? '#fff' : '#0f0f1a';
    var head = document.createElement('div');
    head.style.cssText = 'padding:14px 22px;border-bottom:1px solid rgba(120,140,200,.2);display:flex;align-items:center;gap:16px;';
    head.innerHTML =
      '<b style="color:#6c8cff;font-size:1.05rem;">Résultats — ' + _esc(pid) + '</b>'
      + '<span style="background:' + engBg + ';color:' + engFg + ';font-weight:700;font-size:.8rem;'
      + 'padding:4px 12px;border-radius:999px;letter-spacing:.02em;">Moteur : ' + _esc(engLabel) + '</span>'
      + '<span style="color:#9aa6c0;font-size:.85rem;">' + _esc((sess.start_time||'').replace('T',' ').slice(0,19))
      + ' · lunettes: ' + (sess.glasses||'—') + '</span>'
      + '<span style="flex:1"></span>'
      + '<button id="rv-tab-a" class="rv-tab">Analyse</button>'
      + '<button id="rv-tab-p" class="rv-tab">Parcours du regard</button>'
      + '<button id="rv-close" style="background:#6c8cff;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;">Fermer ✕</button>';
    ov.appendChild(head);

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow:auto;padding:20px 22px;';
    ov.appendChild(body);

    // Bandeau de stats globales
    var meanConf = (function () {
      var c = raw.map(function (p){ return p.confidence; }).filter(function (v){ return typeof v==='number'; });
      return c.length ? (c.reduce(function (a,b){ return a+b; },0)/c.length).toFixed(2) : '—';
    })();
    var luxVals = raw.map(function (p){ return p.lux; }).filter(function (v){ return typeof v==='number'; });
    var lux = luxVals.length ? Math.round(luxVals.sort(function (a,b){ return a-b; })[Math.floor(luxVals.length/2)]) : '—';
    var nFix = events.filter(function (e){ return e.type==='fixation'; }).length;
    var nSac = events.filter(function (e){ return e.type==='saccade'; }).length;
    var cal = sess.calibration_score || {};
    function statCard(label, val) {
      return '<div style="background:#16213e;border-radius:10px;padding:12px 16px;min-width:120px;">'
        + '<div style="color:#9aa6c0;font-size:.74rem;">' + label + '</div>'
        + '<div style="font-size:1.25rem;font-weight:700;color:#4ecdc4;">' + val + '</div></div>';
    }
    var stats = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px;">'
      + statCard('Points', raw.length)
      + statCard('Fixations', nFix)
      + statCard('Saccades', nSac)
      + statCard('Confiance moy.', meanConf)
      + statCard('Calibration', cal.mean_error_px!=null ? Math.round(cal.mean_error_px)+' px' : '—')
      + statCard('Luminosité', lux + ' lux')
      + '</div>';

    // ── Onglet ANALYSE ──
    var paneA = document.createElement('div');
    if (rows.length) {
      var tbl = '<h3 style="color:#6c8cff;margin:0 0 10px;">Analyse par stimulus (cercle rouge montré)</h3>'
        + '<table style="width:100%;border-collapse:collapse;font-size:.88rem;">'
        + '<thead><tr style="color:#4ecdc4;text-align:left;">'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">Stimulus</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">Page regardée</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">AOI ciblée</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">AOI la plus regardée</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">Sur la cible</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">Points</th>'
        + '<th style="padding:8px 10px;border-bottom:1px solid rgba(120,140,200,.2);">Durée</th>'
        + '</tr></thead><tbody>';
      rows.forEach(function (r) {
        var hit = r.target && r.most_looked === r.target;
        var hasScore = typeof r.on_target_pct === 'number';
        var col = !hasScore ? '#9aa6c0' : r.on_target_pct >= 50 ? '#27ae60' : r.on_target_pct >= 20 ? '#e0a96a' : '#e74c3c';
        var scoreTxt = hasScore ? (r.on_target_pct + '%') : '—';
        tbl += '<tr>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.stimulus) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.view) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.target) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + (hit?'✓ ':'') + _esc(r.most_looked) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);color:' + col + ';font-weight:700;">' + scoreTxt + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + r.points + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + (r.duration_ms/1000).toFixed(1) + ' s</td>'
          + '</tr>';
      });
      tbl += '</tbody></table>';
      paneA.innerHTML = stats + tbl;
    } else {
      paneA.innerHTML = stats
        + '<p style="color:#9aa6c0;">Aucun stimulus étiqueté (session sans scénario guidé). '
        + 'Les statistiques globales et le parcours du regard restent disponibles.</p>';
    }

    // ── Onglet PARCOURS : 3 heatmaps, une par page, sur le VRAI graphique ──
    var res = sess.screen_resolution || { width: 1920, height: 1080 };
    var paneP = document.createElement('div');
    paneP.style.display = 'none';
    // Les 3 vues + le chart correspondant (si disponible dans la page hôte).
    var VIEWS = [
      { key:'bar',     title:'Bar Chart',    chart: global.BarChart,     cid:'rv-bar' },
      { key:'line',    title:'Line Chart',   chart: global.LineChart,    cid:'rv-line' },
      { key:'scatter', title:'Scatter Plot', chart: global.ScatterChart, cid:'rv-scatter' },
    ];
    var hasCharts = VIEWS.some(function (v){ return v.chart && typeof v.chart.init === 'function'; });
    var inner = '<h3 style="color:#6c8cff;margin:0 0 10px;">Parcours du regard — heatmap par page</h3>';
    if (!hasCharts) {
      inner += '<p style="color:#9aa6c0;font-size:.82rem;">Les graphiques ne sont pas chargés sur cette page : '
        + 'heatmap affichée sur fond neutre, mise à l\'échelle de l\'écran de test.</p>';
    }
    VIEWS.forEach(function (v) {
      inner += '<div style="margin-bottom:22px;">'
        + '<div style="color:#4ecdc4;font-weight:600;margin-bottom:6px;">' + v.title + '</div>'
        + '<div id="' + v.cid + '-wrap" style="position:relative;width:100%;max-width:900px;'
        + 'aspect-ratio:' + res.width + '/' + res.height + ';background:#0a0f1e;border:1px solid rgba(120,140,200,.25);border-radius:10px;overflow:hidden;">'
        + '<div id="' + v.cid + '-chart" style="position:absolute;inset:0;"></div>'
        + '<canvas id="' + v.cid + '-hm" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>'
        + '</div></div>';
    });
    inner += '<p style="color:#9aa6c0;font-size:.8rem;">Densité du regard : '
      + '<span style="color:#3cb44b;">vert = peu regardé</span> → '
      + '<span style="color:#e69632;">orange</span> → '
      + '<span style="color:#e74c3c;">rouge = très regardé</span> · ● fixations (∝ durée) · — chemin temporel</p>';
    paneP.innerHTML = inner;

    body.appendChild(paneA);
    body.appendChild(paneP);
    document.body.appendChild(ov);

    // Style des onglets
    var tabA = document.getElementById('rv-tab-a'), tabP = document.getElementById('rv-tab-p');
    function styleTab(active) {
      [tabA, tabP].forEach(function (t) {
        t.style.cssText = 'border:none;border-radius:8px;padding:9px 16px;cursor:pointer;font-weight:600;'
          + (t===active ? 'background:#4ecdc4;color:#0f0f1a;' : 'background:transparent;color:#9aa6c0;border:1px solid rgba(120,140,200,.4);');
      });
    }
    styleTab(tabA);
    var _drawn = false;
    tabA.addEventListener('click', function () { styleTab(tabA); paneA.style.display=''; paneP.style.display='none'; });
    tabP.addEventListener('click', function () {
      styleTab(tabP); paneA.style.display='none'; paneP.style.display='';
      if (!_drawn) { _drawn = true; setTimeout(function () { drawAllPages(data, res, VIEWS); }, 60); }
    });
    document.getElementById('rv-close').addEventListener('click', hide);
  }

  // Rendu des 3 pages : (re)dessine chaque graphique puis la heatmap par-dessus.
  function drawAllPages(data, res, views) {
    views.forEach(function (v) {
      var wrap = document.getElementById(v.cid + '-wrap');
      if (!wrap) return;
      // 1. (Re)dessiner le vrai graphique en fond, si dispo.
      if (v.chart && typeof v.chart.init === 'function') {
        try { v.chart.init(v.cid + '-chart'); } catch (_) {}
      }
      // 2. Heatmap des points de CETTE page, mise à l'échelle du conteneur.
      var rect = wrap.getBoundingClientRect();
      var cv = document.getElementById(v.cid + '-hm');
      var W = Math.round(rect.width), H = Math.round(rect.height);
      cv.width = W; cv.height = H;
      drawPageHeatmap(cv, data, v.key, res.width, res.height, W, H);
    });
  }

  // Dessine heatmap + scanpath des points dont viz_state.active_view == viewKey.
  function drawPageHeatmap(cv, data, viewKey, srcW, srcH, W, H) {
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var sx = W / srcW, sy = H / srcH;
    // Filtrer les points de cette page.
    var raw = (data.raw_gaze_data || []).filter(function (p) {
      return p.viz_state && p.viz_state.active_view === viewKey;
    });
    if (!raw.length) {
      ctx.fillStyle = 'rgba(154,166,192,.6)'; ctx.font = '13px Arial'; ctx.textAlign = 'center';
      ctx.fillText('Aucun regard enregistré sur cette page', W/2, H/2);
      return;
    }
    // Heatmap (grille gaussienne, rayon plus large = zones plus lisses/lisibles).
    var cell = 8, cols = Math.ceil(W/cell), rows2 = Math.ceil(H/cell);
    var grid = new Float32Array(cols*rows2), maxV = 0, R = 5;
    raw.forEach(function (p) {
      var gx = Math.floor(p.x*sx/cell), gy = Math.floor(p.y*sy/cell);
      for (var dy=-R; dy<=R; dy++) for (var dx=-R; dx<=R; dx++) {
        var cx=gx+dx, cy=gy+dy; if (cx<0||cy<0||cx>=cols||cy>=rows2) continue;
        var w = Math.exp(-(dx*dx+dy*dy)/(2*(R*0.6)*(R*0.6))); var idx=cy*cols+cx;
        grid[idx]+=w; if (grid[idx]>maxV) maxV=grid[idx];
      }
    });
    // Palette VERT (peu regardé) → ORANGE → ROUGE (beaucoup regardé), comme demandé.
    function heat(t){ t=Math.max(0,Math.min(1,t)); var r,g,b;
      if(t<0.5){ // vert → orange
        var u=t/0.5; r=Math.round(60+(230-60)*u); g=Math.round(180+(150-180)*u); b=Math.round(75+(40-75)*u);
      } else { // orange → rouge vif
        var u2=(t-0.5)/0.5; r=Math.round(230+(231-230)*u2); g=Math.round(150+(40-150)*u2); b=Math.round(40+(40-40)*u2);
      }
      return 'rgba('+r+','+g+','+b+',';
    }
    if (maxV>0) for (var r2=0;r2<rows2;r2++) for (var c2=0;c2<cols;c2++){
      var v=grid[r2*cols+c2]/maxV; if(v<0.06) continue;
      // Opacité croissante avec l'intensité (plus regardé = plus opaque/visible).
      var alpha = 0.20 + 0.55 * v;
      ctx.fillStyle=heat(v)+alpha.toFixed(2)+')';
      ctx.fillRect(c2*cell,r2*cell,cell,cell);
    }
    // Scanpath : fixations de cette page (approximées via les points filtrés).
    var fx=(data.events||[]).filter(function(e){return e.type==='fixation';})
      .map(function(f){return {x:(f.details&&f.details.x)*sx,y:(f.details&&f.details.y)*sy,d:f.duration};})
      .filter(function(f){return isFinite(f.x)&&isFinite(f.y);});
    ctx.strokeStyle='rgba(108,140,255,0.7)'; ctx.lineWidth=1.5; ctx.beginPath();
    fx.forEach(function(f,i){ i?ctx.lineTo(f.x,f.y):ctx.moveTo(f.x,f.y); }); ctx.stroke();
    fx.forEach(function(f,i){
      var r=Math.max(5,Math.min(18,6+(f.d||0)/55));
      ctx.beginPath(); ctx.arc(f.x,f.y,r,0,Math.PI*2);
      ctx.fillStyle='rgba(78,205,196,0.28)'; ctx.fill();
      ctx.strokeStyle='#4ecdc4'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(String(i+1), f.x, f.y);
    });
  }

  global.ResultsView = { show: show, hide: hide, analyze: analyze, showButton: showButton, hideButton: hideButton };

})(typeof window !== 'undefined' ? window : global);
