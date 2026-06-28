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
    resizeGrip.addEventListener('pointerdown', _onResizeGripPointerDown);
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

let _dragState = null; // { cardEl, grid, pointerId, ghostEl } while a drag is in progress, else null

// How close to a card's left/right edge (as a fraction of its width) the
// pointer must be for that side to count as an "insert here" zone rather
// than a swap. E.g. 0.25 = outer 25% on each side is insert, middle 50% is swap.
const STATS_LAYOUT_INSERT_EDGE_RATIO = 0.25;

const STATS_LAYOUT_INSERT_INDICATOR_CLASS = 'layout-insert-indicator';
const STATS_LAYOUT_DRAG_GHOST_CLASS       = 'stats-layout-drag-ghost';

// ── Ghost helpers ──────────────────────────────────────────
// Creates a visual clone of the dragged card, positioned exactly over the
// original card so the drag appears to "pick up" the card itself.
// The clone is appended to document.body with fixed positioning so it
// escapes the grid's stacking context and can move freely above everything.
function _createDragGhost(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = STATS_LAYOUT_DRAG_GHOST_CLASS;
  ghost.style.width  = rect.width  + 'px';
  ghost.style.height = rect.height + 'px';
  // Start exactly over the original card — gives the illusion of picking
  // it up directly rather than spawning a new element.
  ghost.style.left = rect.left + 'px';
  ghost.style.top  = rect.top  + 'px';
  document.body.appendChild(ghost);
  return ghost;
}

// Moves the ghost so it stays centered under the pointer, using the
// offset from the point where the drag started (where the handle was
// clicked) so the card doesn't jump relative to the finger/cursor.
// dragOffsetX/Y are stored in _dragState at pointerdown.
function _moveDragGhost(ghost, clientX, clientY) {
  const { dragOffsetX, dragOffsetY } = _dragState;
  ghost.style.left = (clientX - dragOffsetX) + 'px';
  ghost.style.top  = (clientY - dragOffsetY) + 'px';
}

function _removeDragGhost(ghost) {
  if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
}

// Minimum pointer movement (px) before a press on the move handle is
// treated as an intentional drag. Below this, a tap/click does nothing.
const STATS_LAYOUT_DRAG_THRESHOLD_PX = 6;

function _onMoveHandlePointerDown(e) {
  if (!_statsLayoutEditing) return;
  const handle = e.currentTarget;
  const cardEl = handle.closest('.section[data-card-id]');
  const grid = _getStatsGrid();
  if (!cardEl || !grid) return;

  e.preventDefault();

  // Measure once at drag start — used every pointermove frame.
  const cardRect = cardEl.getBoundingClientRect();
  const gridStyle = window.getComputedStyle(grid);
  const gapPx = parseFloat(gridStyle.columnGap || gridStyle.gap) || 0;
  const columnWidth = (grid.getBoundingClientRect().width - gapPx * 5) / 6;

  // How far from the card's top-left corner the pointer landed — used by
  // _moveDragGhost() so the ghost stays anchored under the grab point
  // instead of jumping to center on pointer-down.
  const dragOffsetX = e.clientX - cardRect.left;
  const dragOffsetY = e.clientY - cardRect.top;

  // ghostEl is null until the drag threshold is crossed — _activateDrag()
  // creates it and hides the original card. Until then, nothing visible changes.
  _dragState = {
    cardEl, grid, pointerId: e.pointerId, ghostEl: null,
    origW: cardRect.width, origH: cardRect.height,
    columnWidth, gapPx,
    dragOffsetX, dragOffsetY,
    startX: e.clientX, startY: e.clientY,
    active: false  // becomes true once threshold is crossed
  };

  handle.setPointerCapture(e.pointerId);

  handle.addEventListener('pointermove', _onMoveHandlePointerMove);
  handle.addEventListener('pointerup', _onMoveHandlePointerUp);
  handle.addEventListener('pointercancel', _onMoveHandlePointerCancel);
}

