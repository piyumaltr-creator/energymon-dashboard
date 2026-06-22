/**
 * history.js — Historical data from Supabase for EnergyMon dashboard
 *
 * Provides:
 *   History.init(supabaseUrl, supabaseAnonKey)
 *   History.renderPanel(meterId, meterName, containerId)
 *   History.fetchReadings(meterId, from, to, resolution)
 *   History.fetchDailyEnergy(meterId, days)
 */

const History = (() => {

  let _url = '';
  let _key = '';

  function init(supabaseUrl, supabaseAnonKey) {
    _url = supabaseUrl.replace(/\/$/, '');
    _key = supabaseAnonKey;
  }

  /* ─── Fetch helpers ─── */
  async function _get(path, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${_url}/rest/v1/${path}${qs ? '?' + qs : ''}`, {
      headers: {
        'apikey':        _key,
        'Authorization': `Bearer ${_key}`,
        'Accept':        'application/json',
      }
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function fetchReadings(meterId, from, to, resolution = 'raw') {
    const view = resolution === 'hourly' ? 'hourly_avg' : 'readings';
    const timeCol = resolution === 'hourly' ? 'hour' : 'recorded_at';
    return _get(view, {
      meter_id: `eq.${meterId}`,
      [timeCol]: `gte.${from.toISOString()}`,
      and:       `(${timeCol}.lte.${to.toISOString()})`,
      order:     `${timeCol}.asc`,
      limit:     1000,
      select:    `${timeCol},voltage_l1_n,voltage_l2_n,voltage_l3_n,current_l1,current_l2,current_l3,active_power_total,power_factor_total,frequency,active_energy_import`,
    });
  }

  async function fetchDailyEnergy(meterId, days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);
    return _get('daily_energy', {
      meter_id: `eq.${meterId}`,
      day:      `gte.${from.toISOString().slice(0,10)}`,
      order:    'day.asc',
      limit:    days + 1,
    });
  }

  /* ─── History panel renderer ─── */
  function renderPanel(meterId, meterName, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const panelId = `hist-${meterId}`;
    container.innerHTML = `
      <div class="hist-panel">
        <div class="hist-toolbar">
          <div class="hist-range-btns">
            <button class="hist-range-btn active" data-range="6h">6h</button>
            <button class="hist-range-btn" data-range="24h">24h</button>
            <button class="hist-range-btn" data-range="7d">7d</button>
            <button class="hist-range-btn" data-range="30d">30d</button>
            <button class="hist-range-btn" data-range="custom">Custom</button>
          </div>
          <div class="hist-custom-range" id="${panelId}-custom" style="display:none">
            <input type="datetime-local" id="${panelId}-from">
            <span style="color:var(--text-tertiary)">→</span>
            <input type="datetime-local" id="${panelId}-to">
            <button class="btn btn-sm btn-primary" id="${panelId}-go">Load</button>
          </div>
          <div class="hist-param-sel">
            <label style="font-size:11px;color:var(--text-secondary)">Parameter:</label>
            <select id="${panelId}-param" class="select-sm">
              <option value="voltage_l1_n">Voltage L1-N (V)</option>
              <option value="voltage_l2_n">Voltage L2-N (V)</option>
              <option value="voltage_l3_n">Voltage L3-N (V)</option>
              <option value="current_l1">Current L1 (A)</option>
              <option value="current_l2">Current L2 (A)</option>
              <option value="current_l3">Current L3 (A)</option>
              <option value="active_power_total">Active Power (kW)</option>
              <option value="power_factor_total">Power Factor</option>
              <option value="frequency">Frequency (Hz)</option>
              <option value="active_energy_import">Energy Import (kWh)</option>
            </select>
          </div>
        </div>

        <div class="hist-chart-wrap">
          <canvas id="${panelId}-chart" aria-label="Historical trend chart"></canvas>
          <div class="hist-loading" id="${panelId}-loading" style="display:none">
            <i class="ti ti-loader-2 spin"></i> Loading…
          </div>
          <div class="hist-empty" id="${panelId}-empty" style="display:none">
            No data in this range. The bridge needs to run for a while to accumulate readings.
          </div>
        </div>

        <div class="hist-energy-section">
          <div class="hist-section-title">
            <i class="ti ti-bolt"></i> Daily energy consumption (kWh)
          </div>
          <div class="hist-energy-bars" id="${panelId}-energy-bars">
            <div class="hist-loading"><i class="ti ti-loader-2 spin"></i> Loading…</div>
          </div>
        </div>
      </div>`;

    // State
    let activeRange = '6h';
    let chart       = null;

    // Range buttons
    container.querySelectorAll('.hist-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.hist-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeRange = btn.dataset.range;
        const custom = document.getElementById(`${panelId}-custom`);
        if (custom) custom.style.display = activeRange === 'custom' ? 'flex' : 'none';
        if (activeRange !== 'custom') _loadChart(activeRange);
      });
    });

    // Custom range
    document.getElementById(`${panelId}-go`)?.addEventListener('click', () => {
      const from = document.getElementById(`${panelId}-from`)?.value;
      const to   = document.getElementById(`${panelId}-to`)?.value;
      if (from && to) _loadChart('custom', new Date(from), new Date(to));
    });

    // Parameter selector
    document.getElementById(`${panelId}-param`)?.addEventListener('change', () => {
      _loadChart(activeRange);
    });

    // Initial load
    _loadChart('6h');
    _loadEnergyBars();

    /* ── Load chart data ── */
    async function _loadChart(range, customFrom, customTo) {
      const loading = document.getElementById(`${panelId}-loading`);
      const empty   = document.getElementById(`${panelId}-empty`);
      const param   = document.getElementById(`${panelId}-param`)?.value || 'voltage_l1_n';

      let from, to;
      to = new Date();
      if (range === 'custom' && customFrom && customTo) {
        from = customFrom; to = customTo;
      } else {
        from = new Date(to);
        const offsets = { '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
        from.setHours(from.getHours() - (offsets[range] || 6));
      }

      const resolution = (range === '7d' || range === '30d') ? 'hourly' : 'raw';
      const timeKey    = resolution === 'hourly' ? 'hour' : 'recorded_at';

      if (loading) loading.style.display = 'flex';
      if (empty)   empty.style.display   = 'none';

      try {
        const rows = await fetchReadings(meterId, from, to, resolution);
        const labels = rows.map(r => {
          const d = new Date(r[timeKey]);
          return resolution === 'hourly'
            ? d.toLocaleDateString([], {month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
            : d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        });
        const values = rows.map(r => r[param]);

        if (rows.length === 0) {
          if (empty) empty.style.display = 'block';
        }

        const ctx = document.getElementById(`${panelId}-chart`);
        if (!ctx) return;

        if (chart) { chart.destroy(); chart = null; }
        chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label:       param.replace(/_/g,' '),
              data:        values,
              borderColor: '#185FA5',
              borderWidth: 1.5,
              pointRadius: rows.length > 200 ? 0 : 2,
              fill:        false,
              tension:     0.3,
              spanGaps:    true,
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { mode: 'index', intersect: false,
                callbacks: { label: ctx => `${ctx.parsed.y?.toFixed(3)} ${_unitFor(param)}` }
              }
            },
            scales: {
              x: { ticks: { font: { size: 10 }, color: '#888', maxTicksLimit: 10, autoSkip: true }, grid: { color: 'rgba(128,128,128,.1)' } },
              y: { ticks: { font: { size: 10 }, color: '#888' }, grid: { color: 'rgba(128,128,128,.1)' } },
            }
          }
        });
      } catch (e) {
        console.error('[History] chart load error:', e);
        if (empty) { empty.style.display = 'block'; empty.textContent = 'Error loading data: ' + e.message; }
      } finally {
        if (loading) loading.style.display = 'none';
      }
    }

    /* ── Load energy bars ── */
    async function _loadEnergyBars() {
      const barsEl = document.getElementById(`${panelId}-energy-bars`);
      if (!barsEl) return;
      try {
        const rows = await fetchDailyEnergy(meterId, 14);
        if (!rows.length) { barsEl.innerHTML = '<span style="font-size:12px;color:var(--text-tertiary)">No daily energy data yet.</span>'; return; }
        const maxKwh = Math.max(...rows.map(r => r.kwh_consumed || 0), 1);
        barsEl.innerHTML = rows.map(r => {
          const kwh = r.kwh_consumed?.toFixed(2) ?? '—';
          const pct = r.kwh_consumed ? Math.min(100, (r.kwh_consumed / maxKwh) * 100) : 0;
          const day = new Date(r.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          return `
            <div class="hist-energy-row">
              <span class="hist-energy-day">${day}</span>
              <div class="hist-energy-track">
                <div class="hist-energy-fill" style="width:${pct}%"></div>
              </div>
              <span class="hist-energy-kwh">${kwh} kWh</span>
            </div>`;
        }).join('');
      } catch (e) {
        barsEl.innerHTML = `<span style="font-size:12px;color:var(--text-tertiary)">Error: ${e.message}</span>`;
      }
    }
  }

  function _unitFor(param) {
    const units = {
      voltage_l1_n: 'V', voltage_l2_n: 'V', voltage_l3_n: 'V',
      current_l1: 'A', current_l2: 'A', current_l3: 'A',
      active_power_total: 'kW', power_factor_total: '', frequency: 'Hz',
      active_energy_import: 'kWh',
    };
    return units[param] || '';
  }

  return { init, renderPanel, fetchReadings, fetchDailyEnergy };

})();
