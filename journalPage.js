/**
 * journalPage.js — Journal Module
 *
 * Handles:
 *   - Trade Day / No Trade Day switcher
 *   - NTD form state + save (upsert by date — see saveNtdDay)
 *   - Rules checklist rendering
 *   - Rules modal (add / delete)
 *
 * Depends on globals from app.js:
 *   loadJournal(), saveJournal(), loadRules(), saveRules(), toast(), today
 *
 * Depends on globals from tradeForm.js:
 *   closeNewTradeModal()
 *
 * Load order: must come AFTER tradeForm.js
 */

// ─── SWITCHER STATE ────────────────────────────────────────
let _journalMode = 'trade'; // 'trade' | 'ntd'

function setJournalMode(mode) {
  _journalMode = mode;
  const tradeSection = document.getElementById('jrn-trade-section');
  const ntdSection   = document.getElementById('jrn-ntd-section');
  const btnTrade     = document.getElementById('jrn-btn-trade');
  const btnNtd       = document.getElementById('jrn-btn-ntd');
  if (tradeSection) { tradeSection.style.display = mode === 'trade' ? 'flex' : 'none'; tradeSection.style.flexDirection = 'column'; tradeSection.style.flex = '1'; tradeSection.style.minHeight = '0'; }
  if (ntdSection)   { ntdSection.style.display = mode === 'ntd' ? 'flex' : 'none'; ntdSection.style.flex = '1'; ntdSection.style.minHeight = '0'; }
  if (btnTrade)     btnTrade.classList.toggle('active', mode === 'trade');
  if (btnNtd)       btnNtd.classList.toggle('active',   mode === 'ntd');

  // sync the NTD date field to the trade form date (or today)
  if (mode === 'ntd') {
    const tradeDateVal = document.getElementById('f-date') && document.getElementById('f-date').value;
    const ntdDate = document.getElementById('jrn-ntd-date');
    if (ntdDate) ntdDate.value = tradeDateVal || today.toISOString().split('T')[0];
  }
}

// ─── NTD BUTTON GUARD ─────────────────────────────────────
// Disables the NTD button when a trade already exists for the selected date.
function _updateNtdButtonState() {
  const btnNtd = document.getElementById('jrn-btn-ntd');
  if (!btnNtd) return;

  const dateVal = (document.getElementById('f-date') && document.getElementById('f-date').value)
    || today.toISOString().split('T')[0];

  // Check if any saved trade exists for this date
  const hasTrade = (typeof trades !== 'undefined' ? trades : [])
    .some(t => t.date === dateVal);

  if (hasTrade) {
    btnNtd.disabled = true;
    btnNtd.title    = 'A trade already exists for this date';
    btnNtd.style.opacity = '0.38';
    btnNtd.style.cursor  = 'not-allowed';
    // If currently in NTD mode, switch back to trade
    if (_journalMode === 'ntd') setJournalMode('trade');
  } else {
    btnNtd.disabled = false;
    btnNtd.title    = '';
    btnNtd.style.opacity = '';
    btnNtd.style.cursor  = '';
  }
}


let _ntdReason   = '';       // 'technical' | 'mental' | 'other'
let _ntdPositive = null;     // true | false | null
let _ntdMood     = '';

function setNtdReason(reason) {
  _ntdReason = reason;
  ['technical','mental','other'].forEach(r => {
    const btn = document.getElementById('ntd-btn-' + r);
    if (btn) btn.classList.toggle('active', r === reason);
  });
}

function setNtdPositive(val) {
  _ntdPositive = val;
  const btnPos = document.getElementById('ntd-btn-positive');
  const btnNeg = document.getElementById('ntd-btn-negative');
  if (btnPos) { btnPos.classList.toggle('active-good', val === true);  btnPos.classList.toggle('active-bad', false); }
  if (btnNeg) { btnNeg.classList.toggle('active-bad',  val === false); btnNeg.classList.toggle('active-good', false); }
}

