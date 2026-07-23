/**
 * calendarPage.js — Calendar Module
 * Extracted from EdgeBook_v30.html
 *
 * Depends on globals from the main script block (must be declared before this file loads):
 *   trades              — global array (read-only here; never mutated by calendar)
 *   getFilteredTrades() — used only by renderMonthlyCalendar()
 *   loadJournal(), saveJournal(), toast() — app.js; used for No Trade Day entries
 *   localStorage        — native browser API (holiday persistence)
 *
 * Public API exposed on window (called from showPage(), refreshAll(), inline onclick):
 *   renderCalPage()          — primary calendar render; called by showPage() and refreshAll()
 *   renderMonthlyCalendar()  — monthly summary render (currently has no call site — preserved as-is)
 *   calNav(dir)
 *   setCalSubMode(sub)
 *   setCalMode(mode)         — legacy compat alias
 *   toggleHolidayMode()
 *   toggleHoliday(dateStr)
 *   deleteNtdFromCalendar(dateStr) — delete a No Trade Day entry from the day panel
 *   getISOWeek(dt)           — pure helper; exposed for safety
 *
 * Load order: AFTER main </script> block, BEFORE the bottom bootstrap <script>.
 * i.e. after <script src="tradeList.js">, before <script>renderHomeList()...</script>
 *
 * No imports from tradeForm.js or tradeList.js.
 */

// ─── CALENDAR STATE ────────────────────────────────────────
let calYear        = new Date().getFullYear();
let calMonth       = new Date().getMonth();
const calScope     = 'single'; // always Timeline; Grid mode removed
let calSubMode     = 'normal'; // 'normal' | 'focus' | 'cumulative'
let calHolidayMode = false;
let holidays       = JSON.parse(localStorage.getItem('edgebook_holidays') || '[]');

// Derived: returns the active sub-mode (calScope is always 'single' / Timeline)
function getCalMode() {
  return calSubMode;
}

// ─── NAVIGATION ────────────────────────────────────────────
function calNav(dir) {
  if (dir === 0) {
    calYear  = new Date().getFullYear();
    calMonth = new Date().getMonth();
  } else {
    calMonth += dir;
    if (calMonth > 11) { calMonth = 0;  calYear++; }
    if (calMonth <  0) { calMonth = 11; calYear--; }
  }
  renderCalPage();
}

function setCalSubMode(sub) {
  calSubMode = sub;
  updateCalModeButtons();
  renderCalPage();
}

// Keep old setCalMode as alias for backward compatibility
function setCalMode(mode) {
  calSubMode = mode;
  updateCalModeButtons();
  renderCalPage();
}

// ─── BUTTON SYNC ───────────────────────────────────────────
function updateCalModeButtons() {
  // Sub-mode buttons (Normal / Focus / Cumulative)
  ['normal', 'focus', 'cumulative'].forEach(m => {
    const btn = document.getElementById('cal-mode-' + m);
    if (!btn) return;
    btn.classList.toggle('active', m === calSubMode);
  });
}

// ─── HOLIDAY MODE ──────────────────────────────────────────
function toggleHolidayMode() {
  calHolidayMode = !calHolidayMode;
  const btn = document.getElementById('cal-holiday-btn');
  if (btn) {
    btn.style.background = calHolidayMode ? 'var(--amber)' : '';
    btn.style.color      = calHolidayMode ? '#fff'         : '';
  }
}

function toggleHoliday(dateStr) {
  if (!calHolidayMode) return;
  if (holidays.includes(dateStr)) {
    holidays = holidays.filter(d => d !== dateStr);
  } else {
    holidays.push(dateStr);
  }
  localStorage.setItem('edgebook_holidays', JSON.stringify(holidays));
  renderCalPage();
}

