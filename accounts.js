/**
 * accounts.js — Multi-Account Data Layer
 * EdgeBook Stage 1
 *
 * Must be loaded BEFORE app.js in the HTML:
 *   <script src="accounts.js"></script>
 *   <script src="app.js"></script>
 *
 * Owns:
 *   activeAccount          — 'demo' | 'live'
 *   loadAccountTrades()    — returns trades array for active account
 *   saveAccountTrades(arr) — persists array for active account
 *   switchAccount(acct)    — switches account, reloads trades, re-renders
 *
 * Storage keys:
 *   edgebook_active_account  → 'demo' | 'live'
 *   trades_live              → JSON array (live account)
 *   trades_demo              → JSON array (demo account)
 *
 * Migration:
 *   If trades_live is empty but legacy key 'tradeJournal_v2' exists,
 *   its data is automatically moved into trades_live (once only).
 */

// ─── CONSTANTS ────────────────────────────────────────────
const ACCT_KEY    = 'edgebook_active_account';
const TRADES_KEY  = acct => `trades_${acct}`;
const LEGACY_KEY  = 'tradeJournal_v2';

// ─── ACTIVE ACCOUNT STATE ────────────────────────────────
let activeAccount = localStorage.getItem(ACCT_KEY) || 'live';

// ─── MIGRATION (runs once) ───────────────────────────────
(function migrateLegacyData() {
  const liveKey = TRADES_KEY('live');
  const hasLive = localStorage.getItem(liveKey);
  const legacy  = localStorage.getItem(LEGACY_KEY);
  if (!hasLive && legacy) {
    // Move existing data into live account
    localStorage.setItem(liveKey, legacy);
    // Keep legacy key intact so nothing breaks if app.js still reads it
  }
})();

// ─── CORE FUNCTIONS ──────────────────────────────────────
function loadAccountTrades() {
  try {
    const raw = localStorage.getItem(TRADES_KEY(activeAccount));
    return raw ? JSON.parse(raw) : [];
  } catch(e) {
    return [];
  }
}

function saveAccountTrades(tradesArr) {
  try {
    localStorage.setItem(TRADES_KEY(activeAccount), JSON.stringify(tradesArr));
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      // Let app.js toast handle this — just rethrow
      throw e;
    }
  }
}

// ─── ACCOUNT SWITCH ──────────────────────────────────────
function switchAccount(acct) {
  if (acct !== 'demo' && acct !== 'live') return;
  activeAccount = acct;
  window.activeAccount = acct;  // keep window in sync
  localStorage.setItem(ACCT_KEY, acct);

  // Reload global trades (defined in app.js, available by the time
  // switchAccount is ever called from the UI)
  trades = loadAccountTrades();

  // Persist under new account key immediately
  saveAccountTrades(trades);

  // Re-render everything
  if (typeof refreshAll === 'function') refreshAll();

  // Update UI indicators (Stage 2 + 4 add these)
  if (typeof updateAcctButtons === 'function') updateAcctButtons();
  if (typeof updateAcctBadge   === 'function') updateAcctBadge();
}

// ─── EXPOSE PUBLIC API ───────────────────────────────────
// window.activeAccount is a live getter — always reflects the current value
Object.defineProperty(window, 'activeAccount', {
  get: () => activeAccount,
  set: v  => { activeAccount = v; },
  configurable: true
});
window.loadAccountTrades  = loadAccountTrades;
window.saveAccountTrades  = saveAccountTrades;
window.switchAccount      = switchAccount;

// ─── UI UPDATERS ────────────────────────────────────────
function updateAcctButtons() {
  const liveBtn = document.getElementById('acct-btn-live');
  const demoBtn = document.getElementById('acct-btn-demo');
  if (liveBtn) {
    liveBtn.classList.toggle('active-live', activeAccount === 'live');
    liveBtn.classList.toggle('active', activeAccount === 'live');
  }
  if (demoBtn) {
    demoBtn.classList.toggle('active-demo', activeAccount === 'demo');
    demoBtn.classList.toggle('active', activeAccount === 'demo');
  }
}
window.updateAcctButtons = updateAcctButtons;

function updateAcctBadge() {
  const badge = document.getElementById('acct-badge');
  if (!badge) return;
  badge.textContent = activeAccount === 'live' ? 'Live' : 'Demo';
  badge.className   = 'acct-badge badge-' + activeAccount;

  // Demo mode: amber bottom border on topbar
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.classList.toggle('demo-mode', activeAccount === 'demo');
}
window.updateAcctBadge = updateAcctBadge;