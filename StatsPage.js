/**
 * statsPage.js — Statistics & Analytics Module
 * Extracted from EdgeBook_v31.html
 *
 * Depends on globals from the main script block (must be declared before this file loads):
 *   trades              — global array (read-only)
 *   getFilteredTrades() — filtered trade array
 *   timeFilter          — read inside renderEquityChart() for axis formatting
 *   fmtNum(), fmtFull(), fmtDollar(), tipVal()  — shared formatters (stay in main)
 *   drillToLog()        — called from renderPriceRangeChart() and showDrillModal()
 *   flashActiveFilters()— called from renderPriceRangeChart() and showDrillModal()
 *   renderLog()         — called from showDrillModal()
 *   Chart               — Chart.js, global via CDN
 *
 * Public API exposed on window (called from showPage(), refreshAll(), inline onclick):
 *   updateStats()       — renders home KPI donuts + compact bar
 *   renderStats()       — renders full stats tab
 *   expandChart(key)    — opens chart expand modal
 *   closeChartModal()   — closes chart expand modal
 *
 * Load order: AFTER calendarPage.js, BEFORE the bottom bootstrap <script>.
 *
 * NOTE: fmtFull, fmtNum, fmtDollar, tipVal, tipDiv are included here verbatim
 * because they originate in the stats block. They are also consumed by openDetail()
 * and tradeList.js as globals — keeping them here preserves that without change,
 * since statsPage.js loads before the bootstrap and exposes them on window.
 *
 * Orphans preserved as-is (no call sites added):
 *   drawMiniDonut()   — no callers, preserved for future use
 *   chartExpandDefs   — declared but never read
 */

let chartInstance = null;

// ─── STATS ─────────────────────────────────────────────────
const donutInstances = {};
// calcCommission(t) is defined in app.js (global) — uses t.legs for accuracy.

function drawDonut(id, posVal, negVal, posColor, negColor, commVal, hoverLabels) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (donutInstances[id]) donutInstances[id].destroy();
  const isDark      = document.documentElement.getAttribute('data-theme') === 'dark';
  const resolvedPos   = posColor;
  const resolvedNeg   = negColor;
  const resolvedAmber = '#EF9F27';
  const resolvedEmpty = isDark ? '#2a2a2a' : '#e0dfd8';
  const borderCol     = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (isDark ? '#141414' : '#ffffff');
  const comm = Math.abs(commVal || 0);
  const rawTotal = Math.abs(posVal) + Math.abs(negVal);
  let data, colors;
  if (rawTotal > 0 || comm > 0) {
    if (comm > 0) {
      // Give commission a minimum visual weight of 6% so it's always visible
      const minCommWeight = rawTotal * 0.06;
      const displayComm = Math.max(comm, minCommWeight);
      data   = [Math.abs(posVal), Math.abs(negVal), displayComm];
      colors = [resolvedPos, resolvedNeg, resolvedAmber];
    } else {
      data   = [Math.abs(posVal), Math.abs(negVal)];
      colors = [resolvedPos, resolvedNeg];
    }
  } else {
    data = [1, 0]; colors = [resolvedEmpty, resolvedEmpty];
  }
  donutInstances[id] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { datasets: [{ data, backgroundColor: colors, borderWidth: 6, borderColor: borderCol, hoverOffset: 0, borderRadius: 8 }] },
    options: {
      cutout: '58%', responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 500 },
      onHover: (comm > 0 || hoverLabels) ? (evt, elements) => {
        const valEl = document.getElementById(id.replace('d-','s-'));
        const lblEl = document.getElementById(id.replace('d-','lbl-'));
        if (!valEl) return;
        if (!elements.length) {
          if (hoverLabels) {
            valEl.textContent = hoverLabels.default.val;
            valEl.className = hoverLabels.default.cls;
            valEl.style.color = '';
            if (lblEl) lblEl.textContent = hoverLabels.default.lbl;
          } else {
            const net = posVal - negVal - comm;
            valEl.textContent = fmtNum(net);
            valEl.className = 'stat-val ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : 'neu');
            valEl.style.color = '';
            if (lblEl) lblEl.textContent = 'P&L (Net)';
          }
          return;
        }
        const idx = elements[0].index;
        if (hoverLabels) {
          const seg = hoverLabels.segments[idx];
          if (!seg) return;
          valEl.textContent = seg.val;
          valEl.className = 'stat-val';
          valEl.style.color = seg.color;
          if (lblEl) lblEl.textContent = seg.lbl;
        } else {
          if (idx === 0) {
            valEl.textContent = fmtNum(posVal);
            valEl.style.color = posColor;
            if (lblEl) lblEl.textContent = 'Profit (Gross)';
          } else if (idx === 1) {
            valEl.textContent = fmtNum(-negVal);
            valEl.style.color = negColor;
            if (lblEl) lblEl.textContent = 'Loss (Gross)';
          } else {
            valEl.textContent = '-' + fmtNum(comm);
            valEl.style.color = '#EF9F27';
            if (lblEl) lblEl.textContent = 'Fees';
          }
          valEl.className = 'stat-val';
        }
      } : null
    }
  });
}

function fmtFull(v) {
  // Full number with commas, no decimals, with sign
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  return sign + '$' + Math.round(abs).toLocaleString('en-US');
}

function fmtNum(v) {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1000000) return sign + '$' + (abs/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
  if (abs >= 1000)    return sign + '$' + (abs/1000).toFixed(1).replace(/\.0$/,'') + 'K';
  return sign + '$' + Math.round(abs).toLocaleString('en-US');
}

