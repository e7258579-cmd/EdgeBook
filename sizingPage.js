/**
 * sizingPage.js — Position Sizing Analysis Module
 *
 * NEW standalone analytics page. Does NOT modify Stats page, equity chart,
 * trade model, or any existing behavior.
 *
 * Depends on globals from app.js / statsPage.js (loaded before this file):
 *   getFilteredTrades()   — filtered trade array (respects active time filter)
 *   timeFilter            — read for axis formatting (same as renderEquityChart)
 *   fmtNum()              — shared formatter from statsPage.js
 *   Chart                 — Chart.js global via CDN
 *
 * Position size determination:
 *   positionSize(t) = Math.abs(t.entry * t.qty)
 *   This mirrors how entry exposure is represented in the existing trade model.
 *   t.entry = price per share, t.qty = share count (both present on every trade).
 *
 * Public API (called from showPage() / refreshAll() equivalent):
 *   renderSizingPage()    — full render; call when tab becomes visible
 *
 * Load order: AFTER statsPage.js (needs fmtNum), BEFORE bootstrap <script>.
 *
 * HTML requirements — add ONE sidebar nav item and ONE tab div:
 *
 *   Sidebar button (inside .sidebar, alongside other .sb-item buttons):
 *   <button class="sb-item" id="nav-sizing" onclick="showPage('sizing')">
 *     <svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/><path d="M9 9h6v6H9z"/><path d="M3 9h6M15 9h6M3 15h6M15 15h6M9 3v6M9 15v6M15 3v6M15 15v6"/></svg>
 *     <span class="sb-label">EdgeAnalysis</span>
 *   </button>
 *
 *   Tab panel (inside #main-wrap, alongside #tab-home, #tab-stats etc.):
 *   <div id="tab-sizing" style="display:none"></div>
 *
 *   In showPage() switch/if block, add:
 *   if (page === 'sizing') { document.getElementById('tab-sizing').style.display = ''; renderSizingPage(); }
 *
 *   In refreshAll(), add:
 *   const sizing = document.getElementById('tab-sizing');
 *   if (sizing && sizing.style.display !== 'none') renderSizingPage();
 */

// ─── Module-level chart instances (never collide with statsPage.js names) ────
let _szGoodChart  = null;
let _szOverChart  = null;

// ─── Position size calculator ─────────────────────────────────────────────────
// Single source of truth for this module.
// Uses the two fields every trade object carries: entry price × share quantity.
function _posSize(t) {
  return Math.abs((t.entry || 0) * (t.qty || 0));
}

// ─── Equity curve builder (mirrors renderEquityChart logic, self-contained) ──
// Takes a pre-filtered trade array, returns { labels, data, dayMap, dayKeys }
// ready to pass into Chart.js.  No globals mutated.
function _buildEquityCurve(tradeSubset) {
  const sorted = [...tradeSubset].sort((a, b) => a.date.localeCompare(b.date));

  // Aggregate by day (NET — consistent with renderEquityChart in StatsPage.js)
  const dayMap = {};
  sorted.forEach(t => {
    if (!dayMap[t.date]) dayMap[t.date] = { pnl: 0, wins: 0, losses: 0, count: 0 };
    dayMap[t.date].pnl    += (t.pnl - (typeof calcCommission === 'function' ? calcCommission(t) : 0));
    dayMap[t.date].count  += 1;
    if (t.pnl > 0) dayMap[t.date].wins++;
    else if (t.pnl < 0) dayMap[t.date].losses++;
  });

  const days    = Object.keys(dayMap).sort();
  const labels  = [];
  const data    = [];
  const dayKeys = [];

  // Zero-baseline point before first day (same convention as renderEquityChart)
  if (days.length > 0) {
    const firstDt = new Date(days[0] + 'T00:00:00');
    const prevDt  = new Date(firstDt);
    prevDt.setDate(prevDt.getDate() - 1);
    const prevStr = prevDt.toISOString().slice(0, 10);
    labels.push('');
    data.push(0);
    dayKeys.push(prevStr);
  }

  let cum = 0;
  days.forEach(d => {
    cum += dayMap[d].pnl;
    labels.push('');
    data.push(parseFloat(cum.toFixed(2)));
    dayKeys.push(d);
  });

  return { labels, data, dayMap, dayKeys };
}

// ─── Segment color helper (identical algorithm to renderEquityChart) ──────────
function _makeSegColor(data) {
  const GREEN = [141, 197, 114];
  const RED   = [216,  90,  48];
  const MID   = [239, 159,  39];
  const WIN   = 3;

  function lerp(a, b, t) {
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
  }

  const trend = data.map((v, i) => {
    const start = Math.max(0, i - WIN);
    return data[i] - data[start];
  });
  const maxAbs = Math.max(...trend.map(Math.abs), 0.001);

  return (ctx) => {
    const i   = ctx.p1DataIndex;
    const t0  = trend[Math.max(0, i - 1)] / maxAbs;
    const t1  = trend[i] / maxAbs;
    const avg = (t0 + t1) / 2;
    return avg >= 0
      ? lerp(MID, GREEN, Math.min(1, avg * 2))
      : lerp(MID, RED,   Math.min(1, Math.abs(avg) * 2));
  };
}

// ─── Fill plugin factory (same gradient logic as renderEquityChart) ───────────
function _makeFillPlugin(data) {
  return {
    id: 'szDynamicFill',
    beforeDatasetDraw(chart) {
      const { ctx: c, chartArea } = chart;
      if (!chartArea || !data.length) return;
      const isPos = data[data.length - 1] >= 0;
      const grad  = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      if (isPos) {
        grad.addColorStop(0,   'rgba(141,197,114,.18)');
        grad.addColorStop(0.5, 'rgba(141,197,114,.06)');
        grad.addColorStop(1,   'rgba(141,197,114,0)');
      } else {
        grad.addColorStop(0,   'rgba(216,90,48,.16)');
        grad.addColorStop(0.5, 'rgba(216,90,48,.05)');
        grad.addColorStop(1,   'rgba(216,90,48,0)');
      }
      chart.data.datasets[0].backgroundColor = grad;
    }
  };
}

// ─── Draw one equity curve into a canvas ─────────────────────────────────────
// canvasId      — DOM id of the <canvas>
// tooltipElId   — DOM id of the floating tooltip div
// tradeSubset   — already-filtered trade array for this bucket
// instanceRef   — { current: Chart|null } — caller passes an object so we can
//                 destroy/recreate without a closure over a let variable
function _drawSizingChart(canvasId, tooltipElId, tradeSubset, instanceRef) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (instanceRef.current) {
    instanceRef.current.destroy();
    instanceRef.current = null;
  }

  const { labels, data, dayMap, dayKeys } = _buildEquityCurve(tradeSubset);

  if (!data.length || data.every(v => v === 0 && !dayMap[dayKeys[0]])) {
    // Nothing to draw — show empty state on canvas
    const c2 = canvas.getContext('2d');
    c2.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Tooltip element — background is applied live inside the callback (theme-aware)
  let tooltipEl = document.getElementById(tooltipElId);

  const segColor   = _makeSegColor(data);
  const fillPlugin = _makeFillPlugin(data);

  const siteFont = "'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const tickColor = '#999';

  const fmtY = v => {
    const abs = Math.abs(v), sign = v < 0 ? '-' : '';
    if (abs >= 1000000) return sign + (abs/1000000).toFixed(1) + 'M';
    if (abs >= 1000)    return sign + (abs/1000).toFixed(1) + 'K';
    return sign + abs;
  };

  instanceRef.current = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: segColor,
        backgroundColor: 'transparent',
        borderWidth: 3.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: .42,
        fill: true,
        segment: { borderColor: segColor }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external({ chart, tooltip }) {
            if (!tooltipEl) return;
            if (tooltip.opacity === 0) {
              tooltipEl.style.opacity = '0';
              tooltipEl.style.transform = 'translateY(6px) scale(.97)';
              return;
            }
            const i = tooltip.dataPoints?.[0]?.dataIndex;
            if (i == null) return;
            const date    = dayKeys[i];
            const cumPnl  = data[i];
            const dayData = dayMap[date];
            if (!dayData) { tooltipEl.style.opacity = '0'; return; }

            const dayPnl = dayData.pnl;
            const pnlCls = dayPnl >= 0 ? '#8dc572' : '#D85A30';
            const cumCls = cumPnl >= 0 ? '#8dc572' : '#D85A30';
            const sign   = v => v > 0 ? '+' : v < 0 ? '-' : '';
            const fmt    = v => sign(v) + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
            const fmtK   = v => {
              const abs = Math.abs(v), s = sign(v) + '$';
              return abs >= 1000 ? s + (abs/1000).toFixed(1) + 'K' : s + Math.round(abs).toLocaleString('en-US');
            };
            const dt    = new Date(date + 'T00:00:00');
            const pad   = n => String(n).padStart(2, '0');
            const dStr  = `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`;

            // Apply theme-correct background on every tooltip show
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            tooltipEl.style.background = isDark ? 'rgba(28,28,28,.92)' : 'rgba(255,255,255,.85)';

            tooltipEl.innerHTML = `
              <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px;font-family:${siteFont}">${dStr}</div>
              <div style="display:flex;flex-direction:column;gap:5px">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
                  <span style="font-size:12px;color:var(--text2);font-family:${siteFont}">Day P&L (Net)</span>
                  <span style="font-size:14px;font-weight:700;color:${pnlCls};font-family:${siteFont}">${fmt(dayPnl)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
                  <span style="font-size:12px;color:var(--text2);font-family:${siteFont}">Cumulative</span>
                  <span style="font-size:14px;font-weight:700;color:${cumCls};font-family:${siteFont}">${fmtK(cumPnl)}</span>
                </div>
                <div style="height:1px;background:var(--border);margin:2px 0"></div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
                  <span style="font-size:12px;color:var(--text2);font-family:${siteFont}">Trades</span>
                  <span style="font-size:13px;font-weight:600;color:var(--text);font-family:${siteFont}">${dayData.count}</span>
                </div>
                <div style="display:flex;gap:10px">
                  <span style="font-size:11px;color:#8dc572;font-family:${siteFont}">▲ ${dayData.wins} win${dayData.wins!==1?'s':''}</span>
                  <span style="font-size:11px;color:#D85A30;font-family:${siteFont}">▼ ${dayData.losses} loss${dayData.losses!==1?'es':''}</span>
                </div>
              </div>`;

            const canvasRect = chart.canvas.getBoundingClientRect();
            const ttW = 180, ttH = 140, margin = 12;
            let left = canvasRect.left + tooltip.caretX + margin;
            if (left + ttW > window.innerWidth - margin) left = canvasRect.left + tooltip.caretX - ttW - margin;
            left = Math.max(canvasRect.left, Math.min(left, canvasRect.right - ttW));
            let top = canvasRect.top + tooltip.caretY - ttH / 2;
            top = Math.max(canvasRect.top, Math.min(top, canvasRect.bottom - ttH));
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top  = top  + 'px';
            tooltipEl.style.opacity = '1';
            tooltipEl.style.transform = 'translateY(0) scale(1)';
          }
        }
      },
      scales: {
        y: {
          grid: { display: false },
          ticks: { callback: fmtY, color: tickColor, font: { family: siteFont, size: 11 } }
        },
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 8, color: tickColor, font: { family: siteFont, size: 11 } }
        }
      }
    },
    plugins: [fillPlugin]
  });
}