function setNtdMood(m) {
  _ntdMood = m;
  document.querySelectorAll('.ntd-mood-btn').forEach(b => b.classList.toggle('sel', b.textContent.includes(m)));
}

// ─── NTD SAVE ──────────────────────────────────────────────
function saveNtdDay() {
  const dateEl = document.getElementById('jrn-ntd-date');
  const date   = dateEl ? dateEl.value : today.toISOString().split('T')[0];

  if (!date)          { toast('⚠️ Please select a date');   return; }
  if (!_ntdReason)    { toast('⚠️ Please select a reason'); return; }
  if (_ntdPositive === null) { toast('⚠️ Please select Good call or Missed opportunity'); return; }

  const note = (document.getElementById('jrn-ntd-note') || {}).value || '';

  const entries  = loadJournal();
  const existing = entries.find(e => e.type === 'ntd' && e.date === date);
  const filtered = entries.filter(e => e.date !== date);
  filtered.push({
    id:       existing ? existing.id : Date.now(), // preserve id when updating an existing entry
    date,
    type:     'ntd',
    reason:   _ntdReason,
    positive: _ntdPositive,
    mood:     _ntdMood,
    note,
  });
  saveJournal(filtered);
  toast(existing ? '✓ No Trade Day updated!' : '✓ No Trade Day saved!');
  _resetNtdForm();
  closeNewTradeModal();
}

function _resetNtdForm() {
  _ntdReason   = '';
  _ntdPositive = null;
  _ntdMood     = '';
  const noteEl = document.getElementById('jrn-ntd-note');
  if (noteEl) noteEl.value = '';
  const dateEl = document.getElementById('jrn-ntd-date');
  if (dateEl) dateEl.disabled = false; // re-enable in case editNtdFromCalendar() (tradeForm.js) had locked it
  ['technical','mental','other'].forEach(r => {
    const btn = document.getElementById('ntd-btn-' + r);
    if (btn) btn.classList.remove('active');
  });
  const btnPos = document.getElementById('ntd-btn-positive');
  const btnNeg = document.getElementById('ntd-btn-negative');
  if (btnPos) { btnPos.classList.remove('active-good','active-bad'); }
  if (btnNeg) { btnNeg.classList.remove('active-good','active-bad'); }
  document.querySelectorAll('.ntd-mood-btn').forEach(b => b.classList.remove('sel'));
}

// ─── RULES CHECKLIST ───────────────────────────────────────
function renderRulesChecklist() {
  const rules = loadRules();

  // Right panel
  const rpList  = document.getElementById('right-panel-rules-list');
  const rpEmpty = document.getElementById('right-panel-rules-empty');

  if (rpList) {
    if (rules.length) {
      rpList.innerHTML = rules.map(r =>
        `<label class="jrn-rule-item" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 8px;border-radius:7px;transition:background .12s" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" style="margin-top:2px;flex-shrink:0;accent-color:var(--green)">
          <span style="font-size:13px;color:var(--text);line-height:1.45">${r.text}</span>
        </label>`
      ).join('');
      if (rpEmpty) rpEmpty.style.display = 'none';
    } else {
      rpList.innerHTML = '';
      if (rpEmpty) rpEmpty.style.display = 'block';
    }
  }
}

// ─── RULES MODAL ───────────────────────────────────────────
let _rulesModalOpen = false;

