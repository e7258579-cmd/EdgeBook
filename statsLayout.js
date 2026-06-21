/**
 * statsLayout.js — Stats Page Card Layout Editor
 *
 * Generic layout-editing module for the Statistics page card grid
 * (#stats-grid). Knows nothing about P&L, win rate, or any trading
 * calculations — purely concerned with card position/order and width.
 *
 * Depends on globals from the main script block (must be declared before this file loads):
 *   (none yet — Stage 3 only reads/writes the DOM and localStorage)
 *
 * Public API exposed on window (called from StatsPage.js's renderStats(), at
 * the end, after all cards/charts are populated):
 *   initStatsLayout()        — reads saved layout (if any) and applies it to #stats-grid.
 *                               Safe to call multiple times; safe to call before #stats-grid
 *                               exists in the DOM (no-ops gracefully).
 *   getStatsLayout()         — returns the current in-memory layout array
 *                               [{ id, width }, ...] in DOM order. Useful for debugging
 *                               and for later stages (drag/resize) to read current state.
 *   saveStatsLayout(layout)  — persists a layout array to localStorage (global key,
 *                               shared across all accounts per product decision).
 *   resetStatsLayout()       — clears the saved layout and re-applies the default
 *                               (DOM source-order + each card's original width class).
 *
 * Load order: must come AFTER StatsPage.js (renderStats() calls initStatsLayout()
 *             directly — statsLayout.js must already be loaded by then) and is
 *             safe to load near the bottom bootstrap <script>, same tier as
 *             calendarPage.js / sizingPage.js.
 *
 * Storage key: 'edgebook_stats_layout' (localStorage, global — not per-account).
 *
 * Layout data shape:
 *   [
 *     { id: 'hourly',     width: 'half'  },
 *     { id: 'dayofweek',  width: 'half'  },
 *     { id: 'mood',       width: 'half'  },
 *     { id: 'holdtime',   width: 'half'  },
 *     { id: 'pricerange', width: 'full'  },
 *     { id: 'statsdetail',width: 'full'  },
 *   ]
 *   - Array order = DOM order (left-to-right, top-to-bottom in source order).
 *   - width is one of: 'third' | 'half' | 'full', mapped to the
 *     .card-w-third / .card-w-half / .card-w-full CSS classes defined
 *     alongside #stats-grid in the main stylesheet.
 */

// ─── CONSTANTS ──────────────────────────────────────────────
const STATS_LAYOUT_STORAGE_KEY = 'edgebook_stats_layout';
const STATS_LAYOUT_WIDTH_CLASSES = ['card-w-third', 'card-w-half', 'card-w-full'];
const STATS_LAYOUT_WIDTH_MAP = {
  'card-w-third': 'third',
  'card-w-half':  'half',
  'card-w-full':  'full'
};
const STATS_LAYOUT_CLASS_MAP = {
  third: 'card-w-third',
  half:  'card-w-half',
  full:  'card-w-full'
};

// ─── PRIVATE STATE ──────────────────────────────────────────
// In-memory mirror of the currently-applied layout (DOM order + width per card).
// Kept in sync by _applyLayout() / _captureLayoutFromDom().
let _statsLayout = [];

// ─── DOM HELPERS ────────────────────────────────────────────
function _getStatsGrid() {
  return document.getElementById('stats-grid');
}

function _getCardEls(grid) {
  // Only direct children with a data-card-id are considered layout-managed cards.
  // Anything else under #stats-grid (shouldn't normally happen) is ignored/untouched.
  return Array.from(grid.children).filter(el => el.hasAttribute('data-card-id'));
}

function _widthFromClassList(el) {
  for (const cls of STATS_LAYOUT_WIDTH_CLASSES) {
    if (el.classList.contains(cls)) return STATS_LAYOUT_WIDTH_MAP[cls];
  }
  return 'half'; // sane fallback if a card somehow has no width class
}

function _setCardWidth(el, width) {
  const targetClass = STATS_LAYOUT_CLASS_MAP[width] || STATS_LAYOUT_CLASS_MAP.half;
  STATS_LAYOUT_WIDTH_CLASSES.forEach(cls => el.classList.remove(cls));
  el.classList.add(targetClass);
}

