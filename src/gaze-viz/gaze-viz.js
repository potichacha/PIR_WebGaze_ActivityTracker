/**
 * gaze-viz.js
 *
 * Visualisation du parcours du regard en fin de session. Le module affiche un
 * overlay plein écran qui combine, par-dessus la page :
 *   - une heatmap de densité des points de regard (du bleu au rouge) ;
 *   - le scanpath, c'est-à-dire le chemin temporel reliant les fixations
 *     numérotées dans l'ordre ;
 *   - les fixations sous forme de cercles dont le rayon est proportionnel à la
 *     durée, ainsi que les points bruts.
 *
 * Le module est indépendant du moteur (WebGazer ou MediaPipe) : il ne consomme
 * que les données exportées par GazeLogger (raw_gaze_data et events).
 * Les styles de l'overlay proviennent de gaze-viz.css.
 *
 * API publique : GazeViz.show(sessionData) / GazeViz.hide()
 */
(function (global) {
  'use strict';

  var OVERLAY_ID = 'gaze-viz-overlay';

  function _clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function _heatColor(t, alpha) {
    t = _clamp(t, 0, 1);
    var r, g, b;
    if (t < 0.25) {
      r = 0;
      g = Math.round(255 * (t / 0.25));
      b = 255;
    } else if (t < 0.5) {
      r = 0;
      g = 255;
      b = Math.round(255 * (1 - (t - 0.25) / 0.25));
    } else if (t < 0.75) {
      r = Math.round(255 * ((t - 0.5) / 0.25));
      g = 255;
      b = 0;
    } else {
      r = 255;
      g = Math.round(255 * (1 - (t - 0.75) / 0.25));
      b = 0;
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function hide() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      existing.remove();
    }
  }

  function createCanvas(overlay) {
    var dpr = window.devicePixelRatio || 1;
    var canvas = document.createElement('canvas');
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.classList.add('gv-canvas');
    overlay.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return ctx;
  }

  function buildHeatGrid(raw, cols, rows, cell, radius) {
    var grid = new Float32Array(cols * rows);
    var maxV = 0;
    raw.forEach(function (p) {
      var gx = Math.floor(p.x / cell);
      var gy = Math.floor(p.y / cell);
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          var cx = gx + dx;
          var cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) {
            continue;
          }
          var d2 = dx * dx + dy * dy;
          var i = cy * cols + cx;
          grid[i] += Math.exp(-d2 / (2 * radius));
          if (grid[i] > maxV) {
            maxV = grid[i];
          }
        }
      }
    });
    return { grid: grid, maxV: maxV };
  }

  function drawHeatmap(ctx, raw, W, H) {
    var cell = 12;
    var radius = 3;
    var cols = Math.ceil(W / cell);
    var rows = Math.ceil(H / cell);
    var built = buildHeatGrid(raw, cols, rows, cell, radius);
    if (built.maxV <= 0) {
      return;
    }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = built.grid[r * cols + c] / built.maxV;
        if (v < 0.04) {
          continue;
        }
        ctx.fillStyle = _heatColor(v, 0.35 * Math.min(1, v + 0.3));
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
  }

  function drawRawPoints(ctx, raw) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    raw.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function fixationPoints(fixations) {
    return fixations
      .map(function (f) {
        return { x: f.details && f.details.x, y: f.details && f.details.y, d: f.duration };
      })
      .filter(function (f) {
        return Number.isFinite(f.x) && Number.isFinite(f.y);
      });
  }

  function drawScanpath(ctx, fx) {
    ctx.strokeStyle = 'rgba(108,140,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    fx.forEach(function (f, i) {
      if (i === 0) {
        ctx.moveTo(f.x, f.y);
      } else {
        ctx.lineTo(f.x, f.y);
      }
    });
    ctx.stroke();
  }

  function drawFixations(ctx, fx) {
    fx.forEach(function (f, i) {
      var rad = _clamp(6 + (f.d || 0) / 40, 7, 34);
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(78,205,196,0.30)';
      ctx.fill();
      ctx.strokeStyle = '#4ecdc4';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), f.x, f.y);
    });
  }

  function meanConfidence(raw) {
    var withConf = raw.filter(function (p) {
      return typeof p.confidence === 'number';
    });
    if (!withConf.length) {
      return '—';
    }
    var sum = withConf.reduce(function (s, p) {
      return s + p.confidence;
    }, 0);
    return (sum / withConf.length).toFixed(2);
  }

  function moduleLabel(session, raw) {
    if (session.session && session.session.id) {
      return (raw[0] && raw[0].source_module) || '—';
    }
    return '—';
  }

  function countSaccades(events) {
    return events.filter(function (e) {
      return e.type === 'saccade';
    }).length;
  }

  function buildInfoPanel(session, raw, events, fx) {
    var panel = document.createElement('div');
    panel.classList.add('gv-info-panel');

    var titleEl = document.createElement('div');
    titleEl.classList.add('gv-info-title');
    titleEl.textContent = 'Parcours du regard';
    panel.appendChild(titleEl);

    var statsLines = [
      'Points : ' + raw.length,
      'Fixations : ' + fx.length,
      'Saccades : ' + countSaccades(events),
      'Confiance moy. : ' + meanConfidence(raw),
      'Moteur : ' + moduleLabel(session, raw),
    ];
    statsLines.forEach(function (line) {
      var br = document.createElement('br');
      panel.appendChild(br);
      panel.appendChild(document.createTextNode(line));
    });

    var legend = document.createElement('div');
    legend.classList.add('gv-info-legend');
    legend.textContent = '⬤ heatmap densité · ● fixations (∝ durée) · — scanpath';
    panel.appendChild(legend);

    return panel;
  }

  function buildCloseButton() {
    var close = document.createElement('button');
    close.classList.add('gv-close-btn');
    close.textContent = 'Fermer ✕';
    close.addEventListener('click', hide);
    return close;
  }

  function show(session) {
    hide();
    if (!session) {
      return;
    }
    var raw = session.raw_gaze_data || [];
    var events = session.events || [];
    var fixations = events.filter(function (e) {
      return e.type === 'fixation';
    });

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    var ctx = createCanvas(overlay);
    var W = window.innerWidth;
    var H = window.innerHeight;
    var fx = fixationPoints(fixations);

    drawHeatmap(ctx, raw, W, H);
    drawRawPoints(ctx, raw);
    drawScanpath(ctx, fx);
    drawFixations(ctx, fx);

    overlay.appendChild(buildInfoPanel(session, raw, events, fx));
    overlay.appendChild(buildCloseButton());
    document.body.appendChild(overlay);
  }

  global.GazeViz = { show: show, hide: hide, _heatColor: _heatColor };

})(typeof window !== 'undefined' ? window : global);
