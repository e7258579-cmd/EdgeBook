/**
 * app.js — Core State, Persistence & Refresh Orchestration
 * Extracted from EdgeBook_v32.html
 *
 * Owns:
 *   trades              — the single source of truth (hydrated from localStorage)
 *   timeFilter          — global time filter state (not persisted, resets on load)
 *   today               — Date instance used by exportCSV and form defaults
 *
 * Provides globals consumed by every other module:
 *   getFilteredTrades() — all render functions call this instead of `trades` directly
 *   save()              — persist trades + sync KPI donuts
 *   toast(msg, dur)     — ephemeral feedback overlay
 *   refreshAll()        — re-render whichever tab is currently visible
 *
 * Also owns topbar time-filter controls and sidebar toggle,
 * because they read/write timeFilter and have no module home.
 *
 * Load order in HTML (must be FIRST <script src>, before all other modules):
 *
 *   <script src="https://cdnjs.cloudflare.com/…/chart.umd.min.js"></script>
 *   <script src="https://cdnjs.cloudflare.com/…/xlsx.full.min.js"></script>
 *   <script src="app.js"></script>          ← this file
 *   <script src="tradeForm.js"></script>
 *   <script src="tradeList.js"></script>
 *   <script src="calendarPage.js"></script>
 *   <script src="statsPage.js"></script>
 *   <script src="importWizard.js"></script>
 *   <script>
 *     updateStats();
 *     renderHomeList();
 *     renderStats();
 *     renderWeekCalendar();
 *   </script>
 *
 * Globals resolved at runtime (defined in other modules, called lazily):
 *   updateStats()       — statsPage.js
 *   renderHomeList()    — tradeList.js
 *   renderLog()         — tradeList.js
 *   renderStats()       — statsPage.js
 *   renderCalPage()     — calendarPage.js
 *   renderWeekCalendar()— main HTML script block (home mini-calendar)
 */

// ─── DATA HYDRATION ────────────────────────────────────────
// accounts.js (loaded before this file) handles migration from legacy key.
let trades = [];  // populated async by accounts.js after Firebase auth
// currentMood, currentRating, currentImgs — live in tradeForm.js

// ─── GLOBAL TIME FILTER STATE ──────────────────────────────
// Not persisted — intentionally resets to 'all' on every page load.
let timeFilter = { mode: 'all', from: null, to: null };

// ─── COMMISSION CALCULATOR (single source of truth) ────────
// Each trade stores t.legs = [{ side:'buy'|'sell', qty:number }, ...]
// representing every real execution that composes the trade
// (e.g. 100 buy + 100 buy + 200 sell = 3 legs).
// Per-leg fee: qty < 200 → $0.99 flat; qty >= 200 → qty * 0.005.
// pnl is ALWAYS stored gross; net = pnl - calcCommission(t).
function calcCommission(t) {
  if (!t || !Array.isArray(t.legs) || !t.legs.length) return 0;
  return t.legs.reduce((sum, leg) => {
    const q = Math.abs((leg && leg.qty) || 0);
    if (!q) return sum;
    return sum + (q < 200 ? 0.99 : q * 0.005);
  }, 0);
}
window.calcCommission = calcCommission;

function getFilteredTrades() {
  if (!Array.isArray(trades)) return [];
  if (timeFilter.mode === 'all') return trades;
  const now = new Date();
  let from, to;
  if (timeFilter.mode === 'week') {
    from = new Date(now); from.setDate(from.getDate() - 7);
  } else if (timeFilter.mode === 'month') {
    from = new Date(now); from.setMonth(from.getMonth() - 1);
  } else if (timeFilter.mode === 'year') {
    from = new Date(now); from.setFullYear(from.getFullYear() - 1);
  } else if (timeFilter.mode === 'custom') {
    from = timeFilter.from ? new Date(timeFilter.from + 'T00:00:00') : null;
    to   = timeFilter.to   ? new Date(timeFilter.to   + 'T23:59:59') : null;
  }
  return trades.filter(t => {
    if (!t.date) return false;
    const d = new Date(t.date + 'T00:00:00');
    if (from && d < from) return false;
    if (to   && d > to  ) return false;
    return true;
  });
}