function fmtDollar(v, decimals=0) {
  // Plain formatted dollar with commas, no forced sign
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  return sign + '$' + abs.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function tipVal(shortTxt, fullVal) {
  return `<span title="${fmtFull(fullVal)}" style="cursor:default">${shortTxt}</span>`;
}

function tipDiv(shortTxt, fullVal) {
  // For mini-donut-val divs - returns just the title attribute string
  return `title="${fmtFull(fullVal)}"`;
}

function updateStats() {
  const ft = getFilteredTrades();
  const n = ft.length;
  const totalPnl = ft.reduce((a,t) => a+t.pnl, 0);
  const wins = ft.filter(t => t.pnl > 0);
  const losses = ft.filter(t => t.pnl < 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const wr = n ? Math.round(winCount/n*100) : 0;
  const avg = n ? totalPnl/n : 0;
  const avgWin = winCount ? wins.reduce((a,t)=>a+t.pnl,0)/winCount : 0;
  const avgLoss = lossCount ? Math.abs(losses.reduce((a,t)=>a+t.pnl,0)/lossCount) : 0;
  const totalPos = wins.reduce((a,t)=>a+t.pnl,0);
  const totalNeg = Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
  const pf = totalNeg ? totalPos / totalNeg : null;

  const totalComm = ft.reduce((a,t) => a + calcCommission(t), 0);
  // Headline P&L KPI is NET (gross minus fees). totalPnl above remains
  // GROSS and is still used for avg/win/loss/profit-factor breakdowns.
  const totalNetPnl = totalPnl - totalComm;

  const setHtml = (id, html, cls) => { const e=document.getElementById(id); if(e){e.innerHTML=html;e.className=cls;} };

  const pnlTxt=fmtNum(totalNetPnl), pnlCls='stat-val '+(totalNetPnl>0?'pos':totalNetPnl<0?'neg':'neu');
  const wrTxt=wr+'%', wrCls='stat-val '+(wr>=50?'pos':n>0?'neg':'neu');
  const avgTxt=fmtNum(avg), avgCls='stat-val '+(avg>0?'pos':avg<0?'neg':'neu');
  const pfTxt=pf?pf.toFixed(2):'—', pfCls='stat-val '+(pf&&pf>=1?'pos':pf?'neg':'neu');

  const wrHover = {
    default:  { val: wrTxt, cls: wrCls, lbl: 'Win%' },
    segments: [
      { val: winCount,  color: '#8dc572', lbl: 'Wins'   },
      { val: lossCount, color: '#D85A30', lbl: 'Losses'  }
    ]
  };
  const avgHover = {
    default:  { val: avgTxt, cls: avgCls, lbl: 'Per Trade' },
    segments: [
      { val: fmtNum(avgWin),          color: '#8dc572', lbl: 'Avg Win'  },
      { val: fmtNum(-Math.abs(avgLoss)), color: '#D85A30', lbl: 'Avg Loss' }
    ]
  };

  // Hero
  setHtml('s-pnl', tipVal(pnlTxt, totalNetPnl), pnlCls); drawDonut('d-pnl',totalPos,totalNeg,'#8dc572','#D85A30',totalComm);
  setHtml('s-wr',  wrTxt, wrCls);                      drawDonut('d-wr', winCount,lossCount,'#8dc572','#D85A30',0,wrHover);
  setHtml('s-avg', tipVal(avgTxt, avg), avgCls);        drawDonut('d-avg',avgWin,avgLoss,'#8dc572','#D85A30',0,avgHover);
  setHtml('s-pf',  pfTxt, pfCls);                       drawDonut('d-pf', avgWin,avgLoss,'#8dc572','#D85A30');

  // Avg Rating stars
  const ratedTrades = ft.filter(t => t.rating);
  const avgRating = ratedTrades.length ? ratedTrades.reduce((s,t) => s + t.rating, 0) / ratedTrades.length : 0;
  const ratingEl = document.getElementById('s-avg-rating');
  const ratingHomeEl = document.getElementById('s-avg-rating-home');
  [ratingEl, ratingHomeEl].forEach(el => {
    if (!el) return;
    if (!avgRating) { el.innerHTML = '—'; }
    else {
      const full = Math.floor(avgRating);
      const half = avgRating - full >= 0.5 ? 1 : 0;
      const empty = 5 - full - half;
      el.innerHTML = '★'.repeat(full) + (half ? '⯨' : '') + '<span style="opacity:.25">' + '★'.repeat(empty) + '</span>';
      el.title = avgRating.toFixed(1) + ' / 5';
    }
  });

  // P&L KPI rectangular card
  (function() {
    const valEl = document.getElementById('pnl-kpi-val');
    const subEl = document.getElementById('pnl-kpi-sub');
    const barEl = document.getElementById('pnl-kpi-bar-fill');
    const cardEl = document.getElementById('pnl-kpi-card');
    if (!valEl) return;
    valEl.textContent = fmtDollar(totalNetPnl, Math.abs(totalNetPnl) < 1000 ? 0 : 0);
    valEl.className = 'pnl-kpi-val ' + (totalNetPnl > 0 ? 'pos' : totalNetPnl < 0 ? 'neg' : 'neu');
    if (subEl) subEl.textContent = n + ' trade' + (n !== 1 ? 's' : '') + (winCount ? ' · ' + wr + '% win rate' : '');
    if (barEl) {
      const pct = totalNeg + totalPos > 0 ? Math.round(totalPos / (totalPos + totalNeg) * 100) : 50;
      barEl.style.width = pct + '%';
      barEl.style.background = totalNetPnl >= 0 ? '#1D9E75' : '#D85A30';
    }
  })();

  // Compact
  setHtml('s-pnl-c', tipVal(pnlTxt, totalNetPnl), pnlCls); drawDonut('d-pnl-c',totalPos,totalNeg,'#8dc572','#D85A30',totalComm);
  setHtml('s-wr-c',  wrTxt, wrCls);                      drawDonut('d-wr-c', winCount,lossCount,'#8dc572','#D85A30',0,wrHover);
  setHtml('s-avg-c', tipVal(avgTxt, avg), avgCls);        drawDonut('d-avg-c',avgWin,avgLoss,'#8dc572','#D85A30',0,avgHover);
  setHtml('s-pf-c',  pfTxt, pfCls);                       drawDonut('d-pf-c', avgWin,avgLoss,'#8dc572','#D85A30');

  // Reset on mouseleave
  ['d-pnl','d-pnl-c'].forEach(canvasId => {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    cv.onmouseleave = () => {
      const valEl = document.getElementById(canvasId.replace('d-','s-'));
      const lblEl = document.getElementById(canvasId.replace('d-','lbl-'));
      if (!valEl) return;
      valEl.innerHTML = tipVal(pnlTxt, totalNetPnl);
      valEl.className = pnlCls;
      valEl.style.color = '';
      if (lblEl) lblEl.textContent = 'P&L (Net)';
    };
  });
  ['d-wr','d-wr-c'].forEach(canvasId => {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    cv.onmouseleave = () => {
      const valEl = document.getElementById(canvasId.replace('d-','s-'));
      const lblEl = document.getElementById(canvasId.replace('d-','lbl-'));
      if (!valEl) return;
      valEl.textContent = wrTxt;
      valEl.className = wrCls;
      valEl.style.color = '';
      if (lblEl) lblEl.textContent = 'Win%';
    };
  });
  ['d-avg','d-avg-c'].forEach(canvasId => {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    cv.onmouseleave = () => {
      const valEl = document.getElementById(canvasId.replace('d-','s-'));
      const lblEl = document.getElementById(canvasId.replace('d-','lbl-'));
      if (!valEl) return;
      valEl.innerHTML = tipVal(avgTxt, avg);
      valEl.className = avgCls;
      valEl.style.color = '';
      if (lblEl) lblEl.textContent = 'Per Trade';
    };
  });
}

window.addEventListener('scroll', () => {
  const hero = document.getElementById('stats-hero');
  const compact = document.getElementById('stats-compact');
  if (!hero || !compact) return;
  compact.classList.toggle('visible', hero.getBoundingClientRect().bottom < 0);
});

// ─── STATS CHARTS ──────────────────────────────────────────
function kpiCircle(value, display, sub, forceNeutral, tip) {
  let cls = 'neutral';
  if (!forceNeutral) {
    if (value > 0) cls = 'positive';
    else if (value < 0) cls = 'negative';
  }
  const inner = tip != null ? `<span title="${fmtFull(tip)}" style="cursor:default;border-bottom:1px dotted rgba(0,0,0,.2)">${display}</span>` : display;
  return `<div class="kpi-circle ${cls}">${inner}${sub ? '<span style="font-size:10px;font-weight:400;margin-top:1px">'+sub+'</span>' : ''}</div>`;
}

function renderStats() {
  const trades = getFilteredTrades();
  const n = trades.length;
  if (!n) {
    document.getElementById('stats-detail').innerHTML = '<div class="empty">No trades yet</div>';

    // ── Equity chart ──────────────────────────────────────────────────────────
    if (typeof chartInstance !== 'undefined' && chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    const eqTooltip = document.getElementById('equity-tooltip');
    if (eqTooltip) eqTooltip.style.opacity = '0';
    const eqCanvas = document.getElementById('equity-chart');
    if (eqCanvas) {
      eqCanvas.getContext('2d').clearRect(0, 0, eqCanvas.width, eqCanvas.height);
    }

    // ── Hold Time chart ───────────────────────────────────────────────────────
    if (typeof holdTimeChartInstance !== 'undefined' && holdTimeChartInstance) {
      holdTimeChartInstance.destroy();
      holdTimeChartInstance = null;
    }

    // ── Price Range chart (canvas-based, no Chart.js instance) ───────────────
    if (typeof priceRangeChartInstance !== 'undefined' && priceRangeChartInstance) {
      priceRangeChartInstance.destroy();
      priceRangeChartInstance = null;
    }
    const prCanvas = document.getElementById('pricerange-chart');
    if (prCanvas) {
      prCanvas.getContext('2d').clearRect(0, 0, prCanvas.width, prCanvas.height);
    }

    // ── Hourly chart ──────────────────────────────────────────────────────────
    if (typeof hourlyChartInstance !== 'undefined' && hourlyChartInstance) {
      hourlyChartInstance.destroy();
      hourlyChartInstance = null;
    }
    const hourlyCanvas = document.getElementById('hourly-chart');
    if (hourlyCanvas) {
      hourlyCanvas.getContext('2d').clearRect(0, 0, hourlyCanvas.width, hourlyCanvas.height);
    }
    const hourlyLegend = document.getElementById('hourly-legend');
    if (hourlyLegend) hourlyLegend.innerHTML = '';

    // ── Mood chart ────────────────────────────────────────────────────────────
    if (typeof moodChartInstance !== 'undefined' && moodChartInstance) {
      moodChartInstance.destroy();
      moodChartInstance = null;
    }
    const moodCanvas = document.getElementById('mood-chart');
    if (moodCanvas) {
      moodCanvas.style.display = 'none';
      moodCanvas.getContext('2d').clearRect(0, 0, moodCanvas.width, moodCanvas.height);
    }
    const moodLegend = document.getElementById('mood-legend');
    if (moodLegend) moodLegend.innerHTML = '';

    // ── Day stats (HTML-rendered) ─────────────────────────────────────────────
    const dayStatsEl = document.getElementById('day-stats');
    if (dayStatsEl) dayStatsEl.innerHTML = '<div class="empty" style="padding:1rem">No data yet</div>';

    return;
  }
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const total = trades.reduce((a,t) => a+t.pnl, 0);          // gross
  const totalFees = trades.reduce((a,t) => a + calcCommission(t), 0);
  const totalNet = total - totalFees;                         // net
  const avgWin = wins.length ? wins.reduce((a,t)=>a+t.pnl,0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a,t)=>a+t.pnl,0)/losses.length : 0;
  const maxWin = wins.length ? Math.max(...wins.map(t=>t.pnl)) : 0;
  const maxLoss = losses.length ? Math.min(...losses.map(t=>t.pnl)) : 0;
  const totalPos = wins.reduce((a,t)=>a+t.pnl,0);
  const totalNeg = Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
  const pf = totalNeg ? totalPos / totalNeg : null;
  const wr = Math.round(wins.length/n*100);
  const avgTrade = total/n;

  const kpis = [
    { label:'Total Trades',  val:n,             display:n.toLocaleString(),                                      tip:null,       sub:'',            neutral:true },
    { label:'Win Rate',      val:wr-50,          display:wr+'%',                                                  tip:null,       sub:'vs 50%'                   },
    { label:'Total P&L (Net)', val:totalNet,     display:fmtNum(totalNet),                                        tip:totalNet,   sub:''                          },
    { label:'Total Fees',    val:-totalFees,     display:'-'+fmtNum(totalFees).replace(/^[+-]/,''),               tip:-totalFees, sub:'',            neutral:true  },
    { label:'Avg Per Trade (Gross)', val:avgTrade, display:fmtNum(avgTrade),                                      tip:avgTrade,   sub:''                          },
    { label:'Avg Win (Gross)', val:avgWin,       display:fmtNum(avgWin),                                          tip:avgWin,     sub:'per winner'                },
    { label:'Avg Loss (Gross)', val:avgLoss,     display:fmtNum(-Math.abs(avgLoss)),                              tip:-Math.abs(avgLoss), sub:'per loser'         },
    { label:'Profit Factor', val:pf?pf-1:0,      display:pf?pf.toFixed(2):'∞',                                   tip:null,       sub:pf&&pf>=1?'good':'low'      },
    { label:'Best Trade (Gross)', val:maxWin,    display:fmtNum(maxWin),                                          tip:maxWin,     sub:'biggest win'               },
    { label:'Worst Trade (Gross)', val:maxLoss,  display:fmtNum(maxLoss),                                         tip:maxLoss,    sub:'biggest loss'              },
    { label:'Winners',       val:wins.length,    display:wins.length.toLocaleString(),                            tip:null,       sub:wr+'%',        neutral:true  },
    { label:'Losers',        val:-losses.length, display:losses.length.toLocaleString(),                          tip:null,       sub:(100-wr)+'%',  neutral:true  },
    { label:'Trading Days',  val:0,              display:new Set(trades.map(t=>t.date)).size.toLocaleString(),    tip:null,       sub:'unique days', neutral:true  },
  ];

  document.getElementById('stats-detail').innerHTML = `<div class="kpi-grid">${
    kpis.map(k => `<div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      ${kpiCircle(k.val, k.display, k.sub, k.neutral, k.tip)}
    </div>`).join('')
  }</div>`;

  renderEquityChart(); renderDayStats(); renderMoodStats(); renderHoldTimeChart(); renderPriceRangeChart(); renderHourlyChart();

  // Apply saved card layout (order + width) now that all cards are populated.
  // Lives in statsLayout.js — generic layout module, no trading logic.
  if (typeof initStatsLayout === 'function') initStatsLayout();
}

function renderEquityChart() {
  const sorted = [...getFilteredTrades()].sort((a,b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    const tooltipEl = document.getElementById('equity-tooltip');
    if (tooltipEl) tooltipEl.style.opacity = '0';
    const canvas = document.getElementById('equity-chart');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Aggregate PnL + stats by day (NET — gross minus fees, consistent with calendar page)
  const dayMap = {};
  sorted.forEach(t => {
    if (!dayMap[t.date]) dayMap[t.date] = { pnl: 0, wins: 0, losses: 0, count: 0 };
    dayMap[t.date].pnl    += (t.pnl - calcCommission(t));
    dayMap[t.date].count  += 1;
    if (t.pnl > 0) dayMap[t.date].wins++;
    else if (t.pnl < 0) dayMap[t.date].losses++;
  });
  const days = Object.keys(dayMap).sort();

  let cum = 0;
  const labels = [], data = [], dayKeys = [];

  // X-axis label format based on active filter
  const mode = timeFilter ? timeFilter.mode : 'all';

  // For custom ranges, determine span in days to decide format
  const spanDays = (() => {
    if (days.length < 2) return 0;
    const first = new Date(days[0] + 'T00:00:00');
    const last  = new Date(days[days.length - 1] + 'T00:00:00');
    return (last - first) / (1000 * 60 * 60 * 24);
  })();

  // Use month+year format when: all, year, or custom > 60 days
  const useLongFormat = mode === 'all' || mode === 'year' || (mode === 'custom' && spanDays > 60);

  // X-axis shows no labels — info is in the tooltip
  const fmtLabel = () => '';

  // Add zero baseline at start so chart always begins at 0
  if (days.length > 0) {
    const firstDt = new Date(days[0] + 'T00:00:00');
    const prevDt  = new Date(firstDt); prevDt.setDate(prevDt.getDate() - 1);
    const prevStr = prevDt.toISOString().slice(0,10);
    labels.unshift(fmtLabel(prevStr));
    data.unshift(0);
    dayKeys.unshift(prevStr);
  }

  // Cumulative starts from 0 at the first day of the filtered period (relative P&L)
  days.forEach(d => {
    cum += dayMap[d].pnl;
    labels.push(fmtLabel(d));
    data.push(parseFloat(cum.toFixed(2)));
    dayKeys.push(d);
  });

  // Custom tooltip element
  let tooltipEl = document.getElementById('equity-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'equity-tooltip';
    document.querySelector('.app').appendChild(tooltipEl);
  }
  const isDarkEq = document.documentElement.getAttribute('data-theme') === 'dark';
  tooltipEl.style.cssText = `
    position:fixed;pointer-events:none;z-index:9999;
    background:${isDarkEq ? 'rgba(28,28,28,.92)' : 'rgba(255,255,255,.85)'};
    border:1px solid var(--border);border-radius:12px;
    padding:10px 14px;width:180px;box-shadow:0 4px 24px rgba(0,0,0,.18);
    opacity:0;transform:translateY(6px) scale(.97);
    transition:opacity .18s ease,transform .18s ease;
    font-family:'CircularXXWeb-Bold',-apple-system,sans-serif;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  `;

  const ctx = document.getElementById('equity-chart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  // Smooth segment color with interpolation across 3 points
  const GREEN = [141, 197, 114]; // #8dc572
  const RED   = [216,  90,  48]; // #D85A30
  const MID   = [239, 159,  39]; // #EF9F27 (amber midpoint)

  function lerpColor(a, b, t) {
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
  }

  // Build per-point trend strength (smoothed over window)
  const window = 3;
  const trend = data.map((v, i) => {
    const start = Math.max(0, i - window);
    const delta = data[i] - data[start];
    return delta; // positive = up, negative = down
  });
  const maxAbs = Math.max(...trend.map(Math.abs), 0.001);

  const segColor = (ctx) => {
    const i = ctx.p1DataIndex;
    const t0 = trend[Math.max(0, i-1)] / maxAbs;
    const t1 = trend[i] / maxAbs;
    const avg = (t0 + t1) / 2;
    if (avg >= 0) {
      // green, with amber at low confidence
      return lerpColor(MID, GREEN, Math.min(1, avg * 2));
    } else {
      // red, with amber at low confidence
      return lerpColor(MID, RED, Math.min(1, Math.abs(avg) * 2));
    }
  };

  // Smooth fill gradient based on final value
  const fillPlugin = {
    id: 'dynamicFill',
    beforeDatasetDraw(chart) {
      const { ctx: c, chartArea } = chart;
      if (!chartArea || !data.length) return;
      const isPos = data[data.length - 1] >= 0;
      const grad = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
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

  // Y-axis formatter: compact units
  const fmtY = v => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1000000) return sign + (abs/1000000).toFixed(1) + 'M';
    if (abs >= 1000)    return sign + (abs/1000).toFixed(1) + 'K';
    return sign + abs;
  };

  const siteFont = "'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const tickColor = '#999';

  chartInstance = new Chart(ctx, {
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
            if (!dayData) {
              tooltipEl.style.opacity = '0';
              return;
            }
            const dayPnl  = dayData.pnl;
            const pnlCls  = dayPnl >= 0 ? '#8dc572' : '#D85A30';
            const cumCls  = cumPnl >= 0 ? '#8dc572' : '#D85A30';
            const sign    = v => v > 0 ? '+' : v < 0 ? '-' : '';
            const fmt     = v => sign(v) + '$' + Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0});
            const fmtK    = v => { const abs = Math.abs(v); const s = sign(v) + '$'; return abs >= 1000 ? s + (abs/1000).toFixed(1) + 'K' : s + Math.round(abs).toLocaleString('en-US'); };
            const dt      = new Date(date + 'T00:00:00');
            const pad = n => String(n).padStart(2,'0');
            const dateStr = `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`;
            tooltipEl.innerHTML = `
              <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px;font-family:${siteFont}">${dateStr}</div>
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
            const ttW = 180, ttH = 140;
            const margin = 12;

            // Prefer right of cursor, flip left if overflows viewport
            let left = canvasRect.left + tooltip.caretX + margin;
            if (left + ttW > window.innerWidth - margin) {
              left = canvasRect.left + tooltip.caretX - ttW - margin;
            }
            // Clamp within canvas horizontally
            left = Math.max(canvasRect.left, Math.min(left, canvasRect.right - ttW));

            // Center vertically on caret, clamp within canvas
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
          ticks: {
            callback: fmtY,
            color: tickColor,
            font: { family: siteFont, size: 11 }
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: mode === 'week' ? 7 : useLongFormat ? 50 : 8,
            color: tickColor,
            font: { family: siteFont, size: 11 }
          }
        }
      }
    },
    plugins: [fillPlugin]
  });
}

let holdTimeChartInstance = null;
function renderHoldTimeChart() {
  const canvas = document.getElementById('holdtime-chart');
  if (!canvas) return;
  if (holdTimeChartInstance) { holdTimeChartInstance.destroy(); holdTimeChartInstance = null; }

  function toMins(dur) {
    if (!dur) return null;
    const h = dur.match(/(\d+)h/), m = dur.match(/(\d+)m/);
    return (h ? parseInt(h[1])*60 : 0) + (m ? parseInt(m[1]) : 0);
  }
  function fmtMins(m) {
    if (!m) return '0m';
    if (m < 60) return Math.round(m) + 'm';
    const h = Math.floor(m/60), rem = Math.round(m%60);
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }

  const ft = getFilteredTrades();
  const winMins  = ft.filter(t => t.pnl > 0).map(t => toMins(t.duration)).filter(v => v !== null);
  const lossMins = ft.filter(t => t.pnl < 0).map(t => toMins(t.duration)).filter(v => v !== null);
  const avgWin  = winMins.length  ? Math.round(winMins.reduce((a,v)=>a+v,0)  / winMins.length)  : 0;
  const avgLoss = lossMins.length ? Math.round(lossMins.reduce((a,v)=>a+v,0) / lossMins.length) : 0;

  const siteFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#aaa';
  const maxVal = Math.max(avgWin, avgLoss, 1);

  holdTimeChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Losing Trades', 'Winning Trades'],
      datasets: [
        {
          label: 'Wins',
          data: [0, avgWin],
          backgroundColor: ['transparent', '#8dc572cc'],
          borderRadius: 6, borderSkipped: false, barPercentage: 0.5,
        },
        {
          label: 'Losses',
          data: [-avgLoss, 0],
          backgroundColor: ['#D85A30cc', 'transparent'],
          borderRadius: 6, borderSkipped: false, barPercentage: 0.5,
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = Math.abs(ctx.raw);
              return v ? '  ' + fmtMins(v) : null;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(128,128,128,.1)' },
          min: -maxVal * 1.35,
          max:  maxVal * 1.35,
          ticks: {
            color: tickColor,
            font: { family: siteFont, size: 11 },
            callback: v => v === 0 ? '0' : fmtMins(Math.abs(v))
          }
        },
        y: {
          stacked: false,
          grid: { display: false },
          ticks: { color: tickColor, font: { family: siteFont, size: 12 } }
        }
      }
    },
    plugins: [{
      id: 'divLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = `600 12px ${siteFont}`;
        ctx.textBaseline = 'middle';

        // Win label (right of green bar)
        const winBar = chart.getDatasetMeta(0).data[1];
        if (avgWin) {
          ctx.fillStyle = '#8dc572';
          ctx.textAlign = 'left';
          ctx.fillText(fmtMins(avgWin), winBar.x + 8, winBar.y);
        }

        // Loss label (left of red bar)
        const lossBar = chart.getDatasetMeta(1).data[0];
        if (avgLoss) {
          ctx.fillStyle = '#D85A30';
          ctx.textAlign = 'right';
          ctx.fillText(fmtMins(avgLoss), lossBar.x - 8, lossBar.y);
        }
        ctx.restore();
      }
    }]
  });
}

let priceRangeChartInstance = null;
function renderPriceRangeChart() {
  const canvas = document.getElementById('pricerange-chart');
  if (!canvas) return;
  if (priceRangeChartInstance) { priceRangeChartInstance.destroy(); priceRangeChartInstance = null; }

  const buckets = [
    { label: '<$2',       min: 0,   max: 2,       drill: '0-2'        },
    { label: '$2–4.99',   min: 2,   max: 5,       drill: '2-5'        },
    { label: '$5–9.99',   min: 5,   max: 10,      drill: '5-10'       },
    { label: '$10–19.99', min: 10,  max: 20,      drill: '10-20'      },
    { label: '$20–29.99', min: 20,  max: 30,      drill: '20-30'      },
    { label: '>$30',      min: 30,  max: Infinity, drill: '30-999999' },
  ];

  const data = buckets.map(() => ({ pnl: 0, wins: 0, losses: 0, count: 0 }));
  getFilteredTrades().forEach(t => {
    if (!t.entry) return;
    const idx = buckets.findIndex(b => t.entry >= b.min && t.entry < b.max);
    if (idx < 0) return;
    data[idx].pnl += (t.pnl - calcCommission(t)); // net
    data[idx].count++;
    if (t.pnl > 0) data[idx].wins++;
    else if (t.pnl < 0) data[idx].losses++;
  });

  const siteFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#999';

  // symmetric log transform
  const symLog = v => v === 0 ? 0 : Math.sign(v) * Math.log10(Math.abs(v) + 1);

  const logVals = data.map(d => symLog(d.pnl));
  const maxLog  = Math.max(...logVals.map(Math.abs), 0.1);

  const DURATION = 900; // ms
  let startTime = null;
  let animId = null;

  function fmtCounter(v) {
    const abs = Math.abs(Math.round(v));
    return (v >= 0 ? '+' : '-') + '$' + abs.toLocaleString('en-US');
  }

  function draw(progress) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth || 600;
    const H = 200;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const padL = 12, padR = 12, padT = 28, padB = 44;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const midY   = padT + chartH / 2;

    // Zero line only
    ctx.strokeStyle = 'rgba(128,128,128,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, midY); ctx.lineTo(W - padR, midY); ctx.stroke();

    // Bars
    const barW = Math.min(52, (chartW / buckets.length) * 0.55);
    const step  = chartW / buckets.length;
    // easeOutExpo
    const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

    buckets.forEach((b, i) => {
      const d      = data[i];
      const lv     = logVals[i];
      const x      = padL + step * i + step / 2;
      const fullH  = Math.abs(lv / maxLog) * (chartH / 2);
      const actualH = d.count > 0 ? Math.max(fullH, 4) * ease : 0;
      const y      = lv >= 0 ? midY - actualH : midY;
      const color  = lv >= 0 ? '#8dc572' : '#D85A30';
      const bx     = x - barW / 2;
      const r      = 5;

      if (!d.count) {
        // X label only — always at bottom
        ctx.font = `11px ${siteFont}`;
        ctx.fillStyle = tickColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(b.label, x, midY + 8);
        return;
      }

      // Bar
      ctx.fillStyle = color + 'cc';
      ctx.beginPath();
      if (lv >= 0) {
        ctx.moveTo(bx + r, y); ctx.lineTo(bx + barW - r, y);
        ctx.arcTo(bx + barW, y, bx + barW, y + r, r);
        ctx.lineTo(bx + barW, midY); ctx.lineTo(bx, midY);
        ctx.arcTo(bx, y, bx + r, y, r);
      } else {
        ctx.moveTo(bx, midY); ctx.lineTo(bx + barW, midY);
        ctx.lineTo(bx + barW, y + actualH - r);
        ctx.arcTo(bx + barW, y + actualH, bx + barW - r, y + actualH, r);
        ctx.lineTo(bx + r, y + actualH);
        ctx.arcTo(bx, y + actualH, bx, y + actualH - r, r);
        ctx.lineTo(bx, midY);
      }
      ctx.closePath();
      ctx.fill();

      // Animated counter label
      const animatedVal = d.pnl * ease;
      const label = fmtCounter(animatedVal);
      ctx.font = `700 11px ${siteFont}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      if (lv >= 0) {
        // Green: label above bar, price label below zero line
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, y - 5);
        ctx.font = `11px ${siteFont}`;
        ctx.fillStyle = tickColor;
        ctx.textBaseline = 'top';
        ctx.fillText(b.label, x, midY + 8);
      } else {
        // Red: price label above zero line, value label below bar
        ctx.font = `11px ${siteFont}`;
        ctx.fillStyle = tickColor;
        ctx.textBaseline = 'bottom';
        ctx.fillText(b.label, x, midY - 6);
        ctx.font = `700 11px ${siteFont}`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + actualH + 5);
      }
    });
  }

  function animate(ts) {
    if (!startTime) startTime = ts;
    const progress = Math.min((ts - startTime) / DURATION, 1);
    draw(progress);
    if (progress < 1) animId = requestAnimationFrame(animate);
  }

  animId = requestAnimationFrame(animate);
  priceRangeChartInstance = { destroy: () => { if (animId) cancelAnimationFrame(animId); } };

  // Drill on click
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const W = canvas.parentElement.clientWidth || 600;
    const padL = 58, padR = 16;
    const chartW = W - padL - padR;
    const step = chartW / buckets.length;
    const idx = Math.floor((mx - padL) / step);
    if (idx >= 0 && idx < buckets.length) {
      drillToLog('stats');
      setTimeout(() => {
        const el = document.getElementById('filt-price');
        if (el) { el.value = buckets[idx].drill; renderLog(); flashActiveFilters(); }
      }, 50);
    }
  };
  canvas.style.cursor = 'pointer';
}