function openRulesModal() {
  if (_rulesModalOpen) return;
  _rulesModalOpen = true;

  const overlay = document.createElement('div');
  overlay.id = 'rules-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:400;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:1.5rem;width:min(94vw,460px);max-height:80vh;display:flex;flex-direction:column;gap:1rem;box-shadow:0 20px 50px rgba(0,0,0,.18)';

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:16px;font-weight:700;color:var(--text)">Trading Rules</span>
      <button onclick="closeRulesModal()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:var(--bg2);cursor:pointer;font-size:16px;color:var(--text2);display:flex;align-items:center;justify-content:center;transition:background .15s" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--bg2)'">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text3)">Up to 10 rules. They appear as a checklist every time you open the Journal.</div>
    <div id="rules-modal-list" style="display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:280px"></div>
    <div style="display:flex;gap:6px">
      <input id="rules-modal-input" type="text" placeholder="e.g. Never trade the first 5 minutes" maxlength="120"
        style="flex:1;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none"
        onkeydown="if(event.key==='Enter')addRule()">
      <button onclick="addRule()" style="padding:8px 16px;border-radius:8px;border:none;background:var(--text);color:var(--bg);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">Add</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeRulesModal(); });

  _renderRulesModalList();
  setTimeout(() => document.getElementById('rules-modal-input') && document.getElementById('rules-modal-input').focus(), 50);
}

let _dragSrcIdx = null;

function _renderRulesModalList() {
  const list = document.getElementById('rules-modal-list');
  if (!list) return;
  const rules = loadRules();

  if (!rules.length) {
    list.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:8px 0">No rules yet. Add your first rule above.</div>`;
    return;
  }

  list.innerHTML = '';
  rules.forEach((r, i) => {
    const row = document.createElement('div');
    row.dataset.idx = i;
    row.draggable = true;
    row.style.cssText = 'display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;transition:opacity .15s,box-shadow .15s;cursor:default';

    row.innerHTML = `
      <span class="rule-drag-handle" title="Drag to reorder"
        style="cursor:grab;color:var(--text3);font-size:16px;line-height:1;flex-shrink:0;padding:0 2px;user-select:none"
        onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text3)'">⠿</span>
      <span class="rule-num" style="font-size:12px;color:var(--text3);font-weight:700;min-width:16px;flex-shrink:0">${i + 1}.</span>
      <span class="rule-text" style="flex:1;font-size:13px;color:var(--text)">${r.text}</span>
      <button class="rule-edit-btn" data-id="${r.id}" title="Edit"
        style="width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:var(--text3);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:color .15s;flex-shrink:0"
        onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text3)'">✏️</button>
      <button class="rule-del-btn" data-id="${r.id}" title="Delete"
        style="width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:var(--text3);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:color .15s;flex-shrink:0"
        onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text3)'">✕</button>
    `;

    // ── Edit button ──
    row.querySelector('.rule-edit-btn').addEventListener('click', () => _startEditRule(r.id));

    // ── Delete button ──
    row.querySelector('.rule-del-btn').addEventListener('click', () => deleteRule(r.id));

    // ── Drag events ──
    row.addEventListener('dragstart', e => {
      _dragSrcIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { row.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '1';
      list.querySelectorAll('[data-idx]').forEach(el => {
        el.style.boxShadow = '';
        el.style.borderColor = '';
      });
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('[data-idx]').forEach(el => {
        el.style.boxShadow = '';
        el.style.borderColor = 'var(--border)';
      });
      row.style.boxShadow = '0 0 0 2px var(--green)';
      row.style.borderColor = 'var(--green)';
    });
    row.addEventListener('dragleave', () => {
      row.style.boxShadow = '';
      row.style.borderColor = 'var(--border)';
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (_dragSrcIdx === null || _dragSrcIdx === i) return;
      const rules = loadRules();
      const [moved] = rules.splice(_dragSrcIdx, 1);
      rules.splice(i, 0, moved);
      saveRules(rules);
      _dragSrcIdx = null;
      _renderRulesModalList();
      renderRulesChecklist();
    });

    list.appendChild(row);
  });
}

function _startEditRule(id) {
  const list = document.getElementById('rules-modal-list');
  if (!list) return;
  const rules = loadRules();
  const rule  = rules.find(r => r.id === id);
  if (!rule) return;

  // Find the row with matching edit button
  const editBtn = list.querySelector(`.rule-edit-btn[data-id="${id}"]`);
  if (!editBtn) return;
  const row      = editBtn.closest('[data-idx]');
  const textSpan = row.querySelector('.rule-text');

  // Replace text span with input
  const input = document.createElement('input');
  input.type  = 'text';
  input.value = rule.text;
  input.maxLength = 120;
  input.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:13px;color:var(--text);font-family:inherit;outline:none;min-width:0';
  row.replaceChild(input, textSpan);
  input.focus();
  input.select();

  // Hide edit + delete + drag handle while editing
  row.querySelector('.rule-drag-handle').style.visibility = 'hidden';
  row.querySelector('.rule-del-btn').style.visibility    = 'hidden';
  editBtn.style.visibility = 'hidden';
  row.draggable = false;

  // Confirm button ✓
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✓';
  confirmBtn.title = 'Save';
  confirmBtn.style.cssText = 'width:26px;height:26px;border-radius:6px;border:none;background:var(--green);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0';
  row.insertBefore(confirmBtn, editBtn);

  const save = () => {
    const newText = input.value.trim();
    if (!newText) { toast('⚠️ Rule cannot be empty'); input.focus(); return; }
    const rules = loadRules();
    const idx   = rules.findIndex(r => r.id === id);
    if (idx !== -1) { rules[idx].text = newText; saveRules(rules); }
    confirmBtn.remove();
    _renderRulesModalList();
    renderRulesChecklist();
  };

  confirmBtn.addEventListener('click', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { _renderRulesModalList(); }
  });
}

