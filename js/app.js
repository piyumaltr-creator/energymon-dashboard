/**
 * app.js — EnergyMon main application
 */

/* ─── State ─── */
let meterModels    = JSON.parse(JSON.stringify(METER_MODELS));
let meters         = JSON.parse(JSON.stringify(DEMO_METERS));
let nextMeterId    = meters.reduce((m, x) => Math.max(m, x.id), 0) + 1;
let activeMeter    = meters[0]?.id ?? null;
let activeModelKey = Object.keys(meterModels)[0] ?? null;
let liveValues     = {};
let _editingMeterId  = null;
let _editingModelKey = null;

/* ─── Toast ─── */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/* ─── Page navigation ─── */
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  meters:    'Meters',
  modbus:    'Model Library',
  mqtt:      'MQTT & Gateway Config',
  history:   'History',
};

function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${name}"]`)?.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[name] || name;
  if (name === 'dashboard') { renderMeterTabs(); Dashboard.render(activeMeter); }
  if (name === 'meters')    renderMeterTable();
  if (name === 'modbus')    renderModbusPage();
  if (name === 'history')   renderHistoryPage();
}

document.querySelectorAll('.nav-item[data-page]').forEach(btn =>
  btn.addEventListener('click', () => switchPage(btn.dataset.page))
);

/* ─── Sidebar meter list ─── */
function renderMeterNav() {
  const nav = document.getElementById('meter-nav');
  nav.innerHTML = meters.map(m => `
    <button class="nav-item" data-meter="${m.id}">
      <i class="ti ti-device-analytics"></i>${m.name}
      <span class="meter-dot ${m.online ? 'online' : ''}"></span>
    </button>`).join('');
  nav.querySelectorAll('[data-meter]').forEach(btn => {
    btn.addEventListener('click', () => { activeMeter = +btn.dataset.meter; switchPage('dashboard'); });
  });
  document.getElementById('meter-count').textContent = `${meters.length} meter${meters.length !== 1 ? 's' : ''}`;
}

/* ─── Dashboard: meter tabs ─── */
function renderMeterTabs() {
  const bar = document.getElementById('meter-tabs');
  bar.innerHTML = meters.map(m =>
    `<button class="tab ${m.id === activeMeter ? 'active' : ''}" data-mid="${m.id}">${m.name}</button>`
  ).join('');
  bar.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      activeMeter = +t.dataset.mid;
      renderMeterTabs();
      Dashboard.render(activeMeter);
    });
  });
}

/* ─── Data pipeline ─── */
function ingestValue(meterId, param, value) {
  if (!liveValues[meterId]) liveValues[meterId] = {};
  liveValues[meterId][param] = value;
  if (meterId === activeMeter) {
    Dashboard.pushChartData(meterId);  // updates charts + live KPI/gauge/bar/table values
  }
}

/* ─── MQTT status UI ─── */
function setMqttStatus(connected, label) {
  const cls = connected ? 'dot-green' : 'dot-red';
  document.getElementById('mqtt-status-dot').className = 'dot ' + cls;
  document.getElementById('mqtt-status-label').textContent = label;
  const conn = document.getElementById('mqtt-conn-status');
  if (conn) conn.innerHTML = `<span class="dot ${cls}"></span>${label}`;
  // Show disconnect button only when connected
  const discBtn = document.getElementById('mqtt-disconnect-btn');
  if (discBtn) discBtn.style.display = connected ? '' : 'none';
}

MqttClient.on('onConnect', () => {
  setMqttStatus(true, 'MQTT connected');
  _applySubscriptions();
  toast('MQTT connected');
});

MqttClient.on('onDisconnect', () => {
  setMqttStatus(false, 'Disconnected');
});

MqttClient.on('onMessage', (topic, value) => {
  let matched = false;
  for (const m of meters) {
    if (topic.startsWith(m.topic + '/')) {
      const slug = topic.slice(m.topic.length + 1);
      const reg  = (meterModels[m.model]?.registers || [])
        .find(r => r.param.toLowerCase().replace(/[^a-z0-9]+/g,'_') === slug);
      if (reg) {
        ingestValue(m.id, reg.param, value);
        debugLog('value', topic, String(value), `Meter: ${m.name} • Param: ${reg.param}`);
        matched = true;
      }
      break;
    }
  }
  if (!matched) debugLog('unmatched', topic, String(value), 'Numeric payload received, but no meter parameter matched this topic.');
});

