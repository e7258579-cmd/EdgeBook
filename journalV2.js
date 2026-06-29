/**
 * journalV2.js — Journal v2 UI Layer
 * EdgeBook
 *
 * Renders the Journal page: period summary cards (week/month/year)
 * and a day-by-day timeline of all trading days with trades grouped by symbol.
 *
 * Depends on:
 *   window.trades       — trade array from accounts.js / app.js
 *   window.activeAccount — 'live' | 'demo'
 *   journalV2Data.js    — Firestore data layer (saveJournalEntry, loadJournalEntry, etc.)
 *
 * Called by showPage('journal') in EdgeBook.html.
 * Public API: window.renderJournalPage()
 */

// ─── STATE ────────────────────────────────────────────────────────────────────
let _jrnYear  = new Date().getFullYear();
let _jrnMonth = new Date().getMonth() + 1; // 1-12
let _jrnEntries = {}; // cache: { [entryId]: entry }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function _fmt$(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1000
    ? '$' + (abs / 1000).toFixed(1) + 'k'
    : '$' + abs.toFixed(2);
  return (n < 0 ? '-' : '+') + s;
}

function _fmtDate(dateStr) {
  // '2026-06-29' → 'Mon Jun 29'
  const d = new Date(dateStr + 'T00:00:00');
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate();
}

function _escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── TRADE DATA HELPERS ───────────────────────────────────────────────────────
// Returns trades for the active account only.
function _activeTrades() {
  const all = window.trades || [];
  const acct = window.activeAccount || 'live';
  return all.filter(t => (t.account || 'live') === acct);
}

// Returns all trades for a given 'YYYY-MM-DD' date.
function _getDayTrades(dateStr) {
  return _activeTrades().filter(t => t.date === dateStr);
}

// Groups trades by symbol, computing net P&L and entry count per symbol.
function _groupBySymbol(trades) {
  const map = {};
  for (const t of trades) {
    const sym = (t.symbol || t.sym || '?').toUpperCase();
    if (!map[sym]) map[sym] = { symbol: sym, trades: [], netPnl: 0 };
    map[sym].trades.push(t);
    map[sym].netPnl += (parseFloat(t.pnl) || 0);
  }
  return Object.values(map).sort((a, b) => b.netPnl - a.netPnl);
}

// Returns all unique trading days (sorted desc) for the current month/year.
function _getDaysForMonth(year, month) {
  const pad = String(month).padStart(2, '0');
  const prefix = `${year}-${pad}-`;
  const trades = _activeTrades().filter(t => t.date && t.date.startsWith(prefix));
  const days = [...new Set(trades.map(t => t.date))].sort().reverse();
  return days;
}

// ─── PERIOD STATS ─────────────────────────────────────────────────────────────
function _getPeriodStats(filterFn) {
  const trades = _activeTrades().filter(filterFn);
  const pnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const wins = trades.filter(t => (parseFloat(t.pnl) || 0) > 0).length;
  const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
  return { pnl, count: trades.length, winRate: wr };
}

function _getWeekStats() {
  const now = new Date();
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const monStr = mon.toISOString().split('T')[0];
  return _getPeriodStats(t => t.date >= monStr);
}