let hourlyChartInstance = null;

function renderHourlyChart() {
  const el = document.getElementById('hourly-chart');
  const legendEl = document.getElementById('hourly-legend');
  if (!el) return;

  const HOURS = [];
  for (let h = 4; h <= 18; h++) HOURS.push(h);

  // Build per-hour buckets
  const buckets = {};
  HOURS.forEach(h => { buckets[h] = { pnl: 0, wins: 0, losses: 0, count: 0, trades: [] }; });

  getFilteredTrades().forEach(t => {
    if (!t.entryTime) return;
    const match = t.entryTime.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return;
    const h = parseInt(match[1]);
    if (h < 4 || h > 18) return;
    buckets[h].pnl    += (t.pnl - calcCommission(t)); // net
    buckets[h].count  += 1;
    buckets[h].trades.push(t);
    if (t.pnl > 0) buckets[h].wins++;
    else if (t.pnl < 0) buckets[h].losses++;
  });

  const labels  = HOURS.map(h => `${String(h).padStart(2,'0')}:00`);
  const pnlData = HOURS.map(h => buckets[h].pnl); // net
  const counts  = HOURS.map(h => buckets[h].count);
  const maxAbs  = Math.max(...pnlData.map(Math.abs), 1);

  // Colors per bar
  const barColors = pnlData.map(v =>
    v > 0  ? 'rgba(141,197,114,0.85)' :
    v < 0  ? 'rgba(216,90,48,0.85)'  :
             'rgba(180,180,180,0.3)'
  );
  const barBorders = pnlData.map(v =>
    v > 0  ? '#8dc572' :
    v < 0  ? '#D85A30' :
             '#ccc'
  );

  // Custom tooltip
  let tooltipEl = document.getElementById('hourly-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'hourly-tooltip';
    document.querySelector('.app')?.appendChild(tooltipEl);
  }
  const isDarkH = document.documentElement.getAttribute('data-theme') === 'dark';
  tooltipEl.style.cssText = `
    position:absolute;pointer-events:none;z-index:999;
    background:${isDarkH ? 'rgba(28,28,28,.92)' : 'rgba(255,255,255,.85)'};
    border:1px solid var(--border);border-radius:12px;
    padding:10px 14px;min-width:150px;box-shadow:0 4px 24px rgba(0,0,0,.18);
    opacity:0;transform:translateY(6px) scale(.97);
    transition:opacity .15s ease,transform .15s ease;
    font-family:-apple-system,sans-serif;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  `;

  if (hourlyChartInstance) hourlyChartInstance.destroy();

  const isDark = document.documentElement.classList.contains('dark');
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#999';

  hourlyChartInstance = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: pnlData,
        backgroundColor: barColors,
        borderColor: barBorders,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      onClick(e, elements) {
        if (!elements.length) return;
        const i = elements[0].index;
        const h = HOURS[i];
        const b = buckets[h];
        if (!b.trades.length) return;
        showDrillModal(`${String(h).padStart(2,'0')}:00 – ${String(h+1).padStart(2,'0')}:00`, b.trades);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external({ chart, tooltip }) {
            if (tooltip.opacity === 0) {
              tooltipEl.style.opacity = '0';
              tooltipEl.style.transform = 'translateY(6px) scale(.97)';
              return;
            }
            const i   = tooltip.dataPoints?.[0]?.dataIndex;
            if (i == null) return;
            const h   = HOURS[i];
            const b   = buckets[h];
            const pnl = b.pnl;
            const pnlCls = pnl > 0 ? '#8dc572' : pnl < 0 ? '#D85A30' : 'var(--text3)';
            const sign   = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
            const wr     = b.count ? Math.round(b.wins / b.count * 100) : 0;

            tooltipEl.innerHTML = `
              <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px">${String(h).padStart(2,'0')}:00 – ${String(h+1).padStart(2,'0')}:00</div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;justify-content:space-between;gap:20px">
                  <span style="font-size:12px;color:var(--text2)">P&L (Net)</span>
                  <span style="font-size:14px;font-weight:700;color:${pnlCls}">${sign}$${Math.abs(pnl).toLocaleString('en-US',{maximumFractionDigits:0})}</span>
                </div>
                <div style="height:1px;background:var(--border);margin:2px 0"></div>
                <div style="display:flex;justify-content:space-between;gap:20px">
                  <span style="font-size:12px;color:var(--text2)">Trades</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text)">${b.count}</span>
                </div>
                ${b.count ? `
                <div style="display:flex;gap:10px">
                  <span style="font-size:11px;color:#8dc572">▲ ${b.wins}</span>
                  <span style="font-size:11px;color:#D85A30">▼ ${b.losses}</span>
                  <span style="font-size:11px;color:var(--text3)">${wr}% WR</span>
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">Click to see trades</div>` : ''}
              </div>`;

            const cRect = chart.canvas.getBoundingClientRect();
            const aRect = document.querySelector('.app')?.getBoundingClientRect() || cRect;
            let left = cRect.left - aRect.left + tooltip.caretX + 12;
            let top  = cRect.top  - aRect.top  + tooltip.caretY - 20;
            if (left + 170 > aRect.width) left = cRect.left - aRect.left + tooltip.caretX - 165;
            tooltipEl.style.left      = left + 'px';
            tooltipEl.style.top       = top  + 'px';
            tooltipEl.style.opacity   = '1';
            tooltipEl.style.transform = 'translateY(0) scale(1)';
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: tickColor, font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { display: false },
          grace: '15%'
        }
      }
    },
    plugins: [{
      id: 'barLabels',
      afterDatasetDraw(chart) {
        const { ctx, data } = chart;
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((bar, i) => {
          const v = data.datasets[0].data[i];
          if (!v) return;
          const isPos = v >= 0;
          const label = (isPos ? '+' : '-') + '$' + (Math.abs(v) >= 1000 ? (Math.abs(v)/1000).toFixed(1)+'K' : Math.abs(v).toFixed(0));
          ctx.save();
          ctx.font = '600 10px CircularXXWeb-Bold,-apple-system,sans-serif';
          ctx.fillStyle = isPos ? '#8dc572' : '#D85A30';
          ctx.textAlign = 'center';
          ctx.textBaseline = isPos ? 'bottom' : 'top';
          const y = isPos ? bar.y - 4 : bar.y + 4;
          ctx.fillText(label, bar.x, y);
          ctx.restore();
        });
      }
    }]
  });

  // Legend
  const best  = HOURS.reduce((a, h) => buckets[h].pnl > buckets[a].pnl ? h : a, HOURS[0]);
  const worst = HOURS.reduce((a, h) => buckets[h].pnl < buckets[a].pnl ? h : a, HOURS[0]);
  const mostActive = HOURS.reduce((a, h) => buckets[h].count > buckets[a].count ? h : a, HOURS[0]);

  if (legendEl) {
    const anyData = HOURS.some(h => buckets[h].count > 0);
    legendEl.innerHTML = anyData ? `
      <span style="font-size:11px;color:var(--text3)">
        <span style="color:#8dc572;font-weight:700">Best:</span> ${String(best).padStart(2,'0')}:00
        (${buckets[best].pnl >= 0 ? '+' : ''}$${Math.abs(buckets[best].pnl).toLocaleString('en-US',{maximumFractionDigits:0})})
      </span>
      <span style="font-size:11px;color:var(--text3)">·</span>
      <span style="font-size:11px;color:var(--text3)">
        <span style="color:#D85A30;font-weight:700">Worst:</span> ${String(worst).padStart(2,'0')}:00
        ($${buckets[worst].pnl <= 0 ? '' : '+'}${buckets[worst].pnl.toLocaleString('en-US',{maximumFractionDigits:0})})
      </span>
      <span style="font-size:11px;color:var(--text3)">·</span>
      <span style="font-size:11px;color:var(--text3)">
        <span style="font-weight:700;color:var(--text2)">Most active:</span> ${String(mostActive).padStart(2,'0')}:00
        (${buckets[mostActive].count} trades)
      </span>` : '';
  }
}

function renderDayStats() {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const ds = Array(7).fill(null).map(() => ({count:0,pnl:0,wins:0}));
  getFilteredTrades().forEach(t => {
    if (!t.date) return;
    const d = new Date(t.date + 'T00:00:00').getDay();
    ds[d].count++;
    ds[d].pnl += (t.pnl - calcCommission(t)); // net
    if (t.pnl > 0) ds[d].wins++;
  });

  // Only show trading days (skip days with 0 trades)
  const active = days.map((name, i) => ({ name, ...ds[i] })).filter(d => d.count > 0);

  if (!active.length) {
    document.getElementById('day-stats').innerHTML = '<div class="empty" style="padding:1rem">No data yet</div>';
    return;
  }

  const maxAbsPnl = Math.max(...active.map(d => Math.abs(d.pnl)), 1);

  const bars = active.map(d => {
    const pct = Math.abs(d.pnl) / maxAbsPnl * 100;
    const isPos = d.pnl >= 0;
    const color = isPos ? 'var(--green)' : 'var(--red)';
    const pnlStr = (isPos ? '+' : '-') + '$' + Math.abs(d.pnl).toLocaleString('en-US', {maximumFractionDigits:0});
    const wr = d.count ? Math.round(d.wins / d.count * 100) : 0;

    return `
      <div style="display:grid;grid-template-columns:42px 1fr 80px 60px;align-items:center;gap:12px;padding:6px 0">
        <span style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.04em;text-align:right">${d.name}</span>
        <div style="position:relative;height:22px;background:var(--bg3);border-radius:4px;overflow:hidden">
          <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:4px;opacity:.85;transition:width .5s ease"></div>
          <div style="position:absolute;left:0;top:0;height:100%;width:100%;display:flex;align-items:center;padding:0 8px">
            <span style="font-size:11px;font-weight:700;color:var(--text);position:relative">${pnlStr}</span>
          </div>
        </div>
        <span style="font-size:11px;color:var(--text3);text-align:right;white-space:nowrap">${d.count} trade${d.count!==1?'s':''}</span>
        <span style="font-size:11px;font-weight:600;color:${wr>=50?'var(--green)':'var(--red)'};text-align:right">${wr}% WR</span>
      </div>`;
  }).join('');

  document.getElementById('day-stats').innerHTML = `
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;padding:0 0 4px 0">P&L shown is Net (after fees)</div>
    <div style="padding:.25rem 0">${bars}</div>`;
}

let moodChartInstance = null;

function renderMoodStats() {
  const el = document.getElementById('mood-chart');
  const legendEl = document.getElementById('mood-legend');
  if (!el) return;

  // Emoji map
  const moodEmoji = { 'Focused':'😤','Calm':'😌','Stressed':'😰','Overconfident':'😎','Doubtful':'🤔','FOMO':'😱' };

  // Build per-mood stats
  const moodMap = {};
  getFilteredTrades().forEach(t => {
    if (!t.mood) return;
    if (!moodMap[t.mood]) moodMap[t.mood] = { pnls: [], wins: 0, losses: 0, count: 0, totalPnl: 0 };
    const m = moodMap[t.mood];
    m.pnls.push(t.pnl - calcCommission(t));
    m.count++;
    m.totalPnl += (t.pnl - calcCommission(t));
    if (t.pnl > 0) m.wins++; else if (t.pnl < 0) m.losses++;
  });

  const moods = Object.keys(moodMap);
  if (!moods.length) {
    el.style.display = 'none';
    if (legendEl) legendEl.innerHTML = '<div class="empty" style="padding:1rem">No mood data yet</div>';
    return;
  }
  el.style.display = '';

  // Per mood: avgPnl = X, winRate = Y, count = bubble size
  const moodColors = {
    'Focused':      { fill:'rgba(141,197,114,.75)', border:'#8dc572' },
    'Calm':         { fill:'rgba(55,138,221,.75)',  border:'#378ADD' },
    'Stressed':     { fill:'rgba(216,90,48,.75)',   border:'#D85A30' },
    'Overconfident':{ fill:'rgba(155,89,182,.75)',  border:'#9B59B6' },
    'Doubtful':     { fill:'rgba(239,159,39,.75)',  border:'#EF9F27' },
    'FOMO':         { fill:'rgba(231,76,60,.75)',   border:'#E74C3C' },
  };
  const defaultColor = { fill:'rgba(150,150,150,.6)', border:'#999' };

  const maxCount = Math.max(...moods.map(m => moodMap[m].count));

  const bubbleData = moods.map(mood => {
    const m = moodMap[mood];
    const avgPnl = m.totalPnl / m.count;
    const wr     = Math.round(m.wins / m.count * 100);
    const r      = 10 + (m.count / maxCount) * 28; // radius 10–38px
    const col    = moodColors[mood] || defaultColor;
    return {
      label: mood,
      data: [{ x: avgPnl, y: wr, r }],
      backgroundColor: col.fill,
      borderColor:     col.border,
      borderWidth: 2,
      hoverBorderWidth: 3,
    };
  });

  // Tooltip
  let tooltipEl = document.getElementById('mood-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'mood-tooltip';
    document.querySelector('.app')?.appendChild(tooltipEl);
  }
  const isDarkMood = document.documentElement.getAttribute('data-theme') === 'dark';
  tooltipEl.style.cssText = `
    position:absolute;pointer-events:none;z-index:999;
    background:${isDarkMood ? 'rgba(28,28,28,.92)' : 'rgba(255,255,255,.75)'};border:1px solid var(--border);border-radius:12px;
    padding:10px 14px;min-width:155px;box-shadow:0 4px 24px rgba(0,0,0,.13);
    opacity:0;transform:translateY(6px) scale(.97);
    transition:opacity .15s ease,transform .15s ease;
  `;

  if (moodChartInstance) moodChartInstance.destroy();

  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#999';

  moodChartInstance = new Chart(el.getContext('2d'), {
    type: 'bubble',
    data: { datasets: bubbleData },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutElastic' },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external({ chart, tooltip }) {
            if (tooltip.opacity === 0) {
              tooltipEl.style.opacity = '0';
              tooltipEl.style.transform = 'translateY(6px) scale(.97)';
              return;
            }
            const dp = tooltip.dataPoints?.[0];
            if (!dp) return;
            const mood  = dp.dataset.label;
            const m     = moodMap[mood];
            const avgPnl = m.totalPnl / m.count;
            const wr    = Math.round(m.wins / m.count * 100);
            const emoji = moodEmoji[mood] || '●';
            const pnlCls = avgPnl >= 0 ? '#8dc572' : '#D85A30';
            const sign   = avgPnl >= 0 ? '+' : '-';
            // Spread: std deviation of PnL
            const mean  = avgPnl;
            const std   = Math.sqrt(m.pnls.reduce((s,v)=>s+Math.pow(v-mean,2),0)/m.pnls.length);

            tooltipEl.innerHTML = `
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
                <span style="font-size:18px">${emoji}</span>
                <span style="font-size:13px;font-weight:700;color:var(--text)">${mood}</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;justify-content:space-between;gap:18px">
                  <span style="font-size:11px;color:var(--text3)">Avg P&L (Net)</span>
                  <span style="font-size:13px;font-weight:700;color:${pnlCls}">${sign}$${Math.abs(avgPnl).toFixed(0)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:18px">
                  <span style="font-size:11px;color:var(--text3)">Win Rate</span>
                  <span style="font-size:12px;font-weight:600;color:${wr>=50?'#8dc572':'#D85A30'}">${wr}%</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:18px">
                  <span style="font-size:11px;color:var(--text3)">Trades</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text)">${m.count}</span>
                </div>
                <div style="height:1px;background:var(--border);margin:2px 0"></div>
                <div style="display:flex;gap:10px">
                  <span style="font-size:10px;color:#8dc572">▲ ${m.wins} W</span>
                  <span style="font-size:10px;color:#D85A30">▼ ${m.losses} L</span>
                  <span style="font-size:10px;color:var(--text3)">σ $${std.toFixed(0)}</span>
                </div>
              </div>`;

            const cRect = chart.canvas.getBoundingClientRect();
            const aRect = document.querySelector('.app')?.getBoundingClientRect() || cRect;
            let left = cRect.left - aRect.left + tooltip.caretX + 12;
            let top  = cRect.top  - aRect.top  + tooltip.caretY - 20;
            if (left + 175 > aRect.width) left = cRect.left - aRect.left + tooltip.caretX - 170;
            tooltipEl.style.left      = left + 'px';
            tooltipEl.style.top       = top  + 'px';
            tooltipEl.style.opacity   = '1';
            tooltipEl.style.transform = 'translateY(0) scale(1)';
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Avg P&L (Net) ($)', color: tickColor, font: { size: 10 } },
          grid: { color: 'rgba(128,128,128,.1)' },
          ticks: { color: tickColor, font: { size: 10 }, callback: v => (v>=0?'+':'')+`$${v}` }
        },
        y: {
          title: { display: true, text: 'Win Rate (%)', color: tickColor, font: { size: 10 } },
          min: 0, max: 100,
          grid: { color: 'rgba(128,128,128,.1)' },
          ticks: { color: tickColor, font: { size: 10 }, callback: v => v+'%' }
        }
      }
    },
    plugins: [{
      id: 'moodLabels',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach(ds => {
          const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(ds));
          if (meta.hidden) return;
          meta.data.forEach(pt => {
            const emoji = moodEmoji[ds.label] || '●';
            ctx.save();
            ctx.font = `${Math.max(12, pt.options.radius * 0.7)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, pt.x, pt.y);
            ctx.restore();
          });
        });
      }
    }]
  });

  // Zero reference lines
  // Add legend
  if (legendEl) {
    legendEl.innerHTML = moods.map(mood => {
      const m   = moodMap[mood];
      const col = (moodColors[mood] || defaultColor).border;
      return `<span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)">
        <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block"></span>
        ${moodEmoji[mood]||''} ${mood} <span style="color:var(--text3)">(${m.count})</span>
      </span>`;
    }).join('');
  }
}

