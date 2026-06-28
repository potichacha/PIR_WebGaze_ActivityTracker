/**
 * scatterchart.js
 *
 * Nuage de points D3 (PIB par habitant contre espérance de vie, par pays) servant
 * de stimulus interactif pour les tests de regard. En plus du rendu, il expose les
 * points d'entrée nécessaires au suivi du regard :
 *   - getAOIs() renvoie une zone d'intérêt circulaire autour de chaque point, plus
 *     les axes et la légende, en coordonnées écran ;
 *   - setGazeMode / gazeHover / gazeDwelling / gazeLeave pilotent la mise en
 *     évidence et l'infobulle à partir du regard plutôt que de la souris.
 *
 * Le rendu reste interactif à la souris tant que le mode regard n'est pas activé.
 */
const ScatterChart = (function () {
  'use strict';

  const DATA = [
    { id: 'fr',  label: 'France',        gdp: 42330, life: 82.3, region: 'Europe'   },
    { id: 'de',  label: 'Allemagne',      gdp: 46260, life: 80.9, region: 'Europe'   },
    { id: 'uk',  label: 'Royaume-Uni',    gdp: 41030, life: 81.3, region: 'Europe'   },
    { id: 'it',  label: 'Italie',         gdp: 33560, life: 83.0, region: 'Europe'   },
    { id: 'es',  label: 'Espagne',        gdp: 29600, life: 83.4, region: 'Europe'   },
    { id: 'se',  label: 'Suède',          gdp: 52480, life: 82.4, region: 'Europe'   },
    { id: 'no',  label: 'Norvège',        gdp: 89090, life: 82.9, region: 'Europe'   },
    { id: 'ch',  label: 'Suisse',         gdp: 87360, life: 83.6, region: 'Europe'   },
    { id: 'us',  label: 'États-Unis',     gdp: 63540, life: 78.5, region: 'Amérique' },
    { id: 'ca',  label: 'Canada',         gdp: 43240, life: 82.0, region: 'Amérique' },
    { id: 'br',  label: 'Brésil',         gdp: 7720,  life: 75.9, region: 'Amérique' },
    { id: 'mx',  label: 'Mexique',        gdp: 9950,  life: 75.0, region: 'Amérique' },
    { id: 'ar',  label: 'Argentine',      gdp: 10030, life: 76.7, region: 'Amérique' },
    { id: 'jp',  label: 'Japon',          gdp: 40690, life: 84.3, region: 'Asie'     },
    { id: 'cn',  label: 'Chine',          gdp: 10500, life: 77.1, region: 'Asie'     },
    { id: 'in',  label: 'Inde',           gdp: 1960,  life: 69.7, region: 'Asie'     },
    { id: 'kr',  label: 'Corée du Sud',   gdp: 31490, life: 83.3, region: 'Asie'     },
    { id: 'sg',  label: 'Singapour',      gdp: 59790, life: 83.9, region: 'Asie'     },
    { id: 'au',  label: 'Australie',      gdp: 54910, life: 83.4, region: 'Océanie'  },
    { id: 'ng',  label: 'Nigeria',        gdp: 2080,  life: 62.6, region: 'Afrique'  },
    { id: 'za',  label: 'Afrique du Sud', gdp: 6000,  life: 64.1, region: 'Afrique'  },
    { id: 'eg',  label: 'Égypte',         gdp: 3550,  life: 71.8, region: 'Afrique'  },
    { id: 'ma',  label: 'Maroc',          gdp: 3450,  life: 74.3, region: 'Afrique'  },
    { id: 'tr',  label: 'Türkiye',        gdp: 9540,  life: 77.5, region: 'Asie'     },
    { id: 'sa',  label: 'Arabie Saoudite',gdp: 23140, life: 75.1, region: 'Asie'     },
    { id: 'ru',  label: 'Russie',         gdp: 11270, life: 72.6, region: 'Europe'   },
    { id: 'pl',  label: 'Pologne',        gdp: 15690, life: 77.8, region: 'Europe'   },
    { id: 'nl',  label: 'Pays-Bas',       gdp: 52330, life: 81.6, region: 'Europe'   },
    { id: 'be',  label: 'Belgique',       gdp: 44750, life: 81.4, region: 'Europe'   },
    { id: 'pt',  label: 'Portugal',       gdp: 23400, life: 81.9, region: 'Europe'   },
  ];

  const REGION_COLORS = {
    'Europe':   '#4e79a7',
    'Amérique': '#e15759',
    'Asie':     '#f28e2b',
    'Afrique':  '#76b7b2',
    'Océanie':  '#59a14f',
  };

  const POINT_RADIUS = 7;
  const AOI_RADIUS = 30;

  let _containerId = null;
  let _svg = null;
  let _g = null;
  let _xScale = null;
  let _yScale = null;
  let _margin = null;
  let _chartW = 0;
  let _chartH = 0;
  let _tooltip = null;
  let _aoiCache = null;
  let _gazeModeActive = false;
  let _resizeHandler = null;
  let _hoveredId = null;

  function pointColor(d) {
    return REGION_COLORS[d.region] || '#888';
  }

  function fillTooltipContent(node, d) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    var title = document.createElement('strong');
    title.textContent = d.label;
    node.appendChild(title);
    node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode('Région : ' + d.region));
    node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode('PIB/hab : '));
    var gdp = document.createElement('strong');
    gdp.textContent = d.gdp.toLocaleString('fr-FR') + ' $';
    node.appendChild(gdp);
    node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode('Espérance de vie : '));
    var life = document.createElement('strong');
    life.textContent = d.life + ' ans';
    node.appendChild(life);
  }

  function init(containerId) {
    _containerId = containerId;
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
    }

    if (document.getElementById('scatterchart-tooltip')) {
      _tooltip = d3.select('#scatterchart-tooltip');
    } else {
      _tooltip = d3.select('body')
        .append('div')
        .attr('id', 'scatterchart-tooltip')
        .attr('class', 'scatterchart-tooltip')
        .style('opacity', 0);
    }

    _render();

    _resizeHandler = _debounce(function () {
      _aoiCache = null;
      _render();
    }, 300);
    window.addEventListener('resize', _resizeHandler);
  }

  function collectPointAOIs(aois, svgRect) {
    DATA.forEach(function (d) {
      var cx = svgRect.left + _margin.left + _xScale(d.gdp);
      var cy = svgRect.top + _margin.top + _yScale(d.life);
      aois.push({
        id:     'point-' + d.id,
        label:  d.label,
        x:      cx - AOI_RADIUS,
        y:      cy - AOI_RADIUS,
        width:  AOI_RADIUS * 2,
        height: AOI_RADIUS * 2,
        _cx: cx,
        _cy: cy,
      });
    });
  }

  function collectChromeAOIs(aois) {
    var xAxisNode = _svg.select('.scatter-x-axis').node();
    if (xAxisNode) {
      var r = xAxisNode.getBoundingClientRect();
      aois.push({ id: 'x-axis', label: 'Axe X — PIB/habitant (USD)',
        x: r.left, y: r.top, width: r.width, height: Math.max(r.height, 20) });
    }
    var yAxisNode = _svg.select('.scatter-y-axis').node();
    if (yAxisNode) {
      var r2 = yAxisNode.getBoundingClientRect();
      aois.push({ id: 'y-axis', label: 'Axe Y — Espérance de vie (ans)',
        x: r2.left, y: r2.top, width: Math.max(r2.width, 20), height: r2.height });
    }
    var legendNode = _svg.select('.scatter-legend').node();
    if (legendNode) {
      var r3 = legendNode.getBoundingClientRect();
      aois.push({ id: 'legend', label: 'Légende régions',
        x: r3.left, y: r3.top, width: r3.width, height: r3.height });
    }
  }

  function getAOIs() {
    if (_aoiCache) {
      return _aoiCache;
    }
    if (!_svg || !_xScale || !_yScale || !_margin) {
      return [];
    }
    var aois = [];
    collectPointAOIs(aois, _svg.node().getBoundingClientRect());
    collectChromeAOIs(aois);
    _aoiCache = aois;
    return aois;
  }

  function setGazeMode(enabled) {
    _gazeModeActive = enabled;
    if (!enabled) {
      gazeLeave();
    }
  }

  function gazeDwelling(pointId, progress) {
    if (!_svg) {
      return;
    }
    if (!pointId) {
      _svg.selectAll('.scatter-point').attr('stroke-width', 1.5).attr('stroke', '#fff');
      return;
    }
    var id = pointId.replace('point-', '');
    _svg.selectAll('.scatter-point')
      .attr('stroke-width', function (d) {
        if (d.id === id) {
          return 1.5 + 3 * progress;
        }
        return 1.5;
      })
      .attr('stroke', function (d) {
        if (d.id === id) {
          return '#3B82F6';
        }
        return '#fff';
      });
  }

  function emphasizePoint(id) {
    _svg.selectAll('.scatter-point')
      .attr('opacity', function (pt) {
        if (pt.id === id) {
          return 1;
        }
        return 0.35;
      })
      .attr('r', function (pt) {
        if (pt.id === id) {
          return POINT_RADIUS + 3;
        }
        return POINT_RADIUS;
      });
  }

  function showTooltip(d, x, y) {
    if (!_tooltip) {
      return;
    }
    fillTooltipContent(_tooltip.node(), d);
    _tooltip
      .style('opacity', 0.95)
      .style('left', (x + 16) + 'px')
      .style('top', (y - 60) + 'px');
  }

  function gazeHover(pointId, x, y) {
    if (!_svg) {
      return;
    }
    var id = pointId.replace('point-', '');
    var d = DATA.find(function (item) { return item.id === id; });
    if (!d) {
      return;
    }
    if (_hoveredId !== id) {
      emphasizePoint(id);
      _hoveredId = id;
    }
    showTooltip(d, x, y);
  }

  function gazeLeave() {
    if (_svg) {
      _svg.selectAll('.scatter-point')
        .attr('opacity', 0.85)
        .attr('r', POINT_RADIUS)
        .attr('stroke-width', 1.5)
        .attr('stroke', '#fff');
    }
    if (_tooltip) {
      _tooltip.style('opacity', 0);
    }
    _hoveredId = null;
  }

  function xTickFormat(d) {
    if (d >= 1000) {
      return (d / 1000).toFixed(0) + 'k';
    }
    return d;
  }

  function _render() {
    var container = document.getElementById(_containerId);
    if (!container) {
      return;
    }

    d3.select('#' + _containerId).selectAll('svg').remove();

    var totalWidth = container.clientWidth || 800;
    var totalHeight = container.clientHeight || 480;
    _margin = { top: 50, right: 160, bottom: 70, left: 80 };
    _chartW = totalWidth - _margin.left - _margin.right;
    _chartH = totalHeight - _margin.top - _margin.bottom;

    _svg = d3.select('#' + _containerId)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight);

    _g = _svg.append('g')
      .attr('transform', 'translate(' + _margin.left + ',' + _margin.top + ')');

    _xScale = d3.scaleLinear()
      .domain([0, d3.max(DATA, function (d) { return d.gdp; }) * 1.08])
      .range([0, _chartW]);

    _yScale = d3.scaleLinear()
      .domain([55, 87])
      .range([_chartH, 0]);

    _g.append('g')
      .attr('class', 'scatter-grid scatter-grid-x')
      .attr('transform', 'translate(0,' + _chartH + ')')
      .call(d3.axisBottom(_xScale).tickSize(-_chartH).tickFormat('').ticks(6));

    _g.append('g')
      .attr('class', 'scatter-grid scatter-grid-y')
      .call(d3.axisLeft(_yScale).tickSize(-_chartW).tickFormat('').ticks(6));

    _g.append('g')
      .attr('class', 'scatter-x-axis')
      .attr('transform', 'translate(0,' + _chartH + ')')
      .call(d3.axisBottom(_xScale).ticks(6).tickFormat(xTickFormat))
      .selectAll('text').style('font-size', '11px').style('fill', '#555');

    _g.append('g')
      .attr('class', 'scatter-y-axis')
      .call(d3.axisLeft(_yScale).ticks(6).tickFormat(function (d) { return d + ' ans'; }))
      .selectAll('text').style('font-size', '11px').style('fill', '#555');

    _g.append('text')
      .attr('class', 'scatter-axis-label')
      .attr('x', _chartW / 2)
      .attr('y', _chartH + 52)
      .attr('text-anchor', 'middle')
      .text('PIB par habitant (USD)');

    _g.append('text')
      .attr('class', 'scatter-axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', -62)
      .attr('x', -(_chartH / 2))
      .attr('text-anchor', 'middle')
      .text('Espérance de vie (ans)');

    _svg.append('text')
      .attr('class', 'scatter-title')
      .attr('x', (_margin.left + _chartW / 2))
      .attr('y', 28)
      .attr('text-anchor', 'middle')
      .text('PIB/habitant vs Espérance de vie — 30 pays (2023)');

    renderPoints();
    renderOutlierLabels();
    renderLegend();

    _aoiCache = null;
  }

  function renderPoints() {
    _g.selectAll('.scatter-point')
      .data(DATA)
      .enter()
      .append('circle')
      .attr('class', 'scatter-point')
      .attr('cx', function (d) { return _xScale(d.gdp); })
      .attr('cy', function (d) { return _yScale(d.life); })
      .attr('r', POINT_RADIUS)
      .attr('fill', pointColor)
      .attr('opacity', 0.85)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        if (_gazeModeActive) {
          return;
        }
        d3.select(this).attr('r', POINT_RADIUS + 3).attr('opacity', 1);
        _svg.selectAll('.scatter-point').filter(function (pt) { return pt.id !== d.id; })
          .attr('opacity', 0.35);
        showTooltip(d, event.clientX, event.clientY);
      })
      .on('mousemove', function (event) {
        if (_gazeModeActive || !_tooltip) {
          return;
        }
        _tooltip
          .style('left', (event.clientX + 16) + 'px')
          .style('top', (event.clientY - 60) + 'px');
      })
      .on('mouseout', function () {
        if (_gazeModeActive) {
          return;
        }
        _svg.selectAll('.scatter-point').attr('opacity', 0.85).attr('r', POINT_RADIUS);
        if (_tooltip) {
          _tooltip.style('opacity', 0);
        }
      });
  }

  function renderOutlierLabels() {
    var labeled = ['no', 'ch', 'sg', 'jp', 'in', 'ng'];
    _g.selectAll('.scatter-label')
      .data(DATA.filter(function (d) { return labeled.indexOf(d.id) !== -1; }))
      .enter()
      .append('text')
      .attr('class', 'scatter-label')
      .attr('x', function (d) { return _xScale(d.gdp) + POINT_RADIUS + 4; })
      .attr('y', function (d) { return _yScale(d.life) + 4; })
      .style('font-size', '10px')
      .style('fill', '#555')
      .style('pointer-events', 'none')
      .text(function (d) { return d.label; });
  }

  function renderLegend() {
    var regions = Object.keys(REGION_COLORS);
    var legendG = _svg.append('g')
      .attr('class', 'scatter-legend')
      .attr('transform', 'translate(' + (_margin.left + _chartW + 16) + ',' + _margin.top + ')');

    legendG.append('text')
      .attr('x', 0).attr('y', -8)
      .style('font-size', '11px').style('fill', '#555').style('font-weight', '600')
      .text('Régions');

    regions.forEach(function (region, i) {
      var row = legendG.append('g').attr('transform', 'translate(0,' + (i * 22) + ')');
      row.append('circle')
        .attr('cx', 6).attr('cy', 6).attr('r', 6)
        .attr('fill', REGION_COLORS[region]).attr('opacity', 0.85);
      row.append('text')
        .attr('x', 16).attr('y', 11)
        .style('font-size', '11px').style('fill', '#555')
        .text(region);
    });
  }

  function _debounce(fn, wait) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  return { init, getAOIs, setGazeMode, gazeDwelling, gazeHover, gazeLeave, data: DATA };
})();

if (typeof window !== 'undefined') {
  window.ScatterChart = ScatterChart;
}
