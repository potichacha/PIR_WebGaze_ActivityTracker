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
  let _aoiCache = null;      // invalidated on each re-render
  let _gazeModeActive = false;

  // État interactif (reflété dans viz_state du log) :
  let _hiddenQuarters = {};  // { T2: true } = trimestre masqué (filtre)
  let _zoom = 1;             // facteur de zoom vertical (échelle des valeurs)
  let _onStateChange = null; // callback déclenché à chaque changement d'état

  function _visibleData() {
    return DATA.filter(d => !_hiddenQuarters[d.quarter]);
  }
  function _notifyState() {
    _aoiCache = null;
    if (typeof _onStateChange === 'function') {
      try { _onStateChange(getState()); } catch (_) {}
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  function init(containerId) {
    _containerId = containerId;

    if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);

    if (!document.getElementById('barchart-tooltip')) {
      _tooltip = d3.select('body')
        .append('div')
        .attr('id', 'barchart-tooltip')
        .attr('class', 'barchart-tooltip')
        .style('opacity', 0);
    } else {
      _tooltip = d3.select('#barchart-tooltip');
    }

    _render();

    _resizeHandler = _debounce(function () { _aoiCache = null; _render(); }, 300);
    window.addEventListener('resize', _resizeHandler);
  }

  /**
   * Returns bounding rectangles (viewport coords) of each bar + both axes.
   * Result is cached and invalidated after each re-render or resize.
   * @returns {Array<{id, label, x, y, width, height}>}
   */
  function getAOIs() {
    if (_aoiCache) return _aoiCache;
    if (!_svg) return [];

    const aois = [];

    _svg.selectAll('.barchart-bar').each(function (d) {
      const r = this.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      aois.push({
        id: `bar-${d.label}`,
        label: `Barre ${d.label} — ${d.value.toLocaleString('fr-FR')} €`,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    });

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

    _aoiCache = aois;
    return aois;
  }

  /**
   * Enable/disable mouse hover on bars.
   * Call setGazeMode(true) when gaze tracking starts so mouse doesn't conflict.
   */
  function setGazeMode(enabled) {
    _gazeModeActive = enabled;
    if (_svg) {
      _svg.selectAll('.barchart-bar')
        .style('pointer-events', enabled ? 'none' : 'all');
    }
    if (!enabled) gazeLeave();
  }

  /**
   * Visual feedback while the user is dwelling on a bar (0 ≤ progress ≤ 1).
   * Darkens the target bar slightly to signal the interaction is registering.
   */
  function gazeDwelling(barId, progress) {
    if (!_svg) return;
    _svg.selectAll('.barchart-bar').attr('opacity', function (d) {
      if (!barId || `bar-${d.label}` !== barId) return 1;
      return 1 - 0.3 * progress;
    });
  }

  /**
   * Trigger the hover state on a specific bar at gaze position (x, y).
   */
  function gazeHover(barId, x, y) {
    if (!_svg) return;
    const d = DATA.find(d => `bar-${d.label}` === barId);
    if (!d) return;

    _svg.selectAll('.barchart-bar')
      .attr('opacity', b => `bar-${b.label}` === barId ? 0.72 : 1);

    _tooltip
      .style('opacity', 0.95)
      .html(
        `<strong>${d.label} 2024</strong><br/>` +
        `Ventes&nbsp;: ${d.value.toLocaleString('fr-FR')} €<br/>` +
        `Trimestre&nbsp;: ${d.quarter}`
      )
      .style('left', (x + 16) + 'px')
      .style('top',  (y - 50) + 'px');
  }

  /** Hide tooltip and reset all bar opacities. */
  function gazeLeave() {
    if (!_svg) return;
    _svg.selectAll('.barchart-bar').attr('opacity', 1);
    if (_tooltip) _tooltip.style('opacity', 0);
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  function _render() {
    const container = document.getElementById(_containerId);
    if (!container) return;

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

    // Le zoom réduit le maximum de l'axe → les barres paraissent plus hautes.
    const dataMax = d3.max(VDATA, d => d.value) || 1;
    const yScale = d3.scaleLinear()
      .domain([0, (dataMax * 1.12) / _zoom])
      .range([chartH, 0]);

    // Horizontal grid lines
    g.append('g')
      .attr('class', 'barchart-grid')
      .call(
        d3.axisLeft(yScale)
          .tickSize(-chartW)
          .tickFormat('')
          .ticks(5)
      );

    // X axis
    g.append('g')
      .attr('class', 'barchart-x-axis')
      .attr('transform', `translate(0,${chartH})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
        .style('font-size', '12px')
        .style('fill', '#444');

    // Y axis
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

    // Axis labels
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

    // Chart title
    _svg.append('text')
      .attr('class', 'barchart-title')
      .attr('x', totalWidth / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .text('Ventes mensuelles — Exercice 2024');

    // Bars
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
        _tooltip
          .style('opacity', 0.95)
          .html(
            `<strong>${d.label} 2024</strong><br/>` +
            `Ventes&nbsp;: ${d.value.toLocaleString('fr-FR')} €<br/>` +
            `Trimestre&nbsp;: ${d.quarter}`
          )
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

    // Value labels on top of bars
    g.selectAll('.barchart-bar-value')
      .data(VDATA)
      .enter()
      .append('text')
      .attr('class', 'barchart-bar-value')
      .attr('x', d => xScale(d.label) + xScale.bandwidth() / 2)
      .attr('y', d => yScale(d.value) - 4)
      .attr('text-anchor', 'middle')
      .text(d => `${(d.value / 1000).toFixed(1)}k`);

    // Legend — cliquable : filtre par trimestre (clic = masquer/afficher).
    const quarters = [...new Set(DATA.map(d => d.quarter))];
    const legendW = quarters.length * 130;
    const legendG = _svg.append('g')
      .attr('class', 'barchart-legend')
      .attr('transform', `translate(${margin.left + chartW / 2 - legendW / 2}, ${totalHeight - 14})`);

    quarters.forEach((q, i) => {
      const hidden = !!_hiddenQuarters[q];
      const entry = legendG.append('g')
        .attr('transform', `translate(${i * 130}, 0)`)
        .style('cursor', 'pointer')
        .style('opacity', hidden ? 0.4 : 1)
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
        .style('text-decoration', hidden ? 'line-through' : 'none')
        .text(`Trimestre ${q}`);
    });

    // Zoom vertical à la molette (Ctrl+molette pour ne pas gêner le scroll page).
    _svg.on('wheel', function (event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      _zoom = Math.max(1, Math.min(5, _zoom * factor));
      _render();
      _notifyState();
    });

    // Indicateur de zoom (si ≠ 1)
    if (_zoom !== 1) {
      _svg.append('text')
        .attr('x', totalWidth - 12).attr('y', 48)
        .attr('text-anchor', 'end')
        .style('font-size', '11px').style('fill', '#888')
        .text(`zoom ×${_zoom.toFixed(1)} (Ctrl+molette)`);
    }
  }

  // ─── Utils ────────────────────────────────────────────────────────────────────

  function _debounce(fn, wait) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  // ─── État interactif (exposé pour le log viz_state) ───────────────────────────

  function getState() {
    return {
      zoom: +_zoom.toFixed(2),
      hidden_quarters: Object.keys(_hiddenQuarters).filter(q => _hiddenQuarters[q]),
      visible_bars: _visibleData().length,
      total_bars: DATA.length,
    };
  }
  function setZoom(z) { _zoom = Math.max(1, Math.min(5, +z || 1)); if (_containerId) _render(); _notifyState(); }
  function toggleQuarter(q) { _hiddenQuarters[q] = !_hiddenQuarters[q]; if (_containerId) _render(); _notifyState(); }
  function resetView() { _hiddenQuarters = {}; _zoom = 1; if (_containerId) _render(); _notifyState(); }
  function onStateChange(cb) { _onStateChange = cb; }

  return {
    init, getAOIs, setGazeMode, gazeDwelling, gazeHover, gazeLeave, data: DATA,
    getState, setZoom, toggleQuarter, resetView, onStateChange,
  };
})();