function _getMonthStats() {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-`;
  return _getPeriodStats(t => t.date && t.date.startsWith(prefix));
}

function _getYearStats() {
  const year = String(new Date().getFullYear());
  return _getPeriodStats(t => t.date && t.date.startsWith(year));
}

// ─── PERIOD SUMMARY CARDS (top of page) ──────────────────────────────────────
function _renderPeriodCards() {
  const week  = _getWeekStats();
  const month = _getMonthStats();
  const year  = _getYearStats();

  const card = (label, stats, periodType) => {
    const pnlClass = stats.pnl > 0 ? 'jrn-pos' : stats.pnl < 0 ? 'jrn-neg' : 'jrn-neu';
    return `
      <div class="jrn-period-card" onclick="openPeriodModal('${periodType}')">
        <div class="jrn-period-label">${label}</div>
        <div class="jrn-period-pnl ${pnlClass}">${_fmt$(stats.pnl)}</div>
        <div class="jrn-period-meta">
          <span>${stats.count} trade${stats.count !== 1 ? 's' : ''}</span>
          <span class="jrn-sep">·</span>
          <span>${stats.winRate}% W</span>
        </div>
        <div class="jrn-period-edit-hint">Click to add reflection</div>
      </div>`;
  };

  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return `
    <div class="jrn-period-row">
      ${card('This week', week, 'week')}
      ${card(months[now.getMonth()], month, 'month')}
      ${card(now.getFullYear(), year, 'year')}
    </div>`;
}

// ─── DAY CARD ────────────────────────────────────────────────────────────────
function _renderDayCard(dateStr, entry) {
  const trades = _getDayTrades(dateStr);
  if (!trades.length) return '';

  const groups  = _groupBySymbol(trades);
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const wins     = trades.filter(t => (parseFloat(t.pnl) || 0) > 0).length;
  const winRate  = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const pnlClass = totalPnl > 0 ? 'jrn-pos' : totalPnl < 0 ? 'jrn-neg' : 'jrn-neu';

  const reflection = entry ? (_escHtml(entry.reflection) || '') : '';
  const aiSummary  = entry ? (_escHtml(entry.aiSummary)  || '') : '';
  const entryId    = buildDayEntryId(dateStr);

  // Symbol rows
  const symbolRows = groups.map(g => {
    const symPnlClass = g.netPnl > 0 ? 'jrn-pos' : g.netPnl < 0 ? 'jrn-neg' : 'jrn-neu';
    const safeId = dateStr.replace(/-/g,'') + '_' + g.symbol;
    return `
      <div class="jrn-sym-row">
        <div class="jrn-sym-main" onclick="toggleSymDetail('${safeId}')">
          <span class="jrn-sym-name">${_escHtml(g.symbol)}</span>
          <span class="jrn-sym-meta">${g.trades.length} entr${g.trades.length !== 1 ? 'ies' : 'y'}</span>
          <span class="jrn-sym-pnl ${symPnlClass}">${_fmt$(g.netPnl)}</span>
          <span class="jrn-sym-chevron" id="chev-${safeId}">›</span>
        </div>
        <div class="jrn-sym-detail" id="detail-${safeId}" style="display:none">
          ${g.trades.map(t => _renderTradeRow(t)).join('')}
        </div>
      </div>`;
  }).join('');

  // Reflection section
  const reflSection = `
    <div class="jrn-section">
      <div class="jrn-section-header">
        <span class="jrn-section-title">Reflection</span>
      </div>
      <div
        class="jrn-reflection-area"
        contenteditable="true"
        data-entry-id="${entryId}"
        data-date="${dateStr}"
        placeholder="What happened today? What would you do differently?"
        onInput="onReflectionInput(event)"
      >${reflection}</div>
      <div class="jrn-save-status" id="save-status-${entryId}"></div>
    </div>`;

  // Screenshots section
  const screenshots = entry ? (entry.screenshots || []) : [];
  const screenshotSection = _renderScreenshotSection(entryId, dateStr, screenshots);

  // AI section
  const aiSection = `
    <div class="jrn-section">
      <div class="jrn-section-header">
        <span class="jrn-section-title">AI Analysis</span>
        <button class="jrn-ai-btn" onclick="generateDayAI('${dateStr}','${entryId}')">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          Generate
        </button>
      </div>
      <div class="jrn-ai-output" id="ai-output-${entryId}">
        ${aiSummary
          ? `<div class="jrn-ai-text" contenteditable="true" data-entry-id="${entryId}" data-field="aiSummary" onInput="onAiTextInput(event)">${aiSummary}</div>`
          : `<div class="jrn-ai-placeholder">Click Generate to get an AI analysis of your trading day</div>`
        }
      </div>
    </div>`;

  return `
    <div class="jrn-day-card" data-date="${dateStr}">
      <div class="jrn-day-header">
        <div class="jrn-day-left">
          <span class="jrn-day-date">${_fmtDate(dateStr)}</span>
          <span class="jrn-day-pnl ${pnlClass}">${_fmt$(totalPnl)}</span>
        </div>
        <div class="jrn-day-right">
          <span class="jrn-day-meta">${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${winRate}% W</span>
        </div>
      </div>

      <div class="jrn-section">
        <div class="jrn-section-header">
          <span class="jrn-section-title">Trades</span>
        </div>
        <div class="jrn-sym-list">${symbolRows}</div>
      </div>

      ${reflSection}
      ${screenshotSection}
      ${aiSection}
    </div>`;
}

function _renderTradeRow(t) {
  const pnl = parseFloat(t.pnl) || 0;
  const pnlClass = pnl > 0 ? 'jrn-pos' : pnl < 0 ? 'jrn-neg' : 'jrn-neu';
  const dir = (t.direction || t.dir || '').toLowerCase();
  const entry = parseFloat(t.entry) || 0;
  const exit  = parseFloat(t.exit)  || 0;
  const qty   = t.qty || t.shares || '—';
  const entryTime = t.entryTime || t.entry_time || '';
  const exitTime  = t.exitTime  || t.exit_time  || '';
  const timeStr = entryTime ? `${entryTime}${exitTime ? ' → ' + exitTime : ''}` : '';

  return `
    <div class="jrn-trade-row">
      <span class="jrn-trade-dir jrn-dir-${dir}">${dir === 'long' ? 'L' : dir === 'short' ? 'S' : '?'}</span>
      <span class="jrn-trade-price">$${entry.toFixed(2)} → $${exit.toFixed(2)}</span>
      <span class="jrn-trade-qty">${qty} sh</span>
      ${timeStr ? `<span class="jrn-trade-time">${_escHtml(timeStr)}</span>` : ''}
      <span class="jrn-trade-pnl ${pnlClass}">${_fmt$(pnl)}</span>
      <button class="jrn-edit-btn" onclick="openEdit(${JSON.stringify(t.id || t._id || '')})">Edit</button>
    </div>`;
}

// ─── SCREENSHOTS (Stage 3) ───────────────────────────────────────────────────
// Renders the screenshots section inside a day card.
// entryId  — e.g. 'day_live_2026-06-29'
// dateStr  — 'YYYY-MM-DD'
// screenshots — array of base64 data-URL strings (max 3)
function _renderScreenshotSection(entryId, dateStr, screenshots) {
  const MAX = 3;
  const canAdd = screenshots.length < MAX;

  const thumbs = screenshots.map((src, idx) => `
    <div class="jrn-thumb-wrap">
      <img
        class="jrn-thumb"
        src="${src}"
        alt="Screenshot ${idx + 1}"
        onclick="jrnViewScreenshot(${JSON.stringify(src)})"
        title="Click to enlarge"
      />
      <button
        class="jrn-thumb-del"
        onclick="jrnRemoveScreenshot('${entryId}','${dateStr}',${idx})"
        title="Remove"
      >✕</button>
    </div>`).join('');

  const addBtn = canAdd ? `
    <label class="jrn-thumb-add" title="Add screenshot (max ${MAX})">
      <input
        type="file"
        accept="image/*"
        style="display:none"
        onchange="jrnAddScreenshot(event,'${entryId}','${dateStr}')"
      />
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
           stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </label>` : '';

  return `
    <div class="jrn-section jrn-screenshots-section" id="screenshots-section-${entryId}">
      <div class="jrn-section-header">
        <span class="jrn-section-title">Screenshots</span>
        <span class="jrn-screenshot-count">${screenshots.length}/${MAX}</span>
      </div>
      <div class="jrn-thumb-row" id="screenshots-row-${entryId}">
        ${thumbs}
        ${addBtn}
      </div>
    </div>`;
}

// Called when the user picks a file from the hidden <input type="file">
async function jrnAddScreenshot(event, entryId, dateStr) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  // Reset the input so the same file can be re-picked if needed
  event.target.value = '';

  const MAX = 3;
  const entry = _jrnEntries[entryId] || (typeof makeDayEntry === 'function'
    ? makeDayEntry(dateStr)
    : { id: entryId, date: dateStr, type: 'day', screenshots: [] });

  const existing = entry.screenshots || [];
  if (existing.length >= MAX) return; // safety guard

  // Convert to base64 data-URL
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(file);
  });

  const updated = { ...entry, screenshots: [...existing, dataUrl] };
  _jrnEntries[entryId] = updated;

  // Optimistic UI — re-render the screenshot section in place
  _refreshScreenshotSection(entryId, dateStr, updated.screenshots);

  // Persist to Firestore
  if (typeof saveJournalEntry === 'function') {
    try {
      await saveJournalEntry(updated);
    } catch(e) {
      console.error('jrnAddScreenshot save error:', e);
    }
  }
}

// Called when the user clicks ✕ on a thumbnail
async function jrnRemoveScreenshot(entryId, dateStr, idx) {
  const entry = _jrnEntries[entryId];
  if (!entry) return;

  const screenshots = [...(entry.screenshots || [])];
  screenshots.splice(idx, 1);

  const updated = { ...entry, screenshots };
  _jrnEntries[entryId] = updated;

  // Optimistic UI update
  _refreshScreenshotSection(entryId, dateStr, updated.screenshots);

  // Persist to Firestore
  if (typeof saveJournalEntry === 'function') {
    try {
      await saveJournalEntry(updated);
    } catch(e) {
      console.error('jrnRemoveScreenshot save error:', e);
    }
  }
}

// Re-renders only the screenshot section for a given entry (no full page re-render)
function _refreshScreenshotSection(entryId, dateStr, screenshots) {
  const section = document.getElementById('screenshots-section-' + entryId);
  if (!section) return;
  const newHtml = _renderScreenshotSection(entryId, dateStr, screenshots);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newSection = tmp.firstElementChild;
  section.replaceWith(newSection);
}

// Opens a full-screen lightbox to view a screenshot
function jrnViewScreenshot(src) {
  // Reuse existing lightbox if present
  let lb = document.getElementById('jrn-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'jrn-lightbox';
    lb.className = 'jrn-lightbox';
    lb.innerHTML = `
      <div class="jrn-lightbox-backdrop" onclick="jrnCloseLightbox()"></div>
      <div class="jrn-lightbox-content">
        <button class="jrn-lightbox-close" onclick="jrnCloseLightbox()" aria-label="Close">✕</button>
        <img class="jrn-lightbox-img" id="jrn-lightbox-img" src="" alt="Screenshot" />
      </div>`;
    document.body.appendChild(lb);
  }
  document.getElementById('jrn-lightbox-img').src = src;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function jrnCloseLightbox() {
  const lb = document.getElementById('jrn-lightbox');
  if (lb) lb.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── MONTH NAV ────────────────────────────────────────────────────────────────
function _renderNav() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `
    <div class="jrn-nav">
      <button class="jrn-nav-btn" onclick="jrnNavMonth(-1)">‹</button>
      <span class="jrn-nav-label">${months[_jrnMonth - 1]} ${_jrnYear}</span>
      <button class="jrn-nav-btn" onclick="jrnNavMonth(1)">›</button>
      <button class="jrn-nav-today" onclick="jrnGoToday()">Today</button>
    </div>`;
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────
async function renderJournalPage() {
  const tab = document.getElementById('tab-journal');
  if (!tab) return;

  tab.innerHTML = `<div class="jrn-loading">Loading journal…</div>`;

  // Load Firestore entries for this month
  let firestoreEntries = [];
  if (typeof loadJournalEntriesForMonth === 'function') {
    try {
      firestoreEntries = await loadJournalEntriesForMonth(_jrnYear, _jrnMonth);
    } catch(e) {
      console.warn('Journal: could not load Firestore entries', e);
    }
  }

  // Cache by id
  _jrnEntries = {};
  for (const e of firestoreEntries) {
    _jrnEntries[e.id] = e;
  }

  const days = _getDaysForMonth(_jrnYear, _jrnMonth);

  const dayCards = days.map(d => {
    const id = typeof buildDayEntryId === 'function' ? buildDayEntryId(d) : `day_${activeAccount}_${d}`;
    return _renderDayCard(d, _jrnEntries[id] || null);
  }).filter(Boolean).join('');

  const empty = !dayCards
    ? `<div class="jrn-empty">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <div>No trading days in this period</div>
        <div class="jrn-empty-sub">Navigate to a month with trades, or add trades via Submit new trade</div>
      </div>`
    : '';

  tab.innerHTML = `
    <div class="jrn-root" style="direction:ltr">
      <div class="jrn-topbar">
        <div class="page-title">Journal</div>
        ${_renderNav()}
      </div>
      ${_renderPeriodCards()}
      <div class="jrn-timeline">
        ${dayCards || empty}
      </div>
    </div>`;

  _injectJrnStyles();
}

// ─── NAV ACTIONS ─────────────────────────────────────────────────────────────
function jrnNavMonth(delta) {
  _jrnMonth += delta;
  if (_jrnMonth > 12) { _jrnMonth = 1; _jrnYear++; }
  if (_jrnMonth < 1)  { _jrnMonth = 12; _jrnYear--; }
  renderJournalPage();
}

function jrnGoToday() {
  const now = new Date();
  _jrnYear  = now.getFullYear();
  _jrnMonth = now.getMonth() + 1;
  renderJournalPage();
}

// ─── TOGGLE SYMBOL DETAIL ─────────────────────────────────────────────────────
function toggleSymDetail(safeId) {
  const det  = document.getElementById('detail-' + safeId);
  const chev = document.getElementById('chev-'   + safeId);
  if (!det) return;
  const open = det.style.display !== 'none';
  det.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
}

// ─── REFLECTION AUTO-SAVE ────────────────────────────────────────────────────
const _reflDebounce = {};

function onReflectionInput(event) {
  const el      = event.target;
  const entryId = el.dataset.entryId;
  const dateStr = el.dataset.date;
  if (!entryId) return;

  const statusEl = document.getElementById('save-status-' + entryId);
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'jrn-save-status jrn-saving'; }

  clearTimeout(_reflDebounce[entryId]);
  _reflDebounce[entryId] = setTimeout(async () => {
    try {
      const existing = _jrnEntries[entryId] || (typeof makeDayEntry === 'function' ? makeDayEntry(dateStr) : { id: entryId, date: dateStr, type: 'day' });
      const updated  = { ...existing, reflection: el.innerText || el.textContent || '' };
      _jrnEntries[entryId] = updated;
      if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated);
      if (statusEl) { statusEl.textContent = 'Saved'; statusEl.className = 'jrn-save-status jrn-saved'; }
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    } catch(e) {
      console.error('Reflection save error:', e);
      if (statusEl) { statusEl.textContent = 'Error saving'; statusEl.className = 'jrn-save-status jrn-error'; }
    }
  }, 500);
}

// ─── AI ANALYSIS ─────────────────────────────────────────────────────────────
async function generateDayAI(dateStr, entryId) {
  const outputEl = document.getElementById('ai-output-' + entryId);
  if (!outputEl) return;

  outputEl.innerHTML = `<div class="jrn-ai-loading"><div class="jrn-spinner"></div> Analyzing…</div>`;

  const trades    = _getDayTrades(dateStr);
  const entry     = _jrnEntries[entryId];
  const reflection = entry ? (entry.reflection || '') : '';

  const tradesSummary = _groupBySymbol(trades).map(g =>
    `${g.symbol}: ${g.trades.length} trade(s), net P&L ${_fmt$(g.netPnl)}, ` +
    g.trades.map(t =>
      `${(t.direction||t.dir||'').toUpperCase()} entry $${parseFloat(t.entry||0).toFixed(2)} exit $${parseFloat(t.exit||0).toFixed(2)} qty ${t.qty||t.shares||'?'}`
    ).join('; ')
  ).join('\n');

  const prompt = `You are analyzing a day trader's journal entry.

Date: ${dateStr}
Trades:
${tradesSummary}

Trader's reflection: ${reflection || '(none provided)'}

Analyze this trading day covering:
1. Mental/emotional state based on the reflection
2. Technical execution quality (entries, exits, timing)
3. P&L breakdown and patterns
4. What went well and what to improve

Be concise, specific, and actionable. Max 200 words.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');

    // Save to Firestore
    const existing = _jrnEntries[entryId] || (typeof makeDayEntry === 'function' ? makeDayEntry(dateStr) : { id: entryId, date: dateStr, type: 'day' });
    const updated  = { ...existing, aiSummary: text, aiGeneratedAt: Date.now() };
    _jrnEntries[entryId] = updated;
    if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated);

    outputEl.innerHTML = `<div class="jrn-ai-text" contenteditable="true" data-entry-id="${entryId}" data-field="aiSummary" onInput="onAiTextInput(event)">${_escHtml(text)}</div>`;
  } catch(e) {
    console.error('AI analysis error:', e);
    outputEl.innerHTML = `<div class="jrn-ai-error">Failed to generate analysis. Check your connection.</div>`;
  }
}