function showDrillModal(label, tradesArr) {
  const h = label.match(/^(\d{2}):/)?.[1];
  if (!h) return;
  drillToLog('stats');
  setTimeout(() => {
    const hf = document.getElementById('filt-hour');
    if (hf) { hf.value = String(parseInt(h)); renderLog(); flashActiveFilters(); }
  }, 50);
}

// ─── CHART EXPAND MODAL ────────────────────────────────────
const chartExpandDefs = {
  hourly:    { title: 'Performance by Hour of Day (Net)' },
  dayofweek: { title: 'Performance by Day of Week (Net)' },
  mood:      { title: 'Performance by Mood (Net)' },
  holdtime:  { title: 'Avg Hold Time: Wins vs Losses' },
  pricerange:{ title: 'Performance by Price Range (Net)' }
};

function expandChart(key) {
  const titles = {
    hourly:    'Performance by Hour of Day (Net)',
    dayofweek: 'Performance by Day of Week (Net)',
    mood:      'Performance by Mood (Net)',
    holdtime:  'Avg Hold Time: Wins vs Losses',
    pricerange:'Performance by Price Range (Net)'
  };

  document.getElementById('chart-modal-title').textContent = titles[key] || '';
  const body   = document.getElementById('chart-modal-body');
  const legend = document.getElementById('chart-modal-legend');
  body.innerHTML = ''; legend.innerHTML = '';
  body.style.height = '420px';

  if (key === 'hourly') {
    body.innerHTML = `<div style="position:relative;height:100%"><canvas id="exp-canvas"></canvas></div>`;
    renderHourlyInto('exp-canvas');
  } else if (key === 'dayofweek') {
    body.innerHTML = `<div id="exp-day-stats" style="padding:.5rem 0;overflow-y:auto;max-height:100%"></div>`;
    renderDayStatsInto('exp-day-stats');
  } else if (key === 'mood') {
    body.innerHTML = `<div style="position:relative;height:100%"><canvas id="exp-canvas"></canvas></div>`;
    renderMoodInto('exp-canvas', 'chart-modal-legend');
  } else if (key === 'holdtime') {
    body.innerHTML = `<div style="position:relative;height:100%"><canvas id="exp-canvas"></canvas></div>`;
    renderHoldTimeInto('exp-canvas');
  } else if (key === 'pricerange') {
    body.innerHTML = `<div style="position:relative;height:100%"><canvas id="exp-canvas"></canvas></div>`;
    renderPriceRangeInto('exp-canvas');
  }

  document.getElementById('chart-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeChartModal() {
  document.getElementById('chart-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChartModal(); });

// ── Expanded renderers (reuse logic from main renderers) ──

function renderHourlyInto(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const HOURS = []; for (let h=4;h<=18;h++) HOURS.push(h);
  const buckets = {}; HOURS.forEach(h=>{buckets[h]={pnl:0,wins:0,losses:0,count:0,trades:[]};});
  getFilteredTrades().forEach(t=>{if(!t.entryTime)return;const m=t.entryTime.match(/^(\d{1,2}):/);if(!m)return;const h=parseInt(m[1]);if(h<4||h>18)return;buckets[h].pnl+=(t.pnl-calcCommission(t));buckets[h].count++;buckets[h].trades.push(t);if(t.pnl>0)buckets[h].wins++;else if(t.pnl<0)buckets[h].losses++;});
  const pnlData    = HOURS.map(h=>buckets[h].pnl);
  const barColors  = pnlData.map(v=>v>0?'rgba(141,197,114,.85)':v<0?'rgba(216,90,48,.85)':'rgba(180,180,180,.3)');
  const barBorders = pnlData.map(v=>v>0?'#8dc572':v<0?'#D85A30':'#ccc');
  const tickColor  = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim()||'#999';
  if (expandChartInstance) expandChartInstance.destroy();
  expandChartInstance = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: HOURS.map(h=>`${String(h).padStart(2,'0')}:00`), datasets: [{
      data: pnlData, backgroundColor: barColors, borderColor: barBorders,
      borderWidth: 1.5, borderRadius: 6, borderSkipped: false
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      onClick(e, elements) {
        if (!elements.length) return;
        const i = elements[0].index;
        const h = HOURS[i];
        if (buckets[h].trades.length) showDrillModal(`${String(h).padStart(2,'0')}:00 – ${String(h+1).padStart(2,'0')}:00`, buckets[h].trades);
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const h = HOURS[ctx.dataIndex]; const b = buckets[h]; const v = b.pnl;
          return [`P&L (Net): ${v>=0?'+':''}$${Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0})}`, `Trades: ${b.count}`, `WR: ${b.count?Math.round(b.wins/b.count*100):0}%`];
        }}}
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { display: false }, border: { display: false }, ticks: { display: false }, grace: '15%' }
      }
    },
    plugins: [{
      id: 'barLabels',
      afterDatasetDraw(chart) {
        const { ctx, data } = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const v = data.datasets[0].data[i]; if (!v) return;
          const isPos = v >= 0;
          const label = (isPos?'+':'-')+'$'+(Math.abs(v)>=1000?(Math.abs(v)/1000).toFixed(1)+'K':Math.abs(v).toFixed(0));
          ctx.save();
          ctx.font = '600 10px CircularXXWeb-Bold,-apple-system,sans-serif';
          ctx.fillStyle = isPos ? '#8dc572' : '#D85A30';
          ctx.textAlign = 'center';
          ctx.textBaseline = isPos ? 'bottom' : 'top';
          ctx.fillText(label, bar.x, isPos ? bar.y - 4 : bar.y + 4);
          ctx.restore();
        });
      }
    }]
  });
}