// ─── TIME FILTER CONTROLS ──────────────────────────────────
function setTimeFilter(mode, btn) {
  timeFilter = { mode, from: null, to: null };
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('tf-custom-panel').classList.remove('open');
  document.getElementById('tf-gear-btn').classList.remove('active');
  refreshAll();
}

function toggleCustomPanel() {
  // Scrolled state (Home page): gear opens the dropdown holding the
  // presets + custom range, instead of the inline panel.
  if (tfScrolled) {
    const dropdown = document.getElementById('tf-scroll-dropdown');
    const gear     = document.getElementById('tf-gear-btn');
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('open');
    dropdown.classList.toggle('open', !isOpen);
    if (gear) gear.classList.toggle('active', !isOpen);
    return;
  }
  const panel = document.getElementById('tf-custom-panel');
  const gear  = document.getElementById('tf-gear-btn');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  gear.classList.toggle('active', !isOpen);
  if (!isOpen) {
    // deselect preset buttons when opening custom
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  }
}

// ─── SCROLLED TIME-FILTER (Home page) ──────────────────────
// On scroll, the 1W/1M/1Y presets collapse away leaving AT + gear.
// The gear then opens a dropdown (below) holding the actual preset
// buttons + custom range — the same nodes, just reparented, so all
// existing setTimeFilter()/setCustomRange() logic keeps working untouched.
let tfScrolled = false;
function setTfScrolled(scrolled) {
  if (scrolled === tfScrolled) return;
  tfScrolled = scrolled;
  const wrap        = document.getElementById('tb-time-filter');
  const dropdown     = document.getElementById('tf-scroll-dropdown');
  const presetWrap    = document.getElementById('tf-preset-wrap');
  const customPanel   = document.getElementById('tf-custom-panel');
  const gearBtn        = document.getElementById('tf-gear-btn');
  if (!wrap || !dropdown || !presetWrap || !customPanel || !gearBtn) return;

  if (scrolled) {
    wrap.classList.add('tf-scrolled');
    setTimeout(() => {
      if (!tfScrolled) return; // scrolled back up before the collapse finished
      dropdown.appendChild(presetWrap);
      dropdown.appendChild(customPanel);
    }, 300);
  } else {
    dropdown.classList.remove('open');
    gearBtn.classList.remove('active');
    wrap.insertBefore(presetWrap, gearBtn);
    wrap.appendChild(customPanel);
    wrap.classList.remove('tf-scrolled');
  }
}
document.addEventListener('click', (e) => {
  if (!tfScrolled) return;
  const wrap = document.getElementById('tb-time-filter');
  const dropdown = document.getElementById('tf-scroll-dropdown');
  if (!wrap || !dropdown || !dropdown.classList.contains('open')) return;
  if (!wrap.contains(e.target)) {
    dropdown.classList.remove('open');
    const gearBtn = document.getElementById('tf-gear-btn');
    if (gearBtn) gearBtn.classList.remove('active');
  }
});

function setCustomRange() {
  const from = document.getElementById('tf-from').value;
  const to   = document.getElementById('tf-to').value;
  timeFilter = { mode: 'custom', from: from || null, to: to || null };
  refreshAll();
}

// ─── REFRESH ORCHESTRATION ─────────────────────────────────
// Re-renders only the currently visible tab.
// Called by: setTimeFilter(), setCustomRange().
// NOT called after save/edit/delete — each write caller handles its own renders.
function refreshAll() {
  updateStats();
  const home    = document.getElementById('tab-home');
  const log     = document.getElementById('tab-log');
  const stats   = document.getElementById('tab-stats');
  const cal     = document.getElementById('tab-cal');
  const journal = document.getElementById('tab-journal');
  if (home    && home.style.display    !== 'none') { renderHomeList(); renderStats(); renderWeekCalendar(); }
  if (log     && log.style.display     !== 'none') { renderLog(); }
  if (stats   && stats.style.display   !== 'none') { renderStats(); }
  if (cal     && cal.style.display     !== 'none') { renderCalPage(); }
  if (journal && journal.style.display !== 'none' && typeof renderJournalPage === 'function') { renderJournalPage(); }
}

// ─── DATE CONSTANT + DOM INIT ──────────────────────────────
// `today` is used by exportCSV() and form default date; must be set before
// any module that references it loads.
const today = new Date();

