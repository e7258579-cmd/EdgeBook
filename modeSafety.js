/**
 * modeSafety.js — Live / Demo Safety Layer
 * EdgeBook
 *
 * Phase 1 + 2:
 *   - Flash overlay on app load (4 seconds / click-anywhere to dismiss)
 *   - Flash overlay on every switchAccount() call
 *
 * Load order in HTML:
 *   <script src="accounts.js"></script>
 *   <script src="modeSafety.js"></script>   ← this file
 *   <script src="app.js"></script>
 *
 * Depends on:
 *   window.activeAccount  — accounts.js (live getter)
 *   window.switchAccount  — accounts.js (intercepted below)
 */

// ─── INJECT CSS ───────────────────────────────────────────
(function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    #mode-flash-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.94);
      width: 500px;
      height: 360px;
      border-radius: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      pointer-events: all;
      cursor: pointer;
      animation: msSafetyIn 0.22s cubic-bezier(.22,.68,0,1.2) forwards;
    }
    #mode-flash-overlay.ms-hiding {
      animation: msSafetyOut 0.16s ease forwards;
    }
    #mode-flash-overlay .ms-word {
      font-size: 88px;
      font-weight: 700;
      letter-spacing: 0.08em;
      font-family: 'CircularXXWeb-Bold', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1;
      user-select: none;
    }
    #mode-flash-overlay .ms-sub {
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.45;
      margin-top: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      user-select: none;
    }
    @keyframes msSafetyIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
      to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes msSafetyOut {
      from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      to   { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
    }
  `;
  document.head.appendChild(style);
})();

// ─── FLASH STATE ──────────────────────────────────────────
const MS_DURATION = 4000;
let _msTimeout = null;

// ─── SHOW FLASH ───────────────────────────────────────────
function showModeFlash(mode) {
  // Remove any existing overlay immediately (no animation)
  _removeModeFlashImmediate();

  const isLive = mode === 'live';
  const label  = isLive ? 'LIVE' : 'DEMO';
  const color  = isLive ? 'var(--green, #1D9E75)' : 'var(--red, #D85A30)';
  const border = isLive ? 'rgba(29,158,117,0.30)'  : 'rgba(216,90,48,0.30)';
  const glow   = isLive ? 'rgba(29,158,117,0.06)'  : 'rgba(216,90,48,0.06)';

  const overlay = document.createElement('div');
  overlay.id = 'mode-flash-overlay';
  overlay.style.background = 'var(--bg2, #f5f5f3)';
  overlay.style.border     = `2px solid ${border}`;
  overlay.style.boxShadow  = `0 20px 70px rgba(0,0,0,0.18), inset 0 0 80px ${glow}`;

  overlay.innerHTML = `
    <span class="ms-word" style="color:${color}">${label}</span>
    <span class="ms-sub"  style="color:${color}">account active &nbsp;·&nbsp; click anywhere to dismiss</span>
  `;

  document.body.appendChild(overlay);

  // Auto-close after MS_DURATION
  _msTimeout = setTimeout(_closeModeFlash, MS_DURATION);

  // Click anywhere on document closes it.
  // 50ms grace period so the click that triggered switchAccount doesn't instantly close the flash.
  setTimeout(() => {
    document.addEventListener('click', _onFlashClick, { capture: true, once: true });
  }, 50);
}

// ─── CLOSE FLASH ─────────────────────────────────────────
function _onFlashClick() {
  _closeModeFlash();
}

function _closeModeFlash() {
  if (_msTimeout) { clearTimeout(_msTimeout); _msTimeout = null; }
  document.removeEventListener('click', _onFlashClick, { capture: true });
  const overlay = document.getElementById('mode-flash-overlay');
  if (!overlay) return;
  overlay.classList.add('ms-hiding');
  overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
}

function _removeModeFlashImmediate() {
  if (_msTimeout) { clearTimeout(_msTimeout); _msTimeout = null; }
  document.removeEventListener('click', _onFlashClick, { capture: true });
  const overlay = document.getElementById('mode-flash-overlay');
  if (overlay) overlay.remove();
}

// ─── INTERCEPT switchAccount (Phase 2) ───────────────────
// Wraps window.switchAccount after accounts.js has run,
// so every mode change triggers the flash automatically.
(function interceptSwitchAccount() {
  function doIntercept() {
    if (typeof window.switchAccount !== 'function') return;
    const _orig = window.switchAccount;
    window.switchAccount = function(mode) {
      _orig.call(this, mode);  // original logic first (saves, re-renders, updates badge)
      showModeFlash(mode);     // then show flash
    };
  }

  // accounts.js loads before this file, so switchAccount is already on window.
  // But guard with DOMContentLoaded just in case.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doIntercept);
  } else {
    doIntercept();
  }
})();

// ─── EXPOSE PUBLIC API ────────────────────────────────────
window.showModeFlash   = showModeFlash;
window._closeModeFlash = _closeModeFlash;

// ─── LOCK / UNLOCK MODE BUTTONS (Phase 3) ────────────────
function lockModeButtons() {
  ['acct-btn-live', 'acct-btn-demo'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled            = true;
    btn.style.opacity       = '0.35';
    btn.style.cursor        = 'not-allowed';
    btn.style.pointerEvents = 'none';
  });
}

function unlockModeButtons() {
  ['acct-btn-live', 'acct-btn-demo'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled            = false;
    btn.style.opacity       = '';
    btn.style.cursor        = '';
    btn.style.pointerEvents = '';
  });
}

window.lockModeButtons   = lockModeButtons;
window.unlockModeButtons = unlockModeButtons;

// ─── CONFIRM DIALOG (Phase 4) ─────────────────────────────
function showModeConfirm(mode, onConfirm) {
  const existing = document.getElementById('mode-confirm-overlay');
  if (existing) existing.remove();

  const isLive   = mode === 'live';
  const label    = isLive ? 'LIVE' : 'DEMO';
  const color    = isLive ? 'var(--green, #1D9E75)' : 'var(--red, #D85A30)';
  const colorHex = isLive ? '#1D9E75' : '#D85A30';

  const overlay = document.createElement('div');
  overlay.id = 'mode-confirm-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(0,0,0,0.45);
    z-index:9998;
    display:flex;align-items:center;justify-content:center;
  `;
  overlay.innerHTML = `
    <div style="
      background:var(--bg,#fff);
      border:1px solid var(--border2,#ddd);
      border-radius:14px;
      padding:28px 32px;
      width:340px;
      text-align:center;
      box-shadow:0 12px 40px rgba(0,0,0,0.4);
    ">
      <div style="font-size:13px;color:var(--text2,#666);margin-bottom:14px;">
        Save trade to
      </div>
      <div style="font-size:36px;font-weight:700;color:${color};margin-bottom:24px;letter-spacing:.05em;">
        ${label}
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="mode-confirm-cancel" style="
          flex:1;padding:10px;border-radius:9px;
          border:1px solid var(--border2,#ddd);
          background:transparent;color:var(--text2,#666);
          font-size:13px;cursor:pointer;font-family:inherit;
          transition:opacity .15s;
        ">Cancel</button>
        <button id="mode-confirm-ok" style="
          flex:1;padding:10px;border-radius:9px;border:none;
          background:${colorHex};color:#fff;
          font-size:13px;font-weight:700;
          cursor:pointer;font-family:inherit;
          transition:opacity .15s;
        ">Confirm</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('mode-confirm-ok').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  document.getElementById('mode-confirm-cancel').addEventListener('click', () => {
    overlay.remove();
  });
}

window.showModeConfirm = showModeConfirm;