// Saves manual edits to the AI text field
const _aiDebounce = {};
function onAiTextInput(event) {
  const el      = event.target;
  const entryId = el.dataset.entryId;
  if (!entryId) return;
  clearTimeout(_aiDebounce[entryId]);
  _aiDebounce[entryId] = setTimeout(async () => {
    const existing = _jrnEntries[entryId];
    if (!existing) return;
    const updated = { ...existing, aiSummary: el.innerText || el.textContent || '' };
    _jrnEntries[entryId] = updated;
    if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated).catch(console.error);
  }, 600);
}

// ─── PERIOD MODAL (stage 5) ───────────────────────────────────────────────────
// State for the currently open modal
let _periodModal = {
  type:       null,   // 'week' | 'month' | 'year'
  identifier: null,   // '2026-W26' | '2026-06' | '2026'
  entry:      null    // cached PeriodEntry from Firestore (or null)
};

// Returns the current period identifier for 'week', 'month', or 'year'
function _currentPeriodIdentifier(type) {
  const now = new Date();
  if (type === 'week')  return typeof getWeekIdentifier === 'function'
    ? getWeekIdentifier(now.toISOString().split('T')[0])
    : `${now.getFullYear()}-W${String(Math.ceil(now.getDate() / 7)).padStart(2,'0')}`;
  if (type === 'month') return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if (type === 'year')  return String(now.getFullYear());
  return '';
}