MqttClient.on('onModbusFrame', (topic, hexFrame) => {
  let bestError = '';
  for (const m of meters) {
    const regs = meterModels[m.model]?.registers || [];
    try {
      const decoded = ModbusDecoder.decode(hexFrame, regs);
      if (decoded.error) {
        bestError = decoded.error;
        continue;
      }
      if (decoded.slaveId !== m.slave) {
        bestError = `Frame slave ${decoded.slaveId} does not match meter "${m.name}" slave ${m.slave}`;
        continue;
      }

      const pairs = Object.entries(decoded.values);
      if (pairs.length === 0) {
        bestError = `Decoded frame for slave ${decoded.slaveId}, but no registers matched the current model map.`;
        continue;
      }

      pairs.forEach(([param, value]) => ingestValue(m.id, param, value));
      debugLog(
        'decoded',
        topic,
        hexFrame,
        `Meter: ${m.name} • Slave: ${decoded.slaveId} • FC: ${decoded.fc} • Start: ${decoded.startAddr !== null ? '0x' + decoded.startAddr.toString(16) : 'n/a'} • Values: ${pairs.map(([param, value]) => `${param}=${value}`).join(' | ')}`
      );
      break;
    } catch (e) {
      bestError = e.message || 'Unknown decode error';
    }
  }
  if (bestError) debugLog('error', topic, hexFrame, bestError);
});

/* ═══════════════════════════════════════════════
   DASHBOARD COMPONENT SYSTEM
   ═══════════════════════════════════════════════ */

Dashboard.init({
  getLive:        (meterId) => liveValues[meterId] || {},
  getMeters:      () => meters,
  getActiveMeter: () => activeMeter,
  getMeterModels: () => meterModels,
});

/* ── Toolbar buttons ── */
document.getElementById('dashboard-edit-btn').addEventListener('click', () => {
  const isEditing = document.getElementById('dashboard-edit-btn').classList.contains('btn-primary');
  Dashboard.setEditMode(!isEditing, activeMeter);
});
document.getElementById('dashboard-add-btn').addEventListener('click', () => {
  Dashboard.openAddModal(activeMeter);
});
document.getElementById('dashboard-reset-btn').addEventListener('click', () => {
  Dashboard.resetToDefaults(activeMeter);
});
document.getElementById('dashboard-copy-btn').addEventListener('click', () => {
  Dashboard.openCopyModal(activeMeter);
});

/* ── Backdrop close for copy modal ── */
document.getElementById('copy-layout-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

/* ── Component type picker buttons ── */
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('comp-type').value = btn.dataset.type;
    Dashboard._onTypeChange();
  });
});

/* Sync type picker when editing existing component */
function _syncTypePicker(type) {
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}
const _origOpenEdit = Dashboard.openEditModal.bind(Dashboard);
Dashboard.openEditModal = (compId, meterId) => {
  _origOpenEdit(compId, meterId ?? activeMeter);
  _syncTypePicker(document.getElementById('comp-type').value);
};

