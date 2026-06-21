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
    moveHandle.addEventListener('pointerdown', _onMoveHandlePointerDown);
    el.appendChild(moveHandle);
  }
  if (!el.querySelector('.' + STATS_LAYOUT_RESIZE_GRIP_CLASS)) {
    const resizeGrip = document.createElement('div');
    resizeGrip.className = STATS_LAYOUT_RESIZE_GRIP_CLASS;
    resizeGrip.setAttribute('title', 'Drag to resize');
    resizeGrip.setAttribute('aria-label', 'Drag to resize card');
    el.appendChild(resizeGrip);
  }
}

function _removeCardHandles(el) {
  const moveHandle = el.querySelector('.' + STATS_LAYOUT_MOVE_HANDLE_CLASS);
  if (moveHandle) {
    moveHandle.removeEventListener('pointerdown', _onMoveHandlePointerDown);
    moveHandle.remove();
  }
  const resizeGrip = el.querySelector('.' + STATS_LAYOUT_RESIZE_GRIP_CLASS);
  if (resizeGrip) resizeGrip.remove();
}

function _enterStatsLayoutEdit() {
  const grid = _getStatsGrid();
  if (!grid) return;
  _statsLayoutEditing = true;
  grid.classList.add('layout-editing');
  _getCardEls(grid).forEach(_injectCardHandles);

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

// ─── DRAG TO MOVE / SWAP / INSERT (Stage 5) ────────────────
// Pointer-based drag, started only from the move handle (⠿) — never from
// clicking the card body, so chart hover/tooltip interactions inside a
// card are never hijacked by drag. Uses Pointer Events (covers mouse,
// touch, and pen with one code path) + setPointerCapture so the drag
// keeps tracking even if the pointer moves off the handle/card.
//
// Drop behavior:
//   - Pointer released over the CENTER band of another card → SWAP: the
//     dragged card and that card trade DOM positions.
//   - Pointer released near the LEFT/RIGHT EDGE of another card → INSERT:
//     the dragged card is moved to sit directly before/after that exact
//     card in DOM order — which, via normal grid flow, keeps it in the
//     SAME VISUAL ROW as that card (as long as the row has room per the
//     cards' width spans), rather than jumping to wherever the next card
//     in linear DOM order happens to be (which could be the next row).
//   - Pointer released over empty grid space (gaps between/below cards,
//     not near any card's edge) → INSERT at the end of the grid.
//   A thin vertical placeholder bar (.layout-insert-indicator) is shown
//   live during the drag so the exact landing position is visible before drop.
//   - Pointer released outside #stats-grid entirely → no-op (card stays
//     where it was; nothing is reordered or saved).
// On any successful drop (swap or insert) the in-memory layout is
// recaptured from the DOM and persisted via saveStatsLayout(), matching
// the "auto-save after every action" decision (Stage 7 in the plan) —
// included now so Stage 5 is independently testable end-to-end.

let _dragState = null; // { cardEl, grid, pointerId } while a drag is in progress, else null

// How close to a card's left/right edge (as a fraction of its width) the
// pointer must be for that side to count as an "insert here" zone rather
// than a swap. E.g. 0.25 = outer 25% on each side is insert, middle 50% is swap.
const STATS_LAYOUT_INSERT_EDGE_RATIO = 0.25;

const STATS_LAYOUT_INSERT_INDICATOR_CLASS = 'layout-insert-indicator';

function _onMoveHandlePointerDown(e) {
  if (!_statsLayoutEditing) return;
  const handle = e.currentTarget;
  const cardEl = handle.closest('.section[data-card-id]');
  const grid = _getStatsGrid();
  if (!cardEl || !grid) return;

  e.preventDefault();

  _dragState = { cardEl, grid, pointerId: e.pointerId };
  handle.setPointerCapture(e.pointerId);

  cardEl.classList.add('layout-dragging');

  handle.addEventListener('pointermove', _onMoveHandlePointerMove);
  handle.addEventListener('pointerup', _onMoveHandlePointerUp);
  handle.addEventListener('pointercancel', _onMoveHandlePointerCancel);
}

// Finds the drop target under the pointer:
//   - Pointer over the center band of another card           → { type: 'swap', cardEl }
//   - Pointer over the outer edge band of another card, or
//     over empty grid space (gaps, below last row)            → { type: 'insert', beforeEl }
//     beforeEl is the card to insert in front of, or null to insert at the end.
//   - Pointer outside the grid entirely                       → null
function _resolveDropTarget(clientX, clientY) {
  const { cardEl: draggedEl, grid } = _dragState;
  const elAtPoint = document.elementFromPoint(clientX, clientY);
  if (!elAtPoint) return null;

  const hoveredCard = elAtPoint.closest('.section[data-card-id]');
  if (hoveredCard && hoveredCard !== draggedEl && hoveredCard.parentElement === grid) {
    const rect = hoveredCard.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const edgeZone = rect.width * STATS_LAYOUT_INSERT_EDGE_RATIO;

    if (offsetX < edgeZone) {
      // Left edge band — insert before this card. If this card IS the
      // dragged card's current next sibling, that's already its position —
      // normalize to "no-op" instead of showing a placeholder right next
      // to the (semi-transparent) dragged card itself.
      return hoveredCard === draggedEl.nextElementSibling
        ? null
        : { type: 'insert', beforeEl: hoveredCard };
    }
    if (offsetX > rect.width - edgeZone) {
      // Right edge band — insert immediately after this card in DOM order.
      // Using hoveredCard.nextElementSibling (not "the next layout card
      // anywhere in the DOM") keeps the dragged card in the same visual
      // row as hoveredCard via normal grid flow — it lands right next to
      // it, rather than jumping to wherever the next card happens to sit,
      // which could be the start of the following row.
      const beforeEl = hoveredCard.nextElementSibling;
      // Same normalization: if "after hoveredCard" is exactly where the
      // dragged card already sits, treat as no-op.
      return beforeEl === draggedEl
        ? null
        : { type: 'insert', beforeEl };
    }
    // Center band — swap.
    return { type: 'swap', cardEl: hoveredCard };
  }

  // Not over a (different) card — still over the grid's own empty space
  // (gaps between/below cards count as "insert at the end"; outside the grid does not).
  if (elAtPoint === grid || grid.contains(elAtPoint)) {
    return { type: 'insert', beforeEl: null };
  }

  return null;
}

function _clearDropTargetHighlight(grid) {
  _getCardEls(grid).forEach(el => el.classList.remove('layout-drop-target'));
  const indicator = grid.querySelector('.' + STATS_LAYOUT_INSERT_INDICATOR_CLASS);
  if (indicator) indicator.remove();
}

// Shows the insert-position placeholder bar as an actual (temporary) grid
// item, positioned via insertBefore so normal grid flow pushes neighboring
// cards aside — giving an accurate live preview of where the card will land.
function _showInsertIndicator(grid, beforeEl) {
  let indicator = grid.querySelector('.' + STATS_LAYOUT_INSERT_INDICATOR_CLASS);
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = STATS_LAYOUT_INSERT_INDICATOR_CLASS;
  }
  if (beforeEl) {
    grid.insertBefore(indicator, beforeEl);
  } else {
    grid.appendChild(indicator); // end of grid
  }
}