function renderDayStatsInto(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const ds=Array(7).fill(null).map(()=>({count:0,pnl:0,wins:0}));
  getFilteredTrades().forEach(t=>{if(!t.date)return;const d=new Date(t.date+'T00:00:00').getDay();ds[d].count++;ds[d].pnl+=(t.pnl-calcCommission(t));if(t.pnl>0)ds[d].wins++;});
  const active=days.map((name,i)=>({name,...ds[i]})).filter(d=>d.count>0);
  if(!active.length){el.innerHTML='<div class="empty">No data</div>';return;}
  const maxAbs=Math.max(...active.map(d=>Math.abs(d.pnl)),1);
  el.innerHTML=`<div style="padding:.5rem 0">${active.map(d=>{const pct=Math.abs(d.pnl)/maxAbs*100;const isPos=d.pnl>=0;const color=isPos?'var(--green)':'var(--red)';const pnlStr=(isPos?'+':'-')+'$'+Math.abs(d.pnl).toLocaleString('en-US',{maximumFractionDigits:0});const wr=d.count?Math.round(d.wins/d.count*100):0;return `<div style="display:grid;grid-template-columns:48px 1fr 90px 66px;align-items:center;gap:14px;padding:8px 0"><span style="font-size:13px;font-weight:700;color:var(--text2);text-align:right">${d.name}</span><div style="position:relative;height:26px;background:var(--bg3);border-radius:4px;overflow:hidden"><div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:4px;opacity:.85"></div><div style="position:absolute;inset:0;display:flex;align-items:center;padding:0 8px"><span style="font-size:12px;font-weight:700;color:var(--text)">${pnlStr}</span></div></div><span style="font-size:12px;color:var(--text3);text-align:right">${d.count} trade${d.count!==1?'s':''}</span><span style="font-size:12px;font-weight:600;color:${wr>=50?'var(--green)':'var(--red)'};text-align:right">${wr}% WR</span></div>`;}).join('')}</div>`;
}

