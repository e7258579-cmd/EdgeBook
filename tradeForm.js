/**
 * tradeForm.js — Trade Form Module
 * Extracted from EdgeBook_v28.html
 *
 * Depends on globals defined in the main script block:
 *   trades, save(), toast(), today, showPage(),
 *   renderLog(), renderHomeList()
 *
 * All public functions are assigned to window so that
 * inline onclick="" attributes in the HTML continue to work
 * without any HTML changes.
 *
 * Load order: must come AFTER the main </script> block.
 */

// ─── PRIVATE STATE ─────────────────────────────────────────
let currentMood   = '';
let currentRating = 0;
let currentImgs   = [];   // replaces currentImgData
let _editingTradeId = null;

// Navigation state — which page to return to after form closes
let _newTradePrevPage = 'home';

// ─── MOOD & RATING ─────────────────────────────────────────
function setMood(m) {
  currentMood = m;
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('sel', b.textContent.includes(m)));
}
function setRating(r) {
  currentRating = r;
  document.querySelectorAll('#stars-input .star').forEach((s, i) => s.classList.toggle('on', i < r));
}

// ─── IMAGE HANDLING ────────────────────────────────────────
function handleImgs(input, ctx) {
  const files  = Array.from(input.files);
  const getArr = () => ctx === 'edit' ? editImgs : currentImgs;
  const toLoad = files.slice(0, Math.max(0, 3 - getArr().length));
  toLoad.forEach(file => {
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      getArr().push(e.target.result);
      renderImgPreviews(ctx);
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}
function renderImgPreviews(ctx) {
  const arr  = ctx === 'edit' ? editImgs : currentImgs;
  const wrap = document.getElementById(ctx === 'edit' ? 'e-img-previews' : 'f-img-previews');
  wrap.innerHTML = arr.map((src, i) => `
    <div style="position:relative;display:inline-block">
      <img src="${src}" style="width:80px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="expandImgPreview('${ctx}',${i})">
      <button onclick="removeImg('${ctx}',${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:var(--text3);color:var(--bg);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">✕</button>
    </div>`).join('');
}
function removeImg(ctx, i) {
  if (ctx === 'edit') editImgs.splice(i, 1); else currentImgs.splice(i, 1);
  renderImgPreviews(ctx);
}
function expandImgPreview(ctx, i) {
  const src = ctx === 'edit' ? editImgs[i] : currentImgs[i];
  const ov  = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  ov.onclick = () => ov.remove();
  const img = document.createElement('img');
  img.src = src; img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px';
  ov.appendChild(img); document.body.appendChild(ov);
}

// ─── FIELD CALCULATORS ─────────────────────────────────────
function calcPnl() {
  const entry = parseFloat(document.getElementById('f-entry').value) || 0;
  const exit  = parseFloat(document.getElementById('f-exit').value)  || 0;
  const qty   = parseFloat(document.getElementById('f-qty').value)   || 0;
  const dir   = document.getElementById('f-dir').value;
  if (entry && exit && qty) {
    const pnl = dir === 'long' ? (exit - entry) * qty : (entry - exit) * qty;
    document.getElementById('f-pnl').value = pnl.toFixed(2);
  } else { document.getElementById('f-pnl').value = ''; }
  calcRR();
}
function calcRR() {
  const entry = parseFloat(document.getElementById('f-entry').value) || 0;
  const sl    = parseFloat(document.getElementById('f-sl').value)    || 0;
  const tp    = parseFloat(document.getElementById('f-tp').value)    || 0;
  if (sl && tp && entry && entry !== sl) {
    document.getElementById('f-rr').value = '1 : ' + (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);
  } else { document.getElementById('f-rr').value = ''; }
}
function calcDuration() {
  const et = document.getElementById('f-entry-time').value;
  const xt = document.getElementById('f-exit-time').value;
  if (et && xt) {
    const [eh, em] = et.split(':').map(Number);
    const [xh, xm] = xt.split(':').map(Number);
    let mins = (xh * 60 + xm) - (eh * 60 + em);
    if (mins < 0) mins += 1440;
    const h = Math.floor(mins / 60), m = mins % 60;
    document.getElementById('f-duration').value = h > 0 ? `${h}h ${m}m` : `${m}m`;
  } else { document.getElementById('f-duration').value = ''; }
}

// ─── EVENT LISTENERS ───────────────────────────────────────
document.getElementById('f-dir').addEventListener('change', calcPnl);
document.getElementById('f-sl').addEventListener('input',  calcRR);
document.getElementById('f-tp').addEventListener('input',  calcRR);

// ─── SUBMIT ────────────────────────────────────────────────
function saveTrade() {
  const sym = document.getElementById('f-sym').value.trim().toUpperCase();
  if (!sym) { alert('Please enter a symbol'); return; }

  const mode             = typeof window.activeAccount !== 'undefined' ? window.activeAccount : 'live';
  const editingIdCapture = _editingTradeId;   // capture before any async/modal reset

  if (typeof showModeConfirm === 'function') {
    showModeConfirm(mode, () => _doSaveTrade(editingIdCapture));
  } else {
    _doSaveTrade(editingIdCapture);
  }
}

async function _doSaveTrade(editingIdOverride) {
  const resolvedEditingId = (editingIdOverride !== undefined) ? editingIdOverride : _editingTradeId;
  const sym   = document.getElementById('f-sym').value.trim().toUpperCase();
  const entry = parseFloat(document.getElementById('f-entry').value) || 0;
  const exit  = parseFloat(document.getElementById('f-exit').value)  || 0;
  const qty   = parseFloat(document.getElementById('f-qty').value)   || 0;
  const dir   = document.getElementById('f-dir').value;
  const pnl   = (entry && exit && qty) ? (dir === 'long' ? (exit - entry) * qty : (entry - exit) * qty) : 0;
  const sl    = parseFloat(document.getElementById('f-sl').value) || 0;
  const tp    = parseFloat(document.getElementById('f-tp').value) || 0;
  const rr    = (sl && tp && entry && entry !== sl) ? parseFloat((Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2)) : 0;

  if (resolvedEditingId !== null) {
    // ── EDIT: preserve the original id ──────────────────────
    const idx = trades.findIndex(t => String(t.id) === String(resolvedEditingId));
    const originalId = idx >= 0 ? trades[idx].id : resolvedEditingId;
    const trade = {
      id: originalId,
      date: document.getElementById('f-date').value,
      sym, dir, entry, exit, qty,
      pnl: parseFloat(pnl.toFixed(2)),
      sl, tp, rr,
      legs: (qty > 0) ? [
        { side: dir === 'long' ? 'buy'  : 'sell', qty },
        { side: dir === 'long' ? 'sell' : 'buy',  qty }
      ] : [],
      entryTime: document.getElementById('f-entry-time').value,
      exitTime:  document.getElementById('f-exit-time').value,
      duration:  document.getElementById('f-duration').value,
      reason:    document.getElementById('f-reason').value,
      notes:     document.getElementById('f-notes').value,
      mood: currentMood, rating: currentRating, imgs: [...currentImgs], img: currentImgs[0] || ''
    };
    if (idx >= 0) trades[idx] = { ...trades[idx], ...trade };
    _editingTradeId = null;
    try {
      await saveOneTrade(trade);   // write only this document
    } catch(e) {
      console.error('_doSaveTrade (edit) error:', e);
      toast('⚠ שגיאה בשמירה');
      return;
    }
    closeNewTradeModal();
    renderLog();
    renderHomeList();
    if (typeof unlockModeButtons === 'function') unlockModeButtons();
    toast('✓ Trade updated!');

  } else {
    // ── NEW TRADE ────────────────────────────────────────────
    const trade = {
      id: Date.now(),
      date: document.getElementById('f-date').value,
      sym, dir, entry, exit, qty,
      pnl: parseFloat(pnl.toFixed(2)),
      sl, tp, rr,
      legs: (qty > 0) ? [
        { side: dir === 'long' ? 'buy'  : 'sell', qty },
        { side: dir === 'long' ? 'sell' : 'buy',  qty }
      ] : [],
      entryTime: document.getElementById('f-entry-time').value,
      exitTime:  document.getElementById('f-exit-time').value,
      duration:  document.getElementById('f-duration').value,
      reason:    document.getElementById('f-reason').value,
      notes:     document.getElementById('f-notes').value,
      mood: currentMood, rating: currentRating, imgs: [...currentImgs], img: currentImgs[0] || ''
    };
    trades.unshift(trade);
    try {
      await saveOneTrade(trade);   // write only this document
    } catch(e) {
      console.error('_doSaveTrade (new) error:', e);
      toast('⚠ שגיאה בשמירה');
      return;
    }
    closeNewTradeModal();
    renderHomeList();
    if (typeof unlockModeButtons === 'function') unlockModeButtons();
    toast('✓ Trade saved!');
  }
}

// ─── RESET / DISCARD ───────────────────────────────────────
function resetForm() {
  // Note: _editingTradeId is intentionally NOT reset here.
  // It is managed exclusively by openEdit() and _doSaveTrade().
  ['f-sym','f-entry','f-exit','f-qty','f-sl','f-tp','f-pnl','f-reason','f-notes','f-entry-time','f-exit-time','f-duration','f-rr']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f-dir').value  = 'long';
  document.getElementById('f-date').value = today.toISOString().split('T')[0];
  currentMood = ''; currentRating = 0; currentImgs = [];
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('sel'));
  document.querySelectorAll('#stars-input .star').forEach(s => s.classList.remove('on'));
  document.getElementById('f-img-previews').innerHTML = '';
  document.getElementById('f-img').value = '';
}
function resetNewTradeForm() {
  if (!confirm('Discard this trade?')) return;
  _editingTradeId = null;
  resetForm();
  closeNewTradeModal();
}

// ─── NAVIGATION ────────────────────────────────────────────
function openNewTradeModal() {
  _editingTradeId = null;
  _newTradePrevPage = ['home','log','cal','stats'].find(id =>
    document.getElementById('tab-' + id) && document.getElementById('tab-' + id).style.display !== 'none'
  ) || 'home';
  if (typeof lockModeButtons === 'function') lockModeButtons();
  showPage('new');
}
function closeNewTradeModal() {
  resetForm();
  if (typeof unlockModeButtons === 'function') unlockModeButtons();
  showPage(_newTradePrevPage || 'home');
}

// ─── OPEN EDIT ─────────────────────────────────────────────
function openEdit(id) {
  const t = trades.find(x => String(x.id) === String(id)); if (!t) return;

  resetForm();
  _editingTradeId = t.id;

  document.getElementById('f-sym').value        = t.sym        || '';
  document.getElementById('f-date').value       = t.date       || '';
  document.getElementById('f-dir').value        = t.dir        || 'long';
  document.getElementById('f-entry').value      = t.entry      || '';
  document.getElementById('f-exit').value       = t.exit       || '';
  document.getElementById('f-qty').value        = t.qty        || '';
  document.getElementById('f-pnl').value        = t.pnl        || '';
  document.getElementById('f-entry-time').value = t.entryTime  || '';
  document.getElementById('f-exit-time').value  = t.exitTime   || '';
  document.getElementById('f-duration').value   = t.duration   || '';
  document.getElementById('f-sl').value         = t.sl         || '';
  document.getElementById('f-tp').value         = t.tp         || '';
  document.getElementById('f-rr').value         = t.rr ? '1 : ' + t.rr : '';
  document.getElementById('f-reason').value     = t.reason     || '';
  document.getElementById('f-notes').value      = t.notes      || '';

  currentMood = t.mood || '';
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('sel', b.textContent.includes(currentMood) && !!currentMood));

  currentRating = t.rating || 0;
  document.querySelectorAll('#stars-input .star').forEach((s, i) => s.classList.toggle('on', i < currentRating));

  currentImgs = t.imgs ? [...t.imgs] : (t.img ? [t.img] : []);
  renderImgPreviews('new');

  _newTradePrevPage = ['home','log','cal','stats'].find(pid =>
    document.getElementById('tab-' + pid) && document.getElementById('tab-' + pid).style.display !== 'none'
  ) || 'log';
  if (typeof lockModeButtons === 'function') lockModeButtons();
  showPage('new');
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
// Required so that inline onclick="" attributes in HTML resolve correctly.
window.setMood           = setMood;
window.setRating         = setRating;
window.handleImgs        = handleImgs;
window.renderImgPreviews = renderImgPreviews;
window.removeImg         = removeImg;
window.expandImgPreview  = expandImgPreview;
window.calcPnl           = calcPnl;
window.calcRR            = calcRR;
window.calcDuration      = calcDuration;
window.saveTrade         = saveTrade;
window._doSaveTrade      = _doSaveTrade;
window.resetForm         = resetForm;
window.resetNewTradeForm = resetNewTradeForm;
window.openNewTradeModal = openNewTradeModal;
window.closeNewTradeModal= closeNewTradeModal;
window.openEdit          = openEdit;