function _onMoveHandlePointerMove(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  const { grid } = _dragState;

  // Remove any existing indicator/highlight FIRST, before resolving the drop
  // target. The indicator bar is itself a grid item (span 1 column) that
  // shifts neighboring cards when present — resolving against a grid that
  // still contains it would measure shifted card positions and could flicker
  // between two answers on consecutive moves. Always resolve against a clean
  // grid (no inserted indicator) for a stable result.
  _clearDropTargetHighlight(grid);

  const target = _resolveDropTarget(e.clientX, e.clientY);
  if (target && target.type === 'swap') {
    target.cardEl.classList.add('layout-drop-target');
  } else if (target && target.type === 'insert') {
    _showInsertIndicator(grid, target.beforeEl);
  }
  // null (invalid drop, outside the grid) → no highlight; dragged card's
  // reduced opacity is feedback enough.
}

function _finishDrag() {
  if (!_dragState) return;
  const { cardEl, grid } = _dragState;

  cardEl.classList.remove('layout-dragging');
  _clearDropTargetHighlight(grid);

  const handle = cardEl.querySelector('.' + STATS_LAYOUT_MOVE_HANDLE_CLASS);
  if (handle) {
    handle.removeEventListener('pointermove', _onMoveHandlePointerMove);
    handle.removeEventListener('pointerup', _onMoveHandlePointerUp);
    handle.removeEventListener('pointercancel', _onMoveHandlePointerCancel);
    try { handle.releasePointerCapture(_dragState.pointerId); } catch (err) { /* already released */ }
  }

  _dragState = null;
}

function _onMoveHandlePointerUp(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  const { cardEl, grid } = _dragState;

  // Clear the indicator/highlight before resolving — same reasoning as in
  // pointermove: resolving against a grid that still contains the inserted
  // indicator bar would measure shifted card positions and could pick the
  // wrong target right at the moment of drop.
  _clearDropTargetHighlight(grid);
  const target = _resolveDropTarget(e.clientX, e.clientY);

  if (target && target.type === 'swap') {
    // Trade DOM positions: insert a marker before the dragged card, move the
    // dragged card to where the target card was, then move the target card
    // to the marker. Keeps both elements (and any live Chart.js instances
    // inside them) intact — only their position in the DOM changes.
    const marker = document.createComment('stats-layout-swap-marker');
    grid.insertBefore(marker, cardEl);
    grid.insertBefore(cardEl, target.cardEl);
    grid.insertBefore(target.cardEl, marker);
    marker.remove();

    _captureLayoutFromDom();
    saveStatsLayout(_statsLayout);
  } else if (target && target.type === 'insert') {
    // Move the dragged card to sit directly before `beforeEl` (or to the
    // end, if beforeEl is null) — a true positional insert, not just append.
    if (target.beforeEl) {
      grid.insertBefore(cardEl, target.beforeEl);
    } else {
      grid.appendChild(cardEl);
    }

    _captureLayoutFromDom();
    saveStatsLayout(_statsLayout);
  }
  // else: dropped outside the grid entirely — no reorder, no save.

  _finishDrag();
}

function _onMoveHandlePointerCancel(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  // Pointer interaction was interrupted (e.g. browser gesture, alt-tab) —
  // abandon the drag without reordering or saving.
  _finishDrag();
}


window.initStatsLayout       = initStatsLayout;
window.getStatsLayout        = getStatsLayout;
window.saveStatsLayout       = saveStatsLayout;
window.resetStatsLayout      = resetStatsLayout;
window.toggleStatsLayoutEdit = toggleStatsLayoutEdit;
