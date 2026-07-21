/**
 * bootstrap.js — App Boot Sequence
 * Extracted from EdgeBook.html (inline script block 2)
 *
 * Owns:
 *   Final boot sequence — updateStats(), showPage('home')
 *   patchRefreshAllForSizing() IIFE — hooks refreshAll() to also re-render the sizing page
 *   initAcctUI() IIFE — initializes account badge + buttons on load
 *   openEdgeBooster() — opens the EdgeBooster popup window
 *
 * MUST LOAD LAST — after every other module — since it kicks off the
 * first render (calls showPage('home'), which itself depends on
 * showPage/renderHomeList/renderStats/etc. from all the other modules
 * already being loaded and available on window/global scope).
 *
 * Load order: after tradeZeroSync.js, immediately before </body>.
 */

updateStats();        // KPI donuts — runs unconditionally (not page-specific)
showPage('home');     // initialises sidebar active state + renders home tab

// ── Sizing page: hook into refreshAll so time-filter changes re-render it ────
(function patchRefreshAllForSizing() {
  const _origRefreshAll = window.refreshAll;
  window.refreshAll = function() {
    if (typeof _origRefreshAll === 'function') _origRefreshAll.apply(this, arguments);
    const sz = document.getElementById('tab-sizing');
    if (sz && sz.style.display !== 'none' && typeof renderSizingPage === 'function') renderSizingPage();
  };
})();

// ── Account badge + buttons init ─────────────────────────────────────────────
(function initAcctUI() {
  if (typeof updateAcctBadge   === 'function') updateAcctBadge();
  if (typeof updateAcctButtons === 'function') updateAcctButtons();
  // showModeFlash is now called inside onAuthStateChanged in accounts.js,
  // after the real account is restored — so we don't call it here anymore.
})();

// ── Right panel drawer (laptop only) ────────────────────────────────────────
// On desktop (>1440px) the panel is always visible in the grid; this is a no-op.
// On laptop (≤1440px) it slides in/out as a fixed drawer.

// ── EdgeBooster ──────────────────────────────────────────────────────────────
function openEdgeBooster() {
  const settings = JSON.parse(localStorage.getItem('edgebook_booster_settings') || '{}');
  const sizeMap = {
    compact: { w: 380, h: 560 },
    default: { w: 440, h: 680 },
    wide:    { w: 560, h: 780 }
  };
  const size = sizeMap[settings.windowSize] || sizeMap['default'];
  const left = Math.round((window.screen.width  - size.w) / 2);
  const top  = Math.round((window.screen.height - size.h) / 2);
  const features = `width=${size.w},height=${size.h},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`;
  window.open('edgeBooster.html', 'EdgeBooster', features);
}
// ── End EdgeBooster ───────────────────────────────────────────────────────────