// ─── Summary stats bar for each bucket ───────────────────────────────────────
function _bucketStats(trades) {
  if (!trades.length) return { n: 0, pnl: 0, wr: 0, avg: 0 };
  const pnl  = trades.reduce((a, t) => a + t.pnl - (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0); // net
  const wins = trades.filter(t => t.pnl > 0).length;
  const wr   = Math.round(wins / trades.length * 100);
  const avg  = pnl / trades.length;
  return { n: trades.length, pnl, wr, avg };
}

// ─── Build full page HTML ─────────────────────────────────────────────────────
function _sizingPageHTML(accountSize, threshold, exposurePct, baselineDate, riskBudgetPct, analysisMode) {
  riskBudgetPct = riskBudgetPct || 1;
  analysisMode  = analysisMode  || 'exposure';
  const siteFont = "'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  // CSS injected once
  const styleId = 'sizing-page-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .sz-wrap { padding: clamp(.75rem,2vw,1.5rem); max-width: 1400px; }
      .sz-header { margin-bottom: 1.5rem; }
      .sz-title {
        font-size: 26px; font-weight: 700; color: var(--text2);
        letter-spacing: .18em; margin-bottom: .25rem;
        text-transform: uppercase;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        line-height: 1;
      }
      .sz-sub { font-size: 13px; color: var(--text3); }

      /* Account size input row */
      .sz-input-row {
        display: flex; align-items: center; gap: 12px;
        margin-bottom: 1.75rem; flex-wrap: wrap;
      }
      .sz-input-label {
        font-size: 13px; font-weight: 600; color: var(--text2);
        white-space: nowrap;
      }
      .sz-acct-input {
        width: 160px; padding: 8px 12px;
        font-size: 14px; font-weight: 600;
        border: 1px solid var(--border2); border-radius: var(--radius-sm);
        background: var(--bg); color: var(--text);
        outline: none; font-family: inherit;
        transition: border-color .15s;
      }
      .sz-acct-input:focus { border-color: var(--text2); }
      .sz-threshold-badge {
        padding: 5px 12px; border-radius: 20px;
        background: var(--bg2); border: 1px solid var(--border);
        font-size: 12px; font-weight: 600; color: var(--text2);
        white-space: nowrap;
      }
      .sz-threshold-badge span { color: var(--amber); }

      /* Two-column chart grid */
      .sz-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
      @media (max-width: 860px) {
        .sz-grid { grid-template-columns: 1fr; }
      }

      /* Chart card */
      .sz-card {
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 1.25rem;
        display: flex; flex-direction: column; gap: .75rem;
        position: relative; overflow: visible;
      }
      .sz-card-head {
        display: flex; justify-content: space-between;
        align-items: flex-start; gap: 12px;
      }
      .sz-card-title {
        font-size: 14px; font-weight: 700; color: var(--text);
        letter-spacing: .03em;
      }
      .sz-card-badge {
        padding: 3px 9px; border-radius: 20px;
        font-size: 11px; font-weight: 700;
        letter-spacing: .04em; text-transform: uppercase;
        white-space: nowrap; flex-shrink: 0;
      }
      .sz-card-badge.good  { background: rgba(141,197,114,.15); color: #8dc572; }
      .sz-card-badge.over  { background: rgba(216,90,48,.14);   color: #D85A30; }

      /* Mini KPI row */
      .sz-kpi-row {
        display: flex; gap: 16px; flex-wrap: wrap;
        padding-bottom: .5rem;
        border-bottom: 1px solid var(--border);
      }
      .sz-kpi { display: flex; flex-direction: column; gap: 2px; }
      .sz-kpi-label { font-size: 10px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .04em; }
      .sz-kpi-val   { font-size: 14px; font-weight: 700; color: var(--text); }
      .sz-kpi-val.pos { color: #8dc572; }
      .sz-kpi-val.neg { color: #D85A30; }
      .sz-kpi-val.neu { color: var(--text2); }

      /* Canvas wrapper */
      .sz-chart-wrap { position: relative; height: 240px; }

      /* Empty state */
      .sz-empty {
        height: 200px; display: flex; align-items: center;
        justify-content: center;
        font-size: 13px; color: var(--text3);
        border: 1px dashed var(--border); border-radius: var(--radius-sm);
      }

      /* Tooltip (shared style) */
      .sz-tooltip {
        position: fixed; pointer-events: none; z-index: 9999;
        border: 1px solid var(--border); border-radius: 12px;
        padding: 10px 14px; width: 180px;
        box-shadow: 0 4px 24px rgba(0,0,0,.18);
        opacity: 0; transform: translateY(6px) scale(.97);
        transition: opacity .18s ease, transform .18s ease;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      }

      /* Exposure threshold selector */
      .sz-exposure-row {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 1.5rem; flex-wrap: wrap;
      }
      .sz-exposure-label {
        font-size: 13px; font-weight: 600; color: var(--text2);
        white-space: nowrap;
      }
      .sz-exposure-btns { display: flex; gap: 6px; }
      .sz-exp-btn {
        padding: 5px 14px; border-radius: 20px;
        border: 1px solid var(--border2);
        background: var(--bg2); color: var(--text2);
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .15s;
      }
      .sz-exp-btn:hover { border-color: var(--text2); color: var(--text); }
      .sz-exp-btn.active {
        background: var(--text); color: var(--bg);
        border-color: var(--text);
      }

      /* Baseline date input */
      .sz-baseline-input {
        width: 150px; padding: 8px 10px;
        font-size: 13px; font-weight: 600;
        border: 1px solid var(--border2); border-radius: var(--radius-sm);
        background: var(--bg); color: var(--text);
        outline: none; font-family: inherit;
        transition: border-color .15s;
      }
      .sz-baseline-input:focus { border-color: var(--text2); }

      /* Equity info pill */
      .sz-equity-info {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 20px;
        background: rgba(141,197,114,.1); border: 1px solid rgba(141,197,114,.25);
        font-size: 11px; font-weight: 600; color: #8dc572;
        white-space: nowrap;
      }

      /* Definition note */
      .sz-def-note {
        font-size: 11px; color: var(--text3);
        line-height: 1.5; padding: .25rem 0;
      }

      /* ── Analysis mode selector ── */
      .sz-mode-row {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 1.5rem; flex-wrap: wrap;
      }
      .sz-mode-label {
        font-size: 13px; font-weight: 600; color: var(--text2);
        white-space: nowrap; margin-right: 4px;
      }
      .sz-mode-btn {
        padding: 6px 16px; border-radius: 20px;
        border: 1px solid var(--border2);
        background: var(--bg2); color: var(--text2);
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .15s;
      }
      .sz-mode-btn:hover { border-color: var(--text2); color: var(--text); }
      .sz-mode-btn.active {
        background: var(--text); color: var(--bg);
        border-color: var(--text);
      }

      /* ── Risk Budget section ── */
      .sz-rb-settings-row {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 1.25rem; flex-wrap: wrap;
      }
      .sz-rb-btn {
        padding: 5px 14px; border-radius: 20px;
        border: 1px solid var(--border2);
        background: var(--bg2); color: var(--text2);
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .15s;
      }
      .sz-rb-btn:hover { border-color: var(--text2); color: var(--text); }
      .sz-rb-btn.active {
        background: var(--text); color: var(--bg);
        border-color: var(--text);
      }

      /* RB KPI summary row — wider for 9 items */
      .sz-rb-kpi-bar {
        display: flex; gap: 16px; flex-wrap: wrap;
        padding: 1rem 1.25rem;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius); margin-bottom: 1.25rem;
      }
      .sz-kpi-val.amber { color: var(--amber); }

      /* RB chart cards — 3 columns on wide, 1 on narrow */
      .sz-rb-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 20px; margin-bottom: 20px;
      }
      @media (max-width: 1100px) { .sz-rb-grid { grid-template-columns: 1fr 1fr; } }
      @media (max-width: 680px)  { .sz-rb-grid { grid-template-columns: 1fr; } }

      .sz-card-badge.compliant { background: rgba(141,197,114,.15); color: #8dc572; }
      .sz-card-badge.warning   { background: rgba(239,159,39,.15);  color: var(--amber); }
      .sz-card-badge.violation { background: rgba(216,90,48,.14);   color: #D85A30; }

      /* ── Combined Filter Analysis ── */
      .sz-cb-params-note {
        font-size: 12px; color: var(--text3);
        background: var(--bg2); border: 1px solid var(--border);
        border-radius: var(--radius-sm); padding: .55rem 1rem;
        margin-bottom: 1.25rem; line-height: 1.6;
      }
      .sz-cb-kpi-bar {
        display: flex; gap: 16px; flex-wrap: wrap;
        padding: 1rem 1.25rem;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius); margin-bottom: 1.25rem;
      }
      .sz-cb-layout {
        display: block;
      }
      .sz-cb-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px; margin-bottom: 20px;
      }
      @media (max-width: 860px) { .sz-cb-grid { grid-template-columns: 1fr; } }
      .sz-card-badge.cb-clean { background: rgba(141,197,114,.15); color: #8dc572; }
      .sz-card-badge.cb-no-filters { background: rgba(160,160,160,.12); color: var(--text3); }
      .sz-card-badge.cb-ref   { background: rgba(100,149,237,.13); color: #6495ed; border: 1px solid rgba(100,149,237,.25); }

      /* ── View toggle (Charts / Table) ── */
      .sz-view-toggle {
        display: flex; align-items: center; gap: 6px;
        margin-left: auto;
      }
      .sz-view-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 5px 13px; border-radius: 20px;
        border: 1px solid var(--border2);
        background: var(--bg2); color: var(--text3);
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .15s;
      }
      .sz-view-btn svg { opacity: .6; }
      .sz-view-btn:hover { border-color: var(--text2); color: var(--text); }
      .sz-view-btn.active {
        background: var(--text); color: var(--bg);
        border-color: var(--text);
      }
      .sz-view-btn.active svg { opacity: 1; }

      /* ── Sizing table ── */
      .sz-table-wrap {
        overflow-x: auto; border-radius: var(--radius);
        border: 1px solid var(--border); margin-bottom: 20px;
      }
      .sz-tbl {
        width: 100%; border-collapse: collapse;
        font-size: 12px; font-family: inherit;
      }
      .sz-tbl thead th {
        position: sticky; top: 0; z-index: 2;
        background: var(--bg2); color: var(--text3);
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .04em; padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        white-space: nowrap; text-align: left;
        cursor: pointer; user-select: none;
      }
      .sz-tbl thead th:hover { color: var(--text); }
      .sz-tbl thead th.sorted { color: var(--text); }
      .sz-tbl thead th .sort-arrow { margin-left: 3px; opacity: .5; }
      .sz-tbl thead th.sorted .sort-arrow { opacity: 1; }
      .sz-tbl tbody tr {
        border-bottom: 1px solid var(--border);
        transition: background .1s;
      }
      .sz-tbl tbody tr:last-child { border-bottom: none; }
      .sz-tbl tbody tr:hover { background: var(--bg2); }
      .sz-tbl tbody td {
        padding: 7px 10px; color: var(--text2);
        white-space: nowrap; vertical-align: middle;
      }
      .sz-tbl .td-num   { text-align: right; font-variant-numeric: tabular-nums; }
      .sz-tbl .td-sym   { font-weight: 700; color: var(--text); }
      .sz-tbl .td-pos   { color: #8dc572; font-weight: 600; }
      .sz-tbl .td-neg   { color: #D85A30; font-weight: 600; }
      .sz-tbl .td-neu   { color: var(--text2); }
      .sz-tbl .td-amber { color: var(--amber); }
      .sz-tbl .td-dim   { color: var(--text3); font-size: 11px; }

      /* Status badge in table */
      .sz-status-badge {
        display: inline-block; padding: 2px 8px;
        border-radius: 20px; font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .04em;
        white-space: nowrap;
      }
      .sz-status-badge.clean    { background: rgba(141,197,114,.15); color: #8dc572; }
      .sz-status-badge.dirty    { background: rgba(216,90,48,.14);   color: #D85A30; }
      .sz-status-badge.compliant { background: rgba(141,197,114,.15); color: #8dc572; }
      .sz-status-badge.warning  { background: rgba(239,159,39,.15);  color: var(--amber); }
      .sz-status-badge.violation { background: rgba(216,90,48,.14);  color: #D85A30; }
      .sz-status-badge.over     { background: rgba(216,90,48,.14);   color: #D85A30; }
      .sz-status-badge.cb-no-filters { background: rgba(160,160,160,.12); color: var(--text3); }

      /* Table summary header bar */
      .sz-tbl-summary {
        display: flex; flex-wrap: wrap; gap: 20px;
        padding: 1rem 1.25rem;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius); margin-bottom: 1rem;
      }
      .sz-tbl-section-title {
        font-size: 13px; font-weight: 700; color: var(--text);
        letter-spacing: .03em; margin: 1.25rem 0 .6rem;
        display: flex; align-items: center; gap: 8px;
      }
      .sz-tbl-section-title .sz-tbl-count {
        font-size: 11px; font-weight: 600; color: var(--text3);
        background: var(--bg2); border: 1px solid var(--border);
        border-radius: 20px; padding: 2px 9px;
      }

      /* Insights grid */
      .sz-insights-card {
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 1.25rem;
        margin-bottom: 20px;
      }
      .sz-insights-title {
        font-size: 13px; font-weight: 700; color: var(--text);
        margin-bottom: 1rem; letter-spacing: .03em;
      }
      .sz-insights-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 16px;
      }
      .sz-insights-grid--top { margin-bottom: 16px; }
      .sz-insight-item { display: flex; flex-direction: column; gap: 3px; }
      .sz-insight-val {
        font-size: 18px; font-weight: 700; color: var(--text);
      }
      .sz-insight-sub {
        font-size: 10px; color: var(--text3); line-height: 1.4;
      }
      .sz-ins-section-title {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .05em; color: var(--text3); margin-bottom: 6px;
      }
      .sz-ins-breakdown {
        width: 100%; border-collapse: collapse; margin-bottom: 6px;
      }
      .sz-ins-breakdown tr { border-bottom: 1px solid var(--border); }
      .sz-ins-breakdown tr:last-child { border-bottom: none; }
      .sz-ins-br-label {
        font-size: 12px; color: var(--text2); padding: 5px 0;
      }
      .sz-ins-br-val {
        font-size: 13px; font-weight: 700; text-align: right;
        padding: 5px 8px 5px 0; white-space: nowrap;
      }
      .sz-ins-br-pct {
        font-size: 11px; text-align: right; padding: 5px 0;
        white-space: nowrap; min-width: 36px;
      }
      .sz-ins-note {
        font-size: 10px; color: var(--text3); font-style: italic;
        margin-top: 4px;
      }

      /* Collapsible panel cards */
      .sz-panel-card {
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .sz-panel-card + .sz-panel-card { margin-top: 16px; }
      .sz-panel-card__header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1rem 1.25rem;
        cursor: pointer; user-select: none;
        font-size: 13px; font-weight: 700; color: var(--text);
        letter-spacing: .03em;
        border-radius: var(--radius);
        transition: background .15s;
      }
      .sz-panel-card__header:hover { background: var(--bg2); }
      .sz-panel-card__chevron {
        font-size: 10px; color: var(--text3);
        transition: transform .2s ease;
        flex-shrink: 0; margin-left: 6px;
      }
      .sz-panel-card.collapsed .sz-panel-card__chevron { transform: rotate(-90deg); }
      .sz-panel-card__body {
        overflow: hidden;
        max-height: 2000px;
        transition: max-height .25s ease, opacity .2s ease, padding .2s ease;
        opacity: 1;
        padding: 0 1.25rem 1.1rem;
      }
      .sz-panel-card.collapsed .sz-panel-card__body {
        max-height: 0;
        opacity: 0;
        padding-bottom: 0;
      }

      .sz-rb-formula {
        font-size: 11px; color: var(--text3); line-height: 1.7;
        background: var(--bg2); border-radius: var(--radius-sm);
        padding: .6rem 1rem; margin-bottom: 1.25rem;
        border-left: 3px solid var(--border2);
      }

      /* ── Filter Checkboxes Panel (Step 2) ── */
      .sz-cb-filters-card {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 1.1rem 1.25rem;
      }
      .sz-cb-filter-row {
        padding: .65rem 0;
        border-bottom: 1px solid var(--border);
      }
      .sz-cb-filter-row:last-child { border-bottom: none; }

      .sz-cbf-label {
        display: flex; align-items: center; gap: 9px;
        font-size: 13px; font-weight: 600; color: var(--text);
        cursor: pointer; user-select: none;
      }
      .sz-cbf-label input[type="checkbox"] {
        width: 15px; height: 15px; cursor: pointer;
        accent-color: var(--green, #8dc572);
        flex-shrink: 0;
      }
      .sz-cbf-options {
        margin-top: .55rem; padding-left: 24px;
        display: none;
      }
      .sz-cbf-options.visible { display: block; }
      .sz-cbf-opt-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .04em; color: var(--text3); margin-bottom: 6px;
        display: block;
      }
      .sz-cbf-dollar-input {
        width: 100%; padding: 5px 8px; box-sizing: border-box;
        font-size: 12px; font-weight: 600;
        border: 1px solid var(--border2); border-radius: var(--radius-sm);
        background: var(--bg); color: var(--text);
        outline: none; font-family: inherit;
      }
      .sz-cbf-dollar-input:focus { border-color: var(--text2); }
      .sz-cbf-price-row {
        display: flex; gap: 6px; align-items: center;
      }
      .sz-cbf-price-row input {
        flex: 1; min-width: 0; padding: 5px 8px; box-sizing: border-box;
        font-size: 12px; font-weight: 600;
        border: 1px solid var(--border2); border-radius: var(--radius-sm);
        background: var(--bg); color: var(--text);
        outline: none; font-family: inherit;
      }
      .sz-cbf-price-row input:focus { border-color: var(--text2); }
      .sz-cbf-price-row span { font-size: 11px; color: var(--text3); white-space: nowrap; }
      .sz-cbf-hint {
        font-size: 10px; color: var(--text3); line-height: 1.5;
        margin-top: 6px; padding: .4rem .6rem;
        background: var(--bg2); border-radius: var(--radius-sm);
        border-left: 2px solid var(--border2);
      }
      .sz-cbf-inline-check {
        display: flex; align-items: center; gap: 6px;
        margin-top: 8px; cursor: pointer;
        font-size: 11px; color: var(--text2);
        user-select: none;
      }
      .sz-cbf-inline-check input[type="checkbox"] {
        width: 13px; height: 13px; cursor: pointer; flex-shrink: 0;
        accent-color: var(--text);
      }

      /* Time of Day slot list */
      .sz-cbf-slot-list {
        display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px;
      }

      /* Option button groups inside filter options */
      .sz-cbf-opt-btns { display: flex; gap: 5px; flex-wrap: wrap; }
      .sz-cbf-opt-btn {
        padding: 4px 12px; border-radius: 20px;
        border: 1px solid var(--border2);
        background: var(--bg2); color: var(--text2);
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: all .15s;
      }
      .sz-cbf-opt-btn:hover { border-color: var(--text2); color: var(--text); }
      .sz-cbf-opt-btn.active {
        background: var(--text); color: var(--bg); border-color: var(--text);
      }
    `;
    document.head.appendChild(style);
  }

  const thresholdFmt = threshold > 0
    ? `$${threshold.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : '—';

  return `
    <div class="sz-wrap">
      <div class="sz-header">
        <div class="sz-title" id="sizing-page-title">Trading Analysis</div>
        <div class="sz-sub" id="sz-sub-title">Filter trades with active rules and see what clean trading looks like</div>
      </div>

      <!-- View toggle only (Analysis Type buttons removed — checkboxes drive the filters) -->



      <!-- ═══════════════════════════════════════════════════════════════════
           EXPOSURE ANALYSIS SECTION (existing, unchanged)
      ══════════════════════════════════════════════════════════════════════ -->
      <div id="sz-exposure-section" style="display:none">

        <!-- Exposure threshold selector -->
        <div class="sz-exposure-row">
          <span class="sz-exposure-label">Exposure Threshold</span>
          <div class="sz-exposure-btns">
            ${[25, 50, 75, 100].map(p => `
              <button class="sz-exp-btn${p === exposurePct ? ' active' : ''}"
                onclick="window._szOnExposureChange(${p})">${p}%</button>
            `).join('')}
          </div>
        </div>

        <div class="sz-grid">

          <!-- Group A: Good sizing -->
          <div class="sz-card">
            <div class="sz-card-head">
              <div class="sz-card-title">Properly Sized Trades</div>
              <div class="sz-card-badge good">≤ ${exposurePct}%</div>
            </div>
            <div class="sz-kpi-row" id="sz-kpi-good">
              <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
            </div>
            <div id="sz-good-chart-area">
              <div class="sz-empty">Enter account size above</div>
            </div>
            <div class="sz-def-note">Position size = entry price × shares. Trades with exposure ≤ ${exposurePct}% of account size.</div>
          </div>

          <!-- Group B: Oversized -->
          <div class="sz-card">
            <div class="sz-card-head">
              <div class="sz-card-title">Oversized Trades</div>
              <div class="sz-card-badge over">&gt; ${exposurePct}%</div>
            </div>
            <div class="sz-kpi-row" id="sz-kpi-over">
              <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
            </div>
            <div id="sz-over-chart-area">
              <div class="sz-empty">Enter account size above</div>
            </div>
            <div class="sz-def-note">Trades with exposure &gt; ${exposurePct}% of account size — position too large relative to account.</div>
          </div>

        </div>

        <!-- All-trades comparison chart -->
        <div class="sz-card" style="margin-top:20px">
          <div class="sz-card-head">
            <div class="sz-card-title">All Trades — Full Equity Curve (Net)</div>
            <div class="sz-card-badge" style="background:rgba(100,149,237,.13);color:#6495ed;border:1px solid rgba(100,149,237,.25)">Reference</div>
          </div>
          <div class="sz-kpi-row" id="sz-kpi-all">
            <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
          </div>
          <div id="sz-all-chart-area">
            <div class="sz-empty">Enter account size above</div>
          </div>
          <div class="sz-def-note">All filtered trades combined — use as reference baseline when comparing the two buckets above.</div>
        </div>

      </div><!-- /sz-exposure-section -->

      <!-- Table view — Exposure Analysis -->
      <div id="sz-table-exposure" style="display:none"></div>

      <!-- ═══════════════════════════════════════════════════════════════════
           RISK BUDGET ANALYSIS SECTION (new)
      ══════════════════════════════════════════════════════════════════════ -->
      <div id="sz-riskbudget-section" style="display:none">

        <!-- Risk Budget % selector -->
        <div class="sz-rb-settings-row">
          <span class="sz-exposure-label">Risk Budget</span>
          <div class="sz-exposure-btns">
            ${[0.5, 1, 2, 3, 5].map(p => `
              <button class="sz-rb-btn${p === riskBudgetPct ? ' active' : ''}"
                data-pct="${p}"
                onclick="window._szOnRiskBudgetChange(${p})">${p}%</button>
            `).join('')}
          </div>
          <div class="sz-threshold-badge" style="margin-left:4px">
            Active Budget: <span id="sz-rb-pct-badge" style="color:var(--amber);font-weight:700">${riskBudgetPct}%</span>
          </div>
        </div>

        <!-- Formula note -->
        <div class="sz-rb-formula">
          <strong>Budget Stop formula:</strong>
          Allowed Risk = Account Equity × Risk Budget% &nbsp;|&nbsp;
          Risk/Share = Allowed Risk ÷ Shares &nbsp;|&nbsp;
          Budget Stop = Entry − Risk/Share &nbsp;|&nbsp;
          Stop Dist % = (Risk/Share ÷ Entry) × 100<br>
          <strong>Compliant</strong> ≥ 2% &nbsp;·&nbsp;
          <strong>Warning</strong> 1–2% &nbsp;·&nbsp;
          <strong>Violation</strong> &lt; 1%
        </div>

        <!-- 9-item KPI summary bar -->
        <div class="sz-rb-kpi-bar" id="sz-rb-kpi-bar">
          <span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>
        </div>

        <!-- Chart grid: Compliant + Warning + Violation (3 columns) -->
        <div class="sz-rb-grid">

          <!-- Compliant -->
          <div class="sz-card">
            <div class="sz-card-head">
              <div class="sz-card-title">Risk Compliant</div>
              <div class="sz-card-badge compliant">Stop ≥ 2%</div>
            </div>
            <div class="sz-kpi-row" id="sz-rb-kpi-comp">
              <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
            </div>
            <div id="sz-rb-compliant-area">
              <div class="sz-empty">Enter account size above</div>
            </div>
            <div class="sz-def-note">Stop Dist ≥ 2% — compatible with risk budget.</div>
          </div>

          <!-- Warning -->
          <div class="sz-card">
            <div class="sz-card-head">
              <div class="sz-card-title">Risk Warning</div>
              <div class="sz-card-badge warning">1% ≤ Stop &lt; 2%</div>
            </div>
            <div class="sz-kpi-row" id="sz-rb-kpi-warn">
              <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
            </div>
            <div id="sz-rb-warning-area">
              <div class="sz-empty">Enter account size above</div>
            </div>
            <div class="sz-def-note">Stop Dist 1–2% — position may be too large.</div>
          </div>

          <!-- Violation -->
          <div class="sz-card">
            <div class="sz-card-head">
              <div class="sz-card-title">Risk Violations</div>
              <div class="sz-card-badge violation">Stop &lt; 1%</div>
            </div>
            <div class="sz-kpi-row" id="sz-rb-kpi-viol">
              <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
            </div>
            <div id="sz-rb-violation-area">
              <div class="sz-empty">Enter account size above</div>
            </div>
            <div class="sz-def-note">Stop Dist &lt; 1% — unrealistically tight stop required.</div>
          </div>

        </div><!-- /sz-rb-grid -->

        <!-- Insights card -->
        <div class="sz-insights-card">
          <div class="sz-insights-title">📊 Insights</div>
          <div id="sz-rb-insights">
            <span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>
          </div>
        </div>

      </div><!-- /sz-riskbudget-section -->

      <!-- Table view — Risk Budget Analysis -->
      <div id="sz-table-riskbudget" style="display:none"></div>

      <!-- ═══════════════════════════════════════════════════════════════════
           COMBINED FILTER ANALYSIS SECTION (Phase 4)
      ══════════════════════════════════════════════════════════════════════ -->
      <div id="sz-combined-section" style="">

        <!-- Layout: main area (left) + sidebar (right) -->
        <div class="sz-cb-layout">

          <!-- LEFT: Main content -->
          <div class="sz-cb-main">

            <!-- Combined KPI bar -->
            <div class="sz-cb-kpi-bar" id="sz-cb-kpi-bar">
              <span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>
            </div>

            <!-- Clean vs All grid -->
            <div class="sz-cb-grid">

              <!-- Clean Trades card -->
              <div class="sz-card">
                <div class="sz-card-head">
                  <div class="sz-card-title" id="sz-cb-clean-title">All Trades</div>
                  <div class="sz-card-badge cb-clean" id="sz-cb-clean-badge">No Filters</div>
                </div>
                <div class="sz-kpi-row" id="sz-cb-clean-kpi">
                  <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
                </div>
                <div id="sz-cb-clean-chart-area">
                  <div class="sz-empty">Enter account size above</div>
                </div>
                <div class="sz-def-note" id="sz-cb-clean-note">All trades — no filters active.</div>
              </div>

              <!-- All Trades reference card -->
              <div class="sz-card">
                <div class="sz-card-head">
                  <div class="sz-card-title">All Trades</div>
                  <div class="sz-card-badge cb-ref">Reference</div>
                </div>
                <div class="sz-kpi-row" id="sz-cb-all-kpi">
                  <div class="sz-empty" style="border:none;height:auto;font-size:12px;color:var(--text3)">Enter account size to analyse</div>
                </div>
                <div id="sz-cb-all-chart-area">
                  <div class="sz-empty">Enter account size above</div>
                </div>
                <div class="sz-def-note">All filtered trades — reference baseline showing actual trading history.</div>
              </div>

            </div><!-- /sz-cb-grid -->

          </div><!-- /sz-cb-main -->

        </div><!-- /sz-cb-layout -->

      </div><!-- /sz-combined-section -->

      <!-- Table view — Combined Filter -->
      <div id="sz-table-combined" style="display:none"></div>

    </div>

    <!-- Floating tooltip elements — Exposure Analysis -->
    <div id="sz-tooltip-good" class="sz-tooltip"></div>
    <div id="sz-tooltip-over" class="sz-tooltip"></div>
    <div id="sz-tooltip-all"  class="sz-tooltip"></div>

    <!-- Floating tooltip elements — Risk Budget Analysis -->
    <div id="sz-tooltip-rb-comp" class="sz-tooltip"></div>
    <div id="sz-tooltip-rb-viol" class="sz-tooltip"></div>
    <div id="sz-tooltip-rb-warn" class="sz-tooltip"></div>

    <!-- Floating tooltip elements — Combined Filter Analysis -->
    <div id="sz-tooltip-cb-clean" class="sz-tooltip"></div>
    <div id="sz-tooltip-cb-all"   class="sz-tooltip"></div>
  `;
}

// ─── Render KPI bar for a bucket ─────────────────────────────────────────────
function _renderKPIBar(elId, stats) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!stats.n) {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3);padding:.25rem 0">No trades in this bucket</span>`;
    return;
  }
  const pnlCls = stats.pnl > 0 ? 'pos' : stats.pnl < 0 ? 'neg' : 'neu';
  const avgCls = stats.avg > 0 ? 'pos' : stats.avg < 0 ? 'neg' : 'neu';
  const wrCls  = stats.wr >= 50 ? 'pos' : 'neg';
  const fmt    = v => (v >= 0 ? '+' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');

  el.innerHTML = `
    <div class="sz-kpi">
      <div class="sz-kpi-label">Trades</div>
      <div class="sz-kpi-val neu">${stats.n}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Total P&amp;L (Net)</div>
      <div class="sz-kpi-val ${pnlCls}">${fmt(stats.pnl)}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Win Rate</div>
      <div class="sz-kpi-val ${wrCls}">${stats.wr}%</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Avg / Trade (Net)</div>
      <div class="sz-kpi-val ${avgCls}">${fmt(stats.avg)}</div>
    </div>
  `;
}

// ─── Render chart area (canvas or empty state) ───────────────────────────────
function _renderChartArea(areaId, canvasId, tooltipId, tradeSubset, instanceRef) {
  const area = document.getElementById(areaId);
  if (!area) return;

  if (!tradeSubset.length) {
    if (instanceRef.current) { instanceRef.current.destroy(); instanceRef.current = null; }
    area.innerHTML = `<div class="sz-empty">No trades in this bucket</div>`;
    return;
  }

  area.innerHTML = `<div class="sz-chart-wrap"><canvas id="${canvasId}"></canvas></div>`;

  // Tooltip background is now applied live inside the Chart.js external tooltip
  // callback on every hover, so it always reflects the current theme.

  _drawSizingChart(canvasId, tooltipId, tradeSubset, instanceRef);
}

// ─── Module-level refs (objects so _drawSizingChart can mutate .current) ─────
const _szGoodRef = { current: null };
const _szOverRef = { current: null };
const _szAllRef  = { current: null };   // all-trades comparison chart

// Risk Budget Analysis chart refs
const _szRbCompliantRef = { current: null };
const _szRbViolationRef = { current: null };
const _szRbWarningRef   = { current: null };

// Combined Filter Analysis chart refs
const _szCbCleanRef = { current: null };
const _szCbAllRef   = { current: null };

let   _szLastAccountSize = 0;
let   _szExposurePct     = 50;   // default 50% — loaded from localStorage on init
let   _szBaselineDate    = '';   // 'YYYY-MM-DD' — loaded from localStorage on init

// Risk Budget Analysis state
let   _szAnalysisMode    = 'combined';   // always combined — mode buttons removed
let   _szRiskBudgetPct   = 1;            // 0.5 | 1 | 2 | 3 | 5

// ─── Combined Filter state (Step 2) ──────────────────────────────────────────
// Replaces the old fixed two-filter approach for the Combined mode.
// _szExposurePct / _szRiskBudgetPct remain intact for their own analysis modes.
let _szCbFilters = {
  exposure:     { enabled: false, pct: 50 },
  riskBudget:   { enabled: false, pct: 1  },
  timeOfDay:    { enabled: false, blockedSlots: [] },
  revengeTrade: { enabled: false, maxLossStreak: 2 },
  overtrading:  { enabled: false, maxTradesPerDay: 3, includePreceding: true },
  maxLoss:      { enabled: false, value: '' },
  priceRange:   { enabled: false, min: '', max: '' },
};

// ─── Time of Day slot definitions ────────────────────────────────────────────
const _SZ_TIME_SLOTS = [
  { key: 'pre_early', label: '< 7:00',        startH:  0, startM:  0, endH:  6, endM: 59 },
  { key: 'pre',       label: '7:00 – 9:30',   startH:  7, startM:  0, endH:  9, endM: 29 },
  { key: 'open',      label: '9:30 – 11:30',  startH:  9, startM: 30, endH: 11, endM: 29 },
  { key: 'mid',       label: '11:30 – 16:00', startH: 11, startM: 30, endH: 15, endM: 59 },
  { key: 'after',     label: '> 16:00',       startH: 16, startM:  0, endH: 23, endM: 59 },
];
// Processes ALL trades (unfiltered from getFilteredTrades scope — we use the
// full global trades array so equity builds correctly even when a time filter
// hides early trades from the charts).
//
// Returns Map<tradeId → equityBeforeTrade>
//
// Sort order guarantee: primary = date string (ISO, lexicographic = chronological),
// secondary = entryTime string. If neither differs, insertion order is preserved
// (irrelevant because P&L is the same either way).
function _szBuildEquityMap(startingEquity, baselineDate) {
  // Use global `trades` array (all trades, regardless of active time filter)
  // Fall back to getFilteredTrades() if global trades is unavailable.
  const allTrades = (typeof trades !== 'undefined' ? trades : getFilteredTrades())
    .filter(t => t.date >= baselineDate)
    .slice()   // don't mutate original
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const at = a.entryTime || '00:00';
      const bt = b.entryTime || '00:00';
      return at.localeCompare(bt);
    });

  const map = new Map();
  let equity = startingEquity;

  allTrades.forEach(t => {
    map.set(String(t.id), equity);       // equity BEFORE this trade
    equity += (t.pnl || 0) - (typeof calcCommission === 'function' ? calcCommission(t) : 0); // update equity AFTER trade (net of fees)
  });

  return map;
}

// ─── Combined Filter classifier (OR logic) ────────────────────────────────────
// Returns { clean, dirty, dirtyByExposureOnly, dirtyByRbOnly, dirtyByBoth, kpis, insights }
// ─── Pre-processing helpers for Combined Filter ───────────────────────────────

// Builds a Map<tradeId → isRevenge (bool)> for Revenge Trading filter.
// Logic: per-day consecutive loss counter; once it reaches maxConsecLosses,
// every subsequent trade that day is flagged dirty — no intra-day reset.
function _szBuildStreakMap(sortedTrades, maxConsecLosses) {
  const map = new Map();
  const byDay = {};
  sortedTrades.forEach(t => {
    if (!byDay[t.date]) byDay[t.date] = [];
    byDay[t.date].push(t);
  });

  Object.values(byDay).forEach(dayTrades => {
    let consecLosses = 0;
    let triggered    = false;
    dayTrades.forEach(t => {
      if (triggered) {
        map.set(String(t.id), true);
      } else {
        map.set(String(t.id), false);
        if ((t.pnl || 0) < 0) {
          consecLosses++;
          if (consecLosses >= maxConsecLosses) triggered = true;
        } else {
          consecLosses = 0;
        }
      }
    });
  });
  return map;
}

// Builds { date → total trade count } for Overtrading filter.
function _szBuildDayCountMap(trades) {
  const countByDay = {};
  trades.forEach(t => {
    countByDay[t.date] = (countByDay[t.date] || 0) + 1;
  });
  return countByDay;
}

// Builds Map<tradeId → overtradingStatus> where status is:
//   'clean'  — trade is within the allowed count
//   'breach' — trade is at position > maxTradesPerDay (always dirty)
//   'preceding' — trade is within count but on an overtrading day
//                 (dirty only when includePreceding is true)
function _szBuildOvertradingMap(sortedTrades, maxTradesPerDay) {
  // Count per day first
  const dayCount = {};
  sortedTrades.forEach(t => {
    dayCount[t.date] = (dayCount[t.date] || 0) + 1;
  });

  // Assign per-trade index within day (1-based, chronological)
  const dayIndex = {};
  const map = new Map();
  sortedTrades.forEach(t => {
    dayIndex[t.date] = (dayIndex[t.date] || 0) + 1;
    const idx          = dayIndex[t.date];
    const totalDay     = dayCount[t.date];
    const isOtDay      = totalDay > maxTradesPerDay;

    if (!isOtDay) {
      map.set(String(t.id), 'clean');
    } else if (idx <= maxTradesPerDay) {
      map.set(String(t.id), 'preceding'); // within limit but day is dirty
    } else {
      map.set(String(t.id), 'breach');    // beyond limit
    }
  });
  return map;
}

// Builds Map<tradeId → isMaxLossBreach (bool)> for Max Daily Loss filter.
// Logic: per-day cumulative P&L; once it drops below -maxLossDollars,
// every subsequent trade that day is flagged dirty — no intra-day reset.
function _szBuildMaxLossMap(sortedTrades, maxLossDollars) {
  const map = new Map();
  const byDay = {};
  sortedTrades.forEach(t => {
    if (!byDay[t.date]) byDay[t.date] = [];
    byDay[t.date].push(t);
  });

  Object.values(byDay).forEach(dayTrades => {
    let cumPnl    = 0;
    let triggered = false;
    dayTrades.forEach(t => {
      if (triggered) {
        map.set(String(t.id), true);
      } else {
        cumPnl += (t.pnl || 0);
        if (cumPnl <= -Math.abs(maxLossDollars)) {
          triggered = true;
          map.set(String(t.id), true);  // העסקה שפרצה — גם היא dirty
        } else {
          map.set(String(t.id), false);
        }
      }
    });
  });
  return map;
}

// ─── Combined Filter classifier — supports all 5 filters ─────────────────────
// Returns { clean, dirty, dirtyTrades, dirtyReasons, kpis, insights }
function _szClassifyCombined(filteredTrades, equityMap, filters) {
  // Pre-processing
  const sorted = [...filteredTrades].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : (a.entryTime || '').localeCompare(b.entryTime || '');
  });
  const streakMap      = _szBuildStreakMap(sorted, filters.revengeTrade.maxLossStreak);
  const dayCountMap    = _szBuildDayCountMap(filteredTrades);
  const overtradingMap = _szBuildOvertradingMap(sorted, filters.overtrading.maxTradesPerDay);
  const maxLossMap     = (filters.maxLoss.enabled && parseFloat(filters.maxLoss.value) > 0)
    ? _szBuildMaxLossMap(sorted, parseFloat(filters.maxLoss.value))
    : null;

  const clean = [];
  const dirty = [];
  const dirtyReasons = { exposure: 0, riskBudget: 0, timeOfDay: 0, revengeTrade: 0, overtrading: 0, maxLoss: 0, priceRange: 0 };

  filteredTrades.forEach(t => {
    const equity  = equityMap.get(String(t.id)) || 0;
    const posSize = _posSize(t);
    const qty     = Math.abs(t.qty || 0);
    const entry   = t.entry || 0;
    const reasons = [];

    // Filter 0: Price Range (immediate, no time ordering needed)
    if (filters.priceRange.enabled && entry > 0) {
      const minP = filters.priceRange.min !== '' ? parseFloat(filters.priceRange.min) : null;
      const maxP = filters.priceRange.max !== '' ? parseFloat(filters.priceRange.max) : null;
      if ((minP !== null && entry < minP) || (maxP !== null && entry > maxP)) {
        reasons.push('priceRange');
      }
    }

    // Filter 1: Exposure Limit
    if (filters.exposure.enabled && equity > 0) {
      if (posSize / equity > filters.exposure.pct / 100) reasons.push('exposure');
    }

    // Filter 2: Risk Budget
    if (filters.riskBudget.enabled && equity > 0 && qty > 0 && entry > 0) {
      const stopDist = (equity * (filters.riskBudget.pct / 100) / qty / entry) * 100;
      if (stopDist < 1) reasons.push('riskBudget');
    }

    // Filter 3: Time of Day — block trades whose entry falls in a checked slot
    if (filters.timeOfDay.enabled && t.entryTime && filters.timeOfDay.blockedSlots.length > 0) {
      const parts = t.entryTime.split(':');
      const eMin  = parseInt(parts[0] || '0') * 60 + parseInt(parts[1] || '0');
      const inBlocked = _SZ_TIME_SLOTS.some(slot =>
        filters.timeOfDay.blockedSlots.includes(slot.key) &&
        eMin >= slot.startH * 60 + slot.startM &&
        eMin <= slot.endH   * 60 + slot.endM
      );
      if (inBlocked) reasons.push('timeOfDay');
    }

    // Filter 4: Revenge Trading
    if (filters.revengeTrade.enabled) {
      if (streakMap.get(String(t.id)) === true) reasons.push('revengeTrade');
    }

    // Filter 3b: Max Daily Loss
    if (filters.maxLoss.enabled && maxLossMap) {
      if (maxLossMap.get(String(t.id)) === true) reasons.push('maxLoss');
    }

    // Filter 5: Overtrading
    if (filters.overtrading.enabled) {
      const otStatus = overtradingMap.get(String(t.id));
      if (otStatus === 'breach' ||
         (otStatus === 'preceding' && filters.overtrading.includePreceding)) {
        reasons.push('overtrading');
      }
    }

    if (reasons.length === 0) {
      clean.push(t);
    } else {
      t.breach_reasons = reasons;
      dirty.push({ trade: t, reasons });
      reasons.forEach(r => dirtyReasons[r]++);
    }
  });

  const total      = filteredTrades.length;
  const dirtyTrades = dirty.map(d => d.trade);
  const sumPnl     = arr => arr.reduce((s, t) => s + (t.pnl || 0) - (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0); // net
  const wins       = arr => arr.filter(t => t.pnl > 0).length;
  const avgFn      = arr => arr.length ? sumPnl(arr) / arr.length : 0;
  const wrFn       = arr => arr.length ? Math.round(wins(arr) / arr.length * 100) : 0;

  const cleanPnl = sumPnl(clean);
  const allPnl   = sumPnl(filteredTrades);
  const cleanWR  = wrFn(clean);
  const allWR    = wrFn(filteredTrades);

  const kpis = {
    total,
    nClean:   clean.length,
    nDirty:   dirty.length,
    cleanPct: total > 0 ? Math.round(clean.length / total * 100) : 0,
    cleanPnl,
    allPnl,
    pnlDelta: cleanPnl - allPnl,
    cleanWR,
    allWR,
    avgClean: avgFn(clean),
    avgAll:   avgFn(filteredTrades),
  };

  const insights = {
    dirtyReasons,
    dirtyPnl:   sumPnl(dirtyTrades),
    wrDelta:    cleanWR - allWR,
    avgDelta:   avgFn(clean) - avgFn(filteredTrades),
    // legacy fields for backward compat
    nExpOnly:   dirtyReasons.exposure,
    pctExpOnly: total > 0 ? Math.round(dirtyReasons.exposure / total * 100) : 0,
    nRbOnly:    dirtyReasons.riskBudget,
    pctRbOnly:  total > 0 ? Math.round(dirtyReasons.riskBudget / total * 100) : 0,
    nBoth:      0,
    pctBoth:    0,
  };

  return { clean, dirty, dirtyTrades, dirtyReasons, kpis, insights };
}

// ─── Risk Budget Analysis — classify trades into 3 buckets ──────────────────
// Returns { compliant, warning, violation, kpis, insights }
function _szClassifyRiskBudget(filteredTrades, equityMap, riskPct) {
  const compliant  = [];
  const warning    = [];
  const violation  = [];
  const details    = [];   // per-trade calculated data for KPIs/insights

  filteredTrades.forEach(t => {
    const equity      = equityMap.get(String(t.id));
    const entry       = t.entry  || 0;
    const qty         = Math.abs(t.qty || 0);
    if (!equity || equity <= 0 || !entry || !qty) return;

    const allowedRisk      = equity * (riskPct / 100);
    const riskPerShare     = allowedRisk / qty;
    const budgetStop       = entry - riskPerShare;
    const budgetStopDist   = (riskPerShare / entry) * 100;   // = ((entry - budgetStop) / entry) * 100

    details.push({ trade: t, equity, allowedRisk, riskPerShare, budgetStop, budgetStopDist });

    if (budgetStopDist >= 2)       compliant.push(t);
    else if (budgetStopDist >= 1)  warning.push(t);
    else                           violation.push(t);
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const total      = details.length;
  const nComp      = compliant.length;
  const nWarn      = warning.length;
  const nViol      = violation.length;
  const compliancePct = total > 0 ? Math.round(nComp / total * 100) : 0;

  const avgAllowedRisk = total > 0
    ? details.reduce((s, d) => s + d.allowedRisk, 0) / total
    : 0;

  const avgBudgetStopDist = total > 0
    ? details.reduce((s, d) => s + d.budgetStopDist, 0) / total
    : 0;

  const tightestStop = total > 0
    ? Math.min(...details.map(d => d.budgetStopDist))
    : 0;

  // Largest violation = smallest budgetStopDist among violations (most over budget)
  const violDetails = details.filter(d => d.budgetStopDist < 1);
  const largestViolation = violDetails.length > 0
    ? Math.min(...violDetails.map(d => d.budgetStopDist))
    : null;

  const kpis = {
    total, nComp, nWarn, nViol, compliancePct,
    avgAllowedRisk, avgBudgetStopDist, tightestStop, largestViolation
  };

  // ── Insights ─────────────────────────────────────────────────────────────
  const pctExceeding = total > 0 ? Math.round((nViol + nWarn) / total * 100) : 0;
  const avgRequired  = avgBudgetStopDist;
  const smallest     = tightestStop;
  const largestPos   = total > 0
    ? details.reduce((max, d) => d.budgetStopDist < max.budgetStopDist ? d : max, details[0])
    : null;

  // Estimated impact: compare violation P&L vs compliant avg/trade
  const compPnl  = compliant.reduce((s, t) => s + (t.pnl || 0) - (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0); // net
  const violPnl  = violation.reduce((s, t) => s + (t.pnl || 0) - (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0); // net
  const compAvg  = nComp > 0 ? compPnl / nComp : 0;
  const estimatedImpact = nViol > 0 ? violPnl - (compAvg * nViol) : 0;

  const insights = { pctExceeding, avgRequired, smallest, largestPos, estimatedImpact, compAvg };

  return { compliant, warning, violation, kpis, insights, details };
}

// ─── Risk Budget Analysis KPI bar ────────────────────────────────────────────
function _szRenderRiskBudgetKPIs(elId, kpis) {
  const el = document.getElementById(elId);
  if (!el) return;

  if (!kpis.total) {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>`;
    return;
  }

  const fmtD  = v => '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtP  = v => v.toFixed(2) + '%';
  const compCls  = kpis.compliancePct >= 80 ? 'pos' : kpis.compliancePct >= 50 ? 'neu' : 'neg';
  const violCls  = kpis.nViol > 0 ? 'neg' : 'pos';
  const warnCls  = kpis.nWarn > 0 ? 'amber' : 'pos';

  el.innerHTML = `
    <div class="sz-kpi">
      <div class="sz-kpi-label">Total Trades</div>
      <div class="sz-kpi-val neu">${kpis.total}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Compliant</div>
      <div class="sz-kpi-val pos">${kpis.nComp}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Warning</div>
      <div class="sz-kpi-val ${warnCls}">${kpis.nWarn}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Violations</div>
      <div class="sz-kpi-val ${violCls}">${kpis.nViol}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Compliance %</div>
      <div class="sz-kpi-val ${compCls}">${kpis.compliancePct}%</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Avg Allowed Risk $</div>
      <div class="sz-kpi-val neu">${fmtD(kpis.avgAllowedRisk)}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Avg Stop Dist %</div>
      <div class="sz-kpi-val neu">${fmtP(kpis.avgBudgetStopDist)}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Tightest Stop %</div>
      <div class="sz-kpi-val neg">${fmtP(kpis.tightestStop)}</div>
    </div>
    <div class="sz-kpi">
      <div class="sz-kpi-label">Largest Violation</div>
      <div class="sz-kpi-val ${kpis.largestViolation !== null ? 'neg' : 'pos'}">
        ${kpis.largestViolation !== null ? fmtP(kpis.largestViolation) : '—'}
      </div>
    </div>
  `;
}

// ─── Risk Budget Insights panel ───────────────────────────────────────────────
function _szRenderRiskBudgetInsights(elId, insights, kpis) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!kpis.total) { el.innerHTML = ''; return; }

  const fmtD = v => '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtP = v => v.toFixed(2) + '%';
  const sign = v => v >= 0 ? '+' : '−';
  const impactCls = insights.estimatedImpact >= 0 ? '#8dc572' : '#D85A30';

  const largestEntry = insights.largestPos
    ? `${insights.largestPos.trade.ticker || 'N/A'} (${fmtP(insights.largestPos.budgetStopDist)} stop dist)`
    : '—';

  el.innerHTML = `
    <div class="sz-insights-grid">
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Trades Exceeding Budget</div>
        <div class="sz-insight-val" style="color:${kpis.nViol + kpis.nWarn > 0 ? '#D85A30' : '#8dc572'}">${insights.pctExceeding}%</div>
        <div class="sz-insight-sub">${kpis.nViol + kpis.nWarn} of ${kpis.total} trades</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Avg Required Stop Dist</div>
        <div class="sz-insight-val">${fmtP(insights.avgRequired)}</div>
        <div class="sz-insight-sub">to stay within budget</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Smallest Required Stop</div>
        <div class="sz-insight-val" style="color:#D85A30">${fmtP(insights.smallest)}</div>
        <div class="sz-insight-sub">tightest constraint</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Largest Position vs Budget</div>
        <div class="sz-insight-val">${largestEntry}</div>
        <div class="sz-insight-sub">most constrained trade</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Est. Impact of Oversizing (Net)</div>
        <div class="sz-insight-val" style="color:${impactCls}">${sign(insights.estimatedImpact)}${fmtD(insights.estimatedImpact)}</div>
        <div class="sz-insight-sub">violation P&L vs compliant avg/trade (net of fees)</div>
      </div>
    </div>
  `;
}

// ─── Combined Filter KPI bar (11 metrics) ─────────────────────────────────────
function _szRenderCombinedKPIs(elId, kpis) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!kpis.total) {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>`;
    return;
  }
  const fmt     = v => (v >= 0 ? '+' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const fmtAbs  = v => '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const pnlCls  = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
  const wrCls   = v => v >= 50 ? 'pos' : 'neg';
  const deltaCls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';

  el.innerHTML = `
    <div class="sz-kpi"><div class="sz-kpi-label">Total Trades</div><div class="sz-kpi-val neu">${kpis.total}</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">Clean Trades</div><div class="sz-kpi-val pos">${kpis.nClean}</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">Filtered Out</div><div class="sz-kpi-val ${kpis.nDirty > 0 ? 'neg' : 'pos'}">${kpis.nDirty}</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">Clean %</div><div class="sz-kpi-val ${kpis.cleanPct >= 70 ? 'pos' : 'neg'}">${kpis.cleanPct}%</div></div>
    <div class="sz-kpi" style="border-left:1px solid var(--border);padding-left:16px">
      <div class="sz-kpi-label">Clean P&amp;L (Net)</div>
      <div class="sz-kpi-val ${pnlCls(kpis.cleanPnl)}">${fmt(kpis.cleanPnl)}</div>
    </div>
    <div class="sz-kpi"><div class="sz-kpi-label">All P&amp;L (Net)</div><div class="sz-kpi-val ${pnlCls(kpis.allPnl)}">${fmt(kpis.allPnl)}</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">P&amp;L Delta (Net)</div><div class="sz-kpi-val ${deltaCls(kpis.pnlDelta)}">${fmt(kpis.pnlDelta)}</div></div>
    <div class="sz-kpi" style="border-left:1px solid var(--border);padding-left:16px">
      <div class="sz-kpi-label">Clean Win Rate</div>
      <div class="sz-kpi-val ${wrCls(kpis.cleanWR)}">${kpis.cleanWR}%</div>
    </div>
    <div class="sz-kpi"><div class="sz-kpi-label">All Win Rate</div><div class="sz-kpi-val ${wrCls(kpis.allWR)}">${kpis.allWR}%</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">Avg Clean Trade</div><div class="sz-kpi-val ${pnlCls(kpis.avgClean)}">${fmt(kpis.avgClean)}</div></div>
    <div class="sz-kpi"><div class="sz-kpi-label">Avg All Trades</div><div class="sz-kpi-val ${pnlCls(kpis.avgAll)}">${fmt(kpis.avgAll)}</div></div>
  `;
}

// ─── Combined Filter Insights ─────────────────────────────────────────────────
function _szRenderCombinedInsights(elId, insights, kpis) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!kpis.total) { el.innerHTML = ''; return; }

  const fmt      = v => (v >= 0 ? '+' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const fmtPnl   = v => (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const pnlCls   = v => v > 0 ? '#8dc572' : v < 0 ? '#D85A30' : 'var(--text2)';
  const deltaCls = v => v > 0 ? '#8dc572' : v < 0 ? '#D85A30' : 'var(--text2)';

  const total = kpis.total;
  const dr    = insights.dirtyReasons || {};

  // Per-filter breakdown rows — only render filters that are currently enabled
  const filterDefs = [
    { key: 'priceRange',   label: 'Price Range',     enabled: _szCbFilters.priceRange.enabled },
    { key: 'timeOfDay',    label: 'Time of Day',     enabled: _szCbFilters.timeOfDay.enabled },
    { key: 'maxLoss',      label: 'Max Daily Loss',  enabled: _szCbFilters.maxLoss.enabled },
    { key: 'revengeTrade', label: 'Revenge Trading', enabled: _szCbFilters.revengeTrade.enabled },
    { key: 'overtrading',  label: 'Overtrading',     enabled: _szCbFilters.overtrading.enabled },
    { key: 'exposure',     label: 'Exposure Limit',  enabled: _szCbFilters.exposure.enabled },
    { key: 'riskBudget',   label: 'Risk Budget',     enabled: _szCbFilters.riskBudget.enabled },
  ];
  const activeFilters = filterDefs.filter(f => f.enabled);

  const breakdownRows = activeFilters.map(f => {
    const n   = dr[f.key] || 0;
    const pct = total > 0 ? Math.round(n / total * 100) : 0;
    const col = n > 0 ? '#D85A30' : '#8dc572';
    return `
      <tr>
        <td class="sz-ins-br-label">${f.label}</td>
        <td class="sz-ins-br-val" style="color:${col}">${n}</td>
        <td class="sz-ins-br-pct" style="color:${col}">${pct}%</td>
      </tr>`;
  }).join('');

  const breakdownSection = activeFilters.length > 0 ? `
    <div class="sz-ins-section-title">By Filter Reason</div>
    <table class="sz-ins-breakdown">
      <tbody>
        ${breakdownRows}
      </tbody>
    </table>
    <div class="sz-ins-note">trades can appear in multiple reasons</div>` : '';

  el.innerHTML = `
    <div class="sz-insights-grid sz-insights-grid--top">
      <div class="sz-insight-item">
        <div class="sz-kpi-label">P&amp;L Impact (filtered-out)</div>
        <div class="sz-insight-val" style="color:${pnlCls(insights.dirtyPnl)}">${fmtPnl(insights.dirtyPnl)}</div>
        <div class="sz-insight-sub">total P&amp;L from dirty trades</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Win Rate Delta</div>
        <div class="sz-insight-val" style="color:${deltaCls(insights.wrDelta)}">${insights.wrDelta >= 0 ? '+' : ''}${insights.wrDelta}pp</div>
        <div class="sz-insight-sub">Clean WR vs All WR</div>
      </div>
      <div class="sz-insight-item">
        <div class="sz-kpi-label">Avg Trade Delta</div>
        <div class="sz-insight-val" style="color:${deltaCls(insights.avgDelta)}">${fmt(insights.avgDelta)}</div>
        <div class="sz-insight-sub">Avg Clean vs Avg All</div>
      </div>
    </div>
    ${breakdownSection}
  `;
}

// ─── Combined Filter orchestrator ─────────────────────────────────────────────
function _szRenderCombinedMode(accountSize) {
  let baselineDate = _szBaselineDate;
  if (!baselineDate) {
    const allT = typeof trades !== 'undefined' ? trades : getFilteredTrades();
    baselineDate = allT.reduce((min, t) => (!min || t.date < min) ? t.date : min, '');
  }

  const equityMap      = _szBuildEquityMap(accountSize, baselineDate || '1970-01-01');
  const filteredTrades = getFilteredTrades();
  const { clean, kpis, insights } =
    _szClassifyCombined(filteredTrades, equityMap, _szCbFilters);

  // Combined KPI bar
  _szRenderCombinedKPIs('sz-cb-kpi-bar', kpis);

  // Insights
  _szRenderCombinedInsights('sz-cb-insights', insights, kpis);

  // Update Clean card title + badge based on whether any filters are active
  const anyActive = Object.values(_szCbFilters).some(f => f.enabled);
  const titleEl = document.getElementById('sz-cb-clean-title');
  const badgeEl = document.getElementById('sz-cb-clean-badge');
  const noteEl  = document.getElementById('sz-cb-clean-note');
  if (titleEl) titleEl.textContent = anyActive ? 'Clean Trades' : 'All Trades';
  if (badgeEl) {
    badgeEl.textContent = anyActive ? '✓ Clean' : '— No Filters';
    badgeEl.className   = anyActive ? 'sz-card-badge cb-clean' : 'sz-card-badge cb-no-filters';
  }
  if (noteEl) noteEl.textContent = anyActive
    ? 'Trades passing all active filters.'
    : 'All trades — no filters active.';

  // Clean Trades card KPI + chart
  _renderKPIBar('sz-cb-clean-kpi', _bucketStats(clean));
  _renderChartArea('sz-cb-clean-chart-area', 'sz-canvas-cb-clean', 'sz-tooltip-cb-clean', clean, _szCbCleanRef);

  // All Trades card KPI + chart
  _renderKPIBar('sz-cb-all-kpi', _bucketStats(filteredTrades));
  _renderChartArea('sz-cb-all-chart-area', 'sz-canvas-cb-all', 'sz-tooltip-cb-all', filteredTrades, _szCbAllRef);
}

// ─── Risk Budget full render ──────────────────────────────────────────────────
function _szRenderRiskBudgetMode(accountSize) {
  // Resolve baseline
  let baselineDate = _szBaselineDate;
  if (!baselineDate) {
    const allT = typeof trades !== 'undefined' ? trades : getFilteredTrades();
    baselineDate = allT.reduce((min, t) => (!min || t.date < min) ? t.date : min, '');
  }

  const equityMap      = _szBuildEquityMap(accountSize, baselineDate || '1970-01-01');
  const filteredTrades = getFilteredTrades();
  const { compliant, warning, violation, kpis, insights } =
    _szClassifyRiskBudget(filteredTrades, equityMap, _szRiskBudgetPct);

  // KPI bar
  _szRenderRiskBudgetKPIs('sz-rb-kpi-bar', kpis);

  // Insights
  _szRenderRiskBudgetInsights('sz-rb-insights', insights, kpis);

  // Charts
  _renderChartArea('sz-rb-compliant-area', 'sz-canvas-rb-comp', 'sz-tooltip-rb-comp', compliant,  _szRbCompliantRef);
  _renderChartArea('sz-rb-violation-area', 'sz-canvas-rb-viol', 'sz-tooltip-rb-viol', violation,  _szRbViolationRef);
  _renderChartArea('sz-rb-warning-area',   'sz-canvas-rb-warn', 'sz-tooltip-rb-warn', warning,    _szRbWarningRef);

  // Bucket KPI bars (reuse existing _renderKPIBar)
  _renderKPIBar('sz-rb-kpi-comp', _bucketStats(compliant));
  _renderKPIBar('sz-rb-kpi-viol', _bucketStats(violation));
  _renderKPIBar('sz-rb-kpi-warn', _bucketStats(warning));
}

// ─── Split and render with a given account size ───────────────────────────────
function _szRenderBuckets(accountSize) {
  // ── Resolve baseline date ─────────────────────────────────────────────────
  // If no baseline set, use the oldest trade date in the full dataset
  let baselineDate = _szBaselineDate;
  if (!baselineDate) {
    const allT = typeof trades !== 'undefined' ? trades : getFilteredTrades();
    baselineDate = allT.reduce((min, t) => (!min || t.date < min) ? t.date : min, '');
  }

  // ── Build equity map (dynamic per-trade account size) ─────────────────────
  const equityMap = _szBuildEquityMap(accountSize, baselineDate || '1970-01-01');

  // ── Update threshold badge (shows starting account for reference) ─────────
  const badge = document.getElementById('sz-threshold-display');
  if (badge) {
    badge.textContent = accountSize > 0
      ? '$' + accountSize.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : '—';
  }

  // ── Classify filtered trades using dynamic equity ─────────────────────────
  const filteredTrades = getFilteredTrades();
  const pctFraction    = _szExposurePct / 100;

  const goodTrades = filteredTrades.filter(t => {
    const equity = equityMap.get(String(t.id));
    if (!equity || equity <= 0) return true;   // unknown equity → generous default
    return _posSize(t) / equity <= pctFraction;
  });

  const overTrades = filteredTrades.filter(t => {
    const equity = equityMap.get(String(t.id));
    if (!equity || equity <= 0) return false;
    return _posSize(t) / equity > pctFraction;
  });

  _renderKPIBar('sz-kpi-good', _bucketStats(goodTrades));
  _renderKPIBar('sz-kpi-over', _bucketStats(overTrades));

  _renderChartArea(
    'sz-good-chart-area', 'sz-canvas-good', 'sz-tooltip-good',
    goodTrades, _szGoodRef
  );
  _renderChartArea(
    'sz-over-chart-area', 'sz-canvas-over', 'sz-tooltip-over',
    overTrades, _szOverRef
  );

  // All-trades reference chart
  _renderKPIBar('sz-kpi-all', _bucketStats(filteredTrades));
  _renderChartArea(
    'sz-all-chart-area', 'sz-canvas-all', 'sz-tooltip-all',
    filteredTrades, _szAllRef
  );
}

// ─── Exposure threshold handler ───────────────────────────────────────────────
window._szOnExposureChange = function(pct) {
  _szExposurePct = pct;
  try { localStorage.setItem('sz_exposure_pct', String(pct)); } catch(e) {}

  // Update badge text without full re-render
  const pctDisplay = document.getElementById('sz-threshold-pct-display');
  if (pctDisplay) pctDisplay.textContent = pct;

  // Update selector button active states
  document.querySelectorAll('.sz-exp-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === pct);
  });

  // Update card badges (≤ X% and > X%) immediately — no re-render needed
  const goodBadge = document.querySelector('.sz-card-badge.good');
  const overBadge = document.querySelector('.sz-card-badge.over');
  if (goodBadge) goodBadge.textContent = `≤ ${pct}%`;
  if (overBadge) overBadge.textContent = `> ${pct}%`;

  // Update definition notes immediately
  const defNotes = document.querySelectorAll('.sz-def-note');
  if (defNotes[0]) defNotes[0].textContent = `Position size = entry price × shares. Trades with exposure ≤ ${pct}% of account size.`;
  if (defNotes[1]) defNotes[1].textContent = `Trades with exposure > ${pct}% of account size — position too large relative to account.`;

  // Re-render buckets with new threshold
  if (_szLastAccountSize > 0) _szRenderBuckets(_szLastAccountSize);
};

// ─── Debounced input handler (attached via window for inline onclick) ─────────
let _szDebounceTimer = null;
window._szOnAccountChange = function(val) {
  clearTimeout(_szDebounceTimer);
  _szDebounceTimer = setTimeout(() => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) {
      _szLastAccountSize = n;
      try { localStorage.setItem('sz_account_size', String(n)); } catch(e) {}
      if (_szAnalysisMode === 'riskbudget') _szRenderRiskBudgetMode(n);
      else if (_szAnalysisMode === 'combined') _szRenderCombinedMode(n);
      else _szRenderBuckets(n);
    }
  }, 380);
};

// ─── Baseline date handler ────────────────────────────────────────────────────
window._szOnBaselineDateChange = function(val) {
  _szBaselineDate = val || '';
  try { localStorage.setItem('sz_baseline_date', _szBaselineDate); } catch(e) {}
  if (_szLastAccountSize > 0) {
    if (_szAnalysisMode === 'riskbudget') _szRenderRiskBudgetMode(_szLastAccountSize);
    else if (_szAnalysisMode === 'combined') _szRenderCombinedMode(_szLastAccountSize);
    else _szRenderBuckets(_szLastAccountSize);
  }
};
window._szOnAnalysisModeChange = function(mode) {
  _szAnalysisMode = mode;
  try { localStorage.setItem('sz_analysis_mode', mode); } catch(e) {}

  const expSection = document.getElementById('sz-exposure-section');
  const rbSection  = document.getElementById('sz-riskbudget-section');
  const cbSection  = document.getElementById('sz-combined-section');
  const subTitle   = document.getElementById('sz-sub-title');

  if (expSection) expSection.style.display = mode === 'exposure'   ? '' : 'none';
  if (rbSection)  rbSection.style.display  = mode === 'riskbudget' ? '' : 'none';
  if (cbSection)  cbSection.style.display  = mode === 'combined'   ? '' : 'none';
  if (subTitle) {
    subTitle.textContent = mode === 'riskbudget'
      ? 'Evaluate position sizes against your predefined risk budget'
      : mode === 'combined'
      ? 'Filter trades failing either exposure or risk budget — see what clean trading looks like'
      : 'Compare cumulative P&L of properly sized vs oversized trades';
  }

  // Update mode button active states
  document.querySelectorAll('.sz-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Sync right-panel FIRST so sz-cb-insights element exists before _szRenderCombinedMode
  _szSyncRightPanel(mode === 'combined');

  if (_szLastAccountSize > 0) {
    if (mode === 'riskbudget') _szRenderRiskBudgetMode(_szLastAccountSize);
    else if (mode === 'combined') _szRenderCombinedMode(_szLastAccountSize);
    else _szRenderBuckets(_szLastAccountSize);
  }
};

// ─── Risk Budget % selector handler ──────────────────────────────────────────
window._szOnRiskBudgetChange = function(pct) {
  _szRiskBudgetPct = pct;
  try { localStorage.setItem('sz_risk_budget_pct', String(pct)); } catch(e) {}

  document.querySelectorAll('.sz-rb-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.pct) === pct);
  });

  const badge = document.getElementById('sz-rb-pct-badge');
  if (badge) badge.textContent = pct + '%';

  if (_szLastAccountSize > 0) _szRenderRiskBudgetMode(_szLastAccountSize);
};

// ─── TABLE VIEW ───────────────────────────────────────────────────────────────

let _szViewMode    = 'charts';   // 'charts' | 'table'
// Multi-column sort: array of { col, dir } — primary first, secondary second, etc.
// Default: chronological order (date asc, then entryTime asc)
let _szTblSortCols = [{ col: 'date', dir: 1 }, { col: 'entryTime', dir: 1 }];
// Legacy aliases (unused after refactor)
let _szTblSortCol = null;
let _szTblSortDir = 1;

window._szOnViewChange = function(view) {
  _szViewMode = view;
  // Update buttons
  const cb = document.getElementById('sz-view-btn-charts');
  const tb = document.getElementById('sz-view-btn-table');
  if (cb) cb.classList.toggle('active', view === 'charts');
  if (tb) tb.classList.toggle('active', view === 'table');

  // Show/hide the right sections
  _szApplyViewVisibility();

  // Render table if switching to table and we have data
  if (view === 'table' && _szLastAccountSize > 0) {
    _szRenderTableView();
  }
};

function _szApplyViewVisibility() {
  const mode = _szAnalysisMode;
  const isTable = _szViewMode === 'table';

  // Charts sections
  const expSec = document.getElementById('sz-exposure-section');
  const rbSec  = document.getElementById('sz-riskbudget-section');
  const cbSec  = document.getElementById('sz-combined-section');
  // Table sections
  const tblExp = document.getElementById('sz-table-exposure');
  const tblRb  = document.getElementById('sz-table-riskbudget');
  const tblCb  = document.getElementById('sz-table-combined');

  if (expSec) expSec.style.display = (!isTable && mode === 'exposure')   ? '' : 'none';
  if (rbSec)  rbSec.style.display  = (!isTable && mode === 'riskbudget') ? '' : 'none';
  if (cbSec)  cbSec.style.display  = (!isTable && mode === 'combined')   ? '' : 'none';

  if (tblExp) tblExp.style.display = ( isTable && mode === 'exposure')   ? '' : 'none';
  if (tblRb)  tblRb.style.display  = ( isTable && mode === 'riskbudget') ? '' : 'none';
  if (tblCb)  tblCb.style.display  = ( isTable && mode === 'combined')   ? '' : 'none';
}

// ─── Build per-trade enriched row for any mode ────────────────────────────────
function _szEnrichTrade(t, equityMap, mode, streakMap, overtradingMap, maxLossMap) {
  const equity    = equityMap.get(String(t.id)) || 0;
  const posSize   = _posSize(t);
  const qty       = Math.abs(t.qty || 0);
  const entry     = t.entry || 0;
  const fees      = typeof calcCommission === 'function' ? calcCommission(t) : 0;
  const net       = (t.pnl || 0) - fees;
  const pnlPct    = (entry && qty) ? (net / (entry * qty)) * 100 : null; // net-based %, consistent with calendarPage.js
  const exposurePct = equity > 0 ? (posSize / equity) * 100 : null;

  let budgetStopDist = null, allowedRisk = null, riskPerShare = null;
  if (equity > 0 && qty > 0 && entry > 0) {
    allowedRisk    = equity * (_szRiskBudgetPct / 100);
    riskPerShare   = allowedRisk / qty;
    budgetStopDist = (riskPerShare / entry) * 100;
  }

  // Status per mode
  // equity <= 0 means we can't validate sizing — treat as violation/dirty
  const equityMissing = equity <= 0;
  let status = null, statusLabel = null;
  if (mode === 'exposure') {
    if (equityMissing) {
      status = 'over'; statusLabel = 'No Equity Data';
    } else {
      const isOver = (posSize / equity) > (_szExposurePct / 100);
      status      = isOver ? 'over' : 'clean';
      statusLabel = isOver ? `> ${_szExposurePct}%` : `≤ ${_szExposurePct}%`;
    }
  } else if (mode === 'riskbudget') {
    if (equityMissing || budgetStopDist === null) { status = 'violation'; statusLabel = 'No Equity Data'; }
    else if (budgetStopDist >= 2) { status = 'compliant'; statusLabel = 'Compliant'; }
    else if (budgetStopDist >= 1) { status = 'warning';   statusLabel = 'Warning'; }
    else                           { status = 'violation'; statusLabel = 'Violation'; }
  } else if (mode === 'combined') {
    // Use _szCbFilters for all 5 filters (consistent with _szClassifyCombined)
    const f = _szCbFilters;
    const reasons = [];

    // Filter 0: Price Range (immediate)
    if (f.priceRange.enabled && entry > 0) {
      const minP = f.priceRange.min !== '' ? parseFloat(f.priceRange.min) : null;
      const maxP = f.priceRange.max !== '' ? parseFloat(f.priceRange.max) : null;
      if ((minP !== null && entry < minP) || (maxP !== null && entry > maxP)) {
        reasons.push('priceRange');
      }
    }

    if (equityMissing) {
      reasons.push('noEquity');
    } else {
      // Filter 1: Exposure
      if (f.exposure.enabled && equity > 0) {
        if (posSize / equity > f.exposure.pct / 100) reasons.push('exposure');
      }
      // Filter 2: Risk Budget
      if (f.riskBudget.enabled && equity > 0 && qty > 0 && entry > 0) {
        const rbAllowed    = equity * (f.riskBudget.pct / 100);
        const rbPerShare   = rbAllowed / qty;
        const rbStopDist   = (rbPerShare / entry) * 100;
        if (rbStopDist < 1) reasons.push('riskBudget');
      }
      // Filter 3: Time of Day
      if (f.timeOfDay.enabled && t.entryTime && f.timeOfDay.blockedSlots.length > 0) {
        const parts = t.entryTime.split(':');
        const eMin  = parseInt(parts[0] || '0') * 60 + parseInt(parts[1] || '0');
        const inBlocked = _SZ_TIME_SLOTS.some(slot =>
          f.timeOfDay.blockedSlots.includes(slot.key) &&
          eMin >= slot.startH * 60 + slot.startM &&
          eMin <= slot.endH   * 60 + slot.endM
        );
        if (inBlocked) reasons.push('timeOfDay');
      }
      // Filter 4: Revenge Trading
      if (f.revengeTrade.enabled && streakMap) {
        if (streakMap.get(String(t.id)) === true) reasons.push('revengeTrade');
      }
      // Filter 5: Overtrading
      if (f.overtrading.enabled && overtradingMap) {
        const otStatus = overtradingMap.get(String(t.id));
        if (otStatus === 'breach' ||
           (otStatus === 'preceding' && f.overtrading.includePreceding)) {
          reasons.push('overtrading');
        }
      }
      // Filter 6: Max Daily Loss
      if (f.maxLoss.enabled && maxLossMap) {
        if (maxLossMap.get(String(t.id)) === true) reasons.push('maxLoss');
      }
    }

    if (reasons.length === 0) {
      status = 'clean'; statusLabel = 'Clean';
    } else if (reasons.includes('noEquity')) {
      status = 'dirty'; statusLabel = 'No Equity Data';
    } else {
      status = 'dirty';
      const labelMap = { exposure: 'Exposure', riskBudget: 'Risk Budget',
                         timeOfDay: 'Time of Day', revengeTrade: 'Revenge Trade',
                         overtrading: 'Overtrading', maxLoss: 'Max Loss', priceRange: 'Price Range' };
      statusLabel = reasons.length > 1
        ? 'Multi'
        : (labelMap[reasons[0]] || reasons[0]);
    }
  }

  return { t, equity, posSize, fees, net, pnlPct, exposurePct,
           budgetStopDist, allowedRisk, riskPerShare, status, statusLabel };
}

// ─── Build one HTML table of enriched rows ────────────────────────────────────
function _szBuildTable(rows, mode, containerId) {
  if (!rows.length) {
    return `<div class="sz-empty">No trades in this bucket</div>`;
  }

  // Column definitions per mode
  const baseCols = [
    { id: 'num',       label: '#',          td: (r,i) => `<td class="td-dim td-num">${i+1}</td>` },
    { id: 'date',      label: 'Date',       td: r => `<td class="td-dim">${r.t.date || '—'}</td>` },
    { id: 'sym',       label: 'Symbol',     td: r => `<td class="td-sym">${r.t.sym || '—'}</td>` },
    { id: 'entryTime', label: 'Entry Time', td: r => `<td class="td-dim">${r.t.entryTime || '—'}</td>` },
    { id: 'exitTime',  label: 'Exit Time',  td: r => `<td class="td-dim">${r.t.exitTime  || '—'}</td>` },
    { id: 'duration',  label: 'Duration',   td: r => `<td class="td-dim">${r.t.duration  || '—'}</td>` },
    { id: 'entry',     label: 'Entry $',    td: r => `<td class="td-num">${r.t.entry ? '$'+Number(r.t.entry).toFixed(2) : '—'}</td>` },
    { id: 'exit',      label: 'Exit $',     td: r => `<td class="td-num">${r.t.exit  ? '$'+Number(r.t.exit).toFixed(2)  : '—'}</td>` },
    { id: 'qty',       label: 'Qty',        td: r => `<td class="td-num">${r.t.qty ? r.t.qty.toLocaleString() : '—'}</td>` },
    { id: 'posSize',   label: 'Pos Size $', td: r => `<td class="td-num">${r.posSize ? '$'+Math.round(r.posSize).toLocaleString('en-US') : '—'}</td>` },
    { id: 'equity',    label: 'Equity $ (Net)',   td: r => `<td class="td-num td-dim">${r.equity ? '$'+Math.round(r.equity).toLocaleString('en-US') : '—'}</td>` },
    { id: 'pnl',       label: 'P&L Gross',  td: r => { const v = r.t.pnl||0; const c = v>0?'td-pos':v<0?'td-neg':''; const s = v>=0?'+':'-'; return `<td class="td-num ${c}">${s}$${Math.abs(v).toFixed(2)}</td>`; } },
    { id: 'net',       label: 'P&L Net',    td: r => { const v = r.net; const c = v>0?'td-pos':v<0?'td-neg':''; const s = v>=0?'+':'-'; return `<td class="td-num ${c}">${s}$${Math.abs(v).toFixed(2)}</td>`; } },
    { id: 'pnlPct',    label: 'P&L % (Net)',      td: r => { if (r.pnlPct===null) return '<td class="td-dim">—</td>'; const c = r.pnlPct>=0?'td-pos':'td-neg'; return `<td class="td-num ${c}">${r.pnlPct>=0?'+':''}${r.pnlPct.toFixed(2)}%</td>`; } },
  ];

  const exposureCols = [
    { id: 'expPct',  label: 'Exposure %', td: r => { if (r.exposurePct===null) return '<td class="td-dim">—</td>'; const over = r.exposurePct > _szExposurePct; const c = over ? 'td-neg' : 'td-pos'; return `<td class="td-num ${c}">${r.exposurePct.toFixed(1)}%</td>`; } },
  ];

  const rbCols = [
    { id: 'allowedRisk',    label: 'Allowed Risk $',   td: r => `<td class="td-num td-dim">${r.allowedRisk !== null ? '$'+Math.round(r.allowedRisk).toLocaleString() : '—'}</td>` },
    { id: 'riskPerShare',   label: 'Risk/Share $',     td: r => `<td class="td-num td-dim">${r.riskPerShare !== null ? '$'+r.riskPerShare.toFixed(2) : '—'}</td>` },
    { id: 'budgetStopDist', label: 'Stop Dist %',      td: r => { if (r.budgetStopDist===null) return '<td class="td-dim">—</td>'; const c = r.budgetStopDist>=2?'td-pos':r.budgetStopDist>=1?'td-amber':'td-neg'; return `<td class="td-num ${c}">${r.budgetStopDist.toFixed(2)}%</td>`; } },
  ];

  const combinedCols = [
    { id: 'expPct',         label: 'Exposure %',  td: r => { if (r.exposurePct===null) return '<td class="td-dim">—</td>'; const over = r.exposurePct > _szExposurePct; const c = over ? 'td-neg' : 'td-pos'; return `<td class="td-num ${c}">${r.exposurePct.toFixed(1)}%</td>`; } },
    { id: 'budgetStopDist', label: 'Stop Dist %', td: r => { if (r.budgetStopDist===null) return '<td class="td-dim">—</td>'; const c = r.budgetStopDist>=2?'td-pos':r.budgetStopDist>=1?'td-amber':'td-neg'; return `<td class="td-num ${c}">${r.budgetStopDist.toFixed(2)}%</td>`; } },
  ];

  const statusCol = {
    id: 'status', label: 'Status',
    td: r => `<td><span class="sz-status-badge ${r.status}">${r.statusLabel}</span></td>`
  };

  let cols = [...baseCols];
  if (mode === 'exposure')   cols = [...baseCols, ...exposureCols, statusCol];
  if (mode === 'riskbudget') cols = [...baseCols, ...rbCols, statusCol];
  if (mode === 'combined')   cols = [...baseCols, ...combinedCols, statusCol];

  // ── Multi-column sort ──────────────────────────────────────────────────────
  const _getSortVal = (r, id) => {
    if (id === 'date')           return r.t.date || '';
    if (id === 'sym')            return r.t.sym  || '';
    if (id === 'dir')            return r.t.dir  || '';
    if (id === 'entry')          return r.t.entry || 0;
    if (id === 'exit')           return r.t.exit  || 0;
    if (id === 'qty')            return r.t.qty   || 0;
    if (id === 'pnl')            return r.t.pnl   || 0;
    if (id === 'net')            return r.net;
    if (id === 'pnlPct')         return r.pnlPct  || 0;
    if (id === 'posSize')        return r.posSize;
    if (id === 'equity')         return r.equity;
    if (id === 'expPct')         return r.exposurePct || 0;
    if (id === 'budgetStopDist') return r.budgetStopDist || 0;
    if (id === 'allowedRisk')    return r.allowedRisk || 0;
    if (id === 'status')         return r.statusLabel || '';
    if (id === 'entryTime')      return r.t.entryTime || '';
    if (id === 'exitTime')       return r.t.exitTime  || '';
    return 0;
  };

  if (_szTblSortCols.length > 0) {
    rows = [...rows].sort((a, b) => {
      for (const { col, dir } of _szTblSortCols) {
        const va = _getSortVal(a, col);
        const vb = _getSortVal(b, col);
        if (va < vb) return -dir;
        if (va > vb) return  dir;
      }
      return 0;
    });
  }

  const thHtml = cols.map(c => {
    const sortIdx = _szTblSortCols.findIndex(s => s.col === c.id);
    const isSorted = sortIdx >= 0;
    const dir    = isSorted ? _szTblSortCols[sortIdx].dir : 0;
    const arrow  = isSorted ? (dir === 1 ? ' ↑' : ' ↓') : '';
    // Show sort priority number when more than one sort column active
    const badge  = isSorted && _szTblSortCols.length > 1
      ? `<span style="font-size:9px;opacity:.6;margin-left:1px">${sortIdx+1}</span>` : '';
    return `<th class="${isSorted ? 'sorted' : ''}" title="Shift+click to add secondary sort" onclick="window._szTblSort('${containerId}','${c.id}',event.shiftKey)">${c.label}${badge}<span class="sort-arrow">${arrow}</span></th>`;
  }).join('');

  const tbodyHtml = rows.map((r, i) =>
    `<tr>${cols.map(c => c.td(r, i)).join('')}</tr>`
  ).join('');

  return `
    <div class="sz-table-wrap">
      <table class="sz-tbl">
        <thead><tr>${thHtml}</tr></thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

// ─── Sort handler (multi-column, Shift+click to add secondary sort) ──────────
window._szTblSort = function(containerId, colId, shiftKey) {
  const existing = _szTblSortCols.findIndex(s => s.col === colId);
  if (shiftKey) {
    // Shift+click: toggle dir if already in list, else add as secondary
    if (existing >= 0) {
      _szTblSortCols = _szTblSortCols.map((s, i) =>
        i === existing ? { col: s.col, dir: -s.dir } : s
      );
    } else {
      _szTblSortCols = [..._szTblSortCols, { col: colId, dir: 1 }];
    }
  } else {
    // Normal click: set as sole primary, toggle dir if already primary
    if (_szTblSortCols.length === 1 && _szTblSortCols[0].col === colId) {
      _szTblSortCols = [{ col: colId, dir: -_szTblSortCols[0].dir }];
    } else {
      _szTblSortCols = [{ col: colId, dir: 1 }];
    }
  }
  _szRenderTableView();
};

// ─── Summary KPI bar for table view ──────────────────────────────────────────
function _szTblSummaryBar(filteredTrades, equityMap) {
  const first  = filteredTrades.length
    ? equityMap.get(String([...filteredTrades].sort((a,b)=>a.date.localeCompare(b.date))[0].id)) || 0
    : 0;
  const total  = filteredTrades.length;
  const pnl    = filteredTrades.reduce((s, t) => s + (t.pnl||0) - (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0); // net
  const wins   = filteredTrades.filter(t => t.pnl > 0).length;
  const wr     = total ? Math.round(wins / total * 100) : 0;
  const avg    = total ? pnl / total : 0;
  const fmt    = v => (v >= 0 ? '+' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const fmtAcct= v => '$' + Math.round(v).toLocaleString('en-US');
  const pnlCls = pnl >= 0 ? 'td-pos' : 'td-neg';

  // count clean/dirty per mode
  let extraKPIs = '';
  if (_szAnalysisMode === 'exposure') {
    const nOver  = filteredTrades.filter(t => { const eq = equityMap.get(String(t.id))||0; return eq>0 && _posSize(t)/eq > _szExposurePct/100; }).length;
    const nClean = total - nOver;
    extraKPIs = `
      <div class="sz-kpi"><div class="sz-kpi-label">Properly Sized</div><div class="sz-kpi-val td-pos">${nClean}</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Oversized</div><div class="sz-kpi-val ${nOver>0?'td-neg':'td-pos'}">${nOver}</div></div>`;
  } else if (_szAnalysisMode === 'riskbudget') {
    const nViol = filteredTrades.filter(t => {
      const eq = equityMap.get(String(t.id))||0;
      const qty = Math.abs(t.qty||0), entry = t.entry||0;
      if (!eq||!qty||!entry) return false;
      return (eq * (_szRiskBudgetPct/100) / qty / entry * 100) < 1;
    }).length;
    extraKPIs = `
      <div class="sz-kpi"><div class="sz-kpi-label">Compliant</div><div class="sz-kpi-val td-pos">${total - nViol}</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Violations</div><div class="sz-kpi-val ${nViol>0?'td-neg':'td-pos'}">${nViol}</div></div>`;
  } else if (_szAnalysisMode === 'combined') {
    // Use _szClassifyCombined to count clean/dirty — consistent with charts view and all 5 filters
    const { kpis: cbKpis } = _szClassifyCombined(filteredTrades, equityMap, _szCbFilters);
    const nDirty = cbKpis.nDirty;
    extraKPIs = `
      <div class="sz-kpi"><div class="sz-kpi-label">Clean Trades</div><div class="sz-kpi-val td-pos">${cbKpis.nClean}</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Filtered Out</div><div class="sz-kpi-val ${nDirty>0?'td-neg':'td-pos'}">${nDirty}</div></div>`;
  }

  return `
    <div class="sz-tbl-summary">
      <div class="sz-kpi"><div class="sz-kpi-label">Starting Equity</div><div class="sz-kpi-val td-neu">${first ? fmtAcct(first) : '—'}</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Total Trades</div><div class="sz-kpi-val td-neu">${total}</div></div>
      ${extraKPIs}
      <div class="sz-kpi"><div class="sz-kpi-label">Total P&amp;L (Net)</div><div class="sz-kpi-val ${pnlCls}">${fmt(pnl)}</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Win Rate</div><div class="sz-kpi-val ${wr>=50?'td-pos':'td-neg'}">${wr}%</div></div>
      <div class="sz-kpi"><div class="sz-kpi-label">Avg / Trade (Net)</div><div class="sz-kpi-val ${avg>=0?'td-pos':'td-neg'}">${fmt(avg)}</div></div>
    </div>`;
}

// ─── Main table render dispatcher ────────────────────────────────────────────
function _szRenderTableView() {
  const mode = _szAnalysisMode;
  const containerId = `sz-table-${mode}`;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!_szLastAccountSize) {
    el.innerHTML = '<div class="sz-empty">Enter account size to analyse</div>';
    return;
  }

  let baselineDate = _szBaselineDate;
  if (!baselineDate) {
    const allT = typeof trades !== 'undefined' ? trades : getFilteredTrades();
    baselineDate = allT.reduce((min, t) => (!min || t.date < min) ? t.date : min, '');
  }
  const equityMap      = _szBuildEquityMap(_szLastAccountSize, baselineDate || '1970-01-01');
  const filteredTrades = getFilteredTrades();

  // Enrich all trades — for combined mode, also build pre-processing maps for filters 4+5
  let _enrichStreakMap = null, _enrichOvertradingMap = null, _enrichMaxLossMap = null;
  if (mode === 'combined') {
    const sorted = [...filteredTrades].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : (a.entryTime || '').localeCompare(b.entryTime || '');
    });
    _enrichStreakMap      = _szBuildStreakMap(sorted, _szCbFilters.revengeTrade.maxLossStreak);
    _enrichOvertradingMap = _szBuildOvertradingMap(sorted, _szCbFilters.overtrading.maxTradesPerDay);
    if (_szCbFilters.maxLoss.enabled && parseFloat(_szCbFilters.maxLoss.value) > 0) {
      _enrichMaxLossMap = _szBuildMaxLossMap(sorted, parseFloat(_szCbFilters.maxLoss.value));
    }
  }
  const enriched = filteredTrades.map(t => _szEnrichTrade(t, equityMap, mode, _enrichStreakMap, _enrichOvertradingMap, _enrichMaxLossMap));

  // Split into buckets
  let bucketA, bucketB, labelA, labelB, badgeClassA, badgeClassB;

  if (mode === 'exposure') {
    bucketA = enriched.filter(r => r.status === 'clean');
    bucketB = enriched.filter(r => r.status === 'over');
    labelA  = 'Properly Sized Trades';
    labelB  = 'Oversized Trades';
    badgeClassA = 'clean'; badgeClassB = 'over';
  } else if (mode === 'riskbudget') {
    bucketA = enriched.filter(r => r.status === 'compliant');
    bucketB = enriched.filter(r => r.status === 'violation' || r.status === 'warning');
    labelA  = 'Risk Compliant Trades';
    labelB  = 'Warning & Violation Trades';
    badgeClassA = 'compliant'; badgeClassB = 'violation';
  } else {
    // For combined mode: use _szClassifyCombined to get accurate clean/dirty sets
    // that include all 5 filters (Revenge Trading and Overtrading need pre-processing
    // over all trades, which _szClassifyCombined handles but _szEnrichTrade cannot).
    const { clean: cbClean, dirty: cbDirty } = _szClassifyCombined(filteredTrades, equityMap, _szCbFilters);
    const cbCleanIds = new Set(cbClean.map(t => String(t.id)));
    // Re-enrich with correct status derived from _szClassifyCombined result
    bucketA = enriched
      .filter(r => cbCleanIds.has(String(r.t.id)))
      .map(r => ({ ...r, status: 'clean', statusLabel: 'Clean' }));
    bucketB = enriched
      .filter(r => !cbCleanIds.has(String(r.t.id)))
      .map(r => {
        // Build the status label from the dirty entry's reasons
        const dirtyEntry = cbDirty.find(d => String(d.trade.id) === String(r.t.id));
        const reasons = dirtyEntry ? dirtyEntry.reasons : [];
        const labelMap = { exposure: 'Exposure', riskBudget: 'Risk Budget',
                           timeOfDay: 'Time of Day', revengeTrade: 'Revenge Trade',
                           overtrading: 'Overtrading', maxLoss: 'Max Loss', priceRange: 'Price Range' };
        const statusLabel = reasons.length === 0 ? 'Dirty'
          : reasons.length > 1 ? 'Multi'
          : (labelMap[reasons[0]] || reasons[0]);
        return { ...r, status: 'dirty', statusLabel };
      });
    const anyActive = Object.values(_szCbFilters).some(f => f.enabled);
    labelA  = anyActive ? 'Clean Trades' : 'All Trades';
    labelB  = 'Filtered-Out Trades';
    badgeClassA = anyActive ? 'clean' : 'cb-no-filters'; badgeClassB = 'dirty';
  }

  el.innerHTML =
    _szTblSummaryBar(filteredTrades, equityMap) +
    `<div class="sz-tbl-section-title">
      <span>${labelA}</span>
      <span class="sz-tbl-count">${bucketA.length} trades</span>
      <span class="sz-status-badge ${badgeClassA}" style="font-size:10px">${badgeClassA === 'compliant' ? 'Compliant' : badgeClassA === 'cb-no-filters' ? '— No Filters' : badgeClassA.charAt(0).toUpperCase()+badgeClassA.slice(1)}</span>
    </div>` +
    _szBuildTable(bucketA, mode, containerId + '_a') +
    `<div class="sz-tbl-section-title" style="margin-top:1.5rem">
      <span>${labelB}</span>
      <span class="sz-tbl-count">${bucketB.length} trades</span>
      <span class="sz-status-badge ${badgeClassB}" style="font-size:10px">${badgeClassB === 'violation' ? 'Non-Compliant' : badgeClassB.charAt(0).toUpperCase()+badgeClassB.slice(1)}</span>
    </div>` +
    _szBuildTable(bucketB, mode, containerId + '_b');
}

// ─── Build HTML for the right-panel (Insights + Filter Settings) ─────────────
// Called by _szSyncRightPanel() to inject into #right-panel-sizing-cb
function _szBuildRightPanelHTML() {
  const f = _szCbFilters;
  return `
    <!-- Account Settings card -->
    <div class="sz-panel-card" id="sz-panel-account">
      <div class="sz-panel-card__header" onclick="window._szTogglePanelCard('sz-panel-account')">
        <span>🏦 Account Settings</span>
        <span class="sz-panel-card__chevron">▾</span>
      </div>
      <div class="sz-panel-card__body">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label class="sz-cbf-opt-label" for="sz-acct-input" style="display:block;margin-bottom:4px">Starting Account</label>
            <input
              id="sz-acct-input"
              class="sz-acct-input"
              type="number"
              min="0"
              step="1000"
              placeholder="e.g. 10000"
              value="${_szLastAccountSize > 0 ? _szLastAccountSize : ''}"
              oninput="window._szOnAccountChange(this.value)"
              style="width:100%"
            />
          </div>
          <div>
            <label class="sz-cbf-opt-label" for="sz-baseline-input" style="display:block;margin-bottom:4px">Equity Baseline Date</label>
            <input
              id="sz-baseline-input"
              class="sz-baseline-input"
              type="date"
              value="${_szBaselineDate || ''}"
              oninput="window._szOnBaselineDateChange(this.value)"
              style="width:100%"
            />
            ${!_szBaselineDate ? '<div style="font-size:10px;color:var(--amber);margin-top:3px;font-weight:600">Using oldest trade date</div>' : ''}
          </div>
          <div style="font-size:10px;color:var(--text3);line-height:1.5">📐 Equity reconstructed chronologically — each trade uses equity <em>at the time it was taken</em>.</div>
        </div>
      </div>
    </div>

    <!-- Insights card -->
    <div class="sz-panel-card" id="sz-panel-insights">
      <div class="sz-panel-card__header" onclick="window._szTogglePanelCard('sz-panel-insights')">
        <span>📊 Insights</span>
        <span class="sz-panel-card__chevron">▾</span>
      </div>
      <div class="sz-panel-card__body">
        <div id="sz-cb-insights">
          <span style="font-size:12px;color:var(--text3)">Enter account size to analyse</span>
        </div>
      </div>
    </div>

    <!-- Filter Settings panel -->
    <div class="sz-panel-card" id="sz-panel-filters">
      <div class="sz-panel-card__header" onclick="window._szTogglePanelCard('sz-panel-filters')">
        <span>⚙️ Filter Settings</span>
        <span class="sz-panel-card__chevron">▾</span>
      </div>
      <div class="sz-panel-card__body" style="padding-top:0">

        <!-- Filter 1: Exposure Limit -->
        <div class="sz-cb-filter-row" id="sz-cbf-exposure">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-exp-check"
                   ${f.exposure.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('exposure', this.checked)" />
            <span>Exposure Limit</span>
          </label>
          <div class="sz-cbf-options${f.exposure.enabled ? ' visible' : ''}" id="sz-cbf-exp-opts">
            <span class="sz-cbf-opt-label">Max exposure % of account</span>
            <div class="sz-cbf-opt-btns">
              ${[25, 50, 75, 100].map(p => `
                <button class="sz-cbf-opt-btn${f.exposure.pct === p ? ' active' : ''}"
                        onclick="window._szCbSetOpt('exposure','pct',${p})">${p}%</button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Filter 2: Risk Budget -->
        <div class="sz-cb-filter-row" id="sz-cbf-riskbudget">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-rb-check"
                   ${f.riskBudget.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('riskBudget', this.checked)" />
            <span>Risk Budget</span>
          </label>
          <div class="sz-cbf-options${f.riskBudget.enabled ? ' visible' : ''}" id="sz-cbf-rb-opts">
            <span class="sz-cbf-opt-label">Risk budget % of equity</span>
            <div class="sz-cbf-opt-btns">
              ${[0.5, 1, 2, 3, 5].map(p => `
                <button class="sz-cbf-opt-btn${f.riskBudget.pct === p ? ' active' : ''}"
                        data-rb-pct="${p}"
                        onclick="window._szCbSetOpt('riskBudget','pct',${p})">${p}%</button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Filter 3: Time of Day -->
        <div class="sz-cb-filter-row" id="sz-cbf-timeofday">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-tod-check"
                   ${f.timeOfDay.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('timeOfDay', this.checked)" />
            <span>Time of Day</span>
          </label>
          <div class="sz-cbf-options${f.timeOfDay.enabled ? ' visible' : ''}" id="sz-cbf-tod-opts">
            <span class="sz-cbf-opt-label">Block trades in these sessions</span>
            <div class="sz-cbf-slot-list">
              ${_SZ_TIME_SLOTS.map(slot => `
                <label class="sz-cbf-inline-check">
                  <input type="checkbox"
                         ${f.timeOfDay.blockedSlots.includes(slot.key) ? 'checked' : ''}
                         onchange="window._szCbToggleTimeSlot('${slot.key}', this.checked)" />
                  <span>${slot.label}</span>
                </label>
              `).join('')}
            </div>
            <div class="sz-cbf-hint">⚠ Trades whose entry time falls in a checked session are flagged. No sessions checked = filter inactive.</div>
          </div>
        </div>

        <!-- Filter 3b: Max Daily Loss -->
        <div class="sz-cb-filter-row" id="sz-cbf-maxloss">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-ml-check"
                   ${f.maxLoss.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('maxLoss', this.checked)" />
            <span>Max Daily Loss</span>
          </label>
          <div class="sz-cbf-options${f.maxLoss.enabled ? ' visible' : ''}" id="sz-cbf-ml-opts">
            <span class="sz-cbf-opt-label">Max loss per day ($)</span>
            <input type="number" class="sz-cbf-dollar-input" id="sz-cbf-ml-value"
                   min="0" step="any" placeholder="e.g. 500"
                   value="${f.maxLoss.value}"
                   oninput="window._szCbSetOpt('maxLoss','value',this.value)" />
            <div class="sz-cbf-hint">⚠ Once cumulative daily P&L drops to or below this loss, all remaining trades that day are flagged.</div>
          </div>
        </div>

        <!-- Filter 4: Revenge Trading -->
        <div class="sz-cb-filter-row" id="sz-cbf-revenge">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-rev-check"
                   ${f.revengeTrade.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('revengeTrade', this.checked)" />
            <span>Revenge Trading</span>
          </label>
          <div class="sz-cbf-options${f.revengeTrade.enabled ? ' visible' : ''}" id="sz-cbf-rev-opts">
            <span class="sz-cbf-opt-label">Max consecutive losses before blocking</span>
            <div class="sz-cbf-opt-btns">
              ${[1, 2, 3, 4].map(n => `
                <button class="sz-cbf-opt-btn${f.revengeTrade.maxLossStreak === n ? ' active' : ''}"
                        onclick="window._szCbSetOpt('revengeTrade','maxLossStreak',${n})">${n}</button>
              `).join('')}
            </div>
            <div class="sz-cbf-hint">⚠ After N consecutive losses in a day, all remaining trades that day are flagged — no intra-day reset.</div>
          </div>
        </div>

        <!-- Filter 5: Overtrading -->
        <div class="sz-cb-filter-row" id="sz-cbf-overtrading">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-ot-check"
                   ${f.overtrading.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('overtrading', this.checked)" />
            <span>Overtrading</span>
          </label>
          <div class="sz-cbf-options${f.overtrading.enabled ? ' visible' : ''}" id="sz-cbf-ot-opts">
            <span class="sz-cbf-opt-label">Max trades per day</span>
            <div class="sz-cbf-opt-btns">
              ${[2, 3, 5, 7, 10].map(n => `
                <button class="sz-cbf-opt-btn${f.overtrading.maxTradesPerDay === n ? ' active' : ''}"
                        onclick="window._szCbSetOpt('overtrading','maxTradesPerDay',${n})">${n}</button>
              `).join('')}
            </div>
            <label class="sz-cbf-inline-check">
              <input type="checkbox"
                     ${f.overtrading.includePreceding ? 'checked' : ''}
                     onchange="window._szCbSetOpt('overtrading','includePreceding',this.checked)" />
              <span>Include preceding trades</span>
            </label>
            <div class="sz-cbf-hint">⚠ ${f.overtrading.includePreceding
              ? 'All trades on an overtrading day are flagged — including the first ones.'
              : 'Only trades beyond the limit are flagged. Earlier trades on that day stay clean.'
            }</div>
          </div>
        </div>

        <!-- Filter 6: Price Range -->
        <div class="sz-cb-filter-row" id="sz-cbf-pricerange">
          <label class="sz-cbf-label">
            <input type="checkbox" id="sz-cbf-pr-check"
                   ${f.priceRange.enabled ? 'checked' : ''}
                   onchange="window._szCbToggleFilter('priceRange', this.checked)" />
            <span>Price Range</span>
          </label>
          <div class="sz-cbf-options${f.priceRange.enabled ? ' visible' : ''}" id="sz-cbf-pr-opts">
            <span class="sz-cbf-opt-label">Entry price range ($)</span>
            <div class="sz-cbf-price-row">
              <input type="number" min="0" step="any" placeholder="Min"
                     value="${f.priceRange.min}"
                     oninput="window._szCbSetOpt('priceRange','min',this.value)" />
              <span>–</span>
              <input type="number" min="0" step="any" placeholder="Max"
                     value="${f.priceRange.max}"
                     oninput="window._szCbSetOpt('priceRange','max',this.value)" />
            </div>
            <div class="sz-cbf-hint">⚠ Trades with entry price outside this range are flagged. Leave a field empty for no limit on that side.</div>
          </div>
        </div>

      </div><!-- /sz-panel-card__body -->
    </div><!-- /sz-panel-filters -->
  `;
}

// ─── Inject / refresh the right-panel for Combined Filter mode ───────────────
// Shows the right-panel-sizing-cb slot and populates it.
// Also toggles the rp-toggle-btn visibility (laptop drawer trigger).
function _szSyncRightPanel(show) {
  const rpSlot   = document.getElementById('right-panel-sizing-cb');
  const rpToggle = document.getElementById('rp-toggle-btn');

  if (!show) {
    if (rpSlot)   rpSlot.style.display = 'none';
    // Only hide toggle if it wasn't already shown by another page
    return;
  }

  if (!rpSlot) return;

  rpSlot.style.display = 'block';
  rpSlot.innerHTML = _szBuildRightPanelHTML();
  _szApplyPanelCollapseState();

  // Show the rp-toggle-btn (visible on ≤1440px screens only via CSS)
  if (rpToggle) rpToggle.style.display = '';
}
window._szSyncRightPanel = _szSyncRightPanel;

// ─── Combined Filter checkbox toggle ─────────────────────────────────────────
// ─── Collapsible panel cards ──────────────────────────────────────────────────
window._szTogglePanelCard = function(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const collapsed = card.classList.toggle('collapsed');
  try {
    const saved = JSON.parse(localStorage.getItem('sz_panel_collapsed') || '{}');
    saved[cardId] = collapsed;
    localStorage.setItem('sz_panel_collapsed', JSON.stringify(saved));
  } catch(e) {}
};

function _szApplyPanelCollapseState() {
  try {
    const saved = JSON.parse(localStorage.getItem('sz_panel_collapsed') || '{}');
    Object.entries(saved).forEach(([id, collapsed]) => {
      const card = document.getElementById(id);
      if (card) card.classList.toggle('collapsed', collapsed);
    });
  } catch(e) {}
}

window._szCbToggleFilter = function(filterKey, enabled) {
  _szCbFilters[filterKey].enabled = enabled;
  try { localStorage.setItem('sz_cb_filters', JSON.stringify(_szCbFilters)); } catch(e) {}

  // Show/hide options panel
  const optMap = {
    exposure:     'sz-cbf-exp-opts',
    riskBudget:   'sz-cbf-rb-opts',
    timeOfDay:    'sz-cbf-tod-opts',
    revengeTrade: 'sz-cbf-rev-opts',
    overtrading:  'sz-cbf-ot-opts',
    maxLoss:      'sz-cbf-ml-opts',
    priceRange:   'sz-cbf-pr-opts',
  };
  const optsEl = document.getElementById(optMap[filterKey]);
  if (optsEl) {
    optsEl.classList.toggle('visible', enabled);

    // Re-stamp active state on all button groups when panel becomes visible
    if (enabled) {
      const filterState = _szCbFilters[filterKey];
      optsEl.querySelectorAll('.sz-cbf-opt-btn').forEach(btn => {
        const btnVal = parseFloat(btn.textContent) || parseInt(btn.textContent) || btn.textContent.trim();
        Object.values(filterState).forEach(stateVal => {
          const cmpVal = typeof stateVal === 'string' ? stateVal : (Number.isInteger(stateVal) ? stateVal : parseFloat(stateVal));
          if (btnVal === cmpVal || String(btnVal) === String(cmpVal)) {
            btn.classList.add('active');
          }
        });
      });

      // Re-stamp includePreceding hint for overtrading
      if (filterKey === 'overtrading') {
        const hintEl = optsEl.querySelector('.sz-cbf-hint');
        if (hintEl) {
          hintEl.textContent = filterState.includePreceding
            ? '⚠ All trades on an overtrading day are flagged — including the first ones.'
            : '⚠ Only trades beyond the limit are flagged. Earlier trades on that day stay clean.';
        }
        const cb = optsEl.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !!filterState.includePreceding;
      }

      // Re-stamp timeOfDay slot checkboxes
      if (filterKey === 'timeOfDay') {
        optsEl.querySelectorAll('.sz-cbf-slot-list input[type="checkbox"]').forEach(cb => {
          cb.checked = filterState.blockedSlots.includes(cb.closest('label').querySelector('span') &&
            _SZ_TIME_SLOTS.find(s => s.label === cb.closest('label').querySelector('span').textContent.trim())?.key);
        });
        // More reliable: match by onchange attribute slot key
        optsEl.querySelectorAll('input[type="checkbox"][onchange*="_szCbToggleTimeSlot"]').forEach(cb => {
          const match = cb.getAttribute('onchange').match(/'([^']+)'/);
          if (match) cb.checked = filterState.blockedSlots.includes(match[1]);
        });
      }

      // Re-stamp maxLoss input value
      if (filterKey === 'maxLoss') {
        const inp = optsEl.querySelector('input[type="number"]');
        if (inp) inp.value = filterState.value || '';
      }

      // Re-stamp priceRange inputs
      if (filterKey === 'priceRange') {
        const [minInp, maxInp] = optsEl.querySelectorAll('input[type="number"]');
        if (minInp) minInp.value = filterState.min || '';
        if (maxInp) maxInp.value = filterState.max || '';
      }
    }
  }

  if (_szLastAccountSize > 0) {
    _szRenderCombinedMode(_szLastAccountSize);
    if (_szViewMode === 'table') _szRenderTableView();
  }
};

// ─── Combined Filter option setter ───────────────────────────────────────────
window._szCbSetOpt = function(filterKey, optKey, value) {
  _szCbFilters[filterKey][optKey] = value;
  try { localStorage.setItem('sz_cb_filters', JSON.stringify(_szCbFilters)); } catch(e) {}

  // Update active button state in the options panel
  const optMap = {
    exposure:     'sz-cbf-exp-opts',
    riskBudget:   'sz-cbf-rb-opts',
    timeOfDay:    'sz-cbf-tod-opts',
    revengeTrade: 'sz-cbf-rev-opts',
    overtrading:  'sz-cbf-ot-opts',
    maxLoss:      'sz-cbf-ml-opts',
    priceRange:   'sz-cbf-pr-opts',
  };
  const optsEl = document.getElementById(optMap[filterKey]);
  if (optsEl) {
    // For button groups: mark active by matching data or text value
    optsEl.querySelectorAll('.sz-cbf-opt-btn').forEach(btn => {
      const btnVal = parseFloat(btn.textContent) || parseInt(btn.textContent) || btn.textContent.trim();
      const cmpVal = typeof value === 'string' ? value : (Number.isInteger(value) ? value : parseFloat(value));
      btn.classList.toggle('active', btnVal === cmpVal || String(btnVal) === String(cmpVal));
    });

    // Update overtrading hint text when includePreceding changes
    if (filterKey === 'overtrading' && optKey === 'includePreceding') {
      const hintEl = optsEl.querySelector('.sz-cbf-hint');
      if (hintEl) {
        hintEl.textContent = value
          ? '⚠ All trades on an overtrading day are flagged — including the first ones.'
          : '⚠ Only trades beyond the limit are flagged. Earlier trades on that day stay clean.';
      }
    }
  }

  if (_szLastAccountSize > 0) {
    _szRenderCombinedMode(_szLastAccountSize);
    if (_szViewMode === 'table') _szRenderTableView();
  }
};

// ─── Time of Day slot toggle ──────────────────────────────────────────────────
window._szCbToggleTimeSlot = function(slotKey, checked) {
  const slots = _szCbFilters.timeOfDay.blockedSlots;
  if (checked && !slots.includes(slotKey)) {
    slots.push(slotKey);
  } else if (!checked) {
    const idx = slots.indexOf(slotKey);
    if (idx !== -1) slots.splice(idx, 1);
  }
  try { localStorage.setItem('sz_cb_filters', JSON.stringify(_szCbFilters)); } catch(e) {}

  if (_szLastAccountSize > 0) {
    _szRenderCombinedMode(_szLastAccountSize);
    if (_szViewMode === 'table') _szRenderTableView();
  }
};


/**
 * renderSizingPage()
 * Call this whenever the sizing tab becomes visible (showPage('sizing'))
 * and from refreshAll() when the sizing tab is active.
 */
function renderSizingPage() {
  const container = document.getElementById('tab-sizing');
  if (!container) return;

  // Restore last-used account size from localStorage
  if (!_szLastAccountSize) {
    try {
      const saved = localStorage.getItem('sz_account_size');
      if (saved) _szLastAccountSize = parseFloat(saved) || 0;
    } catch(e) {}
  }

  // Restore exposure threshold from localStorage
  try {
    const savedPct = localStorage.getItem('sz_exposure_pct');
    if (savedPct) {
      const parsed = parseInt(savedPct);
      if ([25, 50, 75, 100].includes(parsed)) _szExposurePct = parsed;
    }
  } catch(e) {}

  // Restore baseline date from localStorage
  try {
    const savedDate = localStorage.getItem('sz_baseline_date');
    if (savedDate) _szBaselineDate = savedDate;
  } catch(e) {}

  // Restore Risk Budget settings from localStorage
  try {
    const savedMode = localStorage.getItem('sz_analysis_mode');
    if (savedMode === 'exposure' || savedMode === 'riskbudget' || savedMode === 'combined') _szAnalysisMode = savedMode;
  } catch(e) {}
  try {
    const savedRbPct = parseFloat(localStorage.getItem('sz_risk_budget_pct'));
    if ([0.5, 1, 2, 3, 5].includes(savedRbPct)) _szRiskBudgetPct = savedRbPct;
  } catch(e) {}

  // Restore Combined Filter settings from localStorage (deep merge per filter key)
  try {
    const saved = JSON.parse(localStorage.getItem('sz_cb_filters'));
    if (saved && typeof saved === 'object') {
      Object.keys(_szCbFilters).forEach(key => {
        if (saved[key] && typeof saved[key] === 'object') {
          _szCbFilters[key] = { ..._szCbFilters[key], ...saved[key] };
        }
      });
    }
  } catch(e) {}

  container.innerHTML = _sizingPageHTML(
    _szLastAccountSize,
    _szLastAccountSize * (_szExposurePct / 100),
    _szExposurePct,
    _szBaselineDate,
    _szRiskBudgetPct,
    _szAnalysisMode
  );

  // Always combined mode — right panel always visible
  _szSyncRightPanel(true);

  // Sync topbar view-toggle buttons to current _szViewMode
  const tbCharts = document.getElementById('sz-view-btn-charts');
  const tbTable  = document.getElementById('sz-view-btn-table');
  if (tbCharts) tbCharts.classList.toggle('active', _szViewMode === 'charts');
  if (tbTable)  tbTable.classList.toggle('active',  _szViewMode === 'table');

  _szApplyViewVisibility();

  if (_szLastAccountSize > 0) {
    if (_szViewMode === 'table') {
      _szRenderTableView();
    } else {
      _szRenderCombinedMode(_szLastAccountSize);
    }
  }
}

window.renderSizingPage = renderSizingPage;