function renderMoodInto(canvasId, legendElId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const moodEmoji={'Focused':'😤','Calm':'😌','Stressed':'😰','Overconfident':'😎','Doubtful':'🤔','FOMO':'😱'};
  const moodColors={'Focused':{fill:'rgba(141,197,114,.75)',border:'#8dc572'},'Calm':{fill:'rgba(55,138,221,.75)',border:'#378ADD'},'Stressed':{fill:'rgba(216,90,48,.75)',border:'#D85A30'},'Overconfident':{fill:'rgba(155,89,182,.75)',border:'#9B59B6'},'Doubtful':{fill:'rgba(239,159,39,.75)',border:'#EF9F27'},'FOMO':{fill:'rgba(231,76,60,.75)',border:'#E74C3C'}};
  const moodMap={};
  getFilteredTrades().forEach(t=>{if(!t.mood)return;if(!moodMap[t.mood])moodMap[t.mood]={pnls:[],wins:0,losses:0,count:0,totalPnl:0};const m=moodMap[t.mood];const net=t.pnl-calcCommission(t);m.pnls.push(net);m.count++;m.totalPnl+=net;if(t.pnl>0)m.wins++;else if(t.pnl<0)m.losses++;});
  const moods=Object.keys(moodMap);
  if(!moods.length){el.style.display='none';return;}
  const maxCount=Math.max(...moods.map(m=>moodMap[m].count));
  const tickColor=getComputedStyle(document.documentElement).getPropertyValue('--text3').trim()||'#999';
  const ds=moods.map(mood=>{const m=moodMap[mood];const avgPnl=m.totalPnl/m.count;const wr=Math.round(m.wins/m.count*100);const r=12+(m.count/maxCount)*34;const col=moodColors[mood]||{fill:'rgba(150,150,150,.6)',border:'#999'};return{label:mood,data:[{x:avgPnl,y:wr,r}],backgroundColor:col.fill,borderColor:col.border,borderWidth:2};});
  if(expandChartInstance)expandChartInstance.destroy();
  expandChartInstance=new Chart(el.getContext('2d'),{type:'bubble',data:{datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:{duration:700,easing:'easeOutElastic'},plugins:{legend:{display:false},tooltip:{callbacks:{title:ctx=>ctx[0]?.dataset?.label||'',label:ctx=>{const mood=ctx.dataset.label;const m=moodMap[mood];const avgPnl=m.totalPnl/m.count;const wr=Math.round(m.wins/m.count*100);return[`Avg P&L (Net): ${avgPnl>=0?'+':''}$${Math.abs(avgPnl).toFixed(0)}`,`Win Rate: ${wr}%`,`Trades: ${m.count}`,`▲${m.wins} ▼${m.losses}`];}}}},scales:{x:{title:{display:true,text:'Avg P&L (Net) ($)',color:tickColor,font:{size:11}},grid:{color:'rgba(128,128,128,.1)'},ticks:{color:tickColor,callback:v=>(v>=0?'+':'')+`$${v}`}},y:{title:{display:true,text:'Win Rate (%)',color:tickColor,font:{size:11}},min:0,max:100,grid:{color:'rgba(128,128,128,.1)'},ticks:{color:tickColor,callback:v=>v+'%'}}}},plugins:[{id:'moodLabels',afterDatasetsDraw(chart){const ctx2=chart.ctx;chart.data.datasets.forEach(ds2=>{const meta=chart.getDatasetMeta(chart.data.datasets.indexOf(ds2));if(meta.hidden)return;meta.data.forEach(pt=>{const emoji=moodEmoji[ds2.label]||'●';ctx2.save();ctx2.font=`${Math.max(14,pt.options.radius*.7)}px serif`;ctx2.textAlign='center';ctx2.textBaseline='middle';ctx2.fillText(emoji,pt.x,pt.y);ctx2.restore();});});}}]});
  const lEl=document.getElementById(legendElId);
  if(lEl)lEl.innerHTML=moods.map(mood=>{const col=(moodColors[mood]||{border:'#999'}).border;const m=moodMap[mood];return`<span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)"><span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block"></span>${moodEmoji[mood]||''} ${mood} <span style="color:var(--text3)">(${m.count})</span></span>`;}).join('');
}

