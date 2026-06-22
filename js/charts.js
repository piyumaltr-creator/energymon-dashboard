/**
 * charts.js — Chart.js wrapper for the four live trend charts
 */

const Charts = (() => {
  const _charts = {};
  const _history = {};   // meterId → { labels, v, i, p, pf }
  const MAX_POINTS = 30;

  const COLORS = {
    v:  '#185FA5',
    i:  '#3B6D11',
    p:  '#A32D2D',
    pf: '#854F0B',
  };

  function _makeChart(canvasId, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    if (_charts[canvasId]) { _charts[canvasId].destroy(); delete _charts[canvasId]; }

    _charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.35,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: {
            ticks: { font: { size: 10 }, color: '#888', maxTicksLimit: 6, autoSkip: true },
            grid: { color: 'rgba(128,128,128,.1)' },
          },
          y: {
            ticks: { font: { size: 10 }, color: '#888' },
            grid: { color: 'rgba(128,128,128,.1)' },
          }
        }
      }
    });
    return _charts[canvasId];
  }

  function init() {
    _makeChart('vChart',  COLORS.v);
    _makeChart('iChart',  COLORS.i);
    _makeChart('pChart',  COLORS.p);
    _makeChart('pfChart', COLORS.pf);
  }

  function _push(arr, val) {
    arr.push(val);
    if (arr.length > MAX_POINTS) arr.shift();
  }

  function pushData(meterId, voltage, current, power, pf) {
    if (!_history[meterId]) {
      _history[meterId] = { labels: [], v: [], i: [], p: [], pf: [] };
    }
    const h = _history[meterId];
    const label = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    _push(h.labels, label);
    _push(h.v,  voltage);
    _push(h.i,  current);
    _push(h.p,  power);
    _push(h.pf, pf);
  }

  function _updateChart(id, labels, data) {
    const c = _charts[id];
    if (!c) return;
    c.data.labels = [...labels];
    c.data.datasets[0].data = [...data];
    c.update('none');
  }

  function render(meterId) {
    const h = _history[meterId];
    if (!h || !h.labels.length) return;
    _updateChart('vChart',  h.labels, h.v);
    _updateChart('iChart',  h.labels, h.i);
    _updateChart('pChart',  h.labels, h.p);
    _updateChart('pfChart', h.labels, h.pf);
  }

  function getLastValues(meterId) {
    const h = _history[meterId];
    if (!h || !h.v.length) return null;
    return {
      v:  h.v[h.v.length - 1],
      i:  h.i[h.i.length - 1],
      p:  h.p[h.p.length - 1],
      pf: h.pf[h.pf.length - 1],
    };
  }

  return { init, pushData, render, getLastValues };
})();
