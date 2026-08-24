/**
 * metricEngine.js — Display Metric Engine
 * EdgeBook — Phase 4 (Price Move metric)
 *
 * Owns:
 *   getPriceMove(t) / getPriceMovePct(t) — the Price Move calculation
 *   metricMode ('pnl' | 'priceMove')     — global display preference,
 *                                          persisted in localStorage
 *   getMetricValue(t) / getMetricLabel() — convenience helpers so
 *                                          consumer pages don't each
 *                                          re-implement the branch
 *
 * Price Move definition (confirmed):
 *   Long:  exit - entry
 *   Short: entry - exit
 *   % move: priceMove / entry * 100
 *
 * This is an independent metric family alongside $ P&L — not a
 * replacement. t.pnl is untouched; nothing here computes fees (see
 * Phase 1 — fees are not calculated anywhere in the app).
 *
 * Consumers (StatsPage.js, sizingPage.js, settingsPage.js) call
 * getMetricMode() to decide which number/label to show, and call
 * setMetricMode() from the Settings → Display control to change it.
 *
 * Load order: after app.js, before StatsPage.js / sizingPage.js /
 * settingsPage.js (any page that reads the mode).
 */

// ─── PRICE MOVE ──────────────────────────────────────────────
function getPriceMove(t) {
  if (!t) return 0;
  const entry = parseFloat(t.entry) || 0;
  const exit  = parseFloat(t.exit)  || 0;
  return t.dir === 'long' ? (exit - entry) : (entry - exit);
}

function getPriceMovePct(t) {
  const entry = parseFloat(t && t.entry) || 0;
  if (!entry) return 0;
  return (getPriceMove(t) / entry) * 100;
}

// ─── GLOBAL METRIC MODE ────────────────────────────────────────
const METRIC_MODE_KEY = 'edgebook_metric_mode';

function getMetricMode() {
  const saved = localStorage.getItem(METRIC_MODE_KEY);
  return saved === 'priceMove' ? 'priceMove' : 'pnl'; // default 'pnl'
}

function setMetricMode(mode) {
  if (mode !== 'pnl' && mode !== 'priceMove') return;
  localStorage.setItem(METRIC_MODE_KEY, mode);
  // Re-render whichever pages are currently visible / hold KPIs that
  // depend on the mode — same pattern as toggleTheme()'s updateStats() call.
  if (typeof updateStats === 'function') updateStats();
  const statsVisible   = document.getElementById('tab-stats')    && document.getElementById('tab-stats').style.display    !== 'none';
  const sizingVisible  = document.getElementById('tab-sizing')   && document.getElementById('tab-sizing').style.display   !== 'none';
  const settingsVisible= document.getElementById('tab-settings') && document.getElementById('tab-settings').style.display !== 'none';
  if (statsVisible    && typeof renderStats        === 'function') renderStats();
  if (sizingVisible   && typeof renderSizingPage    === 'function') renderSizingPage();
  if (settingsVisible && typeof renderSettingsPage  === 'function') renderSettingsPage();
}

// ─── CONVENIENCE HELPERS ───────────────────────────────────────
// Per-trade $ P&L or Price Move, depending on the current global mode.
function getMetricValue(t) {
  return getMetricMode() === 'priceMove' ? getPriceMove(t) : (parseFloat(t && t.pnl) || 0);
}

// Short label for the current mode, e.g. for KPI card titles.
function getMetricLabel() {
  return getMetricMode() === 'priceMove' ? 'Price Move' : 'P&L';
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
// Short formatted value for chart bar-labels/tooltips — $ with K/M notation
// in P&L mode, plain 2-decimal price delta (no '$') in Price Move mode.
function fmtMetricShort(v) {
  const sign = v >= 0 ? '+' : '-';
  const abs  = Math.abs(v);
  if (getMetricMode() === 'priceMove') return sign + abs.toFixed(2);
  return sign + '$' + (abs >= 1000 ? (abs/1000).toFixed(1).replace(/\.0$/,'') + 'K' : abs.toFixed(0));
}

window.getPriceMove    = getPriceMove;
window.getPriceMovePct = getPriceMovePct;
window.getMetricMode   = getMetricMode;
window.setMetricMode   = setMetricMode;
window.getMetricValue  = getMetricValue;
window.getMetricLabel  = getMetricLabel;
window.fmtMetricShort  = fmtMetricShort;