// ─── CAPTURE / APPLY ────────────────────────────────────────
// Reads the grid's current DOM state (order + width classes) into _statsLayout.
// Used to establish the "default" layout on first load (when nothing is saved
// yet) — i.e. whatever StatsPage.js / the HTML markup already renders.
function _captureLayoutFromDom() {
  const grid = _getStatsGrid();
  if (!grid) { _statsLayout = []; return; }
  const cards = _getCardEls(grid);
  _statsLayout = cards.map(el => ({
    id: el.getAttribute('data-card-id'),
    width: _widthFromClassList(el)
  }));
}

// Applies a given layout array to the live DOM: reorders cards (via
// appendChild, which moves existing nodes rather than recreating them —
// so any live Chart.js instances inside survive untouched) and sets each
// card's width class. Cards referenced in `layout` but missing from the
// DOM are skipped. Cards present in the DOM but missing from `layout`
// (e.g. a newly-added card not yet known to an old saved layout) are
// appended at the end, keeping their existing width class as default.
function _applyLayout(layout) {
  const grid = _getStatsGrid();
  if (!grid) return false;

  const cardsById = {};
  _getCardEls(grid).forEach(el => { cardsById[el.getAttribute('data-card-id')] = el; });

  const appliedIds = new Set();

  layout.forEach(entry => {
    const el = cardsById[entry.id];
    if (!el) return; // referenced card no longer exists in the DOM — skip safely
    _setCardWidth(el, entry.width);
    grid.appendChild(el); // moves the existing node to the end, preserving its content/state
    appliedIds.add(entry.id);
  });

  // Any card present in the DOM but not mentioned in the saved layout
  // (e.g. added to the app after the user last saved a custom layout)
  // gets appended after the known cards, keeping whatever width class
  // it already has in the markup.
  Object.keys(cardsById).forEach(id => {
    if (!appliedIds.has(id)) grid.appendChild(cardsById[id]);
  });

  _captureLayoutFromDom(); // re-sync in-memory state to the now-applied DOM order
  return true;
}

// ─── STORAGE ────────────────────────────────────────────────
function _loadSavedLayout() {
  try {
    const raw = localStorage.getItem(STATS_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Basic shape validation — ignore malformed entries rather than throwing.
    return parsed.filter(e => e && typeof e.id === 'string' &&
      ['third', 'half', 'full'].includes(e.width));
  } catch (e) {
    console.error('statsLayout: failed to read saved layout', e);
    return null;
  }
}

function saveStatsLayout(layout) {
  try {
    localStorage.setItem(STATS_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch (e) {
    console.error('statsLayout: failed to save layout', e);
    return false;
  }
}

function resetStatsLayout() {
  try {
    localStorage.removeItem(STATS_LAYOUT_STORAGE_KEY);
  } catch (e) {
    console.error('statsLayout: failed to clear saved layout', e);
  }
  // Re-apply whatever order/widths are in the original HTML markup as-is.
  // Since we never reordered the DOM yet in this fresh state, capturing
  // straight from the DOM gives back the true default.
  _captureLayoutFromDom();
  _applyLayout(_statsLayout);
}

// ─── PUBLIC INIT ────────────────────────────────────────────
// Call once after the stats page markup exists (safe to call repeatedly —
// e.g. every time the Stats tab is shown — it's idempotent given the same
// saved/default state).
function initStatsLayout() {
  const grid = _getStatsGrid();
  if (!grid) return; // stats page not in the DOM yet — caller can retry later

  const saved = _loadSavedLayout();
  if (saved && saved.length) {
    _applyLayout(saved);
  } else {
    _captureLayoutFromDom(); // establish default from current markup order
  }
}

function getStatsLayout() {
  return _statsLayout.map(e => ({ ...e })); // shallow copy, avoid external mutation
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.initStatsLayout  = initStatsLayout;
window.getStatsLayout   = getStatsLayout;
window.saveStatsLayout  = saveStatsLayout;
window.resetStatsLayout = resetStatsLayout;
