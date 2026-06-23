/**
 * gaze-viz.js — Visualisation du parcours du regard en fin de session.
 *
 * Affiche, par-dessus la page, un overlay plein écran combinant :
 *   - une HEATMAP (densité des points de regard, du bleu au rouge),
 *   - le SCANPATH (chemin temporel reliant les fixations, numérotées),
 *   - les fixations (cercles dont le rayon ∝ durée) et les points bruts.
 *
 * Indépendant du moteur (WebGazer ou MediaPipe) : ne consomme que les données
 * exportées par GazeLogger (raw_gaze_data + events).
 *
 * API : GazeViz.show(sessionData) / GazeViz.hide()
 */
(function (global) {
  'use strict';

  var OVERLAY_ID = 'gaze-viz-overlay';

  function _clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Palette heatmap : valeur normalisée [0,1] → couleur bleu→cyan→jaune→rouge.
  function _heatColor(t, alpha) {
    t = _clamp(t, 0, 1);
    var r, g, b;
    if (t < 0.25)      { r = 0;             g = Math.round(255 * (t / 0.25)); b = 255; }
    else if (t < 0.5)  { r = 0;             g = 255; b = Math.round(255 * (1 - (t - 0.25) / 0.25)); }
    else if (t < 0.75) { r = Math.round(255 * ((t - 0.5) / 0.25)); g = 255; b = 0; }
    else               { r = 255;           g = Math.round(255 * (1 - (t - 0.75) / 0.25)); b = 0; }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function hide() {
    var ex = document.getElementById(OVERLAY_ID);
    if (ex) ex.remove();
  }

  function show(session) {
    hide();
    if (!session) return;
    var raw = session.raw_gaze_data || [];
    var events = session.events || [];
    var fixations = events.filter(function (e) { return e.type === 'fixation'; });

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(10,12,24,0.92);' +
      'font-family:Arial,sans-serif;color:#eee;';

    var dpr = window.devicePixelRatio || 1;
    var canvas = document.createElement('canvas');
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    overlay.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // ── Heatmap : accumulation de gaussiennes sur une grille basse résolution ──
    var W = window.innerWidth, H = window.innerHeight;
    var cell = 12;                         // taille de cellule (px)
    var cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    var grid = new Float32Array(cols * rows);
    var maxV = 0;
    var radius = 3;                        // rayon d'influence en cellules
    raw.forEach(function (p) {
      var gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          var cx = gx + dx, cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          var d2 = dx * dx + dy * dy;
          var w = Math.exp(-d2 / (2 * radius));
          var i = cy * cols + cx;
          grid[i] += w;
          if (grid[i] > maxV) maxV = grid[i];
        }
      }
    });
    if (maxV > 0) {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var v = grid[r * cols + c] / maxV;
          if (v < 0.04) continue;
          ctx.fillStyle = _heatColor(v, 0.35 * Math.min(1, v + 0.3));
          ctx.fillRect(c * cell, r * cell, cell, cell);
        }
      }
    }

    // ── Points bruts (semi-transparents) ──
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    raw.forEach(function (p) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
    });

    // ── Scanpath : relie les fixations dans l'ordre temporel ──
    var fx = fixations
      .map(function (f) { return { x: f.details && f.details.x, y: f.details && f.details.y, d: f.duration }; })
      .filter(function (f) { return Number.isFinite(f.x) && Number.isFinite(f.y); });

    ctx.strokeStyle = 'rgba(108,140,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    fx.forEach(function (f, i) { i === 0 ? ctx.moveTo(f.x, f.y) : ctx.lineTo(f.x, f.y); });
    ctx.stroke();

    // ── Fixations : cercle ∝ durée + numéro d'ordre ──
    fx.forEach(function (f, i) {
      var rad = _clamp(6 + (f.d || 0) / 40, 7, 34);
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(78,205,196,0.30)';
      ctx.fill();
      ctx.strokeStyle = '#4ecdc4'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), f.x, f.y);
    });

    // ── Panneau d'info + bouton fermer ──
    var info = document.createElement('div');
    info.style.cssText =
      'position:absolute;top:18px;left:18px;background:rgba(15,15,26,0.9);' +
      'border:1px solid rgba(108,140,255,0.4);border-radius:10px;padding:14px 18px;font-size:.85rem;line-height:1.6;';
    var meanConf = (function () {
      var c = raw.filter(function (p) { return typeof p.confidence === 'number'; });
      return c.length ? (c.reduce(function (s, p) { return s + p.confidence; }, 0) / c.length).toFixed(2) : '—';
    })();
    var moduleName = (session.session && session.session.id) ?
      (raw[0] && raw[0].source_module) || '—' : '—';
    info.innerHTML =
      '<div style="font-weight:bold;color:#6c8cff;margin-bottom:6px;">Parcours du regard</div>' +
      'Points : ' + raw.length + '<br>' +
      'Fixations : ' + fx.length + '<br>' +
      'Saccades : ' + events.filter(function (e){return e.type==='saccade';}).length + '<br>' +
      'Confiance moy. : ' + meanConf + '<br>' +
      'Moteur : ' + moduleName +
      '<div style="margin-top:8px;color:#9aa6c0;font-size:.75rem;">' +
      '⬤ heatmap densité · ● fixations (∝ durée) · — scanpath</div>';
    overlay.appendChild(info);

    var close = document.createElement('button');
    close.textContent = 'Fermer ✕';
    close.style.cssText =
      'position:absolute;top:18px;right:18px;background:#6c8cff;color:#fff;border:none;' +
      'border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer;';
    close.addEventListener('click', hide);
    overlay.appendChild(close);

    document.body.appendChild(overlay);
  }

  global.GazeViz = { show: show, hide: hide, _heatColor: _heatColor };

})(typeof window !== 'undefined' ? window : global);