(function initDateDisplay() {
  const tbDate = document.getElementById('tb-today-date');
  if (tbDate) tbDate.textContent = today.toLocaleDateString('en-US', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
  // keep old element alive if still referenced anywhere
  const oldDate = document.getElementById('today-date');
  if (oldDate) oldDate.textContent = today.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const fDate = document.getElementById('f-date');
  if (fDate) fDate.value = today.toISOString().split('T')[0];
})();

// ─── SIDEBAR TOGGLE ───────────────────────────────────────
function toggleSidebar() {
  const sb       = document.getElementById('sidebar');
  const layout   = document.getElementById('layout');
  const topbar   = document.getElementById('topbar');
  const mainWrap = document.getElementById('main-wrap');
  const isCollapsed = sb.classList.toggle('collapsed');
  layout.classList.toggle('sb-open', isCollapsed);

  // Read widths from CSS custom properties so JS stays in sync with CSS clamp() values.
  // getPropertyValue returns the computed string e.g. "clamp(220px, 18vw, 290px)".
  // The browser resolves the clamp at paint time — setting it as a style value works correctly.
  const root      = document.documentElement;
  const expanded  = getComputedStyle(root).getPropertyValue('--sb-w').trim();
  const collapsed = getComputedStyle(root).getPropertyValue('--sb-w-collapsed').trim();

  topbar.style.left         = isCollapsed ? collapsed : expanded;
  mainWrap.style.marginLeft = isCollapsed ? collapsed : expanded;
  mainWrap.style.width      = isCollapsed ? `calc(100% - ${collapsed})` : `calc(100% - ${expanded})`;
  try { localStorage.setItem('sb_collapsed', isCollapsed ? '1' : '0'); } catch(e) {}
}
// Start collapsed by default (restore saved preference if exists)
(function initSidebar() {
  const saved = localStorage.getItem('sb_collapsed');
  const shouldCollapse = saved === null ? true : saved === '1'; // default: collapsed
  if (shouldCollapse) {
    const sb       = document.getElementById('sidebar');
    const layout   = document.getElementById('layout');
    const topbar   = document.getElementById('topbar');
    const mainWrap = document.getElementById('main-wrap');
    if (!sb) return;
    sb.classList.add('collapsed');
    layout.classList.add('sb-open');
    const root      = document.documentElement;
    const collapsed = getComputedStyle(root).getPropertyValue('--sb-w-collapsed').trim();
    if (topbar)   topbar.style.left         = collapsed;
    if (mainWrap) mainWrap.style.marginLeft = collapsed;
    if (mainWrap) mainWrap.style.width      = `calc(100% - ${collapsed})`;
  }
})();

// ─── GOOGLE SHEETS URL RESTORE ────────────────────────────
// Runs once at load; the GS modal reads this value from the input on open.
(function restoreGsUrl() {
  const savedGsUrl = localStorage.getItem('gsWebAppUrl') || '';
  const el = document.getElementById('gs-url');
  if (el && savedGsUrl) el.value = savedGsUrl;
})();

// ─── PERSISTENCE ──────────────────────────────────────────
async function save() {
  try {
    await saveAccountTrades(trades);
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      toast('⚠️ Storage full — images may not be saved. Try smaller images.');
    } else {
      console.error('save() error:', e);
      toast('⚠️ שגיאה בשמירה — בדוק את החיבור לאינטרנט.');
    }
  }
  updateStats();
}