// Called the first time the pointer moves past the drag threshold.
// Creates the ghost and hides the original card — nothing visible changes
// until this point, so a plain click on the handle has zero side-effects.
function _activateDrag() {
  const { cardEl, startX, startY } = _dragState;
  const ghostEl = _createDragGhost(cardEl);
  _moveDragGhost(ghostEl, startX, startY);
  _dragState.ghostEl = ghostEl;
  _dragState.active  = true;

  // Hide the original card in place — keeps its grid slot occupied so
  // the layout doesn't reflow, but makes it invisible so only the ghost
  // is seen. Restored in _finishDrag via cardEl.style.visibility = ''.
  cardEl.style.visibility = 'hidden';
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

// Resizes the ghost to visually communicate what will happen on drop:
//   - insert between cards  → thin vertical line (4px wide, full row height)
//   - insert into empty space → card-shaped box sized to the slot
//   - swap                  → card-shaped box sized to the target card
//   - null (no valid target) → original dragged-card dimensions (neutral)
function _updateGhostForTarget(ghost, target) {
  const { origW, origH, columnWidth, gapPx } = _dragState;

  if (!target) {
    // Outside grid or no-op — neutral ghost (original card size).
    ghost.style.width  = origW + 'px';
    ghost.style.height = origH + 'px';
    ghost.style.borderRadius = '';
    return;
  }

  if (target.type === 'swap') {
    // Match the size of the card we'd swap with.
    const r = target.cardEl.getBoundingClientRect();
    ghost.style.width  = r.width  + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.borderRadius = '';
    return;
  }

  if (target.type === 'insert') {
    if (target.beforeEl) {
      // Inserting between two cards — show a thin vertical bar.
      // Height matches the row: use the reference card's height.
      const refH = target.beforeEl.getBoundingClientRect().height;
      ghost.style.width  = '4px';
      ghost.style.height = (refH || origH) + 'px';
      ghost.style.borderRadius = '2px';
    } else {
      // Inserting into empty space at end of grid — size the ghost to
      // whatever span would be snapped to if dropped here.  We use the
      // same span-tier logic as the resize module: pick the tier whose
      // pixel width is closest to the original card's width, but cap at
      // whatever fits (full-width slot = all 6 columns).
      const tiers = [2, 3, 6]; // third, half, full
      const origSpan = (origW + gapPx) / (columnWidth + gapPx);
      const snappedSpan = tiers.reduce((best, t) =>
        Math.abs(t - origSpan) < Math.abs(best - origSpan) ? t : best
      );
      const slotW = snappedSpan * columnWidth + (snappedSpan - 1) * gapPx;
      ghost.style.width  = slotW + 'px';
      ghost.style.height = origH + 'px';
      ghost.style.borderRadius = '';
    }
  }
}

function _onMoveHandlePointerMove(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  const { grid, ghostEl } = _dragState;

  // Always update ghost position first — it must track the pointer every
  // frame regardless of what the drop-target resolution decides below.
  _moveDragGhost(ghostEl, e.clientX, e.clientY);

  // Remove any existing indicator/highlight FIRST, before resolving the drop
  // target. The indicator bar is itself a grid item (span 1 column) that
  // shifts neighboring cards when present — resolving against a grid that
  // still contains it would measure shifted card positions and could flicker
  // between two answers on consecutive moves. Always resolve against a clean
  // grid (no inserted indicator) for a stable result.
  _clearDropTargetHighlight(grid);

  const target = _resolveDropTarget(e.clientX, e.clientY);
  _updateGhostForTarget(ghostEl, target);
  if (target && target.type === 'swap') {
    target.cardEl.classList.add('layout-drop-target');
  } else if (target && target.type === 'insert') {
    _showInsertIndicator(grid, target.beforeEl);
  }
  // null (invalid drop, outside the grid) → no highlight; ghost reverts to
  // original size (handled inside _updateGhostForTarget).
}

function _finishDrag() {
  if (!_dragState) return;
  const { cardEl, grid, ghostEl } = _dragState;

  // Restore the original card's visibility before removing the ghost,
  // so there's no frame where neither the card nor the ghost is visible.
  cardEl.style.visibility = '';
  _clearDropTargetHighlight(grid);
  _removeDragGhost(ghostEl);

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
