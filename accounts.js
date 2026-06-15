/**
 * accounts.js — Multi-Account Data Layer with Firebase
 * EdgeBook
 *
 * Must be loaded AFTER the Firebase CDN scripts in the HTML:
 *   <script src="accounts.js"></script>
 *   <script src="app.js"></script>
 *
 * Owns:
 *   activeAccount          — 'demo' | 'live'
 *   loadAccountTrades()    — returns trades array (async, from Firestore)
 *   saveAccountTrades(arr) — persists array to Firestore
 *   switchAccount(acct)    — switches account, reloads trades, re-renders
 *   signIn()               — Google login
 *   signOut()              — logout
 */

// ─── FIREBASE CONFIG ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCpKPc7c7xAwpCPoaTez7G9VgrTyF1gCZM",
  authDomain:        "edgebook-55d06.firebaseapp.com",
  projectId:         "edgebook-55d06",
  storageBucket:     "edgebook-55d06.firebasestorage.app",
  messagingSenderId: "795611870753",
  appId:             "1:795611870753:web:5c8de0151d52e3ceb51560"
};

// ─── FIREBASE INIT ────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const _auth = firebase.auth();
const _db   = firebase.firestore();

// ─── STATE ────────────────────────────────────────────────
let activeAccount = 'live';
let _currentUser  = null;

// ─── AUTH UI ──────────────────────────────────────────────
function _injectAuthUI() {
  // Create a login overlay that shows when user is not signed in
  const style = document.createElement('style');
  style.textContent = `
    #eb-auth-overlay {
      position: fixed; inset: 0;
      background: var(--bg, #fff);
      z-index: 99999;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #eb-auth-overlay h2 {
      font-size: 28px; font-weight: 700;
      margin: 0; color: var(--text, #111);
    }
    #eb-auth-overlay p {
      font-size: 14px; color: var(--text2, #666);
      margin: 0;
    }
    #eb-auth-google-btn {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 24px;
      border: 1px solid #ddd; border-radius: 10px;
      background: #fff; color: #333;
      font-size: 15px; font-weight: 500;
      cursor: pointer; transition: box-shadow .15s;
    }
    #eb-auth-google-btn:hover { box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    #eb-auth-google-btn svg { width: 20px; height: 20px; }

  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'eb-auth-overlay';
  overlay.innerHTML = `
    <div style="margin-bottom:8px">
      <svg viewBox="0 0 43 43" width="56" height="56" fill="none" style="display:block">
        <path d="M5 37 C9 37 12 14 17 14 C22 14 22 28 26 28 C30 28 32 9 38 9"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M17 14 C22 14 22 28 26 28"
              stroke="#D85A30" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <circle cx="38" cy="9" r="2.6" fill="#1D9E75"/>
      </svg>
    </div>
    <h2 style="font-family:'CircularXXWeb-Bold',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em">EDGEBOOK</h2>
    <p>Your personal trading journal</p>
    <button id="eb-auth-google-btn">
      <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Sign in with Google
    </button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('eb-auth-google-btn').addEventListener('click', signIn);
}

function _removeAuthOverlay() {
  const el = document.getElementById('eb-auth-overlay');
  if (el) el.remove();
}

function _injectUserBar() {
  // Update sidebar user info
  const nameEl   = document.getElementById('sb-user-name');
  const avatarEl = document.getElementById('sb-user-avatar');
  if (nameEl) {
    nameEl.textContent = _currentUser.displayName || _currentUser.email || '';
  }
  if (avatarEl) {
    const initials = (_currentUser.displayName || _currentUser.email || '?')
      .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    avatarEl.textContent = initials;
  }
}

// ─── AUTH FUNCTIONS ───────────────────────────────────────
function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  _auth.signInWithPopup(provider).catch(err => {
    console.error('Sign-in error:', err);
    alert('שגיאה בהתחברות: ' + err.message);
  });
}

function signOut() {
  if (!confirm('להתנתק?')) return;
  _auth.signOut();
}

window.signIn  = signIn;
window.signOut = signOut;

// ─── FIRESTORE HELPERS ────────────────────────────────────
function _tradesDoc(acct) {
  // Each user gets their own document: users/{uid}/accounts/{acct}
  return _db
    .collection('users')
    .doc(_currentUser.uid)
    .collection('accounts')
    .doc(acct);
}