// ─── TOAST ────────────────────────────────────────────────
function toast(msg, dur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

// ─── HOME WEEK CALENDAR ───────────────────────────────────
// Defined here (not in calendarPage.js) because it renders into
// the Home tab and depends on getFilteredTrades() from this file.
function renderWeekCalendar() {
  const el = document.getElementById('week-calendar');
  if (!el) return;

  const ft = getFilteredTrades();

  // Build map: dateStr → { pnl, count }
  const dayMap = {};
  for (const t of ft) {
    if (!t.date) continue;
    if (!dayMap[t.date]) dayMap[t.date] = { pnl: 0, count: 0 };
    dayMap[t.date].pnl   += t.pnl || 0;
    dayMap[t.date].count += 1;
  }

  // Collect last 5 trading days (Mon–Fri) going backwards from today
  const days = [];
  const now  = new Date();
  let   d    = new Date(now);
  while (days.length < 5) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.unshift(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }

  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayStr  = now.toISOString().slice(0, 10);

  const cells = days.map(dateStr => {
    const entry   = dayMap[dateStr];
    const dt      = new Date(dateStr + 'T00:00:00');
    const label   = DOW_LABELS[dt.getDay()];
    const dayNum  = dt.getDate();
    const isToday = dateStr === todayStr;

    if (!entry || entry.count === 0) {
      return `<div class="week-cal-cell empty-day${isToday ? ' today' : ''}">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">${label}</div>
        <div style="font-size:15px;font-weight:${isToday ? '700' : '500'};color:${isToday ? 'var(--text)' : 'var(--text3)'}">${dayNum}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">—</div>
      </div>`;
    }

    const pnl    = entry.pnl;
    const isPos  = pnl >= 0;
    const color  = isPos ? 'var(--green)' : 'var(--red)';
    const sign   = isPos ? '+' : '';
    const pnlStr = sign + '$' + Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 0 });

    return `<div class="week-cal-cell${isToday ? ' today' : ''}">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <div style="font-size:15px;font-weight:${isToday ? '700' : '500'};color:${isToday ? 'var(--text)' : 'var(--text2)'}">${dayNum}</div>
      <div style="font-size:12px;font-weight:700;color:${color};margin-top:2px;white-space:nowrap">${pnlStr}</div>
      <div style="font-size:10px;color:var(--text3)">${entry.count} trade${entry.count !== 1 ? 's' : ''}</div>
    </div>`;
  });

  el.innerHTML = `<div class="week-cal">${cells.join('')}</div>`;
}

// ─── SCROLL-TO-TOP BUTTON ─────────────────────────────────
// Injects a floating ↑ button that appears after scrolling 300px.
// Visible only on tab-log and tab-cal; hidden on all other tabs.
(function initScrollTop() {
  const btn = document.createElement('button');
  btn.id        = 'scroll-top-btn';
  btn.title     = 'Back to top';
  btn.textContent = '↑';

  // Use a class for base styles; only position + visibility toggled via JS
  Object.assign(btn.style, {
    position:     'fixed',
    bottom:       '24px',
    right:        'calc(clamp(280px, 22vw, 380px) + 16px)',
    width:        '36px',
    height:       '36px',
    borderRadius: '50%',
    border:       '1.5px solid #555',
    background:   'var(--bg)',
    color:        '#555',
    fontSize:     '16px',
    lineHeight:   '36px',
    textAlign:    'center',
    cursor:       'pointer',
    zIndex:       '900',
    opacity:      '.8',
    transition:   'opacity .2s',
    visibility:   'hidden',   // use visibility so layout isn't affected
  });

  btn.onmouseenter = () => { btn.style.opacity = '1'; };
  btn.onmouseleave = () => { btn.style.opacity = '.8'; };
  btn.onclick      = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); };
  document.body.appendChild(btn);

  const SCROLL_TABS = new Set(['tab-log', 'tab-cal']);

  function isScrollTab() {
    return [...SCROLL_TABS].some(id => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none';
    });
  }

  function updateBtnPos() {
    const panel = document.getElementById('right-panel');
    const isLaptop = window.matchMedia('(max-width: 1440px)').matches;
    const rpOpen = isLaptop && panel && panel.classList.contains('rp-open');
    const rpWidth = isLaptop
      ? (rpOpen ? Math.max(260, Math.min(window.innerWidth * 0.24, 340)) : 0)
      : Math.max(280, Math.min(window.innerWidth * 0.22, 380));
    btn.style.right = (rpWidth + 16) + 'px';
  }

  function onScroll() {
    const scrolled = document.documentElement.scrollTop > 300;
    btn.style.visibility = (scrolled && isScrollTab()) ? 'visible' : 'hidden';
    updateBtnPos();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateBtnPos);
  // expose so toggleRightPanel can call it
  window._updateScrollBtnPos = updateBtnPos;
  updateBtnPos();
})();

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
// All functions called from inline onclick="" or other modules must be on window.
window.hideScrollTopBtn   = () => { const b = document.getElementById('scroll-top-btn'); if (b) b.style.display = 'none'; };
window.getFilteredTrades  = getFilteredTrades;
window.setTimeFilter      = setTimeFilter;
window.toggleCustomPanel  = toggleCustomPanel;
window.setCustomRange     = setCustomRange;
window.refreshAll         = refreshAll;
window.toggleSidebar      = toggleSidebar;
window.save               = save;
window.toast              = toast;
window.renderWeekCalendar = renderWeekCalendar;