// ─── CALENDAR-LOCAL FILTERS ────────────────────────────────
function getCalFilteredTrades() {
  const sym  = (document.getElementById('cal-filt-sym')?.value  || '').trim().toUpperCase();
  const year = document.getElementById('cal-filt-year')?.value  || '';
  const mo   = document.getElementById('cal-filt-month')?.value || '';
  return trades.filter(t => {
    if (sym  && !(t.sym || '').toUpperCase().includes(sym)) return false;
    if (year && !t.date?.startsWith(year))                  return false;
    if (mo   && t.date?.slice(5, 7) !== mo)                 return false;
    return true;
  });
}

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function initCalYearDropdown() {
  const sel = document.getElementById('cal-filt-year');
  if (!sel) return;
  const prev = sel.value;
  const years = [...new Set(trades.map(t => t.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  sel.innerHTML = '<option value="">All Years</option>' +
    years.map(y => `<option value="${y}"${y === prev ? ' selected' : ''}>${y}</option>`).join('');
}

function initCalMonthDropdown(year) {
  const sel = document.getElementById('cal-filt-month');
  if (!sel) return;
  const prev = sel.value;
  // collect months that exist for this year
  const months = [...new Set(
    trades.filter(t => t.date?.startsWith(year)).map(t => t.date.slice(5, 7))
  )].sort();
  sel.innerHTML = '<option value="">All Months</option>' +
    months.map(m => `<option value="${m}"${m === prev ? ' selected' : ''}>${MONTH_NAMES_SHORT[parseInt(m) - 1]}</option>`).join('');
}

function onCalYearChange() {
  const yearSel  = document.getElementById('cal-filt-year');
  const monthSel = document.getElementById('cal-filt-month');
  if (!yearSel || !monthSel) return;
  const hasYear = !!yearSel.value;
  monthSel.disabled = !hasYear;
  monthSel.style.opacity = hasYear ? '1' : '.4';
  monthSel.style.cursor  = hasYear ? 'pointer' : 'default';
  monthSel.value = '';
  if (hasYear) initCalMonthDropdown(yearSel.value);
  else monthSel.innerHTML = '<option value="">All Months</option>';
  renderCalPage();
}

// ─── MAIN RENDER ───────────────────────────────────────────
function renderCalPage() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const titleEl = document.getElementById('cal-page-title');
  const gridEl  = document.getElementById('cal-grid');
  if (!titleEl || !gridEl) return;

  // Title
  titleEl.className = 'page-title';
  titleEl.innerHTML = 'Calendar';
  titleEl.style.visibility = 'visible';
  titleEl.style.marginBottom = '';
  titleEl.style.height = '';
  titleEl.style.overflow = '';
  updateCalModeButtons();

  // Nav arrows: hidden (not used in Timeline mode)
  const navGroup = document.getElementById('cal-nav-group');
  if (navGroup) navGroup.style.visibility = 'hidden';

  // Build day→data map — respects cal-local filters (sym/year/month)
  const dayMap = {};
  getCalFilteredTrades().forEach(t => {
    if (!t.date) return;
    if (!dayMap[t.date]) dayMap[t.date] = { pnl: 0, fees: 0, net: 0, count: 0 };
    const _fee = typeof calcCommission === 'function' ? calcCommission(t) : 0;
    dayMap[t.date].pnl   = parseFloat((dayMap[t.date].pnl  + parseFloat(t.pnl)).toFixed(2));
    dayMap[t.date].fees  = parseFloat((dayMap[t.date].fees  + _fee).toFixed(2));
    dayMap[t.date].net   = parseFloat((dayMap[t.date].net   + parseFloat(t.pnl) - _fee).toFixed(2));
    dayMap[t.date].count += 1;
  });

  // Build NTD map — { 'YYYY-MM-DD': { positive: bool, reason, note } }
  const ntdMap = typeof loadJournal === 'function'
    ? loadJournal().reduce((m, e) => { if (e.type === 'ntd') m[e.date] = e; return m; }, {})
    : {};

  const today  = new Date();
  const pad    = n  => String(n).padStart(2, '0');
  const fmt    = pnl => `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const pnlCls = pnl => pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';

  // ── SINGLE scope: scrollable full-history view ────────────
  const dayNames7  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const allDateKeys = Object.keys(dayMap).sort();
  const ntdDateKeys = Object.keys(ntdMap);
  if (!allDateKeys.length && !ntdDateKeys.length) { gridEl.innerHTML = `<div class="empty">No trades found.</div>`; return; }

  // Build cumulative map (used when calSubMode === 'cumulative') — uses gross P&L
  // Deliberately trade-based only (ntd days have no P&L to accumulate).
  let runningTotal = 0;
  const cumMap = {};
  allDateKeys.forEach(d => { runningTotal += dayMap[d].pnl; cumMap[d] = runningTotal; });

  // Generate month list from months that have either real trades OR a marked
  // no-trade-day, descending. Previously this only looked at dayMap (trades),
  // so a month containing nothing but a no-trade-day entry never got a
  // section rendered — the day existed in ntdMap but its month never made it
  // into the list, so it was never reachable in the calendar view.
  const monthSet = new Set([...allDateKeys, ...ntdDateKeys].map(d => d.slice(0, 7)));
  const monthList = [...monthSet]
    .sort((a, b) => b.localeCompare(a))
    .map(mk => ({ yr: parseInt(mk.slice(0, 4)), mo: parseInt(mk.slice(5, 7)) - 1 }));

  let html = '';
  let currentYr = null;

  monthList.forEach(({ yr, mo }) => {
    if (yr !== currentYr) {
      if (currentYr !== null) html += `</div>`;
      html += `<div style="margin-bottom:1.5rem"><div class="multi-year-heading">${yr}</div>`;
      currentYr = yr;
    }

    const monthKey   = `${yr}-${pad(mo + 1)}`;
    const monthPnl   = parseFloat(Object.keys(dayMap).filter(d => d.startsWith(monthKey)).reduce((s, d) => parseFloat((s + dayMap[d].pnl).toFixed(2)), 0).toFixed(2));
    const monthCount = Object.keys(dayMap).filter(d => d.startsWith(monthKey)).reduce((s, d) => s + dayMap[d].count, 0);
    const monthPnlHtml = monthCount > 0
      ? `<span class="day-cell-pnl ${pnlCls(monthPnl)}" style="font-size:12px">${fmt(monthPnl)}</span><span class="day-cell-count" style="font-size:10px;margin-right:4px">${monthCount} trade${monthCount !== 1 ? 's' : ''}</span>`
      : `<span style="font-size:11px;color:var(--border2)">no trades</span>`;

    let gridHtml = '';

    // ── FOCUS sub-mode ─────────────────────────────────────
    if (calSubMode === 'focus') {
      const lastDay   = new Date(yr, mo + 1, 0);
      const weekMap   = {};
      const weekOrder = [];
      for (let d = 1; d <= lastDay.getDate(); d++) {
        const dt = new Date(yr, mo, d);
        if (dt.getDay() === 0 || dt.getDay() === 6) continue;
        const wk = getISOWeek(dt);
        if (!weekMap[wk]) { weekMap[wk] = []; weekOrder.push(wk); }
        weekMap[wk].push(dt);
      }
      const focusHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Wk'];
      let cells = '';
      weekOrder.forEach((wk, wi) => {
        const row = [null, null, null, null, null];
        weekMap[wk].forEach(dt => { row[dt.getDay() - 1] = dt; });
        let weekPnl = 0, weekCount = 0;
        [0, 1, 2, 3, 4].forEach(slot => {
          const dt = row[slot];
          if (!dt) { cells += `<div class="day-cell other-month"></div>`; return; }
          const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          const isToday = dt.toDateString() === today.toDateString();
          const data    = dayMap[dateStr];
          const isHol   = holidays.includes(dateStr);
          if (data) { weekPnl = parseFloat((weekPnl + data.pnl).toFixed(2)); weekCount += data.count; }
          const numHtml = isToday
            ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${dt.getDate()}</div>`
            : `<div class="day-cell-num">${dt.getDate()}</div>`;
          const ntd = ntdMap[dateStr];
          cells += `<div class="day-cell${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${ntd && !data ? (ntd.positive ? ' ntd-good' : ' ntd-bad') : ''}" data-date="${dateStr}" onclick="selectCalDay('${dateStr}')">
            ${numHtml}
            ${isHol ? '' : ntd && !data ? `<div class="day-cell-ntd">${ntd.positive ? '—' : '✗'}</div>` : data ? `<div class="day-cell-pnl ${pnlCls(data.pnl)}">${fmt(data.pnl)}</div><div class="day-cell-count">${data.count} trade${data.count !== 1 ? 's' : ''}</div>` : ''}</div>`;
        });
        const wkCls = weekPnl > 0 ? 'pos-week' : weekPnl < 0 ? 'neg-week' : '';
        cells += `<div class="day-cell week-summary ${wkCls}">
          <div class="week-sum-label">Week ${wi + 1}</div>
          ${weekCount > 0
            ? `<div class="week-sum-pnl ${pnlCls(weekPnl)}">${fmt(weekPnl)}</div><div class="week-sum-count">${weekCount} trade${weekCount !== 1 ? 's' : ''}</div>`
            : `<div class="week-sum-count" style="margin-top:4px">—</div>`}
        </div>`;
      });
      gridHtml = `
        <div class="day-grid-focus-header" style="grid-template-columns:repeat(6,1fr)">${focusHeaders.map(h => `<span style="text-align:center;font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;padding:3px 0">${h}</span>`).join('')}</div>
        <div class="day-grid-focus" style="grid-template-columns:repeat(6,1fr)">${cells}</div>`;

    // ── CUMULATIVE sub-mode ────────────────────────────────
    } else if (calSubMode === 'cumulative') {
      const firstDay   = new Date(yr, mo, 1);
      const lastDay    = new Date(yr, mo + 1, 0);
      const startPad   = firstDay.getDay();
      const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;
      let cells = '';
      for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(yr, mo, 1 + (i - startPad));
        const isOther  = cellDate.getMonth() !== mo;
        const isToday  = cellDate.toDateString() === today.toDateString();
        const dateStr  = `${cellDate.getFullYear()}-${pad(cellDate.getMonth() + 1)}-${pad(cellDate.getDate())}`;
        const data     = !isOther ? dayMap[dateStr] : null;
        const isHol    = !isOther && holidays.includes(dateStr);
        const cumVal   = !isOther ? cumMap[dateStr] : null;
        const numHtml  = isToday
          ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${cellDate.getDate()}</div>`
          : `<div class="day-cell-num">${isOther ? '' : cellDate.getDate()}</div>`;
        const ntd = !isOther ? ntdMap[dateStr] : null;
        cells += `<div class="day-cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${ntd && !data ? (ntd.positive ? ' ntd-good' : ' ntd-bad') : ''}" data-date="${isOther ? '' : dateStr}" onclick="if(!${isOther})selectCalDay('${dateStr}')">
          ${numHtml}
          ${!isOther && !isHol && ntd && !data ? `<div class="day-cell-ntd">${ntd.positive ? '—' : '✗'}</div>` : ''}
          ${!isOther && !isHol && cumVal != null ? `<div class="day-cell-pnl ${pnlCls(cumVal)}">${fmt(cumVal)}</div><div class="day-cell-count" style="opacity:.55;font-size:9px">${data ? fmt(data.pnl) + ' day' : ''}</div>` : ''}</div>`;
      }
      gridHtml = `<div class="day-grid-header">${dayNames7.map(d => `<span>${d}</span>`).join('')}</div><div class="day-grid">${cells}</div>`;

    // ── NORMAL sub-mode (default) ──────────────────────────
    } else {
      const firstDay   = new Date(yr, mo, 1);
      const lastDay    = new Date(yr, mo + 1, 0);
      const startPad   = firstDay.getDay();
      const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;
      let cells = '';
      for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(yr, mo, 1 + (i - startPad));
        const isOther  = cellDate.getMonth() !== mo;
        const isToday  = cellDate.toDateString() === today.toDateString();
        const dateStr  = `${cellDate.getFullYear()}-${pad(cellDate.getMonth() + 1)}-${pad(cellDate.getDate())}`;
        const data     = !isOther ? dayMap[dateStr] : null;
        const isHol    = !isOther && holidays.includes(dateStr);
        const numHtml  = isToday
          ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${cellDate.getDate()}</div>`
          : `<div class="day-cell-num">${isOther ? '' : cellDate.getDate()}</div>`;
        const ntd = !isOther ? ntdMap[dateStr] : null;
        cells += `<div class="day-cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${ntd && !data ? (ntd.positive ? ' ntd-good' : ' ntd-bad') : ''}" data-date="${isOther ? '' : dateStr}" onclick="if(!${isOther})selectCalDay('${dateStr}')">
          ${numHtml}
          ${!isOther && !isHol && ntd && !data ? `<div class="day-cell-ntd">${ntd.positive ? '—' : '✗'}</div>` : ''}
          ${!isOther && !isHol && data ? `<div class="day-cell-pnl ${pnlCls(data.pnl)}">${fmt(data.pnl)}</div><div class="day-cell-count">${data.count} trade${data.count !== 1 ? 's' : ''}</div>` : ''}</div>`;
      }
      gridHtml = `<div class="day-grid-header">${dayNames7.map(d => `<span>${d}</span>`).join('')}</div><div class="day-grid">${cells}</div>`;
    }

    html += `<div class="multi-month-wrap" style="margin-bottom:1.5rem">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.5rem;direction:ltr">
        <span class="multi-year-heading" style="font-size:13px;margin:0;border:none;padding:0">${monthNames[mo]}</span>
        <span style="display:flex;align-items:center;gap:8px">${monthPnlHtml}<button onclick="event.stopPropagation();openCalZoom(${yr}, ${mo})" title="Expand" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:2px;line-height:1;transition:color .15s;display:flex;align-items:center" onmouseenter="this.style.color='var(--text)'" onmouseleave="this.style.color='var(--text3)'"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button></span>
      </div>
      ${gridHtml}
    </div>`;
  });

  if (currentYr !== null) html += `</div>`;
  gridEl.style.cssText = '';
  gridEl.innerHTML = html;
}