function renderHoldTimeInto(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  // Build hold time data
  let winMins = [], lossMins = [];
  getFilteredTrades().forEach(t => {
    const mins = parseDurMins(t.duration);
    if (!mins) return;
    if (t.pnl > 0) winMins.push(mins);
    else if (t.pnl < 0) lossMins.push(mins);
  });
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const avgW = avg(winMins), avgL = avg(lossMins);
  const fmt = m => m >= 60 ? `${(m/60).toFixed(1)}h` : `${Math.round(m)}m`;
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim()||'#999';
  if (expandChartInstance) expandChartInstance.destroy();
  expandChartInstance = new Chart(el.getContext('2d'), {
    type:'bar',
    data:{labels:['Wins','Losses'],datasets:[{data:[avgW,avgL],backgroundColor:['rgba(141,197,114,.8)','rgba(216,90,48,.8)'],borderColor:['#8dc572','#D85A30'],borderWidth:1.5,borderRadius:8}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:500},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Avg: ${fmt(ctx.raw)}`}}},scales:{x:{grid:{display:false},ticks:{color:tickColor}},y:{grid:{color:'rgba(128,128,128,.1)'},ticks:{color:tickColor,callback:v=>fmt(v)}}}}
  });
}

function renderPriceRangeInto(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const ranges = [{label:'<$5',min:0,max:5},{label:'$5-15',min:5,max:15},{label:'$15-50',min:15,max:50},{label:'$50-100',min:50,max:100},{label:'>$100',min:100,max:Infinity}];
  const buckets = ranges.map(()=>({pnl:0,count:0,wins:0}));
  getFilteredTrades().forEach(t => {
    if (!t.entry) return;
    const idx = ranges.findIndex(r=>t.entry>=r.min && t.entry<r.max);
    if (idx<0) return;
    buckets[idx].pnl+=(t.pnl-calcCommission(t)); buckets[idx].count++;
    if (t.pnl>0) buckets[idx].wins++;
  });
  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim()||'#999';
  if (expandChartInstance) expandChartInstance.destroy();
  expandChartInstance = new Chart(el.getContext('2d'), {
    type:'bar',
    data:{labels:ranges.map(r=>r.label),datasets:[{data:buckets.map(b=>b.pnl),backgroundColor:buckets.map(b=>b.pnl>0?'rgba(141,197,114,.8)':'rgba(216,90,48,.8)'),borderColor:buckets.map(b=>b.pnl>0?'#8dc572':'#D85A30'),borderWidth:1.5,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:500},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>{const b=buckets[ctx.dataIndex];return[`P&L (Net): ${b.pnl>=0?'+':''}$${Math.abs(b.pnl).toFixed(0)}`,`Trades: ${b.count}`,`WR: ${b.count?Math.round(b.wins/b.count*100):0}%`];}}}},scales:{x:{grid:{display:false},ticks:{color:tickColor}},y:{grid:{color:'rgba(128,128,128,.1)'},ticks:{color:tickColor,callback:v=>(v>=0?'+':'')+`$${Math.abs(v)>=1000?(v/1000).toFixed(1)+'K':Math.abs(v)}`}}}}
  });
}

let expandChartInstance = null;

function parseDurMins(dur) {
  if (!dur) return 0;
  const hm = dur.match(/(\d+)h/); const mm = dur.match(/(\d+)m/);
  return (hm ? parseInt(hm[1])*60 : 0) + (mm ? parseInt(mm[1]) : 0);
}

function drawMiniDonut(id, posVal, negVal, posColor, negColor) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (donutInstances[id]) donutInstances[id].destroy();
  // Sync canvas pixel dimensions to current CSS size so chart fills the wrap
  const sz = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--donut-sz')) || 58;
  canvas.width  = sz;
  canvas.height = sz;
  const total = Math.abs(posVal) + Math.abs(negVal);
  const data = total > 0 ? [Math.abs(posVal), Math.abs(negVal)] : [1, 0];
  const colors = total > 0 ? [posColor, negColor] : ['#e0dfd8', '#e0dfd8'];
  donutInstances[id] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#eeede9', hoverOffset: 0, borderRadius: 4 }] },
    options: { cutout: '58%', responsive: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 300 } }
  });
}


// ─── THEME OBSERVER — update tooltip backgrounds on dark/light switch ────────
// toggleTheme() only calls updateStats(), not renderStats(), so the chart
// tooltip elements already in the DOM keep their stale background color.
// This observer fires immediately when data-theme changes and patches them.
(function initTooltipThemeObserver() {
  function applyTooltipTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const darkBg     = 'rgba(28,28,28,.92)';
    const lightBg    = 'rgba(255,255,255,.85)';
    const lightBgMood = 'rgba(255,255,255,.75)';
    const bg     = isDark ? darkBg : lightBg;
    const bgMood = isDark ? darkBg : lightBgMood;
    ['equity-tooltip', 'hourly-tooltip'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.background = bg;
    });
    const moodEl = document.getElementById('mood-tooltip');
    if (moodEl) moodEl.style.background = bgMood;
  }

  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.attributeName === 'data-theme') applyTooltipTheme();
    });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();

// ─── EXPOSE PUBLIC API ─────────────────────────────────────────────────────
// Required so that refreshAll(), showPage(), save(), inline onclick, and the
// bootstrap script can all resolve these without modification.
window.updateStats     = updateStats;
window.renderStats     = renderStats;
window.expandChart     = expandChart;
window.closeChartModal = closeChartModal;
// window.calcCommission is set in app.js