/* ── Component modal save/cancel ── */
document.getElementById('comp-modal-cancel').addEventListener('click', () => {
  document.getElementById('comp-modal').style.display = 'none';
});
document.getElementById('comp-modal-save').addEventListener('click', () => {
  const ok = Dashboard.saveCompModal(activeMeter);
  if (!ok) toast('Please enter a component title');
});
document.getElementById('comp-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});


/* ═══════════════════════════════════════════════
   METERS PAGE
   ═══════════════════════════════════════════════ */

function renderMeterTable() {
  const tbody = document.getElementById('meter-tbody');
  if (meters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-tertiary)">
      No meters yet. Click <strong>Add meter</strong>.</td></tr>`;
    return;
  }
  tbody.innerHTML = meters.map(m => {
    const ml = meterModels[m.model]?.name || m.model;
    return `<tr>
      <td><div class="meter-name">${m.name}</div>${m.loc ? `<div class="meter-loc">${m.loc}</div>` : ''}</td>
      <td><span style="font-size:12px">${ml}</span><div style="font-size:10px;color:var(--text-tertiary)">${m.model}</div></td>
      <td>${m.slave}</td>
      <td><code>${m.topic}</code></td>
      <td>
        <button class="status-toggle-btn ${m.online ? 'online' : 'offline'}" data-toggle="${m.id}" title="Click to toggle">
          <span class="dot ${m.online ? 'dot-green' : 'dot-red'}"></span>
          ${m.online ? 'Online' : 'Offline'}
        </button>
      </td>
      <td class="td-actions">
        <button class="btn btn-sm" data-edit="${m.id}"><i class="ti ti-edit"></i>Edit</button>
        <button class="btn btn-sm btn-danger" data-del="${m.id}"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const m = meters.find(x => x.id === +b.dataset.toggle);
    if (!m) return;
    m.online = !m.online;
    renderMeterTable();
    renderMeterNav();
    toast(`${m.name} set to ${m.online ? 'Online' : 'Offline'}`);
  }));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const m = meters.find(x => x.id === +b.dataset.del);
    if (!confirm(`Remove "${m?.name}"?`)) return;
    meters = meters.filter(x => x.id !== +b.dataset.del);
    renderAll(); toast('Meter removed');
  }));
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openMeterModal(+b.dataset.edit)));
}