// ─── ISO WEEK HELPER ───────────────────────────────────────
function getISOWeek(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-${String(wn).padStart(2, '0')}`;
}

// ─── MONTHLY CALENDAR ──────────────────────────────────────
// NOTE: This function is defined but has no call site in the current codebase.
// It was previously orphaned and is preserved as-is. Do not add a call without
// verifying the intended render location and trigger point.
// NOTE: This function aggregates monthMap[mk].pnl using gross P&L only (no fees).
// If this function is ever activated, it must be updated to use Net P&L (pnl - calcCommission(t))
// to stay consistent with the rest of the Calendar module.
function renderMonthlyCalendar() {
  const el = document.getElementById('monthly-calendar');
  if (!el) return;
  document.getElementById('monthly-cal-wrap').style.display = 'block';
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const monthMap = {};
  getFilteredTrades().forEach(t => {
    if (!t.date) return;
    const mk = t.date.slice(0, 7); // YYYY-MM
    if (!monthMap[mk]) monthMap[mk] = { pnl: 0, count: 0, year: t.date.slice(0, 4), month: parseInt(t.date.slice(5, 7)) - 1 };
    monthMap[mk].pnl   += t.pnl;
    monthMap[mk].count += 1;
  });

  if (!Object.keys(monthMap).length) { el.innerHTML = '<div class="empty">No trades yet</div>'; return; }

  const sorted = Object.entries(monthMap).sort((a, b) => b[0].localeCompare(a[0]));
  const byYear = {};
  sorted.forEach(([mk, data]) => {
    if (!byYear[data.year]) byYear[data.year] = [];
    byYear[data.year].push({ mk, ...data });
  });

  const years = Object.keys(byYear).sort((a, b) => b - a);
  el.innerHTML = years.map((year, yi) => {
    const months = byYear[year];
    const cells = months.map(m => {
      const cls    = m.pnl > 0 ? 'pos' : m.pnl < 0 ? 'neg' : 'zero';
      const pnlStr = (m.pnl > 0 ? '+' : m.pnl < 0 ? '-' : '') + '$' + Math.abs(m.pnl).toLocaleString('en-US', { maximumFractionDigits: 0 });
      return `<div class="month-cell">
        <div class="month-cell-name">${monthNames[m.month]}</div>
        <div class="month-cell-pnl ${cls}">${pnlStr}</div>
        <div class="month-cell-count">${m.count} trade${m.count !== 1 ? 's' : ''}</div>
      </div>`;
    }).join('');
    return `<div class="month-cal-year${yi === 0 ? ' first' : ''}" style="${yi === 0 ? 'border-top:none;padding-top:0' : 'border-top:2px solid var(--border);padding-top:1.2rem;margin-top:1.2rem'}">${year}</div>
    <div class="month-grid">${cells}</div>`;
  }).join('');
}


// ─── MONTH ZOOM ────────────────────────────────────────────
function openCalZoom(yr, mo) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const overlay = document.getElementById('cal-zoom-overlay');
  const titleEl = document.getElementById('cal-zoom-title');
  const bodyEl  = document.getElementById('cal-zoom-body');
  if (!overlay || !titleEl || !bodyEl) return;

  titleEl.innerHTML = monthNames[mo] + ' ' + yr;

  // Build dayMap from all trades
  const dayMap = {};
  trades.forEach(t => {
    if (!t.date) return;
    if (!dayMap[t.date]) dayMap[t.date] = { pnl: 0, fees: 0, net: 0, count: 0 };
    const _fee = typeof calcCommission === 'function' ? calcCommission(t) : 0;
    dayMap[t.date].pnl   = parseFloat((dayMap[t.date].pnl  + parseFloat(t.pnl)).toFixed(2));
    dayMap[t.date].fees  = parseFloat((dayMap[t.date].fees  + _fee).toFixed(2));
    dayMap[t.date].net   = parseFloat((dayMap[t.date].net   + parseFloat(t.pnl) - _fee).toFixed(2));
    dayMap[t.date].count += 1;
  });

  // Build NTD map for zoom modal
  const ntdMap = typeof loadJournal === 'function'
    ? loadJournal().reduce((m, e) => { if (e.type === 'ntd') m[e.date] = e; return m; }, {})
    : {};

  // Build cumulative map — uses gross P&L
  const allDateKeys = Object.keys(dayMap).sort();
  let running = 0;
  const cumMap = {};
  allDateKeys.forEach(d => { running += dayMap[d].pnl; cumMap[d] = running; });

  const pad    = n  => String(n).padStart(2, '0');
  const fmt    = pnl => `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const pnlCls = pnl => pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
  const today  = new Date();
  const dayNames7 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let gridHtml = '';

  if (calSubMode === 'focus') {
    const lastDay   = new Date(yr, mo + 1, 0);
    const weekMap   = {};
    const weekOrder = [];
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dt = new Date(yr, mo, d);
      if (dt.getDay() === 0 || dt.getDay() === 6) continue;
      const wk = getISOWeek(dt);
      if (!weekMap[wk]) { weekMap[wk] = []; weekOrder.push(wk); }
      weekMap[wk].push(dt);
    }
    const focusHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Wk'];
    let cells = '';
    weekOrder.forEach((wk, wi) => {
      const row = [null, null, null, null, null];
      weekMap[wk].forEach(dt => { row[dt.getDay() - 1] = dt; });
      let weekPnl = 0, weekCount = 0;
      [0, 1, 2, 3, 4].forEach(slot => {
        const dt = row[slot];
        if (!dt) { cells += `<div class="day-cell other-month"></div>`; return; }
        const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const isToday = dt.toDateString() === today.toDateString();
        const data    = dayMap[dateStr];
        const isHol   = holidays.includes(dateStr);
        if (data) { weekPnl = parseFloat((weekPnl + data.pnl).toFixed(2)); weekCount += data.count; }
        const numHtml = isToday
          ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${dt.getDate()}</div>`
          : `<div class="day-cell-num">${dt.getDate()}</div>`;
        cells += `<div class="day-cell${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${ntdMap[dateStr] && !data ? (ntdMap[dateStr].positive ? ' ntd-good' : ' ntd-bad') : ''}">
          ${numHtml}${isHol ? '' : ntdMap[dateStr] && !data ? `<div class="day-cell-ntd">${ntdMap[dateStr].positive ? '—' : '✗'}</div>` : data ? `<div class="day-cell-pnl ${pnlCls(data.pnl)}">${fmt(data.pnl)}</div><div class="day-cell-count">${data.count} trade${data.count !== 1 ? 's' : ''}</div>` : ''}</div>`;
      });
      const wkCls = weekPnl > 0 ? 'pos-week' : weekPnl < 0 ? 'neg-week' : '';
      cells += `<div class="day-cell week-summary ${wkCls}">
        <div class="week-sum-label">Week ${wi + 1}</div>
        ${weekCount > 0
          ? `<div class="week-sum-pnl ${pnlCls(weekPnl)}">${fmt(weekPnl)}</div><div class="week-sum-count">${weekCount} trade${weekCount !== 1 ? 's' : ''}</div>`
          : `<div class="week-sum-count" style="margin-top:4px">—</div>`}
      </div>`;
    });
    gridHtml = `
      <div class="day-grid-focus-header" style="grid-template-columns:repeat(6,1fr)">${focusHeaders.map(h => `<span style="text-align:center;font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;padding:3px 0">${h}</span>`).join('')}</div>
      <div class="day-grid-focus" style="grid-template-columns:repeat(6,1fr)">${cells}</div>`;

  } else if (calSubMode === 'cumulative') {
    const firstDay   = new Date(yr, mo, 1);
    const lastDay    = new Date(yr, mo + 1, 0);
    const startPad   = firstDay.getDay();
    const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;
    let cells = '';
    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(yr, mo, 1 + (i - startPad));
      const isOther  = cellDate.getMonth() !== mo;
      const isToday  = cellDate.toDateString() === today.toDateString();
      const dateStr  = `${cellDate.getFullYear()}-${pad(cellDate.getMonth() + 1)}-${pad(cellDate.getDate())}`;
      const data     = !isOther ? dayMap[dateStr] : null;
      const isHol    = !isOther && holidays.includes(dateStr);
      const cumVal   = !isOther ? cumMap[dateStr] : null;
      const numHtml  = isToday
        ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${cellDate.getDate()}</div>`
        : `<div class="day-cell-num">${isOther ? '' : cellDate.getDate()}</div>`;
      cells += `<div class="day-cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${!isOther && ntdMap[dateStr] && !data ? (ntdMap[dateStr].positive ? ' ntd-good' : ' ntd-bad') : ''}">
        ${numHtml}
        ${!isOther && !isHol && ntdMap[dateStr] && !data ? `<div class="day-cell-ntd">${ntdMap[dateStr].positive ? '—' : '✗'}</div>` : ''}
        ${!isOther && !isHol && cumVal != null ? `<div class="day-cell-pnl ${pnlCls(cumVal)}">${fmt(cumVal)}</div><div class="day-cell-count" style="opacity:.55;font-size:9px">${data ? fmt(data.pnl) + ' day' : ''}</div>` : ''}</div>`;
    }
    gridHtml = `<div class="day-grid-header">${dayNames7.map(d => `<span>${d}</span>`).join('')}</div><div class="day-grid">${cells}</div>`;

  } else {
    // normal
    const firstDay   = new Date(yr, mo, 1);
    const lastDay    = new Date(yr, mo + 1, 0);
    const startPad   = firstDay.getDay();
    const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;
    let cells = '';
    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(yr, mo, 1 + (i - startPad));
      const isOther  = cellDate.getMonth() !== mo;
      const isToday  = cellDate.toDateString() === today.toDateString();
      const dateStr  = `${cellDate.getFullYear()}-${pad(cellDate.getMonth() + 1)}-${pad(cellDate.getDate())}`;
      const data     = !isOther ? dayMap[dateStr] : null;
      const isHol    = !isOther && holidays.includes(dateStr);
      const numHtml  = isToday
        ? `<div class="day-cell-num" style="background:var(--text);color:var(--bg);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px">${cellDate.getDate()}</div>`
        : `<div class="day-cell-num">${isOther ? '' : cellDate.getDate()}</div>`;
      cells += `<div class="day-cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}${data ? ' has-trades' : ''}${isHol ? ' holiday' : ''}${!isOther && ntdMap[dateStr] && !data ? (ntdMap[dateStr].positive ? ' ntd-good' : ' ntd-bad') : ''}">
        ${numHtml}
        ${!isOther && !isHol && ntdMap[dateStr] && !data ? `<div class="day-cell-ntd">${ntdMap[dateStr].positive ? '—' : '✗'}</div>` : ''}
        ${!isOther && !isHol && data ? `<div class="day-cell-pnl ${pnlCls(data.pnl)}">${fmt(data.pnl)}</div><div class="day-cell-count">${data.count} trade${data.count !== 1 ? 's' : ''}</div>` : ''}</div>`;
    }
    gridHtml = `<div class="day-grid-header">${dayNames7.map(d => `<span>${d}</span>`).join('')}</div><div class="day-grid">${cells}</div>`;
  }

  bodyEl.innerHTML = gridHtml;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCalZoom(e) {
  // close only if clicking the overlay backdrop (not the box itself)
  if (e && e.target !== document.getElementById('cal-zoom-overlay')) return;
  const overlay = document.getElementById('cal-zoom-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── DAY SELECTION + RIGHT PANEL ──────────────────────────
let _selectedCalDay = null;

function selectCalDay(dateStr) {
  // Holiday mode: delegate entirely to toggleHoliday
  if (calHolidayMode) { toggleHoliday(dateStr); return; }
  _selectedCalDay = dateStr;
  // Highlight selected cell
  document.querySelectorAll('#cal-grid .day-cell.cal-day-selected')
    .forEach(el => el.classList.remove('cal-day-selected'));
  document.querySelectorAll(`#cal-grid .day-cell[data-date="${dateStr}"]`)
    .forEach(el => el.classList.add('cal-day-selected'));
  renderCalDayPanel(dateStr);
}

function renderCalDayPanel(dateStr) {
  const panel = document.getElementById('right-panel-cal-day');
  if (!panel) return;

  // Format date for display: "Mon May 5, 2025"
  const dt = new Date(dateStr + 'T00:00:00');
  const dayNames  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${dayNames[dt.getDay()]} ${monNames[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;

  // Filter trades for this date — use cal-local filters (sym/year/month) for consistency
  const dayTrades = getCalFilteredTrades().filter(t => t.date === dateStr);

  const fmt2 = n => n == null || n === '' || isNaN(n) ? '—' : parseFloat(n).toFixed(2);
  const fmtPnl = n => {
    const v = parseFloat(n);
    if (isNaN(v)) return '—';
    return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtPct = n => {
    const v = parseFloat(n);
    if (isNaN(v) || v === 0) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  };
  const pnlCls = n => parseFloat(n) > 0 ? 'pos' : parseFloat(n) < 0 ? 'neg' : '';
  const stars = r => r > 0 ? '★'.repeat(Math.min(r, 5)) + '☆'.repeat(Math.max(0, 5 - Math.min(r, 5))) : '—';

  if (!dayTrades.length) {
    const ntd = typeof loadJournal === 'function'
      ? loadJournal().find(e => e.type === 'ntd' && e.date === dateStr)
      : null;

    if (ntd) {
      const reasonLabel = { technical: 'Technical', mental: 'Mental', other: 'Other' }[ntd.reason] || ntd.reason || '—';
      const outcomeIcon  = ntd.positive ? '✓' : '✗';
      const outcomeLabel = ntd.positive ? 'Good call' : 'Missed opportunity';
      const outcomeColor = ntd.positive ? 'var(--green)' : 'var(--red)';
      panel.innerHTML = `
        <div style="font-size:14px;font-weight:500;color:var(--text2);margin-bottom:1.25rem;letter-spacing:.01em;font-family:'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${label}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:1rem">
          <span style="font-size:12px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--text2)">🚫 No Trade Day</span>
          <span style="font-size:12px;font-weight:700;color:${outcomeColor}">${outcomeIcon} ${outcomeLabel}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:.75rem">
          ${_rpRow('Reason', reasonLabel)}
          ${ntd.mood ? _rpRow('Mood', ntd.mood) : ''}
        </div>
        ${ntd.note ? `<div style="margin-top:.5rem"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:3px">Note</div><div style="font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;line-height:1.55">${ntd.note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div></div>` : ''}
        <div style="display:flex;gap:6px;margin-top:1.25rem">
          <button onclick="editNtdFromCalendar('${dateStr}')"
            style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:transparent;font-size:12px;font-weight:600;color:var(--text2);cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:5px"
            onmouseover="this.style.borderColor='var(--text2)';this.style.color='var(--text)'"
            onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button onclick="deleteNtdFromCalendar('${dateStr}')"
            style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:12px;font-weight:600;color:var(--text3);cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:5px"
            onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'"
            onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text3)'">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
          </button>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div style="font-size:14px;font-weight:500;color:var(--text2);margin-bottom:1.25rem;letter-spacing:.01em;font-family:'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${label}</div>
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 0;gap:8px;opacity:.45">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div style="font-size:12px;color:var(--text3);text-align:center;line-height:1.5">No trades on this day</div>
      </div>`;
    return;
  }

  // Day summary
  const totalPnl    = dayTrades.reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
  const totalFees   = dayTrades.reduce((s, t) => s + (typeof calcCommission === 'function' ? calcCommission(t) : 0), 0);
  const totalNetPnl = totalPnl - totalFees;
  const wins = dayTrades.filter(t => parseFloat(t.pnl) > 0).length;

  const tradesHtml = dayTrades.map((t, i) => {
    const dirBadge = (t.dir || '').toLowerCase() === 'short'
      ? `<span class="dir-badge short-badge">Short</span>`
      : `<span class="dir-badge long-badge">Long</span>`;

    // Gross P&L and pnl% based on gross
    const grossPnl = parseFloat(t.pnl) || 0;
    const entryV = parseFloat(t.entry); const qtyV = parseFloat(t.qty);
    const pnlPct = (!isNaN(entryV) && !isNaN(qtyV) && entryV > 0 && qtyV > 0)
      ? fmtPct(grossPnl / (entryV * qtyV) * 100) : '—';

    // Duration helper
    function _parseMins(timeStr) {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':').map(Number);
      return isNaN(h) || isNaN(m) ? null : h * 60 + m;
    }
    const durStr = (() => {
      const inM  = _parseMins(t.entryTime);
      const outM = _parseMins(t.exitTime);
      if (inM == null || outM == null) return '—';
      const diff = outM - inM;
      if (diff <= 0) return '—';
      return diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;
    })();

    // Setup / Reason
    const setupHtml = t.reason ? `
      <div style="margin-top:.6rem">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:3px">Setup</div>
        <div style="font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;line-height:1.55">${t.reason.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
      </div>` : '';

    // Thoughts & Feelings
    const notesHtml = t.notes ? `
      <div style="margin-top:.6rem">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:3px">Thoughts &amp; Feelings</div>
        <div style="font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;line-height:1.55">${t.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
      </div>` : '';

    // Images
    const imgs = t.imgs && t.imgs.length ? t.imgs : (t.img ? [t.img] : []);
    const imgsHtml = imgs.length ? `
      <div style="margin-top:.6rem">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:5px">Screenshots</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${imgs.map(src => `<img src="${src}" style="height:72px;width:auto;max-width:100%;border-radius:6px;border:1px solid var(--border);cursor:zoom-in;object-fit:cover" onclick="zoomImg(this.src)">`).join('')}
        </div>
      </div>` : '';

    return `
      <div style="${i > 0 ? 'border-top:1px solid var(--border);padding-top:.875rem;margin-top:.875rem' : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;gap:6px">
          <div style="display:flex;align-items:center;gap:7px;min-width:0">
            <span style="font-size:14px;font-weight:500;color:var(--text2);letter-spacing:.01em;white-space:nowrap;font-family:'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${t.sym || '—'}</span>
            ${dirBadge}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:14px;font-weight:700" class="${pnlCls(grossPnl)}">${fmtPnl(grossPnl)}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:1px">${pnlPct}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px">
          ${_rpRow('Time in',  t.entryTime || '—')}
          ${_rpRow('Time out', t.exitTime  || '—')}
          ${_rpRow('Duration', durStr)}
          ${_rpRow('Qty', t.qty || '—')}
          ${_rpRow('Entry', t.entry ? '$' + parseFloat(t.entry).toFixed(2) : '—')}
          ${_rpRow('Exit', t.exit ? '$' + parseFloat(t.exit).toFixed(2) : '—')}
          ${_rpRow('R:R', fmt2(t.rr))}
          ${_rpRow('★', stars(t.rating))}
        </div>
        ${setupHtml}
        ${notesHtml}
        ${imgsHtml}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1rem;gap:6px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:500;color:var(--text2);letter-spacing:.01em;font-family:'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${label}</div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:1.1rem">
      <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;text-align:center">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:700;margin-bottom:3px">Win Rate</div>
        <div style="font-size:14px;font-weight:700;color:${wins / dayTrades.length >= 0.5 ? 'var(--green)' : 'var(--red)'}">${Math.round(wins / dayTrades.length * 100)}%</div>
      </div>
      <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;text-align:center">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:700;margin-bottom:3px">Day P&amp;L</div>
        <div style="font-size:14px;font-weight:700" class="${pnlCls(totalPnl)}">${fmtPnl(totalPnl)}</div>
      </div>
      <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;text-align:center">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:700;margin-bottom:3px">Trades</div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">${dayTrades.length}</div>
      </div>
    </div>
    <div>${tradesHtml}</div>`;
}

// ─── DELETE NTD (from calendar day panel) ──────────────────
// Pure calendar-side action — no trade-form modal involved, so it lives
// here rather than in journalPage.js or tradeForm.js.
function deleteNtdFromCalendar(dateStr) {
  if (!confirm('Delete this No Trade Day entry?')) return;

  const entries  = typeof loadJournal === 'function' ? loadJournal() : [];
  const filtered = entries.filter(e => !(e.type === 'ntd' && e.date === dateStr));
  if (filtered.length === entries.length) return; // nothing to delete

  saveJournal(filtered);
  if (typeof toast === 'function') toast('✓ No Trade Day deleted');

  // Refresh both the calendar grid (month may now have nothing to show,
  // see renderCalPage()'s monthSet) and the day panel itself (falls back
  // to "No trades on this day").
  renderCalPage();
  renderCalDayPanel(dateStr);
}

function _rpRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;font-weight:700">${label}</span>
    <span style="font-size:12px;color:var(--text);font-weight:500">${value}</span>
  </div>`;
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.calNav                = calNav;
window.setCalSubMode         = setCalSubMode;
window.setCalMode            = setCalMode;
window.toggleHolidayMode     = toggleHolidayMode;
window.toggleHoliday         = toggleHoliday;
window.renderCalPage         = renderCalPage;
window.renderMonthlyCalendar = renderMonthlyCalendar;
window.getISOWeek            = getISOWeek;
window.openCalZoom           = openCalZoom;
window.onCalYearChange       = onCalYearChange;
window.initCalYearDropdown   = initCalYearDropdown;
window.initCalMonthDropdown  = initCalMonthDropdown;
window.closeCalZoom          = closeCalZoom;
window.selectCalDay          = selectCalDay;
window.renderCalDayPanel     = renderCalDayPanel;
window.deleteNtdFromCalendar = deleteNtdFromCalendar;