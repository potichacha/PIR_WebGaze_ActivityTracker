/**
 * barchart.js
 *
 * Graphique en barres D3 servant de stimulus interactif pour les tests de regard.
 * Il affiche les ventes mensuelles d'un exercice et expose, en plus du rendu, des
 * points d'entrée pensés pour le suivi du regard :
 *   - getAOIs() renvoie les zones d'intérêt (barres + axes) en coordonnées écran ;
 *   - setGazeMode / gazeHover / gazeDwelling / gazeLeave pilotent le retour visuel
 *     déclenché par le regard plutôt que par la souris ;
 *   - l'état interactif (zoom vertical, trimestres masqués) est exposé via
 *     getState() pour être journalisé dans viz_state.
 *
 * La légende est cliquable (filtre par trimestre) et un zoom vertical est
 * disponible via Ctrl+molette.
 */
const BarChart = (function () {
  'use strict';

  const DATA = [
    { label: 'Jan', value: 4200, quarter: 'T1' },
    { label: 'Fév', value: 3800, quarter: 'T1' },
    { label: 'Mar', value: 5100, quarter: 'T1' },
    { label: 'Avr', value: 4700, quarter: 'T2' },
    { label: 'Mai', value: 5800, quarter: 'T2' },
    { label: 'Jun', value: 6200, quarter: 'T2' },
    { label: 'Jul', value: 5500, quarter: 'T3' },
    { label: 'Aoû', value: 4900, quarter: 'T3' },
    { label: 'Sep', value: 6100, quarter: 'T3' },
    { label: 'Oct', value: 7200, quarter: 'T4' },
    { label: 'Nov', value: 8100, quarter: 'T4' },
    { label: 'Déc', value: 9300, quarter: 'T4' },
  ];

  const QUARTER_COLORS = {
    T1: '#4e79a7',
    T2: '#f28e2b',
    T3: '#59a14f',
    T4: '#e15759',
  };

  let _containerId = null;
  let _svg = null;
  let _resizeHandler = null;
  let _tooltip = null;
  let _aoiCache = null;
  let _gazeModeActive = false;

  let _hiddenQuarters = {};
  let _zoom = 1;
  let _onStateChange = null;

  function _visibleData() {
    return DATA.filter(d => !_hiddenQuarters[d.quarter]);
  }

  function _notifyState() {
    _aoiCache = null;
    if (typeof _onStateChange === 'function') {
      try {
        _onStateChange(getState());
      } catch (_) {}
    }
  }

  function barId(d) {
    return `bar-${d.label}`;
  }

  function fillTooltipContent(node, d) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    const title = document.createElement('strong');
    title.textContent = d.label + ' 2024';
    node.appendChild(title);
    node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode('Ventes : ' + d.value.toLocaleString('fr-FR') + ' €'));
    node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode('Trimestre : ' + d.quarter));
  }

  function init(containerId) {
    _containerId = containerId;

    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
    }

    if (document.getElementById('barchart-tooltip')) {
      _tooltip = d3.select('#barchart-tooltip');
    } else {
      _tooltip = d3.select('body')
        .append('div')
        .attr('id', 'barchart-tooltip')
        .attr('class', 'barchart-tooltip')
        .style('opacity', 0);
    }

    _render();

    _resizeHandler = _debounce(function () {
      _aoiCache = null;
      _render();
    }, 300);
    window.addEventListener('resize', _resizeHandler);
  }

  function collectBarAOIs(aois) {
    _svg.selectAll('.barchart-bar').each(function (d) {
      const r = this.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        return;
      }
      aois.push({
        id: barId(d),
        label: `Barre ${d.label} — ${d.value.toLocaleString('fr-FR')} €`,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    });
  }

  function collectAxisAOIs(aois) {
    const xAxisNode = _svg.select('.barchart-x-axis').node();
    if (xAxisNode) {
      const r = xAxisNode.getBoundingClientRect();
      aois.push({
        id: 'x-axis', label: 'Axe X — Mois',
        x: r.left, y: r.top, width: r.width, height: Math.max(r.height, 20),
      });
    }
    const yAxisNode = _svg.select('.barchart-y-axis').node();
    if (yAxisNode) {
      const r = yAxisNode.getBoundingClientRect();
      aois.push({
        id: 'y-axis', label: 'Axe Y — Ventes (€)',
        x: r.left, y: r.top, width: Math.max(r.width, 20), height: r.height,
      });
    }
  }

  function getAOIs() {
    if (_aoiCache) {
      return _aoiCache;
    }
    if (!_svg) {
      return [];
    }
    const aois = [];
    collectBarAOIs(aois);
    collectAxisAOIs(aois);
    _aoiCache = aois;
    return aois;
  }

  function setGazeMode(enabled) {
    _gazeModeActive = enabled;
    if (_svg) {
      let pointerEvents = 'all';
      if (enabled) {
        pointerEvents = 'none';
      }
      _svg.selectAll('.barchart-bar').style('pointer-events', pointerEvents);
    }
    if (!enabled) {
      gazeLeave();
    }
  }

  function gazeDwelling(targetId, progress) {
    if (!_svg) {
      return;
    }
    _svg.selectAll('.barchart-bar').attr('opacity', function (d) {
      if (!targetId || barId(d) !== targetId) {
        return 1;
      }
      return 1 - 0.3 * progress;
    });
  }

  function gazeHover(targetId, x, y) {
    if (!_svg) {
      return;
    }
    const d = DATA.find(item => barId(item) === targetId);
    if (!d) {
      return;
    }

    _svg.selectAll('.barchart-bar').attr('opacity', function (b) {
      if (barId(b) === targetId) {
        return 0.72;
      }
      return 1;
    });

    fillTooltipContent(_tooltip.node(), d);
    _tooltip
      .style('opacity', 0.95)
      .style('left', (x + 16) + 'px')
      .style('top',  (y - 50) + 'px');
  }

  function gazeLeave() {
    if (!_svg) {
      return;
    }
    _svg.selectAll('.barchart-bar').attr('opacity', 1);
    if (_tooltip) {
      _tooltip.style('opacity', 0);
    }
  }

  function _render() {
    const container = document.getElementById(_containerId);
    if (!container) {
      return;
    }

    d3.select(`#${_containerId}`).selectAll('svg').remove();

    const totalWidth = container.clientWidth || 800;
    const totalHeight = container.clientHeight || 480;
    const margin = { top: 55, right: 30, bottom: 72, left: 78 };
    const chartW = totalWidth - margin.left - margin.right;
    const chartH = totalHeight - margin.top - margin.bottom;

    _svg = d3.select(`#${_containerId}`)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight);

    const g = _svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const VDATA = _visibleData();

    const xScale = d3.scaleBand()
      .domain(VDATA.map(d => d.label))
      .range([0, chartW])
      .padding(0.25);

    const dataMax = d3.max(VDATA, d => d.value) || 1;
    const yScale = d3.scaleLinear()
      .domain([0, (dataMax * 1.12) / _zoom])
      .range([chartH, 0]);

    g.append('g')
      .attr('class', 'barchart-grid')
      .call(
        d3.axisLeft(yScale)
          .tickSize(-chartW)
          .tickFormat('')
          .ticks(5)
      );

    g.append('g')
      .attr('class', 'barchart-x-axis')
      .attr('transform', `translate(0,${chartH})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
        .style('font-size', '12px')
        .style('fill', '#444');

    g.append('g')
      .attr('class', 'barchart-y-axis')
      .call(
        d3.axisLeft(yScale)
          .ticks(5)
          .tickFormat(d => `${(d / 1000).toFixed(0)}k€`)
      )
      .selectAll('text')
        .style('font-size', '12px')
        .style('fill', '#444');

    g.append('text')
      .attr('class', 'barchart-axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', -62)
      .attr('x', -(chartH / 2))
      .attr('text-anchor', 'middle')
      .text('Ventes (€)');

    g.append('text')
      .attr('class', 'barchart-axis-label')
      .attr('x', chartW / 2)
      .attr('y', chartH + 52)
      .attr('text-anchor', 'middle')
      .text('Mois');

    _svg.append('text')
      .attr('class', 'barchart-title')
      .attr('x', totalWidth / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .text('Ventes mensuelles — Exercice 2024');

    g.selectAll('.barchart-bar')
      .data(VDATA)
      .enter()
      .append('rect')
      .attr('class', 'barchart-bar')
      .attr('data-label', d => d.label)
      .attr('x', d => xScale(d.label))
      .attr('y', d => yScale(d.value))
      .attr('width', xScale.bandwidth())
      .attr('height', d => chartH - yScale(d.value))
      .attr('fill', d => QUARTER_COLORS[d.quarter])
      .attr('rx', 3)
      .on('mouseover', function (event, d) {
        d3.select(this).attr('opacity', 0.72);
        fillTooltipContent(_tooltip.node(), d);
        _tooltip
          .style('opacity', 0.95)
          .style('left', (event.clientX + 14) + 'px')
          .style('top', (event.clientY - 44) + 'px');
      })
      .on('mousemove', function (event) {
        _tooltip
          .style('left', (event.clientX + 14) + 'px')
          .style('top', (event.clientY - 44) + 'px');
      })
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 1);
        _tooltip.style('opacity', 0);
      });

    g.selectAll('.barchart-bar-value')
      .data(VDATA)
      .enter()
      .append('text')
      .attr('class', 'barchart-bar-value')
      .attr('x', d => xScale(d.label) + xScale.bandwidth() / 2)
      .attr('y', d => yScale(d.value) - 4)
      .attr('text-anchor', 'middle')
      .text(d => `${(d.value / 1000).toFixed(1)}k`);

    renderLegend(margin, chartW, totalHeight);
    enableWheelZoom();
    renderZoomIndicator(totalWidth);
  }

  function renderLegend(margin, chartW, totalHeight) {
    const quarters = [...new Set(DATA.map(d => d.quarter))];
    const legendW = quarters.length * 130;
    const legendG = _svg.append('g')
      .attr('class', 'barchart-legend')
      .attr('transform', `translate(${margin.left + chartW / 2 - legendW / 2}, ${totalHeight - 14})`);

    quarters.forEach((q, i) => {
      const hidden = !!_hiddenQuarters[q];
      let entryOpacity = 1;
      let textDecoration = 'none';
      if (hidden) {
        entryOpacity = 0.4;
        textDecoration = 'line-through';
      }
      const entry = legendG.append('g')
        .attr('transform', `translate(${i * 130}, 0)`)
        .style('cursor', 'pointer')
        .style('opacity', entryOpacity)
        .on('click', function () {
          _hiddenQuarters[q] = !_hiddenQuarters[q];
          _render();
          _notifyState();
        });
      entry.append('rect')
        .attr('width', 12).attr('height', 12).attr('rx', 2)
        .attr('fill', QUARTER_COLORS[q]);
      entry.append('text')
        .attr('x', 16).attr('y', 11)
        .style('font-size', '11px')
        .style('fill', '#555')
        .style('text-decoration', textDecoration)
        .text(`Trimestre ${q}`);
    });
  }

  function enableWheelZoom() {
    _svg.on('wheel', function (event) {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      let factor = 1 / 1.15;
      if (event.deltaY < 0) {
        factor = 1.15;
      }
      _zoom = Math.max(1, Math.min(5, _zoom * factor));
      _render();
      _notifyState();
    });
  }

  function renderZoomIndicator(totalWidth) {
    if (_zoom === 1) {
      return;
    }
    _svg.append('text')
      .attr('x', totalWidth - 12).attr('y', 48)
      .attr('text-anchor', 'end')
      .style('font-size', '11px').style('fill', '#888')
      .text(`zoom ×${_zoom.toFixed(1)} (Ctrl+molette)`);
  }

  function _debounce(fn, wait) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  function getState() {
    return {
      zoom: +_zoom.toFixed(2),
      hidden_quarters: Object.keys(_hiddenQuarters).filter(q => _hiddenQuarters[q]),
      visible_bars: _visibleData().length,
      total_bars: DATA.length,
    };
  }

  function setZoom(z) {
    _zoom = Math.max(1, Math.min(5, +z || 1));
    if (_containerId) {
      _render();
    }
    _notifyState();
  }

  function toggleQuarter(q) {
    _hiddenQuarters[q] = !_hiddenQuarters[q];
    if (_containerId) {
      _render();
    }
    _notifyState();
  }

  function resetView() {
    _hiddenQuarters = {};
    _zoom = 1;
    if (_containerId) {
      _render();
    }
    _notifyState();
  }

  function onStateChange(cb) {
    _onStateChange = cb;
  }

  return {
    init, getAOIs, setGazeMode, gazeDwelling, gazeHover, gazeLeave, data: DATA,
    getState, setZoom, toggleQuarter, resetView, onStateChange,
  };
})();

if (typeof window !== 'undefined') {
  window.BarChart = BarChart;
}