// ─── CSV EXPORT / IMPORT ──────────────────────────────────
// Extracted from EdgeBook_v54.html inline script block.
function exportCSV() {
  if (!trades.length) { alert('No trades to export'); return; }
  const headers = ['Date','Symbol','Direction','Entry','Exit','Shares','P&L','Stop Loss','Take Profit','R:R','Entry Time','Exit Time','Duration','Mood','Rating','Reason','Notes'];
  const rows = trades.map(t => [t.date,t.sym,t.dir,t.entry,t.exit,t.qty,t.pnl,t.sl,t.tp,t.rr,t.entryTime||'',t.exitTime||'',t.duration||'',t.mood,t.rating,'"'+String(t.reason||'').replace(/"/g,'""')+'"','"'+String(t.notes||'').replace(/"/g,'""')+'"']);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'trade_journal_' + today.toISOString().slice(0,10) + '.csv'; a.click();
}

function importCSV() { document.getElementById('import-input').click(); }

function handleImport(input) {
  const file = input.files[0]; if (!file) return;
  if (!confirm('ייבוא יוסיף את הנתונים ליומן הקיים. להמשיך?')) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const lines = e.target.result.split('\n').slice(1).filter(l => l.trim());
      let added = 0;
      lines.forEach(line => {
        const cols = line.split(',');
        if (cols.length < 7) return;
        trades.unshift({
          id: Date.now() + Math.floor(Math.random() * 10000),
          date: cols[0], sym: cols[1], dir: cols[2],
          entry: parseFloat(cols[3])||0, exit: parseFloat(cols[4])||0,
          qty: parseFloat(cols[5])||0, pnl: parseFloat(cols[6])||0,
          sl: parseFloat(cols[7])||0, tp: parseFloat(cols[8])||0,
          rr: parseFloat(cols[9])||0,
          entryTime: cols[10]||'', exitTime: cols[11]||'', duration: cols[12]||'',
          mood: cols[13]||'', rating: parseInt(cols[14])||0,
          reason: (cols[15]||'').replace(/^"|"$/g,''),
          notes: (cols[16]||'').replace(/^"|"$/g,''),
          img: ''
        });
        added++;
      });
      save(); alert('יובאו ' + added + ' עסקאות');
      input.value = '';
    } catch(err) { alert('שגיאה בייבוא הקובץ'); }
  };
  reader.readAsText(file, 'UTF-8');
}

