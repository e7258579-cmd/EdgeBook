/**
 * pageShell.js — Page Shell / Navigation Module
 * Extracted from EdgeBook.html (inline script block 1)
 *
 * Owns:
 *   Theme init IIFE (runs before any render, prevents FOUC)
 *   Scroll-driven topbar-title listener
 *   showPage()          — tab navigation
 *   clearLogFilters(), flashFilter(), flashActiveFilters()
 *   fmtDate()
 *   safeIdFor(), toggleTradeRow()
 *
 * Depends on globals defined in other modules (all loaded after this file,
 * so calls to them only run on user-triggered navigation, by which time
 * everything has loaded): renderLog(), renderHomeList(), renderStats(),
 * renderWeekCalendar(), renderEquityChart(), renderWinLossChart(),
 * renderCalPage(), renderSizingPage(), renderJournalPage(), initCalYearDropdown(),
 * initStatsLayout(), renderRulesChecklist(), setTfScrolled(), unlockModeButtons(),
 * logBackPage, calScope.
 *
 * All public functions are assigned to window so that inline onclick=""
 * attributes in the HTML, and other modules, continue to resolve them.
 *
 * Load order: after app.js, before tradeForm.js.
 */

// ─── THEME INIT — must run before any render to prevent FOUC ────────────────
(function initTheme() {
  const saved       = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme       = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

// ─── MODULE INDEX ────────────────────────────────────────────────────────────
// accounts.js     — account management
// app.js          — trades[], save(), toast(), timeFilter, refreshAll(), showPage()
// tradeForm.js    — openEdit(), saveTrade(), form handling
// tradeList.js    — renderLog(), renderHomeList(), deleteTrade(), escHtml(), zoomImg(),
//                   closeModal(), openDetail(), drillToLog(), goBackFromLog()
// calendarPage.js — calendar rendering
// statsPage.js    — all charts + analytics
// googleSheets.js — GS sync modal
// importWizard.js — import wizard
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('scroll', () => {
  const tbTitle  = document.getElementById('tb-page-title');
  if (!tbTitle) return;

  const logTab = document.getElementById('tab-log');
  const calTab = document.getElementById('tab-cal');

  const journalTab = document.getElementById('tab-journal');
  if (journalTab && journalTab.style.display !== 'none') {
    const jrnTitle = document.getElementById('jrn-page-title');
    const hidden = !jrnTitle || jrnTitle.getBoundingClientRect().bottom < 52;
    tbTitle.textContent = 'Journal';
    tbTitle.classList.toggle('visible', hidden);
    return;
  }

  if (logTab && logTab.style.display !== 'none') {
    const logTitle = document.getElementById('log-page-title');
    const hidden = !logTitle || logTitle.getBoundingClientRect().bottom < 52;
    tbTitle.textContent = 'Trades';
    tbTitle.classList.toggle('visible', hidden);
    return;
  }

  if (calTab && calTab.style.display !== 'none') {
    const calTitle = document.getElementById('cal-page-title');
    const hidden = !calTitle || calTitle.getBoundingClientRect().bottom < 52;
    tbTitle.textContent = 'Calendar';
    tbTitle.classList.toggle('visible', hidden);
    return;
  }

  const statsTab = document.getElementById('tab-stats');
  if (statsTab && statsTab.style.display !== 'none') {
    const statsTitle = document.getElementById('stats-page-title');
    const hidden = !statsTitle || statsTitle.getBoundingClientRect().bottom < 52;
    tbTitle.textContent = 'Statistics';
    tbTitle.classList.toggle('visible', hidden);
    return;
  }

  const sizingTab = document.getElementById('tab-sizing');
  if (sizingTab && sizingTab.style.display !== 'none') {
    const sizingTitle = document.getElementById('sizing-page-title');
    const hidden = !sizingTitle || sizingTitle.getBoundingClientRect().bottom < 52;
    tbTitle.textContent = 'Trading Analysis';
    tbTitle.classList.toggle('visible', hidden);
    return;
  }

  const homeTab = document.getElementById('tab-home');
  if (homeTab && homeTab.style.display !== 'none') {
    const heroTitle = document.getElementById('lbl-pnl');
    // Trigger the instant the donut cards' own titles ("P&L" etc.) scroll out
    // from under the topbar — same idiom as log-page-title / cal-page-title /
    // stats-page-title on every other tab.
    const scrolled = !heroTitle || heroTitle.getBoundingClientRect().bottom < 52;
    if (typeof setTfScrolled === 'function') setTfScrolled(scrolled);
    const statsCompact = document.getElementById('stats-compact');
    if (statsCompact) statsCompact.classList.toggle('visible', scrolled);
    tbTitle.classList.remove('visible');
    return;
  }

  tbTitle.classList.remove('visible');
});

// ─── LOG ────────────────────────────────────────────────────
function clearLogFilters() {
  document.getElementById('filt-dir').value   = '';
  document.getElementById('filt-res').value   = '';
  document.getElementById('filt-price').value = '';
  document.getElementById('filt-hour').value  = '';
  document.getElementById('filt-month').value = '';
  document.getElementById('filt-sym').value   = '';
  renderLog();
}

function flashFilter(elId) {
  const el = document.getElementById(elId);
  if (!el || !el.value) return;
  el.style.transition = 'border-color .4s, background .4s';
  el.style.borderColor = '#D85A30';
  el.style.background  = 'rgba(216,90,48,.12)';
  setTimeout(() => {
    el.style.transition = 'border-color .6s, background .6s';
    el.style.borderColor = '';
    el.style.background  = 'var(--bg2)';
  }, 2000);
}

function flashActiveFilters() {
  setTimeout(() => {
    ['filt-dir','filt-res','filt-price','filt-hour','filt-month'].forEach(flashFilter);
  }, 80);
}


function showPage(p) {
  // If navigating away from the new-trade form, release mode buttons
  const currentPage = ['home','log','cal','stats','new'].find(id => {
    const el = document.getElementById('tab-' + id);
    return el && el.style.display !== 'none';
  });
  if (currentPage === 'new' && p !== 'new') {
    if (typeof unlockModeButtons === 'function') unlockModeButtons();
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  // clear topbar page title immediately on page switch
  const tbTitle = document.getElementById('tb-page-title');
  if (tbTitle) tbTitle.classList.remove('visible');
  // show/hide right panel sections
  const rpFilters = document.getElementById('right-panel-filters');
  if (rpFilters) rpFilters.style.display = p === 'log' ? 'block' : 'none';
  const tbJrnMode = document.getElementById('tb-journal-mode');
  if (tbJrnMode) tbJrnMode.style.display = p === 'new' ? 'flex' : 'none';
  const rpRules = document.getElementById('right-panel-rules');
  if (rpRules) {
    const showRules = p === 'new' || p === 'home';
    rpRules.style.display = showRules ? 'block' : 'none';
    if (showRules && typeof renderRulesChecklist === 'function') renderRulesChecklist();
  }
  const rpCalDay = document.getElementById('right-panel-cal-day');
  if (rpCalDay) { rpCalDay.style.display = p === 'cal' ? 'block' : 'none'; if (p !== 'cal') rpCalDay.innerHTML = ''; }
  // Hide sizing-cb slot when navigating away; renderSizingPage/_szOnAnalysisModeChange re-shows it
  const rpSizingCb = document.getElementById('right-panel-sizing-cb');
  if (rpSizingCb && p !== 'sizing') { rpSizingCb.style.display = 'none'; }
  // Hide the rp-toggle-btn when navigating away from sizing (log page manages its own visibility)
  const rpToggleBtn = document.getElementById('rp-toggle-btn');
  if (rpToggleBtn && p !== 'sizing' && p !== 'log' && p !== 'cal' && p !== 'new' && p !== 'home') rpToggleBtn.style.display = 'none';
  const pageDisplay = { home: 'flex', log: 'block', cal: 'block', stats: 'block', new: 'flex', sizing: 'block', journal: 'block' };
  ['home','log','cal','stats','new','sizing','journal'].forEach(id => {
    const el = document.getElementById('tab-'+id);
    if (el) el.style.display = p===id ? pageDisplay[id] : 'none';
  });
  // home-active = New Trade page (fixed, no-scroll, unchanged);
  // home-scroll-active = Home page (scrolls naturally, same element sizes)
  const appEl = document.querySelector('.app');
  if (appEl) {
    appEl.classList.toggle('home-active', p === 'new');
    appEl.classList.toggle('home-scroll-active', p === 'home');
  }
  document.getElementById('stats-hero').style.display = p === 'home' ? '' : 'none';
  if (p==='log') {
    logBackPage = 'home';
    const backWrap = document.getElementById('log-back-wrap');
    if (backWrap) backWrap.style.display = 'none';
    renderLog();
    flashActiveFilters();
  }
  if (p==='home')  { renderHomeList(); renderStats(); renderWeekCalendar(); renderEquityChart(); renderWinLossChart(); }
  if (p==='cal')   { initCalYearDropdown(); renderCalPage();
    // Grid mode has overflow:hidden — scroll never fires — set topbar title immediately
    // History mode is scrollable so the scroll listener handles it naturally
    const tbTitle = document.getElementById('tb-page-title');
    if (tbTitle && typeof calScope !== 'undefined' && calScope === 'multi') {
      tbTitle.textContent = 'Calendar';
      tbTitle.classList.add('visible');
    }
  }
  // show/hide time filter vs calendar filters in topbar
  const tbTimeFilter = document.getElementById('tb-time-filter');
  const tbCalFilters = document.getElementById('tb-cal-filters');
  const tbCalMode    = document.getElementById('tb-cal-mode');
  const tbLogControls = document.getElementById('tb-log-controls');
  const tbSizingToggle = document.getElementById('tb-sizing-toggle');
  if (tbTimeFilter)    tbTimeFilter.style.display   = p === 'cal' ? 'none' : 'flex';
  if (tbCalFilters)    tbCalFilters.style.display    = p === 'cal' ? 'flex' : 'none';
  if (tbCalMode)       tbCalMode.style.display        = p === 'cal' ? 'flex' : 'none';
  if (tbLogControls)   tbLogControls.style.display    = p === 'log' ? 'flex' : 'none';
  if (tbSizingToggle)  tbSizingToggle.style.display   = p === 'sizing' ? 'flex' : 'none';
  const statsCompactNav = document.getElementById('stats-compact');
  if (statsCompactNav && p !== 'home') statsCompactNav.classList.remove('visible');
  // (tb-cal-controls removed — filters live in #cal-filter-bar)
  if (p==='stats') { renderStats(); if (typeof initStatsLayout === 'function') initStatsLayout(); }
  if (p==='sizing') { renderSizingPage(); }
  if (p==='journal') { if (typeof renderJournalPage === 'function') renderJournalPage(); }
  if (p==='new' && !document.getElementById('f-sym').value)   { document.getElementById('f-date').value = new Date().toISOString().split('T')[0]; }
  // sync sidebar active state
  ['home','log','cal','stats','sizing','journal'].forEach(id => {
    const btn = document.getElementById('sb-'+id);
    if(btn) btn.classList.toggle('active', id===p);
  });
}

function fmtDate(d) {
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dt = new Date(d + 'T00:00:00');
  return months[dt.getMonth()] + ' ' + dt.getDate();
}

// Expose on window so external modules (tradeForm.js, tradeList.js, etc.)
// and inline onclick="" handlers can resolve these without ReferenceError.
window.showPage = showPage;
window.fmtDate  = fmtDate;


// ─── CALENDAR STATE + RENDERING → extracted to calendarPage.js ──────────────
// calYear, calMonth, calScope, calSubMode, calHolidayMode, holidays,
// getCalMode(), calNav(), setCalScope(), setCalSubMode(), setCalMode(),
// updateCalModeButtons(), toggleHolidayMode(), toggleHoliday(),
// renderCalPage(), getISOWeek(), renderMonthlyCalendar()

function safeIdFor(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '_');
}

function toggleTradeRow(key) {
  const exp = document.getElementById('exp-'+key);
  const arr = document.getElementById('arr-'+key);
  if (!exp) return;
  const isOpen = exp.classList.contains('open');
  document.querySelectorAll('.trade-row-expand.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.trade-arrow.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) { exp.classList.add('open'); arr.classList.add('open'); }
}

// openNewTradeModal, closeNewTradeModal, _newTradePrevPage — extracted to tradeForm.js

// updateStats() call moved to bottom bootstrap block (after statsPage.js loads)
