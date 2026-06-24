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

  function hide() { var e = document.getElementById(ID); if (e) e.remove(); }

  // ── Analyse par stimulus à partir de test_case_id / target_aoi_id ──────────────
  // Pour chaque stimulus (cercle rouge montré), on regarde les points de regard
  // étiquetés avec ce test_case_id : combien sont tombés dans la bonne AOI ?
  function analyze(data) {
    var raw = (data.raw_gaze_data || []).filter(function (p) { return p.test_case_id; });
    var byCase = {};
    raw.forEach(function (p) {
      var k = p.test_case_id;
      if (!byCase[k]) byCase[k] = { target: p.target_aoi_id, n: 0, onTarget: 0, domCounts: {}, tFirst: null, tLast: null, view: null };
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
      // « sur la cible » si l'AOI courante == cible
      if (p.viz_state && p.viz_state.current_aoi && c.target && p.viz_state.current_aoi === c.target) c.onTarget++;
      if (c.tFirst == null) c.tFirst = p.t_rel_ms;
      c.tLast = p.t_rel_ms;
    });
    return Object.keys(byCase).map(function (k) {
      var c = byCase[k];
      var mostLooked = null, mostN = 0;
      Object.keys(c.domCounts).forEach(function (id) { if (c.domCounts[id] > mostN) { mostN = c.domCounts[id]; mostLooked = id; } });
      var durMs = (c.tFirst != null && c.tLast != null) ? Math.round(c.tLast - c.tFirst) : 0;
      var rate = c.n ? Math.round(100 * c.onTarget / c.n) : 0;
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
        var col = r.on_target_pct >= 50 ? '#27ae60' : r.on_target_pct >= 20 ? '#e0a96a' : '#e74c3c';
        tbl += '<tr>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.stimulus) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.view) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + _esc(r.target) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);">' + (hit?'✓ ':'') + _esc(r.most_looked) + '</td>'
          + '<td style="padding:7px 10px;border-bottom:1px solid rgba(120,140,200,.1);color:' + col + ';font-weight:700;">' + r.on_target_pct + '%</td>'
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

    // ── Onglet PARCOURS (heatmap + scanpath sur fond propre) ──
    var paneP = document.createElement('div');
    paneP.style.display = 'none';
    var res = sess.screen_resolution || { width: 1920, height: 1080 };
    var cw = 900, ch = Math.round(cw * res.height / res.width);
    paneP.innerHTML =
      '<h3 style="color:#6c8cff;margin:0 0 10px;">Parcours du regard (heatmap densité + scanpath des fixations)</h3>'
      + '<canvas id="rv-canvas" width="' + cw + '" height="' + ch + '" '
      + 'style="width:100%;max-width:' + cw + 'px;background:#0a0f1e;border:1px solid rgba(120,140,200,.25);border-radius:10px;"></canvas>'
      + '<p style="color:#9aa6c0;font-size:.8rem;margin-top:8px;">'
      + '⬤ densité du regard (bleu→rouge) · ● fixations numérotées (∝ durée) · — chemin temporel</p>';

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
    tabA.addEventListener('click', function () { styleTab(tabA); paneA.style.display=''; paneP.style.display='none'; });
    tabP.addEventListener('click', function () {
      styleTab(tabP); paneA.style.display='none'; paneP.style.display='';
      drawScan(data, res, cw, ch);
    });
    document.getElementById('rv-close').addEventListener('click', hide);
  }

  // Heatmap + scanpath mis à l'échelle de la résolution de la session.
  function drawScan(data, res, cw, ch) {
    var cv = document.getElementById('rv-canvas'); if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    var sx = cw / res.width, sy = ch / res.height;
    var raw = data.raw_gaze_data || [];

    // Heatmap (grille gaussienne)
    var cell = 10, cols = Math.ceil(cw/cell), rows2 = Math.ceil(ch/cell);
    var grid = new Float32Array(cols*rows2), maxV = 0, R = 3;
    raw.forEach(function (p) {
      var gx = Math.floor(p.x*sx/cell), gy = Math.floor(p.y*sy/cell);
      for (var dy=-R; dy<=R; dy++) for (var dx=-R; dx<=R; dx++) {
        var cx=gx+dx, cy=gy+dy; if (cx<0||cy<0||cx>=cols||cy>=rows2) continue;
        var w = Math.exp(-(dx*dx+dy*dy)/(2*R)); var idx=cy*cols+cx;
        grid[idx]+=w; if (grid[idx]>maxV) maxV=grid[idx];
      }
    });
    function heat(t){ t=Math.max(0,Math.min(1,t)); var r,g,b;
      if(t<0.25){r=0;g=Math.round(255*t/0.25);b=255;}
      else if(t<0.5){r=0;g=255;b=Math.round(255*(1-(t-0.25)/0.25));}
      else if(t<0.75){r=Math.round(255*(t-0.5)/0.25);g=255;b=0;}
      else{r=255;g=Math.round(255*(1-(t-0.75)/0.25));b=0;} return 'rgba('+r+','+g+','+b+',';}
    if (maxV>0) for (var r2=0;r2<rows2;r2++) for (var c2=0;c2<cols;c2++){
      var v=grid[r2*cols+c2]/maxV; if(v<0.05) continue;
      ctx.fillStyle=heat(v)+(0.4*Math.min(1,v+0.3))+')';
      ctx.fillRect(c2*cell,r2*cell,cell,cell);
    }
    // Scanpath sur fixations
    var fx=(data.events||[]).filter(function(e){return e.type==='fixation';})
      .map(function(f){return {x:(f.details&&f.details.x)*sx,y:(f.details&&f.details.y)*sy,d:f.duration};})
      .filter(function(f){return isFinite(f.x)&&isFinite(f.y);});
    ctx.strokeStyle='rgba(108,140,255,0.85)'; ctx.lineWidth=2; ctx.beginPath();
    fx.forEach(function(f,i){ i?ctx.lineTo(f.x,f.y):ctx.moveTo(f.x,f.y); }); ctx.stroke();
    fx.forEach(function(f,i){
      var r=Math.max(6,Math.min(22,7+(f.d||0)/50));
      ctx.beginPath(); ctx.arc(f.x,f.y,r,0,Math.PI*2);
      ctx.fillStyle='rgba(78,205,196,0.3)'; ctx.fill();
      ctx.strokeStyle='#4ecdc4'; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 11px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(String(i+1), f.x, f.y);
    });
  }

  global.ResultsView = { show: show, hide: hide, analyze: analyze };

})(typeof window !== 'undefined' ? window : global);