// ─── SEED TEST DATA ───────────────────────────────────────
function seedTestData() {
  if (!confirm('Add realistic test trades for the last 3 years?')) return;

  const symData = {
    AAPL:  { 2022:[140,180], 2023:[125,195], 2024:[165,235], 2025:[170,245], 2026:[180,250] },
    TSLA:  { 2022:[180,400], 2023:[100,270], 2024:[175,480], 2025:[230,480], 2026:[200,380] },
    NVDA:  { 2022:[130,300], 2023:[140,505], 2024:[480,950], 2025:[800,1400],2026:[90,140]  },
    MSFT:  { 2022:[240,340], 2023:[220,380], 2024:[360,470], 2025:[380,470], 2026:[370,440] },
    META:  { 2022:[90,340],  2023:[88,360],  2024:[350,590], 2025:[560,740], 2026:[480,620] },
    GOOGL: { 2022:[85,150],  2023:[85,140],  2024:[135,195], 2025:[160,210], 2026:[145,185] },
    AMD:   { 2022:[55,160],  2023:[60,185],  2024:[140,230], 2025:[90,180],  2026:[80,140]  },
    SPY:   { 2022:[360,475], 2023:[375,480], 2024:[470,600], 2025:[510,610], 2026:[490,570] },
    QQQ:   { 2022:[270,395], 2023:[265,405], 2024:[400,530], 2025:[430,540], 2026:[410,510] },
    COIN:  { 2022:[40,250],  2023:[40,190],  2024:[130,310], 2025:[200,340], 2026:[160,280] },
    PLTR:  { 2022:[6,15],    2023:[5,20],    2024:[17,82],   2025:[70,130],  2026:[80,120]  },
    AMZN:  { 2022:[83,170],  2023:[80,155],  2024:[150,230], 2025:[190,240], 2026:[180,230] },
    NFLX:  { 2022:[165,550], 2023:[270,510], 2024:[490,910], 2025:[850,1100],2026:[800,1050]},
    MSTR:  { 2022:[130,450], 2023:[130,680], 2024:[130,520], 2025:[250,560], 2026:[220,400] },
    SMCI:  { 2022:[25,100],  2023:[80,330],  2024:[200,1230],2025:[25,55],   2026:[20,50]   },
  };

  const moods   = ['Focused','Calm','Stressed','Overconfident','Doubtful','FOMO','Patient','Anxious'];
  const reasons = [
    'Breakout above key resistance with volume confirmation',
    'Bull flag pattern on 5min chart, entry on retest',
    'Gap fill play, entry at VWAP reclaim',
    'Momentum trade following strong news catalyst',
    'Reversal at daily support with RSI divergence',
    'Opening range breakout — first 15min high',
    'VWAP reclaim with unusual volume spike',
    'Short squeeze setup — high short float + catalyst',
    'Earnings momentum continuation play',
    'Technical breakdown below 200MA with volume',
    'Inside day breakout on daily chart',
    'Pre-market gap up continuation',
    'Failed breakdown reversal — trapped shorts',
    'Trend continuation on pullback to 20EMA',
  ];
  const notes = [
    'Managed the trade well, stuck to the plan.',
    'Took profits too early, could have held longer.',
    'Stopped out — re-evaluated and re-entered.',
    'Overtraded this session, need to be more selective.',
    'Perfect execution, waited for confirmation.',
    'Chased the entry slightly, lesson learned.',
    '','',' ',''
  ];

  const syms = Object.keys(symData);
  const now  = new Date();
  const newTrades = [];
  let id = Date.now();

  for (let i = 0; i < 120; i++) {
    const daysAgo = Math.floor(Math.random() * 365 * 3);
    const d = new Date(now); d.setDate(d.getDate() - daysAgo);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    const dateStr = d.toISOString().slice(0,10);
    const year    = d.getFullYear();

    const sym   = syms[Math.floor(Math.random() * syms.length)];
    const range = symData[sym][year] || symData[sym][2024];
    const entry = parseFloat((range[0] + Math.random() * (range[1] - range[0])).toFixed(2));
    const dir   = Math.random() > 0.38 ? 'long' : 'short';
    const isWin = Math.random() < 0.62;
    const movePct = isWin
      ? (0.008 + Math.random() * 0.04)
      : -(0.005 + Math.random() * 0.025);
    const move = movePct * entry * (dir === 'long' ? 1 : -1);
    const exit = parseFloat((entry + move).toFixed(2));
    const qty  = [50,100,100,150,200,200,300,500][Math.floor(Math.random()*8)];
    const pnl  = parseFloat(((dir==='long' ? exit-entry : entry-exit) * qty).toFixed(2));
    const sl   = parseFloat((dir==='long' ? entry*0.985 : entry*1.015).toFixed(2));
    const tp   = parseFloat((dir==='long' ? entry*1.03  : entry*0.97 ).toFixed(2));
    const rr   = parseFloat((Math.abs(tp-entry)/Math.abs(entry-sl)).toFixed(2));

    const entryH = 9 + Math.floor(Math.random() * 5);
    const entryM = Math.floor(Math.random() * 60);
    const durMins = 5 + Math.floor(Math.random() * 240);
    const totalExitMins = entryH*60 + entryM + durMins;
    const exitH = Math.min(Math.floor(totalExitMins/60), 15);
    const exitM = totalExitMins % 60;
    const entryTime = String(entryH).padStart(2,'0') + ':' + String(entryM).padStart(2,'0');
    const exitTime  = String(exitH).padStart(2,'0')  + ':' + String(exitM).padStart(2,'0');
    const h = Math.floor(durMins/60), m = durMins%60;

    newTrades.push({
      id: id++, date: dateStr, sym, dir, entry, exit, qty, pnl, sl, tp, rr,
      entryTime, exitTime,
      duration: h > 0 ? `${h}h ${m}m` : `${m}m`,
      mood:   moods[Math.floor(Math.random() * moods.length)],
      rating: isWin ? 3+Math.floor(Math.random()*3) : 1+Math.floor(Math.random()*3),
      reason: reasons[Math.floor(Math.random() * reasons.length)],
      notes:  notes[Math.floor(Math.random() * notes.length)],
      img: ''
    });
  }

  trades.unshift(...newTrades.sort((a,b) => b.date.localeCompare(a.date)));
  save(); showPage('home');
  toast('✓ Added 120 realistic test trades!');
}

