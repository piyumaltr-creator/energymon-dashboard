/**
 * dashboard.js — Per-meter configurable dashboard
 *
 * Each meter has its own independent layout stored in _layouts[meterId].
 * Layouts can be copied from one meter to others.
 * Drag-and-drop reordering works in edit mode.
 */

const Dashboard = (() => {

  /* ─── Default layout (used when a meter has no saved layout) ─── */
  const DEFAULT_COMPONENTS = [
    { id:'d-v1',  type:'kpi',   title:'Voltage L1-N',     param:'Voltage L1-N',        unit:'V',   decimals:2, width:'quarter', color:'#185FA5' },
    { id:'d-v2',  type:'kpi',   title:'Voltage L2-N',     param:'Voltage L2-N',        unit:'V',   decimals:2, width:'quarter', color:'#185FA5' },
    { id:'d-v3',  type:'kpi',   title:'Voltage L3-N',     param:'Voltage L3-N',        unit:'V',   decimals:2, width:'quarter', color:'#185FA5' },
    { id:'d-hz',  type:'kpi',   title:'Frequency',        param:'Frequency',           unit:'Hz',  decimals:2, width:'quarter', color:'#6B2FA0' },
    { id:'d-i1',  type:'kpi',   title:'Current L1',       param:'Current L1',          unit:'A',   decimals:2, width:'quarter', color:'#3B6D11' },
    { id:'d-i2',  type:'kpi',   title:'Current L2',       param:'Current L2',          unit:'A',   decimals:2, width:'quarter', color:'#3B6D11' },
    { id:'d-i3',  type:'kpi',   title:'Current L3',       param:'Current L3',          unit:'A',   decimals:2, width:'quarter', color:'#3B6D11' },
    { id:'d-i4',  type:'kpi',   title:'Current N',        param:'Current N',           unit:'A',   decimals:2, width:'quarter', color:'#3B6D11' },
    { id:'d-p',   type:'kpi',   title:'Active Power',     param:'Active Power Total',  unit:'kW',  decimals:2, width:'quarter', color:'#A32D2D' },
    { id:'d-pf',  type:'kpi',   title:'Power Factor',     param:'Power Factor Total',  unit:'',    decimals:3, width:'quarter', color:'#854F0B' },
    { id:'d-e',   type:'kpi',   title:'Energy Import',    param:'Active Energy Delivered', unit:'kWh', decimals:0, width:'quarter', color:'#0E6B6B' },
    { id:'d-cv',  type:'chart', title:'Voltage L1-N',     param:'Voltage L1-N',        unit:'V',   decimals:1, width:'half',    color:'#185FA5', height:'medium' },
    { id:'d-ci',  type:'chart', title:'Current L1',       param:'Current L1',          unit:'A',   decimals:1, width:'half',    color:'#3B6D11', height:'medium' },
    { id:'d-cp',  type:'chart', title:'Active Power',     param:'Active Power Total',  unit:'kW',  decimals:2, width:'half',    color:'#A32D2D', height:'medium' },
    { id:'d-cpf', type:'chart', title:'Power Factor',     param:'Power Factor Total',  unit:'',    decimals:3, width:'half',    color:'#854F0B', height:'medium' },
  ];

  const PALETTE = ['#185FA5','#3B6D11','#A32D2D','#854F0B','#6B2FA0','#0E6B6B','#C05800','#1A6B3C','#555','#b00068'];

  /* ─── Per-meter layout store ─── */
  // _layouts[meterId] = [ ...components ]
  let _layouts        = {};

  let _editMode       = false;
  let _chartInstances = {};   // id → Chart instance
  let _chartData      = {};   // id → { labels[], values[] }
  let _getLive        = null;
  let _getMeters      = null;
  let _getActiveMeter = null;
  let _getMeterModels = null;
  let _editingCompId  = null;
  let _dragSrcIdx     = null;
  let _dragSrcId      = null;  // comp id being dragged

  const MAX_PTS = 40;

  /* ─── Helpers ─── */
  function _comps(meterId) {
    const mid = meterId ?? _getActiveMeter();
    if (!_layouts[mid]) {
      // Fresh deep-copy of defaults, re-id so each meter has unique ids
      _layouts[mid] = JSON.parse(JSON.stringify(DEFAULT_COMPONENTS)).map(c => ({
        ...c, id: c.id + '-m' + mid
      }));
    }
    return _layouts[mid];
  }

  function _setComps(meterId, arr) {
    _layouts[meterId ?? _getActiveMeter()] = arr;
  }

  function _val(meterId, param) {
    const live = _getLive(meterId) || {};
    const key  = Object.keys(live).find(p => p.toLowerCase() === param.toLowerCase())
              || Object.keys(live).find(p => p.toLowerCase().includes(param.toLowerCase()));
    return key !== undefined ? live[key] : null;
  }

  /* ─── Width / height helpers ─── */
  const _wClass = w => ({ quarter:'comp-quarter', third:'comp-third', half:'comp-half', full:'comp-full' }[w] || 'comp-quarter');
  const _hPx    = h => ({ small:110, medium:170, large:250 }[h] || 170);

  /* ─── Edit overlay ─── */
  function _editOverlay(id) {
    return `<div class="comp-overlay">
      <div class="comp-overlay-btns">
        <button class="comp-ovr-btn" data-move-left="${id}" title="Move left"><i class="ti ti-arrow-left"></i></button>
        <button class="comp-ovr-btn" data-edit-comp="${id}"><i class="ti ti-edit"></i>Edit</button>
        <button class="comp-ovr-btn comp-ovr-del" data-del-comp="${id}"><i class="ti ti-trash"></i></button>
        <button class="comp-ovr-btn" data-move-right="${id}" title="Move right"><i class="ti ti-arrow-right"></i></button>
      </div>
    </div>`;
  }

  /* ─── SVG gauge ─── */
  function _gaugeInner(c, meterId) {
    const v   = _val(meterId, c.param);
    const fmt = v !== null ? (+v).toFixed(c.decimals ?? 1) : '—';
    const pct = v !== null ? Math.min(1, Math.max(0, v / (c.maxVal || 300))) : 0;
    const angle = pct * 180;
    const rad = angle * Math.PI / 180;
    const cx = 60, cy = 62, r = 50;
    const ex = cx + r * Math.cos(Math.PI - rad);
    const ey = cy - r * Math.sin(rad);
    const la = angle > 180 ? 1 : 0;
    return `<svg viewBox="0 0 120 75" width="100%" style="max-width:180px;display:block;margin:0 auto">
      <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="#e5e5e3" stroke-width="10" stroke-linecap="round"/>
      <path d="M10,62 A50,50 0 ${la},1 ${ex.toFixed(2)},${ey.toFixed(2)}"
            fill="none" stroke="${c.color}" stroke-width="10" stroke-linecap="round"/>
      <text x="60" y="58" text-anchor="middle" font-size="14" font-weight="700" fill="${c.color}" class="comp-live-val">${fmt}</text>
      <text x="60" y="70" text-anchor="middle" font-size="8" fill="#888">${c.unit||''}</text>
    </svg>`;
  }

  function _tableRows(c, meterId) {
    return (c.params?.length ? c.params : [c.param]).map(p => {
      const v = _val(meterId, p);
      return `<tr>
        <td style="padding:5px 10px;font-size:11px;color:var(--text-secondary)">${p}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:600;font-size:12px">
          ${v !== null ? (+v).toFixed(c.decimals??2) : '—'}
          <span style="font-size:10px;color:var(--text-tertiary);font-weight:400"> ${c.unit||''}</span>
        </td>
      </tr>`;
    }).join('');
  }

  /* ─── Render one component ─── */
  function _renderComp(c, meterId) {
    const wc        = _wClass(c.width);
    const editing   = _editMode ? 'comp-editing' : '';
    const overlay   = _editMode ? _editOverlay(c.id) : '';
    const draggable = _editMode ? 'draggable="true"' : '';

    if (c.type === 'kpi') {
      const v = _val(meterId, c.param);
      return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
        ${overlay}
        <div class="metric-card" style="border-left:3px solid ${c.color};height:100%;min-height:80px">
          <div class="metric-label">${c.title}</div>
          <div class="metric-value" style="color:${c.color}">
            <span class="comp-live-val">${v !== null ? (+v).toFixed(c.decimals??1) : '—'}</span>
            <span class="metric-unit">${c.unit}</span>
          </div>
          <div class="metric-sub">${c.param}</div>
        </div>
      </div>`;
    }

    if (c.type === 'chart') {
      return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
        ${overlay}
        <div class="card" style="height:100%">
          <div class="card-header" style="padding-bottom:6px">
            <span style="width:9px;height:9px;border-radius:50%;background:${c.color};flex-shrink:0"></span>
            <h3>${c.title}</h3>
            <span class="badge badge-success" style="font-size:10px">Live</span>
          </div>
          <div style="position:relative;height:${_hPx(c.height)}px"><canvas id="canvas-${c.id}"></canvas></div>
        </div>
      </div>`;
    }

    if (c.type === 'gauge') {
      return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
        ${overlay}
        <div class="metric-card" style="text-align:center;height:100%;min-height:100px">
          <div class="metric-label" style="margin-bottom:4px">${c.title}</div>
          <div class="gauge-inner">${_gaugeInner(c, meterId)}</div>
        </div>
      </div>`;
    }

    if (c.type === 'bar') {
      const v   = _val(meterId, c.param);
      const pct = v !== null ? Math.min(100, Math.max(0, (v / (c.maxVal||300)) * 100)) : 0;
      return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
        ${overlay}
        <div class="metric-card" style="height:100%;min-height:80px">
          <div class="metric-label">${c.title}</div>
          <div style="display:flex;align-items:baseline;gap:4px;margin:6px 0">
            <span class="metric-value" style="color:${c.color}">
              <span class="comp-live-val">${v !== null ? (+v).toFixed(c.decimals??1) : '—'}</span>
            </span>
            <span class="metric-unit">${c.unit}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c.color}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-top:3px">
            <span>0</span><span>${c.maxVal||300} ${c.unit}</span>
          </div>
        </div>
      </div>`;
    }

    if (c.type === 'table') {
      return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
        ${overlay}
        <div class="card" style="height:100%">
          <div class="card-header">
            <i class="ti ti-table" style="color:${c.color}"></i><h3>${c.title}</h3>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <tbody>${_tableRows(c, meterId)}</tbody>
          </table>
        </div>
      </div>`;
    }

    if (c.type === 'energy') {
      return _renderEnergy(c, meterId, wc, editing, overlay, draggable);
    }
    return '';
  }

  /* ─── Energy component renderer ─── */
  function _renderEnergy(c, meterId, wc, editing, overlay, draggable) {
    const liveVal  = _val(meterId, c.energyParam || c.param);
    const startVal = c.startVal ?? null;
    const consumed = (liveVal !== null && startVal !== null)
      ? Math.max(0, liveVal - startVal)
      : null;
    const fmt = v => v !== null ? (+v).toFixed(c.decimals ?? 2) : '—';

    const fromLabel = c.energyFrom ? _fmtDatetime(c.energyFrom) : 'Not set';
    const toLabel   = c.energyTo   ? _fmtDatetime(c.energyTo)   : 'Now';
    const isExpired = c.energyTo && new Date(c.energyTo) < new Date();
    const statusColor = isExpired ? 'var(--text-tertiary)' : c.color;

    return `<div class="comp-wrap ${wc} ${editing}" data-comp-id="${c.id}" ${draggable}>
      ${overlay}
      <div class="energy-card" style="border-left:3px solid ${c.color};height:100%;min-height:110px">
        <div class="metric-label">${c.title}</div>

        <div class="energy-value">
          <span class="comp-live-val energy-kwh" style="color:${statusColor}">${fmt(consumed)}</span>
          <span class="metric-unit">kWh</span>
        </div>

        <div class="energy-period">
          <i class="ti ti-calendar-event" style="font-size:11px;vertical-align:-1px"></i>
          <span>${fromLabel}</span>
          <span style="color:var(--text-tertiary)">→</span>
          <span>${toLabel}</span>
          ${isExpired ? '<span class="energy-badge-done">Done</span>' : ''}
        </div>

        <div class="energy-sub">
          <span>Start: <strong>${fmt(startVal)}</strong> kWh</span>
          <span style="margin-left:8px">Now: <strong class="comp-live-raw">${fmt(liveVal)}</strong> kWh</span>
        </div>

        ${!_editMode ? `<button class="energy-reset-btn" data-reset-energy="${c.id}" title="Reset start value to current reading now">
          <i class="ti ti-refresh"></i>Reset start
        </button>` : ''}
      </div>
    </div>`;
  }

  function _fmtDatetime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  /* ─── Full render ─── */
  function render(meterId) {
    const container = document.getElementById('dashboard-grid');
    if (!container) return;

    // Destroy old chart instances for this view
    Object.entries(_chartInstances).forEach(([id, ch]) => {
      try { ch.destroy(); } catch(_) {}
    });
    _chartInstances = {};

    const comps = _comps(meterId);
    if (comps.length === 0) {
      container.innerHTML = `<div class="dash-empty">
        <i class="ti ti-layout-dashboard"></i>
        <p>No components yet.</p>
        <p style="font-size:12px;margin-top:4px">Click <strong>Edit dashboard</strong> then <strong>+ Add component</strong></p>
      </div>`;
      return;
    }

    container.innerHTML = comps.map(c => _renderComp(c, meterId)).join('');

    // Init charts
    comps.filter(c => c.type === 'chart').forEach(c => {
      const canvas = document.getElementById('canvas-' + c.id);
      if (!canvas) return;
      _chartInstances[c.id] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: _chartData[c.id]?.labels || [],
          datasets: [{ data: _chartData[c.id]?.values || [], borderColor: c.color,
            borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { ticks: { font: { size: 10 }, color: '#888', maxTicksLimit: 6, autoSkip: true }, grid: { color: 'rgba(128,128,128,.1)' } },
            y: { ticks: { font: { size: 10 }, color: '#888' }, grid: { color: 'rgba(128,128,128,.1)' } },
          }
        }
      });
    });

    _attachHandlers(meterId);
    if (_editMode) _attachDragDrop(meterId);
  }

  /* ─── Live value refresh (no full re-render) ─── */
  function pushChartData(meterId) {
    if (meterId !== _getActiveMeter()) return;
    const comps = _comps(meterId);

    comps.filter(c => c.type === 'chart').forEach(c => {
      if (!_chartData[c.id]) _chartData[c.id] = { labels: [], values: [] };
      const v = _val(meterId, c.param);
      if (v === null) return;
      const d = _chartData[c.id];
      d.labels.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      d.values.push(+v);
      if (d.labels.length > MAX_PTS) { d.labels.shift(); d.values.shift(); }
      const ch = _chartInstances[c.id];
      if (ch) { ch.data.labels = [...d.labels]; ch.data.datasets[0].data = [...d.values]; ch.update('none'); }
    });

    comps.forEach(c => {
      if (c.type === 'chart') return;
      const wrap = document.querySelector(`[data-comp-id="${c.id}"]`);
      if (!wrap) return;

      if (c.type === 'kpi') {
        const el = wrap.querySelector('.comp-live-val');
        if (el) { const v = _val(meterId, c.param); el.textContent = v !== null ? (+v).toFixed(c.decimals ?? 1) : '—'; }
      }
      if (c.type === 'bar') {
        const v = _val(meterId, c.param);
        const pct = v !== null ? Math.min(100, Math.max(0, (v / (c.maxVal||300)) * 100)) : 0;
        const bar = wrap.querySelector('.bar-fill');
        const valEl = wrap.querySelector('.comp-live-val');
        if (bar) bar.style.width = pct + '%';
        if (valEl && v !== null) valEl.textContent = (+v).toFixed(c.decimals ?? 1);
      }
      if (c.type === 'gauge') {
        const inner = wrap.querySelector('.gauge-inner');
        if (inner) inner.innerHTML = _gaugeInner(c, meterId);
      }
      if (c.type === 'table') {
        const tbody = wrap.querySelector('tbody');
        if (tbody) tbody.innerHTML = _tableRows(c, meterId);
      }
      if (c.type === 'energy') {
        const liveVal  = _val(meterId, c.energyParam || c.param);
        const startVal = c.startVal ?? null;
        const consumed = (liveVal !== null && startVal !== null) ? Math.max(0, liveVal - startVal) : null;
        const fmt      = v => v !== null ? (+v).toFixed(c.decimals ?? 2) : '—';
        const isExpired = c.energyTo && new Date(c.energyTo) < new Date();
        const statusColor = isExpired ? 'var(--text-tertiary)' : c.color;
        const kwhEl  = wrap.querySelector('.energy-kwh');
        const rawEl  = wrap.querySelector('.comp-live-raw');
        if (kwhEl) { kwhEl.textContent = fmt(consumed); kwhEl.style.color = statusColor; }
        if (rawEl)   rawEl.textContent = fmt(liveVal);
      }
    });
  }

  /* ─── Event handlers ─── */
  function _attachHandlers(meterId) {
    document.querySelectorAll('[data-edit-comp]').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.editComp, meterId); })
    );
    document.querySelectorAll('[data-del-comp]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Remove this component?')) return;
        const id = btn.dataset.delComp;
        _setComps(meterId, _comps(meterId).filter(c => c.id !== id));
        delete _chartInstances[id];
        delete _chartData[id];
        render(meterId);
      })
    );
    document.querySelectorAll('[data-move-left]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const comps = _comps(meterId);
        const idx = comps.findIndex(c => c.id === btn.dataset.moveLeft);
        if (idx > 0) { [comps[idx-1], comps[idx]] = [comps[idx], comps[idx-1]]; render(meterId); }
      })
    );
    document.querySelectorAll('[data-move-right]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const comps = _comps(meterId);
        const idx = comps.findIndex(c => c.id === btn.dataset.moveRight);
        if (idx < comps.length - 1) { [comps[idx], comps[idx+1]] = [comps[idx+1], comps[idx]]; render(meterId); }
      })
    );
    // Energy reset-start button
    document.querySelectorAll('[data-reset-energy]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const comps = _comps(meterId);
        const c = comps.find(x => x.id === btn.dataset.resetEnergy);
        if (!c) return;
        const liveVal = _val(meterId, c.energyParam || c.param);
        if (liveVal === null) { if (typeof toast === 'function') toast('No live reading available yet'); return; }
        c.startVal   = liveVal;
        c.energyFrom = new Date().toISOString().slice(0,16);
        // Re-render just this card
        const wrap = document.querySelector(`[data-comp-id="${c.id}"]`);
        if (wrap) wrap.outerHTML = _renderComp(c, meterId);
        _attachHandlers(meterId);
        if (typeof toast === 'function') toast(`Start value set to ${liveVal.toFixed(2)} kWh`);
      })
    );
  }

  /* ─── Drag & drop ─── */
  function _attachDragDrop(meterId) {
    const wraps = document.querySelectorAll('.comp-wrap[draggable="true"]');
    wraps.forEach((el, idx) => {
      el.setAttribute('data-drag-idx', idx);

      el.addEventListener('dragstart', e => {
        _dragSrcIdx = idx;
        _dragSrcId  = el.dataset.compId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
        // Defer class add so drag image captures clean state
        requestAnimationFrame(() => el.classList.add('comp-dragging'));
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('comp-dragging');
        document.querySelectorAll('.comp-drag-over').forEach(x => x.classList.remove('comp-drag-over'));
        _dragSrcIdx = null;
        _dragSrcId  = null;
      });

      el.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (+el.dataset.dragIdx !== _dragSrcIdx)
          el.classList.add('comp-drag-over');
      });

      el.addEventListener('dragleave', e => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('comp-drag-over');
      });

      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('comp-drag-over');
        const destIdx = +el.dataset.dragIdx;
        if (_dragSrcIdx === null || _dragSrcIdx === destIdx) return;
        const comps = _comps(meterId);
        const [moved] = comps.splice(_dragSrcIdx, 1);
        comps.splice(destIdx, 0, moved);
        render(meterId);
      });
    });
  }

  /* ─── Edit mode ─── */
  function setEditMode(on, meterId) {
    _editMode = on;
    const editBtn  = document.getElementById('dashboard-edit-btn');
    const addBtn   = document.getElementById('dashboard-add-btn');
    const resetBtn = document.getElementById('dashboard-reset-btn');
    const copyBtn  = document.getElementById('dashboard-copy-btn');
    if (editBtn) {
      editBtn.innerHTML = on ? '<i class="ti ti-check"></i>Done' : '<i class="ti ti-edit"></i>Edit dashboard';
      editBtn.classList.toggle('btn-primary', on);
    }
    if (addBtn)   addBtn.style.display   = on ? '' : 'none';
    if (resetBtn) resetBtn.style.display = on ? '' : 'none';
    if (copyBtn)  copyBtn.style.display  = on ? '' : 'none';
    render(meterId ?? _getActiveMeter());
  }

  function resetToDefaults(meterId) {
    const mid = meterId ?? _getActiveMeter();
    if (!confirm('Reset this meter\'s dashboard to the default layout?')) return;
    // Clear chart data for this meter's components
    (_comps(mid)).filter(c => c.type === 'chart').forEach(c => { delete _chartData[c.id]; });
    _layouts[mid] = null;  // forces fresh default on next _comps() call
    render(mid);
  }

  /* ─── Copy layout ─── */
  function openCopyModal(srcMeterId) {
    const modal   = document.getElementById('copy-layout-modal');
    const meters  = _getMeters();
    const content = document.getElementById('copy-layout-targets');
    if (!modal || !content) return;

    content.innerHTML = meters
      .filter(m => m.id !== srcMeterId)
      .map(m => `
        <label class="copy-target-row">
          <input type="checkbox" value="${m.id}" style="width:auto">
          <span>${m.name}</span>
          <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">${m.loc||''}</span>
        </label>
      `).join('');

    document.getElementById('copy-layout-confirm').onclick = () => {
      const checked = [...content.querySelectorAll('input:checked')].map(i => +i.value);
      if (checked.length === 0) { return; }
      const srcComps = JSON.parse(JSON.stringify(_comps(srcMeterId)));
      checked.forEach(destId => {
        // Re-id components for the destination meter so IDs are unique
        _layouts[destId] = srcComps.map(c => ({
          ...c,
          id: c.id.replace(/-m\d+$/, '') + '-m' + destId
        }));
        // Clear stale chart data
        Object.keys(_chartData).forEach(k => {
          if (k.endsWith('-m' + destId)) delete _chartData[k];
        });
      });
      modal.style.display = 'none';
      const names = checked.map(id => meters.find(m => m.id === id)?.name).join(', ');
      // Show toast via global function
      if (typeof toast === 'function') toast(`Layout copied to: ${names}`);
    };

    document.getElementById('copy-layout-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.style.display = 'flex';
  }

  /* ══════════════════════════════════════
     ADD / EDIT COMPONENT MODAL
     ══════════════════════════════════════ */
  function _populateParamSuggestions(meterId) {
    const meters = _getMeters();
    const models = _getMeterModels();
    const m = meters.find(x => x.id === meterId);
    const regs = m ? (models[m.model]?.registers || []) : [];
    const dl = document.getElementById('param-suggestions');
    if (dl) dl.innerHTML = regs.map(r => `<option value="${r.param}">`).join('');
  }

  function _populateColorSwatches(currentColor) {
    const box = document.getElementById('color-swatches');
    if (!box) return;
    box.innerHTML = PALETTE.map(c =>
      `<div class="color-swatch ${c === currentColor ? 'active' : ''}" style="background:${c}" data-color="${c}"></div>`
    ).join('');
    box.querySelectorAll('.color-swatch').forEach(sw =>
      sw.addEventListener('click', () => {
        document.getElementById('comp-color').value = sw.dataset.color;
        box.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
      })
    );
  }

  function _onTypeChange() {
    const type = document.getElementById('comp-type')?.value;
    if (!type) return;
    const show = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const row = el.closest('.form-group') || el.closest('.form-row') || el;
      if (row) row.style.display = v ? '' : 'none';
    };
    const isEnergy = type === 'energy';
    show('group-comp-param',   !isEnergy && type !== 'table');
    show('group-comp-unit',    !isEnergy);
    show('group-comp-decimals',!isEnergy);
    show('group-comp-height',  type === 'chart');
    show('group-comp-maxval',  type === 'gauge' || type === 'bar');
    show('group-comp-params',  type === 'table');
    show('group-energy-dates', isEnergy);
    const wSel = document.getElementById('comp-width');
    if (wSel) {
      const qOpt = wSel.querySelector('option[value="quarter"]');
      if (qOpt) qOpt.disabled = (type === 'chart' || type === 'table');
      if ((type === 'chart' || type === 'table') && wSel.value === 'quarter') wSel.value = 'half';
    }
  }

  function _openModal({ comp, meterId }) {
    _editingCompId = comp?.id || null;
    const mid = meterId ?? _getActiveMeter();

    document.getElementById('comp-type').value     = comp?.type     || 'kpi';
    document.getElementById('comp-title').value    = comp?.title    || '';
    document.getElementById('comp-param').value    = comp?.param    || '';
    document.getElementById('comp-unit').value     = comp?.unit     || '';
    document.getElementById('comp-decimals').value = comp?.decimals ?? 2;
    document.getElementById('comp-color').value    = comp?.color    || '#0E6B6B';
    document.getElementById('comp-width').value    = comp?.width    || 'quarter';
    document.getElementById('comp-height').value   = comp?.height   || 'medium';
    document.getElementById('comp-maxval').value   = comp?.maxVal   || 300;
    document.getElementById('comp-params').value   = (comp?.params || []).join('\n');

    // Energy fields — default from = start of today, to = end of today
    const now   = new Date();
    const today = now.toISOString().slice(0,10);
    const todayStart = today + 'T00:00';
    const todayEnd   = today + 'T23:59';
    document.getElementById('comp-energy-param').value    = comp?.energyParam || comp?.param || '';
    document.getElementById('comp-energy-from').value     = comp?.energyFrom  || todayStart;
    document.getElementById('comp-energy-to').value       = comp?.energyTo    || todayEnd;
    document.getElementById('comp-energy-startval').value = comp?.startVal    ?? '';

    document.getElementById('comp-modal-title').textContent = comp ? 'Edit component' : 'Add component';
    document.getElementById('comp-modal-save').textContent  = comp ? 'Save changes'   : 'Add component';

    _populateParamSuggestions(mid);
    _populateColorSwatches(comp?.color || '#0E6B6B');
    _onTypeChange();

    // Wire Capture Now button
    const captureBtn = document.getElementById('comp-energy-capture-btn');
    if (captureBtn) {
      captureBtn.onclick = () => {
        const param = document.getElementById('comp-energy-param').value.trim();
        const live  = _val(mid, param);
        if (live === null) { if (typeof toast === 'function') toast('No live reading for that parameter yet'); return; }
        document.getElementById('comp-energy-startval').value = live.toFixed(3);
        document.getElementById('comp-energy-from').value     = new Date().toISOString().slice(0,16);
        if (typeof toast === 'function') toast(`Start value captured: ${live.toFixed(3)} kWh`);
      };
    }

    document.getElementById('comp-modal').style.display = 'flex';
  }

  function openAddModal(meterId)         { _openModal({ meterId }); }
  function openEditModal(compId, meterId) {
    const c = _comps(meterId ?? _getActiveMeter()).find(x => x.id === compId);
    if (c) _openModal({ comp: c, meterId });
  }

  function saveCompModal(meterId) {
    const mid   = meterId ?? _getActiveMeter();
    const type  = document.getElementById('comp-type').value;
    const title = document.getElementById('comp-title').value.trim();
    if (!title) { document.getElementById('comp-title').focus(); return false; }

    const data = {
      type, title,
      param:       document.getElementById('comp-param').value.trim(),
      unit:        document.getElementById('comp-unit').value.trim(),
      decimals:    +document.getElementById('comp-decimals').value,
      color:       document.getElementById('comp-color').value,
      width:       document.getElementById('comp-width').value,
      height:      document.getElementById('comp-height').value,
      maxVal:      +document.getElementById('comp-maxval').value || 300,
      params:      document.getElementById('comp-params').value.split('\n').map(s => s.trim()).filter(Boolean),
      // Energy fields
      energyParam: document.getElementById('comp-energy-param').value.trim(),
      energyFrom:  document.getElementById('comp-energy-from').value,
      energyTo:    document.getElementById('comp-energy-to').value,
      startVal:    document.getElementById('comp-energy-startval').value !== ''
                    ? +document.getElementById('comp-energy-startval').value
                    : null,
    };

    // For energy type, validate that end >= start
    if (type === 'energy' && data.energyFrom && data.energyTo) {
      if (new Date(data.energyTo) < new Date(data.energyFrom)) {
        if (typeof toast === 'function') toast('End datetime must be after start datetime');
        return false;
      }
    }

    const comps = _comps(mid);
    if (_editingCompId) {
      const idx = comps.findIndex(c => c.id === _editingCompId);
      if (idx >= 0) comps[idx] = { id: _editingCompId, ...data };
    } else {
      comps.push({ id: 'comp-' + Date.now() + '-m' + mid, ...data });
    }
    document.getElementById('comp-modal').style.display = 'none';
    render(mid);
    return true;
  }

  function init({ getLive, getMeters, getActiveMeter, getMeterModels }) {
    _getLive        = getLive;
    _getMeters      = getMeters;
    _getActiveMeter = getActiveMeter;
    _getMeterModels = getMeterModels;
  }

  return {
    init, render, pushChartData,
    setEditMode, resetToDefaults,
    openAddModal, openEditModal, saveCompModal,
    openCopyModal,
    _onTypeChange,
  };

})();