// Builds a human-readable label for the modal header
function _periodLabel(type, identifier) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (type === 'week')  return `Week ${identifier}`; // e.g. 'Week 2026-W26'
  if (type === 'month') {
    const [y, m] = identifier.split('-');
    return `${months[parseInt(m,10)-1]} ${y}`;
  }
  if (type === 'year')  return `Year ${identifier}`;
  return identifier;
}

// Builds an AI prompt for period summaries
function _buildPeriodPrompt(type, identifier, trades, reflection) {
  const label = _periodLabel(type, identifier);
  const totalPnl = trades.reduce((s,t) => s + (parseFloat(t.pnl)||0), 0);
  const wins = trades.filter(t => (parseFloat(t.pnl)||0) > 0).length;
  const wr   = trades.length ? Math.round(wins / trades.length * 100) : 0;

  // Group by symbol for the summary
  const bySymbol = _groupBySymbol(trades)
    .map(g => `  ${g.symbol}: ${g.trades.length} trade(s), net ${_fmt$(g.netPnl)}`)
    .join('\n');

  return `You are analyzing a day trader's ${type} summary.

Period: ${label}
Total trades: ${trades.length}
Net P&L: ${_fmt$(totalPnl)}
Win rate: ${wr}%

Breakdown by symbol:
${bySymbol || '  (no trades)'}

Trader's reflection: ${reflection || '(none provided)'}

Write a concise ${type} analysis covering:
1. Overall performance and P&L narrative
2. Strongest and weakest symbols/setups
3. Behavioral or psychological patterns observed
4. One or two specific focus points for next ${type}

Be specific and actionable. Max 250 words.`;
}