// ─── SETTINGS POPUP ───────────────────────────────────────
function toggleSettingsPopup(e) {
  e.stopPropagation();
  const p = document.getElementById('settings-popup');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function closeSettingsPopup() {
  document.getElementById('settings-popup').style.display = 'none';
}

document.addEventListener('click', e => {
  const p = document.getElementById('settings-popup');
  if (p && !p.contains(e.target) && !e.target.closest('.sb-item[onclick*="toggleSettingsPopup"]')) {
    p.style.display = 'none';
  }
});

// ─── MENU DROPDOWN ────────────────────────────────────────
function toggleMenu() {
  const d = document.getElementById('menu-dropdown');
  d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const menuBtn  = document.getElementById('menu-btn');
  const menuDrop = document.getElementById('menu-dropdown');
  if (menuBtn && menuDrop && !menuBtn.contains(e.target) && !menuDrop.contains(e.target)) {
    menuDrop.style.display = 'none';
  }
});

// ─── RIGHT PANEL TOGGLE ───────────────────────────────────
function toggleRightPanel() {
  const panel    = document.getElementById('right-panel');
  const backdrop = document.getElementById('rp-backdrop');
  const btn      = document.getElementById('rp-toggle-btn');
  if (!panel) return;
  const isOpen = panel.classList.toggle('rp-open');
  if (backdrop) backdrop.classList.toggle('open', isOpen);
  if (btn) btn.style.background = isOpen ? 'var(--bg2)' : '';
  if (window._updateScrollBtnPos) window._updateScrollBtnPos();
}

// ─── THEME ────────────────────────────────────────────────
const MOON_PATH = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const SUN_PATH  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

function updateThemeButton(theme) {
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (!icon) return;
  icon.innerHTML    = theme === 'dark' ? SUN_PATH : MOON_PATH;
  label.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
  if (typeof updateStats === 'function') updateStats();
}

// ─── JOURNAL DATA LAYER ───────────────────────────────────
// Journal entries (No Trade Days) — stored per account.
// Rules — global, not per-account.

const JOURNAL_KEY = acct => `journal_${acct}`;
const RULES_KEY   = 'journal_rules';

function loadJournal() {
  const acct = typeof window.activeAccount !== 'undefined' ? window.activeAccount : 'live';
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY(acct)) || '[]');
  } catch(e) { return []; }
}

function saveJournal(arr) {
  const acct = typeof window.activeAccount !== 'undefined' ? window.activeAccount : 'live';
  try {
    localStorage.setItem(JOURNAL_KEY(acct), JSON.stringify(arr));
  } catch(e) {
    toast('⚠️ Storage full — journal entry may not be saved.');
  }
}

function loadRules() {
  try {
    return JSON.parse(localStorage.getItem(RULES_KEY) || '[]');
  } catch(e) { return []; }
}

function saveRules(arr) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(arr.slice(0, 10)));
  } catch(e) {
    toast('⚠️ Storage full — rules may not be saved.');
  }
}

window.loadJournal = loadJournal;
window.saveJournal = saveJournal;
window.loadRules   = loadRules;
window.saveRules   = saveRules;

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.exportCSV            = exportCSV;
window.importCSV            = importCSV;
window.handleImport         = handleImport;
window.seedTestData         = seedTestData;
window.toggleSettingsPopup  = toggleSettingsPopup;
window.closeSettingsPopup   = closeSettingsPopup;
window.toggleMenu           = toggleMenu;
window.toggleRightPanel     = toggleRightPanel;
window.updateThemeButton    = updateThemeButton;
window.toggleTheme          = toggleTheme;