// ─── CORE FUNCTIONS ───────────────────────────────────────
async function loadAccountTrades() {
  if (!_currentUser) return [];
  try {
    const snap = await _tradesDoc(activeAccount).get();
    return snap.exists ? (snap.data().trades || []) : [];
  } catch(e) {
    console.error('loadAccountTrades error:', e);
    return [];
  }
}

async function saveAccountTrades(tradesArr) {
  if (!_currentUser) return;
  try {
    await _tradesDoc(activeAccount).set({ trades: tradesArr });
  } catch(e) {
    console.error('saveAccountTrades error:', e);
    throw e;
  }
}

// ─── ACCOUNT SWITCH ───────────────────────────────────────
async function switchAccount(acct) {
  if (acct !== 'demo' && acct !== 'live') return;
  activeAccount = acct;
  localStorage.setItem('edgebook_active_account', acct);

  trades = await loadAccountTrades();

  if (typeof refreshAll       === 'function') refreshAll();
  if (typeof updateAcctButtons === 'function') updateAcctButtons();
  if (typeof updateAcctBadge   === 'function') updateAcctBadge();
}

// ─── MIGRATION: localStorage → Firestore (runs once per account) ──
async function _migrateIfNeeded() {
  for (const acct of ['live', 'demo']) {
    const snap = await _db
      .collection('users').doc(_currentUser.uid)
      .collection('accounts').doc(acct).get();
    if (snap.exists) continue; // already migrated

    // Try legacy localStorage keys
    const legacyKeys = [`trades_${acct}`, 'tradeJournal_v2'];
    for (const key of legacyKeys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (arr.length > 0) {
            await _db.collection('users').doc(_currentUser.uid)
              .collection('accounts').doc(acct)
              .set({ trades: arr });
            console.log(`Migrated ${arr.length} trades from localStorage[${key}] → Firestore[${acct}]`);
            break;
          }
        } catch(e) {}
      }
    }
  }
}

// ─── AUTH STATE LISTENER (main entry point) ───────────────
_auth.onAuthStateChanged(async (user) => {
  if (!user) {
    _currentUser = null;
    _injectAuthUI();
    return;
  }

  _currentUser = user;
  _removeAuthOverlay();

  // Restore last active account
  activeAccount = localStorage.getItem('edgebook_active_account') || 'live';

  // Migrate localStorage data to Firestore (once only)
  await _migrateIfNeeded();

  // Load trades and boot the app
  trades = await loadAccountTrades();

  // Inject user bar into topbar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectUserBar);
  } else {
    _injectUserBar();
  }

  // Kick off the app render
  if (typeof refreshAll       === 'function') refreshAll();
  if (typeof updateAcctButtons === 'function') updateAcctButtons();
  if (typeof updateAcctBadge   === 'function') updateAcctBadge();
});

// ─── EXPOSE PUBLIC API ────────────────────────────────────
Object.defineProperty(window, 'activeAccount', {
  get: () => activeAccount,
  set: v  => { activeAccount = v; },
  configurable: true
});
window.loadAccountTrades = loadAccountTrades;
window.saveAccountTrades = saveAccountTrades;
window.switchAccount     = switchAccount;

// ─── UI UPDATERS ─────────────────────────────────────────
function updateAcctButtons() {
  const liveBtn = document.getElementById('acct-btn-live');
  const demoBtn = document.getElementById('acct-btn-demo');
  if (liveBtn) {
    liveBtn.classList.toggle('active-live', activeAccount === 'live');
    liveBtn.classList.toggle('active',      activeAccount === 'live');
  }
  if (demoBtn) {
    demoBtn.classList.toggle('active-demo', activeAccount === 'demo');
    demoBtn.classList.toggle('active',      activeAccount === 'demo');
  }
}
window.updateAcctButtons = updateAcctButtons;

function updateAcctBadge() {
  const badge = document.getElementById('acct-badge');
  if (!badge) return;
  badge.textContent = activeAccount === 'live' ? 'Live' : 'Demo';
  badge.className   = 'acct-badge badge-' + activeAccount;
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.classList.toggle('demo-mode', activeAccount === 'demo');
}
window.updateAcctBadge = updateAcctBadge;