function populateMeterModelSelect(selectedKey) {
  const sel = document.getElementById('m-model');
  sel.innerHTML = Object.entries(meterModels)
    .map(([k, m]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${m.name || k}</option>`).join('');
}

function openMeterModal(editId) {
  _editingMeterId = editId || null;
  const m = editId ? meters.find(x => x.id === editId) : null;
  document.getElementById('modal-title').textContent = editId ? 'Edit meter' : 'Add meter';
  document.getElementById('modal-save').textContent  = editId ? 'Save changes' : 'Add meter';
  document.getElementById('m-name').value  = m?.name  ?? '';
  document.getElementById('m-slave').value = m?.slave ?? 1;
  document.getElementById('m-topic').value = m?.topic ?? 'sensorjip/data';
  document.getElementById('m-loc').value   = m?.loc   ?? '';
  document.getElementById('m-ct').value    = m?.ct    ?? '';
  document.getElementById('m-notes').value = m?.notes ?? '';
  populateMeterModelSelect(m?.model ?? Object.keys(meterModels)[0]);
  document.getElementById('meter-modal').style.display = 'flex';
  document.getElementById('m-name').focus();
}

document.getElementById('add-meter-btn').addEventListener('click', () => openMeterModal(null));
document.getElementById('modal-cancel').addEventListener('click', () => { document.getElementById('meter-modal').style.display = 'none'; });
document.getElementById('modal-save').addEventListener('click', () => {
  const name  = document.getElementById('m-name').value.trim();
  if (!name) { toast('Enter a meter name'); return; }
  const model = document.getElementById('m-model').value;
  const slave = +document.getElementById('m-slave').value;
  const topic = document.getElementById('m-topic').value.trim() || 'sensorjip/data';
  const loc   = document.getElementById('m-loc').value.trim();
  const ct    = document.getElementById('m-ct').value.trim();
  const notes = document.getElementById('m-notes').value.trim();

  if (_editingMeterId) {
    Object.assign(meters.find(x => x.id === _editingMeterId), { name, model, slave, topic, loc, ct, notes });
    toast('Meter updated');
  } else {
    const id = nextMeterId++;
    meters.push({ id, name, model, slave, topic, loc, ct, notes, online: false });
    if (activeMeter === null) activeMeter = id;
    toast(`Meter "${name}" added`);
  }
  document.getElementById('meter-modal').style.display = 'none';
  renderAll();
  // Re-apply subscriptions so any changed topic takes effect immediately
  _applySubscriptions();
});

/* ═══════════════════════════════════════════════
   MODEL LIBRARY PAGE
   ═══════════════════════════════════════════════ */

function renderModbusPage() {
  const sel  = document.getElementById('modbus-model-sel');
  const keys = Object.keys(meterModels);
  sel.innerHTML = keys.map(k =>
    `<option value="${k}" ${k === activeModelKey ? 'selected' : ''}>${meterModels[k].name || k}</option>`
  ).join('');
  if (!activeModelKey && keys.length > 0) activeModelKey = keys[0];
  if (keys.length > 0) sel.value = activeModelKey;
  sel.onchange = () => { activeModelKey = sel.value; _regEditIdx = null; renderRegTable(); updateModelInfoStrip(); };
  renderRegTable(); updateModelInfoStrip();
}

function updateModelInfoStrip() {
  const model  = meterModels[activeModelKey];
  if (!model) return;
  const usedBy = meters.filter(m => m.model === activeModelKey);
  document.getElementById('model-info-name').textContent  = model.name || activeModelKey;
  document.getElementById('model-info-count').textContent = `${(model.registers||[]).length} registers`;
  document.getElementById('model-info-used').textContent  =
    usedBy.length === 0 ? 'Not assigned to any meter'
    : usedBy.length === 1 ? `Used by: ${usedBy[0].name}` : `Used by ${usedBy.length} meters`;
}

let _regEditIdx = null; // index of register currently being edited inline

function renderRegTable() {
  const model = meterModels[activeModelKey];
  const regs  = model?.registers || [];
  document.getElementById('reg-count').textContent = `${regs.length} register${regs.length !== 1 ? 's' : ''}`;
  const empty = document.getElementById('reg-empty');
  if (regs.length === 0) {
    document.getElementById('reg-tbody').innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  document.getElementById('reg-tbody').innerHTML = regs.map((r, i) => {
    if (i === _regEditIdx) {
      // ── Inline edit row ──
      return `
        <tr class="reg-edit-row" data-ridx="${i}">
          <td style="color:var(--text-tertiary);font-size:11px">${i+1}</td>
          <td><input class="reg-inline-input" id="re-param" value="${r.param}" style="width:140px" placeholder="Parameter name"></td>
          <td><input class="reg-inline-input reg-mono" id="re-addr"  value="${r.addr}"  style="width:70px" placeholder="e.g. 3000"></td>
          <td>
            <select class="reg-inline-select" id="re-fc">
              <option value="03" ${r.fc==='03'?'selected':''}>FC03</option>
              <option value="04" ${r.fc==='04'?'selected':''}>FC04</option>
            </select>
          </td>
          <td>
            <select class="reg-inline-select" id="re-dtype">
              ${['UINT16','INT16','UINT32','INT32','FLOAT32'].map(t=>`<option ${r.dtype===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </td>
          <td>
            <select class="reg-inline-select" id="re-byteorder">
              ${['AB CD','CD AB','BA DC','DC BA'].map(b=>`<option ${(r.byteorder||'AB CD')===b?'selected':''}>${b}</option>`).join('')}
            </select>
          </td>
          <td><input class="reg-inline-input reg-mono" id="re-scale" value="${r.scale}" style="width:55px" placeholder="1"></td>
          <td><input class="reg-inline-input" id="re-unit"  value="${r.unit||''}" style="width:50px" placeholder="V"></td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary" id="re-save-btn" data-ridx="${i}"><i class="ti ti-check"></i>Save</button>
            <button class="btn btn-sm" id="re-cancel-btn"><i class="ti ti-x"></i></button>
          </td>
        </tr>`;
    }
    // ── Normal read-only row ──
    return `
      <tr data-ridx="${i}">
        <td style="color:var(--text-tertiary);font-size:11px">${i+1}</td>
        <td style="font-weight:500">${r.param}</td>
        <td><code>${r.addr}</code></td>
        <td>FC${r.fc}</td>
        <td>${r.dtype}</td>
        <td style="font-size:11px;color:var(--text-secondary)">${r.byteorder||'AB CD'}</td>
        <td>${r.scale}</td>
        <td>${r.unit||'—'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" data-edit-ridx="${i}" title="Edit"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger" data-del-ridx="${i}" title="Remove"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
  }).join('');

  // Edit button
  document.querySelectorAll('[data-edit-ridx]').forEach(b => b.addEventListener('click', () => {
    _regEditIdx = +b.dataset.editRidx;
    renderRegTable();
    document.getElementById('re-param')?.focus();
  }));

  // Delete button
  document.querySelectorAll('[data-del-ridx]').forEach(b => b.addEventListener('click', () => {
    if (!confirm(`Remove register "${regs[+b.dataset.delRidx]?.param}"?`)) return;
    meterModels[activeModelKey].registers.splice(+b.dataset.delRidx, 1);
    _regEditIdx = null;
    renderRegTable(); updateModelInfoStrip(); toast('Register removed');
  }));

  // Save inline edit
  document.getElementById('re-save-btn')?.addEventListener('click', () => {
    const idx = _regEditIdx;
    if (idx === null) return;
    const param = document.getElementById('re-param').value.trim();
    if (!param) { document.getElementById('re-param').focus(); return; }
    meterModels[activeModelKey].registers[idx] = {
      param,
      addr:      document.getElementById('re-addr').value.trim() || '0',
      fc:        document.getElementById('re-fc').value,
      dtype:     document.getElementById('re-dtype').value,
      byteorder: document.getElementById('re-byteorder').value,
      scale:     document.getElementById('re-scale').value || '1',
      unit:      document.getElementById('re-unit').value.trim(),
    };
    _regEditIdx = null;
    renderRegTable(); updateModelInfoStrip(); toast('Register saved');
  });

  // Cancel inline edit
  document.getElementById('re-cancel-btn')?.addEventListener('click', () => {
    _regEditIdx = null;
    renderRegTable();
  });

  // Allow Enter key to save
  document.querySelector('.reg-edit-row')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('re-save-btn')?.click();
    if (e.key === 'Escape') document.getElementById('re-cancel-btn')?.click();
  });
}

document.getElementById('add-reg-btn').addEventListener('click', () => {
  if (!activeModelKey) { toast('Select or create a model first'); return; }
  _regEditIdx = null;
  ['r-param','r-addr','r-unit'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('r-fc').value        = '03';
  document.getElementById('r-dtype').value     = 'FLOAT32';
  document.getElementById('r-scale').value     = '1';
  document.getElementById('r-byteorder').value = 'AB CD';
  document.getElementById('reg-modal').style.display = 'flex';
  document.getElementById('r-param').focus();
});
document.getElementById('reg-modal-cancel').addEventListener('click', () => {
  document.getElementById('reg-modal').style.display = 'none';
});
document.getElementById('reg-modal-save').addEventListener('click', () => {
  const param = document.getElementById('r-param').value.trim();
  if (!param) { toast('Enter a parameter name'); return; }
  if (!meterModels[activeModelKey].registers) meterModels[activeModelKey].registers = [];
  meterModels[activeModelKey].registers.push({
    param,
    addr:      document.getElementById('r-addr').value.trim() || '0',
    fc:        document.getElementById('r-fc').value,
    dtype:     document.getElementById('r-dtype').value,
    byteorder: document.getElementById('r-byteorder').value,
    scale:     document.getElementById('r-scale').value || '1',
    unit:      document.getElementById('r-unit').value.trim(),
  });
  document.getElementById('reg-modal').style.display = 'none';
  renderRegTable(); updateModelInfoStrip(); toast('Register added');
});

document.getElementById('add-model-btn').addEventListener('click', () => {
  _editingModelKey = null;
  document.getElementById('m-model-name').value = '';
  document.getElementById('model-modal-title').textContent = 'New meter model';
  document.getElementById('model-modal-save').textContent  = 'Create model';
  document.getElementById('model-modal').style.display = 'flex';
  document.getElementById('m-model-name').focus();
});
document.getElementById('edit-model-btn').addEventListener('click', () => {
  if (!activeModelKey) return;
  _editingModelKey = activeModelKey;
  document.getElementById('m-model-name').value = meterModels[activeModelKey].name || activeModelKey;
  document.getElementById('model-modal-title').textContent = 'Rename model';
  document.getElementById('model-modal-save').textContent  = 'Save';
  document.getElementById('model-modal').style.display = 'flex';
});
document.getElementById('delete-model-btn').addEventListener('click', () => {
  if (!activeModelKey) return;
  const usedBy = meters.filter(m => m.model === activeModelKey);
  if (usedBy.length > 0) { toast(`Cannot delete — used by ${usedBy.length} meter(s)`); return; }
  if (Object.keys(meterModels).length <= 1) { toast('At least one model must remain'); return; }
  if (!confirm(`Delete model "${meterModels[activeModelKey].name || activeModelKey}"?`)) return;
  delete meterModels[activeModelKey];
  activeModelKey = Object.keys(meterModels)[0] || null;
  renderModbusPage(); populateMeterModelSelect(activeModelKey); toast('Model deleted');
});
document.getElementById('model-modal-cancel').addEventListener('click', () => { document.getElementById('model-modal').style.display = 'none'; });
document.getElementById('model-modal-save').addEventListener('click', () => {
  const name = document.getElementById('m-model-name').value.trim();
  if (!name) { toast('Enter a model name'); return; }
  if (_editingModelKey) {
    meterModels[_editingModelKey].name = name; toast('Model renamed');
  } else {
    const key = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    if (meterModels[key]) { toast('Model already exists'); return; }
    meterModels[key] = { name, registers: [] }; activeModelKey = key;
    toast(`Model "${name}" created`);
  }
  document.getElementById('model-modal').style.display = 'none';
  renderModbusPage(); populateMeterModelSelect(activeModelKey);
});
document.getElementById('export-regs-btn').addEventListener('click', () => {
  const model = meterModels[activeModelKey]; if (!model) return;
  const blob = new Blob([JSON.stringify({ modelKey: activeModelKey, ...model }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(model.name||activeModelKey).replace(/\s+/g,'_')}_modbus.json`;
  a.click();
});

/* ═══════════════════════════════════════════════
   MQTT CONFIG
   ═══════════════════════════════════════════════ */

function connLog(level, msg) {
  const box = document.getElementById('conn-log'); if (!box) return;
  const now  = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${now}</span><span class="log-${level}">${msg}</span>`;
  box.appendChild(line); 
  
  // NEW: Prevent infinite DOM growth by removing the oldest entries
  while (box.children.length > 100) {
    box.removeChild(box.firstChild);
  }
  
  box.scrollTop = box.scrollHeight;
}

const RAW_LOG_LIMIT = 200;

function debugLog(status, topic, payload, detail = '') {
  const box = document.getElementById('raw-log');
  if (!box) return;

  const now = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const levelMap = {
    received: 'info',
    decoded: 'success',
    value: 'success',
    ignored: 'warn',
    unmatched: 'warn',
    error: 'error',
  };

  const entry = document.createElement('div');
  entry.className = 'raw-log-entry';
  entry.innerHTML = `
    <div class="raw-log-head">
      <span class="raw-log-time">${now}</span>
      <span class="raw-log-badge ${levelMap[status] || 'info'}">${status}</span>
      <span class="raw-log-topic">${topic || '(no topic)'}</span>
    </div>
    <div class="raw-log-payload">${payload || ''}</div>
    ${detail ? `<div class="raw-log-detail">${detail}</div>` : ''}`;

  const empty = box.querySelector('.raw-log-empty');
  if (empty) empty.remove();

  box.appendChild(entry);
  while (box.children.length > RAW_LOG_LIMIT) box.removeChild(box.firstChild);

  const auto = document.getElementById('raw-autoscroll');
  if (!auto || auto.checked) box.scrollTop = box.scrollHeight;
}

function resetRawLog() {
  const box = document.getElementById('raw-log');
  if (!box) return;
  box.innerHTML = `<div class="raw-log-empty">Waiting for MQTT messages…</div>`;
}

document.getElementById('clear-log-btn')?.addEventListener('click', () => {
  const box = document.getElementById('conn-log'); if (box) box.innerHTML = '';
});
document.getElementById('clear-raw-log-btn')?.addEventListener('click', resetRawLog);

resetRawLog();

MqttClient.on('onLog', (level, msg) => connLog(level, msg));
MqttClient.on('onRawMessage', (topic, raw, meta = {}) => {
  const flags = [];
  if (meters.some(m => m.topic === topic)) flags.push('matches meter topic');
  if (meta.isBinary) flags.push('binary payload converted to hex');
  if (/^[0-9a-fA-F\s]{10,}$/.test(raw)) flags.push('hex-looking payload');
  else if (/^\s*[\[{]/.test(meta.text || raw)) flags.push('JSON-looking payload');
  else if (!isNaN(parseFloat(meta.text || raw))) flags.push('numeric payload');
  debugLog('received', topic, raw, flags.join(' • '));
});

/**
 * _applySubscriptions — subscribe to all meter topics on the live connection.
 * Derives topics directly from the meters list — single source of truth.
 * Called after connect and after any meter add/edit.
 */
function _applySubscriptions() {
  if (!MqttClient.isConnected()) return;

  // Collect unique topics from all meters — single source of truth
  const uniqueTopics = [...new Set(meters.map(m => m.topic).filter(Boolean))];

  // Replace all Modbus subscriptions in one call (old ones unsubscribed cleanly)
  MqttClient.subscribeModbusTopics(uniqueTopics);
  uniqueTopics.forEach(t => connLog('info', `Subscribed: ${t}`));
}

function doConnect() {
  const host     = document.getElementById('cfg-broker').value.trim()  || 'broker.hivemq.com';
  const wsPort   = +document.getElementById('cfg-ws-port').value        || 8000;
  const tls      = document.getElementById('cfg-tls').value === '1';
  const clientId = document.getElementById('cfg-clientid').value.trim() || ('energymon-' + Math.random().toString(16).slice(2,10));
  const username = document.getElementById('cfg-user').value.trim();
  const password = document.getElementById('cfg-pass').value;
  const qos      = +document.getElementById('cfg-qos').value;

  setMqttStatus(false, 'Connecting…');
  connLog('info', `Connecting → ${tls ? 'wss' : 'ws'}://${host}:${wsPort}/mqtt`);
  MqttClient.disconnect();
  MqttClient.connect({ host, port: wsPort, tls, clientId, username, password, qos });
  // _applySubscriptions will be called by onConnect handler
}

document.getElementById('mqtt-save-btn').addEventListener('click', doConnect);
document.getElementById('mqtt-test-btn')?.addEventListener('click', () => { connLog('info', 'Testing…'); doConnect(); });
document.getElementById('mqtt-disconnect-btn')?.addEventListener('click', () => {
  MqttClient.disconnect();
  setMqttStatus(false, 'Disconnected');
  connLog('info', 'Manually disconnected');
  toast('Disconnected');
});

/* Close modals on backdrop */
['meter-modal','model-modal','reg-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
});

/* ─── renderAll ─── */
function renderAll() {
  renderMeterNav(); renderMeterTable(); renderMeterTabs();
}

/* ─── History page ─── */
function renderHistoryPage() {
  // If history.js is loaded and Supabase is configured, use it
  if (typeof History !== 'undefined' && History.renderPanel) {
    const tabs = document.getElementById('history-tabs');
    const container = document.getElementById('history-container');
    if (!tabs || !container) return;
    tabs.innerHTML = meters.map(m =>
      `<button class="tab ${m.id === activeMeter ? 'active' : ''}" data-mid="${m.id}">${m.name}</button>`
    ).join('');
    tabs.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        History.renderPanel(+t.dataset.mid, meters.find(m => m.id === +t.dataset.mid)?.name, 'history-container');
      });
    });
    if (meters[0]) History.renderPanel(meters[0].id, meters[0].name, 'history-container');
  } else {
    // history.js not loaded yet — show setup instructions
    const container = document.getElementById('history-container');
    if (container) container.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--text-tertiary)">
        <i class="ti ti-database" style="font-size:40px;display:block;margin-bottom:12px"></i>
        <p style="font-size:14px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">Historical data not configured</p>
        <p style="font-size:13px;max-width:400px;margin:0 auto;line-height:1.6">
          To enable history, deploy the Cloudflare Worker bridge and add
          <code style="background:var(--bg-secondary);padding:2px 5px;border-radius:4px">history.js</code>
          to this project, then call <code style="background:var(--bg-secondary);padding:2px 5px;border-radius:4px">History.init(url, key)</code>
          in app.js.
        </p>
      </div>`;
  }
}

/* ═══════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════ */
renderAll();
renderModbusPage();
populateMeterModelSelect(activeModelKey);
Dashboard.render(activeMeter);

setMqttStatus(false, 'Disconnected');
connLog('info', 'Dashboard started');
connLog('info', 'Connecting to broker.hivemq.com:8000 (ws://) …');
MqttClient.connect({ host: 'broker.hivemq.com', port: 8000, tls: false, qos: 0 });
