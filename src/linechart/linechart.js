/**
 * linechart.js
 *
 * Graphique en courbes D3 (températures mensuelles de deux villes) servant de
 * stimulus interactif pour les tests de regard. En plus du rendu, il expose les
 * points d'entrée nécessaires au suivi du regard :
 *   - getAOIs() renvoie une bande verticale par mois (zone d'intérêt de dwell),
 *     plus les axes et la légende, en coordonnées écran ;
 *   - setGazeMode / gazeHover / gazeDwelling / gazeLeave pilotent le retour visuel
 *     (bande de survol, ligne de focus, infobulle) à partir du regard.
 *
 * Le rendu reste interactif à la souris tant que le mode regard n'est pas activé.
 */
const LineChart = (function () {
  'use strict';

  const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  const SERIES = [
    {
      id: 'paris',
      label: 'Paris',
      color: '#4e79a7',
      values: [4.2, 5.1, 8.8, 11.5, 15.2, 18.4, 20.6, 20.1, 16.8, 12.3, 7.5, 4.8],
    },
    {
      id: 'lyon',
      label: 'Lyon',
      color: '#e15759',
      values: [3.1, 4.5, 9.2, 12.8, 16.7, 20.1, 22.8, 22.4, 18.2, 13.1, 7.2, 3.9],
    },
  ];

  let _containerId  = null;
  let _svg          = null;
  let _g            = null;
  let _xScale       = null;
  let _yScale       = null;
  let _chartW       = 0;
  let _chartH       = 0;
  let _margin       = null;
  let _resizeHandler = null;
  let _tooltip      = null;
  let _focusGroup   = null;
  let _aoiCache     = null;
  let _gazeModeActive = false;

  function pointerEventsFor(gazeEnabled) {
    if (gazeEnabled) {
      return 'none';
    }
    return 'all';
  }

  function init(containerId) {
    _containerId = containerId;
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
    }

    if (document.getElementById('linechart-tooltip')) {
      _tooltip = d3.select('#linechart-tooltip');
    } else {
      _tooltip = d3.select('body')
        .append('div')
        .attr('id', 'linechart-tooltip')
        .attr('class', 'linechart-tooltip')
        .style('opacity', 0);
    }

    _render();

    _resizeHandler = _debounce(function () {
      _aoiCache = null;
      _render();
    }, 300);
    window.addEventListener('resize', _resizeHandler);
  }

  function collectMonthAOIs(aois) {
    const svgRect = _svg.node().getBoundingClientRect();
    const step = _xScale.step();
    MONTHS.forEach(function (month) {
      const xLocal = _xScale(month) - step / 2;
      aois.push({
        id: 'col-' + month,
        label: 'Colonne ' + month,
        x: svgRect.left + _margin.left + xLocal,
        y: svgRect.top + _margin.top,
        width: step,
        height: _chartH,
      });
    });
  }

  function collectChromeAOIs(aois) {
    const xAxisNode = _svg.select('.linechart-x-axis').node();
    if (xAxisNode) {
      const r = xAxisNode.getBoundingClientRect();
      aois.push({ id: 'x-axis', label: 'Axe X — Mois',
        x: r.left, y: r.top, width: r.width, height: Math.max(r.height, 20) });
    }
    const yAxisNode = _svg.select('.linechart-y-axis').node();
    if (yAxisNode) {
      const r = yAxisNode.getBoundingClientRect();
      aois.push({ id: 'y-axis', label: 'Axe Y — Température (°C)',
        x: r.left, y: r.top, width: Math.max(r.width, 20), height: r.height });
    }
    const legendNode = _svg.select('.linechart-legend').node();
    if (legendNode) {
      const r = legendNode.getBoundingClientRect();
      aois.push({ id: 'legend', label: 'Légende',
        x: r.left, y: r.top, width: r.width, height: r.height });
    }
  }

  function getAOIs() {
    if (_aoiCache) {
      return _aoiCache;
    }
    if (!_svg || !_xScale || !_margin) {
      return [];
    }
    const aois = [];
    collectMonthAOIs(aois);
    collectChromeAOIs(aois);
    _aoiCache = aois;
    return aois;
  }

  function setGazeMode(enabled) {
    _gazeModeActive = enabled;
    if (_svg) {
      _svg.select('.linechart-overlay').style('pointer-events', pointerEventsFor(enabled));
    }
    if (!enabled) {
      gazeLeave();
    }
  }

  function gazeDwelling(colId, progress) {
    if (!_g) {
      return;
    }
    const band = _g.select('.linechart-dwell-band');

    if (!colId) {
      if (!band.empty()) {
        band.attr('opacity', 0);
      }
      return;
    }

    const month = colId.replace('col-', '');
    const idx = MONTHS.indexOf(month);
    if (idx < 0) {
      return;
    }

    const step = _xScale.step();
    const xLocal = _xScale(month) - step / 2;

    if (band.empty()) {
      _g.insert('rect', ':first-child')
        .attr('class', 'linechart-dwell-band')
        .attr('y', 0)
        .attr('height', _chartH);
    }

    _g.select('.linechart-dwell-band')
      .attr('x', xLocal)
      .attr('width', step)
      .attr('fill', 'rgba(100,150,220,' + (0.06 + 0.14 * progress) + ')')
      .attr('opacity', 1);
  }

  function gazeHover(colId, x, y) {
    if (!_focusGroup) {
      return;
    }
    const month = colId.replace('col-', '');
    const idx = MONTHS.indexOf(month);
    if (idx < 0) {
      return;
    }
    _showFocus(month, idx, x, y);
  }

  function gazeLeave() {
    gazeDwelling(null, 0);
    _hideFocus();
    if (_tooltip) {
      _tooltip.style('opacity', 0);
    }
  }

  function _render() {
    const container = document.getElementById(_containerId);
    if (!container) {
      return;
    }

    d3.select('#' + _containerId).selectAll('svg').remove();

    const totalWidth = container.clientWidth || 800;
    const totalHeight = container.clientHeight || 480;
    _margin = { top: 55, right: 40, bottom: 72, left: 65 };
    _chartW = totalWidth - _margin.left - _margin.right;
    _chartH = totalHeight - _margin.top - _margin.bottom;

    _svg = d3.select('#' + _containerId)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight);

    _g = _svg.append('g')
      .attr('transform', 'translate(' + _margin.left + ',' + _margin.top + ')');

    _xScale = d3.scalePoint()
      .domain(MONTHS)
      .range([0, _chartW])
      .padding(0.5);

    const allValues = SERIES.reduce(function (acc, s) { return acc.concat(s.values); }, []);
    _yScale = d3.scaleLinear()
      .domain([Math.min.apply(null, allValues) - 3, Math.max.apply(null, allValues) + 3])
      .range([_chartH, 0]);

    _g.append('g')
      .attr('class', 'linechart-grid')
      .call(d3.axisLeft(_yScale).tickSize(-_chartW).tickFormat('').ticks(6));

    _g.append('g')
      .attr('class', 'linechart-x-axis')
      .attr('transform', 'translate(0,' + _chartH + ')')
      .call(d3.axisBottom(_xScale))
      .selectAll('text')
        .style('font-size', '12px')
        .style('fill', '#444');

    _g.append('g')
      .attr('class', 'linechart-y-axis')
      .call(d3.axisLeft(_yScale).ticks(6).tickFormat(function (d) { return d + '°C'; }))
      .selectAll('text')
        .style('font-size', '12px')
        .style('fill', '#444');

    _g.append('text')
      .attr('class', 'linechart-axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', -52)
      .attr('x', -(_chartH / 2))
      .attr('text-anchor', 'middle')
      .text('Température (°C)');

    _g.append('text')
      .attr('class', 'linechart-axis-label')
      .attr('x', _chartW / 2)
      .attr('y', _chartH + 50)
      .attr('text-anchor', 'middle')
      .text('Mois');

    _svg.append('text')
      .attr('class', 'linechart-title')
      .attr('x', totalWidth / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .text('Températures moyennes mensuelles — Paris & Lyon 2024');

    var lineGen = d3.line()
      .x(function (d, i) { return _xScale(MONTHS[i]); })
      .y(function (d) { return _yScale(d); })
      .curve(d3.curveMonotoneX);

    var areaGen = d3.area()
      .x(function (d, i) { return _xScale(MONTHS[i]); })
      .y0(_chartH)
      .y1(function (d) { return _yScale(d); })
      .curve(d3.curveMonotoneX);

    SERIES.forEach(function (series) {
      _g.append('path')
        .datum(series.values)
        .attr('class', 'linechart-area linechart-area-' + series.id)
        .attr('fill', series.color)
        .attr('opacity', 0.08)
        .attr('d', areaGen);

      _g.append('path')
        .datum(series.values)
        .attr('class', 'linechart-line linechart-line-' + series.id)
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2.5)
        .attr('d', lineGen);

      _g.selectAll('.linechart-dot-' + series.id)
        .data(series.values)
        .enter()
        .append('circle')
        .attr('class', 'linechart-dot linechart-dot-' + series.id)
        .attr('cx', function (d, i) { return _xScale(MONTHS[i]); })
        .attr('cy', function (d) { return _yScale(d); })
        .attr('r', 4)
        .attr('fill', series.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
    });

    _focusGroup = _g.append('g')
      .attr('class', 'linechart-focus')
      .style('display', 'none');

    _focusGroup.append('line')
      .attr('class', 'linechart-focus-line')
      .attr('y1', 0)
      .attr('y2', _chartH)
      .attr('stroke', '#aaa')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,3');

    SERIES.forEach(function (series) {
      _focusGroup.append('circle')
        .attr('class', 'linechart-focus-dot focus-dot-' + series.id)
        .attr('r', 5.5)
        .attr('fill', series.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
    });

    _g.append('rect')
      .attr('class', 'linechart-overlay')
      .attr('width', _chartW)
      .attr('height', _chartH)
      .attr('fill', 'none')
      .style('pointer-events', pointerEventsFor(_gazeModeActive))
      .on('mousemove', function (event) {
        var pos = d3.pointer(event, _g.node());
        var month = _closestMonth(pos[0]);
        if (month !== null) {
          var idx = MONTHS.indexOf(month);
          _showFocus(month, idx, event.clientX, event.clientY);
        }
      })
      .on('mouseleave', function () {
        _hideFocus();
        if (_tooltip) {
          _tooltip.style('opacity', 0);
        }
      });

    renderLegend(totalWidth, totalHeight);

    _aoiCache = null;
  }

  function renderLegend(totalWidth, totalHeight) {
    const legendSpacing = 140;
    const legendW = SERIES.length * legendSpacing;
    const legendG = _svg.append('g')
      .attr('class', 'linechart-legend')
      .attr('transform', 'translate(' + (_margin.left + _chartW / 2 - legendW / 2) + ',' + (totalHeight - 14) + ')');

    SERIES.forEach(function (series, i) {
      const entry = legendG.append('g')
        .attr('transform', 'translate(' + (i * legendSpacing) + ',0)');
      entry.append('line')
        .attr('x1', 0).attr('y1', 6).attr('x2', 20).attr('y2', 6)
        .attr('stroke', series.color).attr('stroke-width', 2.5);
      entry.append('circle')
        .attr('cx', 10).attr('cy', 6).attr('r', 3)
        .attr('fill', series.color);
      entry.append('text')
        .attr('x', 26).attr('y', 11)
        .style('font-size', '11px')
        .style('fill', '#555')
        .text(series.label);
    });
  }

  function _closestMonth(mx) {
    var closest = null;
    var minDist = Infinity;
    MONTHS.forEach(function (month) {
      var d = Math.abs(_xScale(month) - mx);
      if (d < minDist) {
        minDist = d;
        closest = month;
      }
    });
    return closest;
  }

  function fillTooltipContent(node, month, idx) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    var title = document.createElement('strong');
    title.textContent = month + ' 2024';
    node.appendChild(title);
    SERIES.forEach(function (s) {
      node.appendChild(document.createElement('br'));
      node.appendChild(document.createTextNode(s.label + ' : '));
      var val = document.createElement('strong');
      val.style.color = s.color;
      val.textContent = s.values[idx].toFixed(1) + '°C';
      node.appendChild(val);
    });
  }

  function _showFocus(month, idx, clientX, clientY) {
    if (!_focusGroup) {
      return;
    }
    var xPos = _xScale(month);
    _focusGroup.style('display', null);
    _focusGroup.select('.linechart-focus-line').attr('x1', xPos).attr('x2', xPos);

    SERIES.forEach(function (series) {
      _focusGroup.select('.focus-dot-' + series.id)
        .attr('cx', xPos)
        .attr('cy', _yScale(series.values[idx]));
    });

    if (_tooltip) {
      fillTooltipContent(_tooltip.node(), month, idx);
      _tooltip
        .style('opacity', 0.95)
        .style('left', (clientX + 16) + 'px')
        .style('top', (clientY - 65) + 'px');
    }
  }

  function _hideFocus() {
    if (_focusGroup) {
      _focusGroup.style('display', 'none');
    }
  }

  function _debounce(fn, wait) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  return { init, getAOIs, setGazeMode, gazeDwelling, gazeHover, gazeLeave, data: SERIES };
})();

if (typeof window !== 'undefined') {
  window.LineChart = LineChart;
}