function addRule() {
  const input = document.getElementById('rules-modal-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const rules = loadRules();
  if (rules.length >= 10) { toast('⚠️ Maximum 10 rules'); return; }

  rules.push({ id: Date.now(), text });
  saveRules(rules);
  input.value = '';
  _renderRulesModalList();
  renderRulesChecklist();
}

function deleteRule(id) {
  const rules = loadRules().filter(r => r.id !== id);
  saveRules(rules);
  _renderRulesModalList();
  renderRulesChecklist();
}

function closeRulesModal() {
  const overlay = document.getElementById('rules-modal-overlay');
  if (overlay) overlay.remove();
  _rulesModalOpen = false;
  renderRulesChecklist();
}

// ─── HOOK INTO saveTrade ───────────────────────────────────
// Wrap the existing saveTrade so NTD mode routes to saveNtdDay instead.
(function patchSaveTrade() {
  const _orig = window.saveTrade;
  window.saveTrade = function() {
    if (_journalMode === 'ntd') { saveNtdDay(); return; }
    if (typeof _orig === 'function') _orig.apply(this, arguments);
  };
})();

// ─── HOOK INTO resetForm ───────────────────────────────────
// When the form resets (discard / after save), also reset NTD state + return to Trade Day.
(function patchResetForm() {
  const _orig = window.resetForm;
  window.resetForm = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    _resetNtdForm();
    setJournalMode('trade');
  };
})();

// ─── HOOK INTO openNewTradeModal ──────────────────────────
// Render rules checklist every time the Journal opens.
(function patchOpenNewTradeModal() {
  const _orig = window.openNewTradeModal;
  window.openNewTradeModal = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    renderRulesChecklist();
    _updateNtdButtonState();
    // Watch date field changes to re-evaluate the guard
    const dateEl = document.getElementById('f-date');
    if (dateEl && !dateEl._ntdGuardAttached) {
      dateEl.addEventListener('change', _updateNtdButtonState);
      dateEl._ntdGuardAttached = true;
    }
  };
})();

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.setJournalMode   = setJournalMode;
window.setNtdReason     = setNtdReason;
window.setNtdPositive   = setNtdPositive;
window.setNtdMood       = setNtdMood;
window.saveNtdDay       = saveNtdDay;
window.renderRulesChecklist = renderRulesChecklist;
window.openRulesModal   = openRulesModal;
window.closeRulesModal  = closeRulesModal;
window.addRule          = addRule;
window.deleteRule       = deleteRule;
window._startEditRule   = _startEditRule;
window._updateNtdButtonState = _updateNtdButtonState;
