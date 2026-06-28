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
 * Public API exposed on window:
 *   initStatsLayout()        — called from StatsPage.js's renderStats(), at the end,
 *                               after all cards/charts are populated. Reads saved layout
 *                               (if any) and applies it to #stats-grid. Safe to call
 *                               multiple times; safe to call before #stats-grid exists
 *                               in the DOM (no-ops gracefully).
 *   toggleStatsLayoutEdit()  — called from the pencil button's onclick in the HTML
 *                               (#stats-layout-edit-btn). Enters/exits edit mode: injects
 *                               or removes the per-card move-handle (⠿) and resize-grip,
 *                               toggles the dashed outline on #stats-grid, and toggles the
 *                               button's active state.
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

// ─── EDIT MODE ──────────────────────────────────────────────
// Whether the layout editor is currently active. Handles (move + resize)
// only exist in the DOM while this is true — kept out of the markup
// entirely otherwise, so normal page use never pays any cost for them.
let _statsLayoutEditing = false;

const STATS_LAYOUT_MOVE_HANDLE_CLASS   = 'stats-layout-move-handle';
const STATS_LAYOUT_RESIZE_GRIP_CLASS   = 'stats-layout-resize-grip';

function _injectCardHandles(el) {
  // Avoid double-injecting if called more than once for the same card.
  if (!el.querySelector('.' + STATS_LAYOUT_MOVE_HANDLE_CLASS)) {
    const moveHandle = document.createElement('div');
    moveHandle.className = STATS_LAYOUT_MOVE_HANDLE_CLASS;
    moveHandle.setAttribute('title', 'Drag to move');
    moveHandle.setAttribute('aria-label', 'Drag to move card');
    moveHandle.textContent = '⠿';
    // Note: no pointerdown listener here — SortableJS attaches its own
    // drag listeners to the grid and detects the handle via its `handle` option.
    el.appendChild(moveHandle);
  }
  if (!el.querySelector('.' + STATS_LAYOUT_RESIZE_GRIP_CLASS)) {
    const resizeGrip = document.createElement('div');
    resizeGrip.className = STATS_LAYOUT_RESIZE_GRIP_CLASS;
    resizeGrip.setAttribute('title', 'Drag to resize');
    resizeGrip.setAttribute('aria-label', 'Drag to resize card');
    resizeGrip.addEventListener('pointerdown', _onResizeGripPointerDown);
    el.appendChild(resizeGrip);
  }
}

function _removeCardHandles(el) {
  const moveHandle = el.querySelector('.' + STATS_LAYOUT_MOVE_HANDLE_CLASS);
  if (moveHandle) moveHandle.remove(); // SortableJS handles its own listener cleanup
  const resizeGrip = el.querySelector('.' + STATS_LAYOUT_RESIZE_GRIP_CLASS);
  if (resizeGrip) {
    resizeGrip.removeEventListener('pointerdown', _onResizeGripPointerDown);
    resizeGrip.remove();
  }
}

function _enterStatsLayoutEdit() {
  const grid = _getStatsGrid();
  if (!grid) return;
  _statsLayoutEditing = true;
  grid.classList.add('layout-editing');
  _getCardEls(grid).forEach(_injectCardHandles);
  _initSortable(grid); // enable SortableJS drag-to-reorder

  const btn = document.getElementById('stats-layout-edit-btn');
  if (btn) btn.classList.add('active');
}

function _exitStatsLayoutEdit() {
  const grid = _getStatsGrid();
  _statsLayoutEditing = false;
  if (grid) {
    grid.classList.remove('layout-editing');
    _getCardEls(grid).forEach(_removeCardHandles);
  }
  _disableSortable(); // pause SortableJS without destroying the instance

  const btn = document.getElementById('stats-layout-edit-btn');
  if (btn) btn.classList.remove('active');
}

// Called from the pencil button (#stats-layout-edit-btn) in EdgeBook.html.
function toggleStatsLayoutEdit() {
  if (_statsLayoutEditing) {
    _exitStatsLayoutEdit();
  } else {
    _enterStatsLayoutEdit();
  }
}


// ─── DRAG TO MOVE — SortableJS (Stage 5) ───────────────────
// Card reordering is handled by SortableJS (MIT, loaded from CDN).
// SortableJS replaces the ~370 lines of manual pointer-event drag logic
// that was here previously — giving us smooth animations, a correct ghost,
// and touch support for free, with ~20 lines of integration code.
//
// Instance lifecycle:
//   - Created once in _enterStatsLayoutEdit() when edit mode is first activated.
//   - Disabled (not destroyed) in _exitStatsLayoutEdit() so the DOM event
//     listeners don't pile up on repeated enter/exit cycles — SortableJS's
//     own `disabled` option pauses it cleanly.
//   - On drag end (onEnd callback): captures the new DOM order and auto-saves
//     to localStorage, matching the "auto-save after every action" plan.
//
// Handle: the ⠿ move handle injected by _injectCardHandles() — SortableJS
// only starts a drag from that element, so chart/tooltip interactions inside
// the card are never accidentally hijacked.

let _sortableInstance = null;

function _initSortable(grid) {
  if (_sortableInstance) {
    // Already created — just re-enable it.
    _sortableInstance.option('disabled', false);
    return;
  }

  _sortableInstance = Sortable.create(grid, {
    handle: '.' + STATS_LAYOUT_MOVE_HANDLE_CLASS,
    animation: 200,
    ghostClass: 'layout-sortable-ghost',
    dragClass: 'layout-sortable-drag',
    filter: '.' + STATS_LAYOUT_RESIZE_GRIP_CLASS, // resize grip clicks don't start a drag
    onEnd: function () {
      _captureLayoutFromDom();
      saveStatsLayout(_statsLayout);
    }
  });
}

function _disableSortable() {
  if (_sortableInstance) _sortableInstance.option('disabled', true);
}

// ─── DRAG TO RESIZE (Stage 6) ───────────────────────────────
// Pointer-based resize, started only from the resize grip (bottom-right
// corner) — same isolation principle as the move handle: never triggered
// by interacting with the card body itself.
//
// Feel: width tracks the pointer continuously and smoothly in pixels while
// dragging (live pixel width/min-width/max-width override via inline
// style — grid-column itself only accepts whole-number spans, so it can't
// produce smooth pixel-level tracking). On release, the pointer position
// is converted to a span and snapped to whichever named tier (third/half/
// full) it ended up closest to; the inline pixel override is removed and
// the matching width class is applied via the existing _setCardWidth() —
// exactly like every other width change in this module. Layout is then
// captured + auto-saved, same as Stage 5.

let _resizeState = null; // { cardEl, grid, pointerId, columnWidth, gapPx, startSpan } while resizing, else null

const STATS_LAYOUT_SPAN_TIERS = [2, 3, 6]; // third, half, full — in grid-column span units, out of 6

function _onResizeGripPointerDown(e) {
  if (!_statsLayoutEditing) return;
  const grip = e.currentTarget;
  const cardEl = grip.closest('.section[data-card-id]');
  const grid = _getStatsGrid();
  if (!cardEl || !grid) return;

  e.preventDefault();
  e.stopPropagation(); // don't let this bubble into anything card-level (e.g. future click handlers)

  const gridRect = grid.getBoundingClientRect();
  const gridStyle = window.getComputedStyle(grid);
  const gapPx = parseFloat(gridStyle.columnGap || gridStyle.gap) || 0;
  // 6 columns, 5 gaps between them — solve for a single column's width.
  const columnWidth = (gridRect.width - gapPx * 5) / 6;

  _resizeState = {
    cardEl,
    grid,
    pointerId: e.pointerId,
    columnWidth,
    gapPx,
    startSpan: _spanFromWidth(_widthFromClassList(cardEl))
  };

  grip.setPointerCapture(e.pointerId);
  cardEl.classList.add('layout-resizing');

  grip.addEventListener('pointermove', _onResizeGripPointerMove);
  grip.addEventListener('pointerup', _onResizeGripPointerUp);
  grip.addEventListener('pointercancel', _onResizeGripPointerCancel);
}

function _spanFromWidth(width) {
  return width === 'third' ? 2 : width === 'full' ? 6 : 3; // 'half' (default/fallback) = 3
}

// Raw pixel width the card should render at while dragging, clamped to
// stay within the grid's own bounds (1 column min, full grid width max).
// Used purely for the live visual — has no relationship to grid-column
// span units until release, when _continuousSpanFromPointer() converts
// the final pointer position into a span for snapping.
function _continuousWidthPxFromPointer(clientX) {
  const { cardEl, grid } = _resizeState;
  const cardRect = cardEl.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const draggedWidthPx = clientX - cardRect.left;
  const maxWidthPx = gridRect.right - cardRect.left; // can't grow past the grid's own right edge
  return Math.min(maxWidthPx, Math.max(20, draggedWidthPx));
}

// Converts a pointer X position into a continuous (fractional) span value,
// based on distance dragged from the card's own left edge — so the card's
// snap target is computed from the same anchor point used for the live
// pixel preview above. Used only at release time, to pick the nearest tier.
function _continuousSpanFromPointer(clientX) {
  const { cardEl, columnWidth, gapPx } = _resizeState;
  const cardRect = cardEl.getBoundingClientRect();
  const draggedWidthPx = clientX - cardRect.left;
  // Width of N spanned columns = N * columnWidth + (N - 1) * gapPx.
  // Solve for N given a pixel width:
  const rawSpan = (draggedWidthPx + gapPx) / (columnWidth + gapPx);
  return Math.min(6, Math.max(1, rawSpan));
}

function _nearestTierSpan(span) {
  return STATS_LAYOUT_SPAN_TIERS.reduce((closest, tier) =>
    Math.abs(tier - span) < Math.abs(closest - span) ? tier : closest
  );
}

function _spanToWidth(span) {
  return span <= 2 ? 'third' : span >= 6 ? 'full' : 'half';
}

function _onResizeGripPointerMove(e) {
  if (!_resizeState || e.pointerId !== _resizeState.pointerId) return;
  const { cardEl } = _resizeState;

  // True pixel-continuous feedback: grid-column only accepts whole-number
  // spans (e.g. "span 3"), so animating it directly would jump in 6 discrete
  // steps rather than smoothly tracking the pointer. Instead, override the
  // card's rendered width directly in pixels — fully continuous — while
  // leaving its grid-column (and therefore its grid track placement) alone.
  // The override is removed on release, see _onResizeGripPointerUp.
  const widthPx = _continuousWidthPxFromPointer(e.clientX);
  cardEl.style.width = widthPx + 'px';
  cardEl.style.minWidth = widthPx + 'px';
  cardEl.style.maxWidth = widthPx + 'px';
}

function _finishResize() {
  if (!_resizeState) return;
  const { cardEl } = _resizeState;

  cardEl.classList.remove('layout-resizing');
  // Always clear the live pixel-width override here, in one place, so every
  // exit path (normal release, cancel) ends with the card relying solely on
  // its grid-column width class again — never left with a stale inline size.
  cardEl.style.width = '';
  cardEl.style.minWidth = '';
  cardEl.style.maxWidth = '';

  const grip = cardEl.querySelector('.' + STATS_LAYOUT_RESIZE_GRIP_CLASS);
  if (grip) {
    grip.removeEventListener('pointermove', _onResizeGripPointerMove);
    grip.removeEventListener('pointerup', _onResizeGripPointerUp);
    grip.removeEventListener('pointercancel', _onResizeGripPointerCancel);
    try { grip.releasePointerCapture(_resizeState.pointerId); } catch (err) { /* already released */ }
  }

  _resizeState = null;
}

function _onResizeGripPointerUp(e) {
  if (!_resizeState || e.pointerId !== _resizeState.pointerId) return;
  const { cardEl } = _resizeState;

  const liveSpan = _continuousSpanFromPointer(e.clientX);
  const snappedSpan = _nearestTierSpan(liveSpan);
  const snappedWidth = _spanToWidth(snappedSpan);

  // Apply the snapped width class — _finishResize() (called below) clears
  // the live pixel override, so after that the class is the only thing
  // controlling width again, exactly like every other card in the grid.
  _setCardWidth(cardEl, snappedWidth);

  _captureLayoutFromDom();
  saveStatsLayout(_statsLayout);

  _finishResize();
}

function _onResizeGripPointerCancel(e) {
  if (!_resizeState || e.pointerId !== _resizeState.pointerId) return;
  const { cardEl, startSpan } = _resizeState;
  // Interrupted mid-resize — revert to the width the card had before this
  // drag started, discarding the live preview. No save (nothing changed).
  _setCardWidth(cardEl, _spanToWidth(startSpan));
  _finishResize();
}


window.initStatsLayout       = initStatsLayout;
window.getStatsLayout        = getStatsLayout;
window.saveStatsLayout       = saveStatsLayout;
window.resetStatsLayout      = resetStatsLayout;
window.toggleStatsLayoutEdit = toggleStatsLayoutEdit;
