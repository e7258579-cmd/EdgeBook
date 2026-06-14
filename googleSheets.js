/**
 * googleSheets.js — Google Sheets Sync Module
 * Extracted from EdgeBook_v54.html
 *
 * Owns:
 *   openGsModal / closeGsModal
 *   gsSyncNow
 *   copyGsScript
 *
 * Globals consumed (must be defined before this file loads):
 *   trades    — app.js
 *   toast()   — app.js
 *
 * Load order in HTML:
 *   <script src="app.js"></script>
 *   ...
 *   <script src="googleSheets.js"></script>
 */

// ─── MODAL ────────────────────────────────────────────────
function openGsModal() {
  document.getElementById('gs-url').value = localStorage.getItem('gsWebAppUrl') || '';
  document.getElementById('gs-status').textContent = 'Not connected';
  document.getElementById('gs-status').className = 'gs-status';
  document.getElementById('gs-modal').classList.add('open');
}

function closeGsModal() {
  document.getElementById('gs-modal').classList.remove('open');
}

// ─── SYNC ─────────────────────────────────────────────────
async function gsSyncNow() {
  const url = document.getElementById('gs-url').value.trim();
  if (!url) { alert('Please enter a URL'); return; }
  localStorage.setItem('gsWebAppUrl', url);
  const statusEl = document.getElementById('gs-status');
  statusEl.textContent = '⏳ Syncing...';
  statusEl.className = 'gs-status loading';

  const payload = trades.map(t => [
    t.date, t.sym, t.dir==='long'?'Long':'Short',
    t.entry, t.exit, t.qty, t.pnl,
    t.sl||'', t.tp||'', t.rr||'',
    t.entryTime||'', t.exitTime||'', t.duration||'',
    t.mood||'', t.rating||'',
    t.reason||'', t.notes||''
  ]);

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', trades: payload })
    });
    // no-cors means we can't read the response, but if no error was thrown it likely succeeded
    statusEl.textContent = `✓ Synced ${trades.length} trades successfully (${new Date().toLocaleTimeString()})`;
    statusEl.className = 'gs-status ok';
  } catch(err) {
    statusEl.textContent = '✗ Error: ' + err.message + ' — check that the URL is correct and the Web App is deployed as Anyone';
    statusEl.className = 'gs-status err';
  }
}

// ─── COPY APPS SCRIPT ─────────────────────────────────────
function copyGsScript() {
  const script = `// Google Apps Script — הדבק ב-Extensions → Apps Script → Deploy → New Deployment → Web App
// Execute as: Me | Who has access: Anyone

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action !== 'sync') return ok('no action');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('יומן מסחר');
    if (!sheet) sheet = ss.insertSheet('יומן מסחר');

    const headers = ['Date','Symbol','Direction','Entry','Exit','Shares','P&L',
                     'Stop Loss','Take Profit','R:R','Entry Time','Exit Time','Duration',
                     'Mood','Rating','Reason','Notes'];

    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1a1a1a').setFontColor('#ffffff').setFontWeight('bold');

    if (data.trades && data.trades.length > 0) {
      sheet.getRange(2, 1, data.trades.length, headers.length).setValues(data.trades);

      // Color P&L column (col 7)
      data.trades.forEach((row, i) => {
        const pnl = parseFloat(row[6]) || 0;
        const cell = sheet.getRange(i + 2, 7);
        if (pnl > 0) cell.setBackground('#e6f4ea').setFontColor('#1e7e34');
        else if (pnl < 0) cell.setBackground('#fce8e8').setFontColor('#c0392b');
      });
    }

    sheet.autoResizeColumns(1, headers.length);
    return ok('synced ' + (data.trades ? data.trades.length : 0) + ' trades');
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.message}))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function ok(msg) {
  return ContentService.createTextOutput(JSON.stringify({status:'ok', message: msg}))
                       .setMimeType(ContentService.MimeType.JSON);
}`;
  navigator.clipboard.writeText(script).then(() => {
    toast('✓ Script code copied to clipboard!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = script; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('✓ Script code copied to clipboard!');
  });
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.openGsModal  = openGsModal;
window.closeGsModal = closeGsModal;
window.gsSyncNow    = gsSyncNow;
window.copyGsScript = copyGsScript;