// Returns trades for a given period
function _getPeriodTrades(type, identifier) {
  const all = _activeTrades();
  if (type === 'week') {
    // identifier = '2026-W26' — match each trade date against its week identifier
    return all.filter(t => t.date && (typeof getWeekIdentifier === 'function'
      ? getWeekIdentifier(t.date) === identifier
      : false));
  }
  if (type === 'month') {
    // identifier = '2026-06'
    return all.filter(t => t.date && t.date.startsWith(identifier + '-'));
  }
  if (type === 'year') {
    return all.filter(t => t.date && t.date.startsWith(identifier + '-'));
  }
  return [];
}

// Ensures the modal DOM node exists (created once, reused)
function _ensurePeriodModalDom() {
  if (document.getElementById('jrn-period-modal')) return;
  const el = document.createElement('div');
  el.id = 'jrn-period-modal';
  el.className = 'jrn-pm-overlay';
  el.innerHTML = `
    <div class="jrn-pm-box" role="dialog" aria-modal="true">
      <div class="jrn-pm-header">
        <span class="jrn-pm-title" id="jrn-pm-title"></span>
        <button class="jrn-pm-close" onclick="closePeriodModal()" aria-label="Close">✕</button>
      </div>
      <div class="jrn-pm-stats" id="jrn-pm-stats"></div>
      <div class="jrn-pm-body">
        <div class="jrn-pm-section-label">Reflection</div>
        <div
          class="jrn-reflection-area"
          id="jrn-pm-reflection"
          contenteditable="true"
          placeholder="What defined this ${''/* filled dynamically */} period? Key lessons?"
          onInput="onPeriodReflectionInput(event)"
        ></div>
        <div class="jrn-save-status" id="jrn-pm-save-status"></div>

        <div class="jrn-pm-section-label" style="margin-top:1.25rem">
          AI Summary
          <button class="jrn-ai-btn" id="jrn-pm-ai-btn" onclick="generatePeriodAI()" style="margin-left:auto">
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            Generate
          </button>
        </div>
        <div class="jrn-ai-output" id="jrn-pm-ai-output">
          <div class="jrn-ai-placeholder">Click Generate to get an AI analysis of this period</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Close on backdrop click
  el.addEventListener('click', e => { if (e.target === el) closePeriodModal(); });
}

async function openPeriodModal(type) {
  const identifier = _currentPeriodIdentifier(type);
  _periodModal.type       = type;
  _periodModal.identifier = identifier;
  _periodModal.entry      = null;

  _ensurePeriodModalDom();

  // Populate header
  document.getElementById('jrn-pm-title').textContent = _periodLabel(type, identifier);

  // Period stats
  const trades   = _getPeriodTrades(type, identifier);
  const totalPnl = trades.reduce((s,t) => s + (parseFloat(t.pnl)||0), 0);
  const wins     = trades.filter(t => (parseFloat(t.pnl)||0) > 0).length;
  const wr       = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const pnlClass = totalPnl > 0 ? 'jrn-pos' : totalPnl < 0 ? 'jrn-neg' : 'jrn-neu';
  document.getElementById('jrn-pm-stats').innerHTML = `
    <span class="jrn-pm-stat ${pnlClass}">${_fmt$(totalPnl)}</span>
    <span class="jrn-pm-stat-sep">·</span>
    <span class="jrn-pm-stat-sub">${trades.length} trade${trades.length !== 1 ? 's' : ''}</span>
    <span class="jrn-pm-stat-sep">·</span>
    <span class="jrn-pm-stat-sub">${wr}% W</span>`;

  // Reset fields
  const reflEl   = document.getElementById('jrn-pm-reflection');
  const aiOutEl  = document.getElementById('jrn-pm-ai-output');
  const statusEl = document.getElementById('jrn-pm-save-status');
  reflEl.textContent   = '';
  statusEl.textContent = '';
  aiOutEl.innerHTML    = '<div class="jrn-ai-placeholder">Click Generate to get an AI analysis of this period</div>';
  reflEl.setAttribute('placeholder', `What defined this ${type}? Key lessons?`);

  // Open modal
  const overlay = document.getElementById('jrn-period-modal');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Load from Firestore
  if (typeof loadJournalPeriodEntry === 'function') {
    try {
      const entry = await loadJournalPeriodEntry(type, identifier);
      _periodModal.entry = entry;
      if (entry) {
        reflEl.textContent = entry.reflection || '';
        if (entry.aiSummary) {
          aiOutEl.innerHTML = `<div class="jrn-ai-text" contenteditable="true"
            onInput="onPeriodAiTextInput(event)">${_escHtml(entry.aiSummary)}</div>`;
        }
      }
    } catch(e) {
      console.warn('openPeriodModal: could not load entry', e);
    }
  }
}

function closePeriodModal() {
  const overlay = document.getElementById('jrn-period-modal');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// Auto-save reflection in period modal
const _periodReflDebounce = { t: null };
function onPeriodReflectionInput(event) {
  const el       = event.target;
  const statusEl = document.getElementById('jrn-pm-save-status');
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'jrn-save-status jrn-saving'; }

  clearTimeout(_periodReflDebounce.t);
  _periodReflDebounce.t = setTimeout(async () => {
    const { type, identifier } = _periodModal;
    if (!type) return;
    try {
      const existing = _periodModal.entry ||
        (typeof makePeriodEntry === 'function' ? makePeriodEntry(type, identifier) : { id: `${type}_${window.activeAccount||'live'}_${identifier}`, type, identifier });
      const updated = { ...existing, reflection: el.innerText || el.textContent || '' };
      _periodModal.entry = updated;
      if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated);
      if (statusEl) { statusEl.textContent = 'Saved'; statusEl.className = 'jrn-save-status jrn-saved'; }
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    } catch(e) {
      console.error('Period reflection save error:', e);
      if (statusEl) { statusEl.textContent = 'Error saving'; statusEl.className = 'jrn-save-status jrn-error'; }
    }
  }, 500);
}

// Generate AI summary for period
async function generatePeriodAI() {
  const { type, identifier } = _periodModal;
  if (!type) return;

  const aiOutEl = document.getElementById('jrn-pm-ai-output');
  if (!aiOutEl) return;
  aiOutEl.innerHTML = '<div class="jrn-ai-loading"><div class="jrn-spinner"></div> Analyzing…</div>';

  const trades     = _getPeriodTrades(type, identifier);
  const reflEl     = document.getElementById('jrn-pm-reflection');
  const reflection = reflEl ? (reflEl.innerText || reflEl.textContent || '') : '';
  const prompt     = _buildPeriodPrompt(type, identifier, trades, reflection);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');

    // Save to Firestore
    const existing = _periodModal.entry ||
      (typeof makePeriodEntry === 'function' ? makePeriodEntry(type, identifier) : { id: `${type}_${window.activeAccount||'live'}_${identifier}`, type, identifier });
    const updated = { ...existing, aiSummary: text, aiGeneratedAt: Date.now() };
    _periodModal.entry = updated;
    if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated).catch(console.error);

    aiOutEl.innerHTML = `<div class="jrn-ai-text" contenteditable="true"
      onInput="onPeriodAiTextInput(event)">${_escHtml(text)}</div>`;
  } catch(e) {
    console.error('Period AI error:', e);
    aiOutEl.innerHTML = '<div class="jrn-ai-error">Failed to generate analysis. Check your connection.</div>';
  }
}

// Save manual edits to period AI text
const _periodAiDebounce = { t: null };
function onPeriodAiTextInput(event) {
  clearTimeout(_periodAiDebounce.t);
  _periodAiDebounce.t = setTimeout(async () => {
    const el = event.target;
    const existing = _periodModal.entry;
    if (!existing) return;
    const updated = { ...existing, aiSummary: el.innerText || el.textContent || '' };
    _periodModal.entry = updated;
    if (typeof saveJournalEntry === 'function') await saveJournalEntry(updated).catch(console.error);
  }, 600);
}

// ─── CSS INJECTION ───────────────────────────────────────────────────────────
// All Journal v2 styles live here — no changes needed to EdgeBook.html CSS.
function _injectJrnStyles() {
  if (document.getElementById('jrn-styles')) return;
  const s = document.createElement('style');
  s.id = 'jrn-styles';
  s.textContent = `
  /* ── Journal v2 ──────────────────────────────────────────── */
  .jrn-root { max-width: 860px; margin: 0 auto; }

  .jrn-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 1.5rem;
    padding-top: .5rem;
  }

  /* ── Month nav ── */
  .jrn-nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .jrn-nav-btn {
    width: 30px; height: 30px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text2);
    cursor: pointer;
    font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    transition: background .12s, color .12s;
  }
  .jrn-nav-btn:hover { background: var(--bg2); color: var(--text); }
  .jrn-nav-label {
    font-size: 13px; font-weight: 600;
    color: var(--text);
    min-width: 90px; text-align: center;
  }
  .jrn-nav-today {
    padding: 4px 10px;
    border-radius: 7px;
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text2);
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: all .12s;
  }
  .jrn-nav-today:hover { border-color: var(--text2); color: var(--text); }

  /* ── Period cards ── */
  .jrn-period-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: .75rem;
    margin-bottom: 1.5rem;
  }
  .jrn-period-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    cursor: pointer;
    transition: border-color .15s, box-shadow .15s;
  }
  .jrn-period-card:hover {
    border-color: var(--border2);
    box-shadow: 0 2px 12px rgba(0,0,0,.08);
  }
  .jrn-period-label {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--text3);
    margin-bottom: .4rem;
  }
  .jrn-period-pnl {
    font-size: 20px; font-weight: 700;
    margin-bottom: .25rem;
  }
  .jrn-period-meta {
    font-size: 12px; color: var(--text3);
    display: flex; gap: 4px; align-items: center;
  }
  .jrn-sep { opacity: .5; }
  .jrn-period-edit-hint {
    font-size: 11px; color: var(--text3);
    margin-top: .5rem;
    opacity: 0;
    transition: opacity .15s;
  }
  .jrn-period-card:hover .jrn-period-edit-hint { opacity: 1; }

  /* ── Timeline ── */
  .jrn-timeline { display: flex; flex-direction: column; gap: 1rem; }

  /* ── Day card ── */
  .jrn-day-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .jrn-day-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .875rem 1.125rem;
    border-bottom: 1px solid var(--border);
  }
  .jrn-day-left { display: flex; align-items: center; gap: 12px; }
  .jrn-day-date { font-size: 14px; font-weight: 700; color: var(--text); }
  .jrn-day-pnl  { font-size: 15px; font-weight: 700; }
  .jrn-day-right { }
  .jrn-day-meta  { font-size: 12px; color: var(--text3); }

  /* ── Section within day card ── */
  .jrn-section {
    padding: .875rem 1.125rem;
    border-bottom: 1px solid var(--border);
  }
  .jrn-section:last-child { border-bottom: none; }
  .jrn-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: .6rem;
  }
  .jrn-section-title {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--text3);
  }

  /* ── Symbol rows ── */
  .jrn-sym-list { display: flex; flex-direction: column; gap: 2px; }
  .jrn-sym-row { border-radius: var(--radius-sm); overflow: hidden; }
  .jrn-sym-main {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background .12s;
    user-select: none;
  }
  .jrn-sym-main:hover { background: var(--bg2); }
  .jrn-sym-name { font-size: 13px; font-weight: 700; color: var(--text); min-width: 48px; }
  .jrn-sym-meta { font-size: 12px; color: var(--text3); flex: 1; }
  .jrn-sym-pnl  { font-size: 13px; font-weight: 700; }
  .jrn-sym-chevron {
    font-size: 14px; color: var(--text3);
    transition: transform .15s;
    display: inline-block;
    width: 16px; text-align: center;
  }

  /* ── Trade detail rows ── */
  .jrn-sym-detail { padding: 4px 0 6px 56px; }
  .jrn-trade-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text2);
  }
  .jrn-trade-dir {
    font-size: 10px; font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    min-width: 18px;
    text-align: center;
  }
  .jrn-dir-long  { background: rgba(29,158,117,.15); color: var(--green); }
  .jrn-dir-short { background: rgba(216,90,48,.15);  color: var(--red); }
  .jrn-trade-price { font-variant-numeric: tabular-nums; }
  .jrn-trade-qty   { color: var(--text3); }
  .jrn-trade-time  { color: var(--text3); }
  .jrn-trade-pnl   { font-weight: 700; margin-left: auto; }
  .jrn-edit-btn {
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text3);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    transition: all .12s;
  }
  .jrn-edit-btn:hover { border-color: var(--text2); color: var(--text); }

  /* ── Reflection ── */
  .jrn-reflection-area {
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg2);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    line-height: 1.55;
    outline: none;
    transition: border-color .15s;
    box-sizing: border-box;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .jrn-reflection-area:focus { border-color: var(--border2); background: var(--bg); }
  .jrn-reflection-area:empty:before {
    content: attr(placeholder);
    color: var(--text3);
    pointer-events: none;
  }
  .jrn-save-status {
    font-size: 11px;
    margin-top: 4px;
    min-height: 14px;
    transition: color .2s;
  }
  .jrn-saving { color: var(--text3); }
  .jrn-saved  { color: var(--green); }
  .jrn-error  { color: var(--red); }

  /* ── AI section ── */
  .jrn-ai-btn {
    display: flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    border-radius: 7px;
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text2);
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: all .12s;
  }
  .jrn-ai-btn:hover { border-color: var(--text); color: var(--text); background: var(--bg2); }
  .jrn-ai-output { margin-top: .5rem; }
  .jrn-ai-text {
    font-size: 13px; line-height: 1.6; color: var(--text);
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg2);
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .jrn-ai-text:focus { border-color: var(--border2); }
  .jrn-ai-placeholder { font-size: 13px; color: var(--text3); padding: 4px 0; }
  .jrn-ai-loading {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text3); padding: 4px 0;
  }
  .jrn-ai-error { font-size: 13px; color: var(--red); }
  .jrn-spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--border2);
    border-top-color: var(--text2);
    border-radius: 50%;
    animation: jrn-spin .7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes jrn-spin { to { transform: rotate(360deg); } }

  /* ── Screenshots ── */
  .jrn-screenshot-count {
    font-size: 11px; color: var(--text3);
  }
  .jrn-thumb-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: .25rem;
  }
  .jrn-thumb-wrap {
    position: relative;
    width: 88px; height: 66px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .jrn-thumb {
    width: 100%; height: 100%;
    object-fit: cover;
    cursor: zoom-in;
    display: block;
    transition: opacity .12s;
  }
  .jrn-thumb:hover { opacity: .85; }
  .jrn-thumb-del {
    position: absolute;
    top: 3px; right: 3px;
    width: 18px; height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(0,0,0,.55);
    color: #fff;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    opacity: 0;
    transition: opacity .12s;
    padding: 0;
  }
  .jrn-thumb-wrap:hover .jrn-thumb-del { opacity: 1; }
  .jrn-thumb-add {
    width: 88px; height: 66px;
    border: 1px dashed var(--border2);
    border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: var(--text3);
    flex-shrink: 0;
    transition: border-color .12s, color .12s;
  }
  .jrn-thumb-add:hover { border-color: var(--text2); color: var(--text2); }

  /* ── Lightbox ── */
  .jrn-lightbox {
    display: none;
    position: fixed; inset: 0; z-index: 9999;
  }
  .jrn-lightbox.open { display: flex; align-items: center; justify-content: center; }
  .jrn-lightbox-backdrop {
    position: absolute; inset: 0;
    background: rgba(0,0,0,.75);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .jrn-lightbox-content {
    position: relative; z-index: 1;
    max-width: 90vw; max-height: 90vh;
    display: flex; align-items: center; justify-content: center;
  }
  .jrn-lightbox-img {
    max-width: 90vw; max-height: 85vh;
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0,0,0,.5);
    object-fit: contain;
  }
  .jrn-lightbox-close {
    position: absolute;
    top: -36px; right: 0;
    background: rgba(255,255,255,.12);
    border: none;
    color: #fff;
    font-size: 16px;
    width: 28px; height: 28px;
    border-radius: 50%;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .12s;
  }
  .jrn-lightbox-close:hover { background: rgba(255,255,255,.25); }

  /* ── Empty state ── */
  .jrn-empty {
    display: flex; flex-direction: column;
    align-items: center; gap: 10px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text3);
    font-size: 14px;
  }
  .jrn-empty svg { opacity: .35; }
  .jrn-empty-sub { font-size: 12px; color: var(--text3); opacity: .7; }
  .jrn-loading { padding: 48px 24px; text-align: center; color: var(--text3); font-size: 14px; }

  /* ── Colors ── */
  .jrn-pos { color: var(--green); }
  .jrn-neg { color: var(--red);   }
  .jrn-neu { color: var(--text);  }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .jrn-period-row { grid-template-columns: 1fr; }
    .jrn-trade-row  { flex-wrap: wrap; }
  }
  `;
  document.head.appendChild(s);
}

// ─── EXPOSE PUBLIC API ───────────────────────────────────────────────────────
window.renderJournalPage = renderJournalPage;
window.jrnNavMonth       = jrnNavMonth;
window.jrnGoToday        = jrnGoToday;
window.toggleSymDetail   = toggleSymDetail;
window.onReflectionInput = onReflectionInput;
window.onAiTextInput     = onAiTextInput;
window.generateDayAI     = generateDayAI;
window.openPeriodModal   = openPeriodModal;
// Stage 3 — screenshots
window.jrnAddScreenshot    = jrnAddScreenshot;
window.jrnRemoveScreenshot = jrnRemoveScreenshot;
window.jrnViewScreenshot   = jrnViewScreenshot;
window.jrnCloseLightbox    = jrnCloseLightbox;
