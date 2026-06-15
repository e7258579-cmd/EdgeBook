/**
 * importWizard.js — Import Wizard Module
 * Extracted from EdgeBook_v54.html
 *
 * Owns:
 *   openImportWizard / closeImportWizard / wizGoStep / wizSelectFormat
 *   parseDaytradeFormat / parseOrdersFile
 *   handleXlsImport / handleDaytradeImport / handleManualImport
 *   wizShowPreview / wizConfirmImport
 *   buildMappingUI / wizOnMapChange / wizDoManualImport / autoDetectMapping
 *
 * Globals consumed (must be defined before this file loads):
 *   trades          — app.js
 *   save()          — app.js
 *   toast()         — app.js
 *   today           — app.js
 *   showPage()      — app.js (on window)
 *   activeAccount   — accounts.js
 *
 * Load order in HTML:
 *   <script src="app.js"></script>
 *   <script src="accounts.js"></script>
 *   ...
 *   <script src="importWizard.js"></script>   ← this file, before tradeForm.js
 */

// ─── STATE ────────────────────────────────────────────────
let wizParsedTrades = [];   // trades ready to import
let wizPreviewBack  = '1';  // which step "back" goes to from preview

let wizManualHeaders = [];
let wizManualRows    = [];

const JOURNAL_FIELDS = [
  { key:'sym',       label:'Symbol',      required:true  },
  { key:'date',      label:'Date',        required:true  },
  { key:'side',      label:'Side (B/S or Buy/Sell)', required:true },
  { key:'price',     label:'Price',       required:true  },
  { key:'qty',       label:'Quantity',    required:true  },
  { key:'time',      label:'Exec Time',   required:false },
  { key:'comm',      label:'Commission',  required:false },
  { key:'notes',     label:'Notes',       required:false },
];

const FIELD_ALIASES = {
  sym:   ['symbol','ticker','sym','instrument'],
  date:  ['date','t/d','trade date','tradedate','datetime'],
  side:  ['side','action','buy/sell','direction','b/s'],
  price: ['price','avg price','avgprice','avg. price','executed price','exec price'],
  qty:   ['qty','quantity','shares','size','vol','volume'],
  time:  ['exec time','time','exectime','execution time','timestamp'],
  comm:  ['comm','commission','fee','fees'],
  notes: ['note','notes','comment','comments'],
};

// ─── WIZARD NAVIGATION ────────────────────────────────────
function openImportWizard() {
  wizGoStep(1);
  document.getElementById('import-wizard').classList.add('open');
  const badge = document.getElementById('wiz-acct-badge');
  if (badge) {
    const isLive = activeAccount === 'live';
    badge.textContent       = isLive ? 'Live' : 'Demo';
    badge.style.background  = isLive ? 'rgba(29,158,117,.12)' : 'rgba(239,159,39,.15)';
    badge.style.color       = isLive ? 'var(--green)' : 'var(--amber)';
  }
}

function closeImportWizard() {
  document.getElementById('import-wizard').classList.remove('open');
  wizParsedTrades = [];
}

function wizGoStep(step) {
  document.querySelectorAll('.wiz-step').forEach(s => s.classList.remove('active'));
  const el = step === 1 ? document.getElementById('wiz-step-1')
           : document.getElementById('wiz-step-' + step);
  if (el) el.classList.add('active');
  document.getElementById('wiz-title').textContent =
    step === 1         ? 'Import Trades'         :
    step === 'generic' ? 'Generic Broker Format'  :
    step === 'daytrade'? 'DayTrade Format'         :
    step === 'manual'  ? 'Custom Mapping'          :
    step === 'mapping' ? 'Map Columns'             :
    step === 'preview' ? 'Preview'                 : 'Import Trades';
}

function wizSelectFormat(fmt) {
  wizGoStep(fmt);
}

// ─── GENERIC FORMAT PARSER ────────────────────────────────
function parseOrdersFile(headers, dataRows) {
  // Column indices — support both this broker format and generic formats
  const col = name => {
    const aliases = {
      'sym':    ['Symbol/Contract','Symbol','Ticker','sym'],
      'shares': ['Shares','Qty','Quantity','shares','executed','Last Quantity'],
      'price':  ['Avg. Price','AvgPrice','Avg Price','avg_price','Executed Price'],
      'status': ['Status','status'],
      'action': ['Action','Side','action','Buy/Sell'],
      'oc':     ['Open/Close','open_close','OpenClose'],
      'time':   ['Created','DateTime','Time','timestamp','Date'],
      'acct':   ['Acct. Type','Account Type','acct_type'],
    };
    const opts = aliases[name] || [name];
    for (const o of opts) {
      const idx = headers.findIndex(h => h.toLowerCase() === o.toLowerCase());
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const iSym = col('sym'), iShares = col('shares'), iPrice = col('price');
  const iStatus = col('status'), iAction = col('action'), iOC = col('oc');
  const iTime = col('time'), iAcct = col('acct');

  if (iSym < 0 || iPrice < 0) return [];

  function parseDateTime(raw) {
    if (!raw) return null;
    // XLSX cellDates:true may return a JS Date object directly
    if (raw instanceof Date) {
      const dateStr = `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}`;
      raw._localDateStr = dateStr;
      return raw;
    }
    const s = String(raw).trim();
    // MM/DD/YYYY HH:MM:SS
    const m1 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m1) {
      const dateStr = `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
      const timeStr = `${m1[4].padStart(2,'0')}:${m1[5]}:${m1[6]}`;
      const d = new Date(`${dateStr}T${timeStr}`);
      d._localDateStr = dateStr;
      return d;
    }
    // YYYY-MM-DD or YYYY-MM-DDTHH:MM
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) {
      const dateStr = `${m2[1]}-${m2[2]}-${m2[3]}`;
      try { const d = new Date(s.includes('T') ? s : dateStr + 'T00:00:00'); d._localDateStr = dateStr; return d; } catch(e){}
    }
    // MM/DD/YYYY without time
    const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m3) {
      const dateStr = `${m3[3]}-${m3[1].padStart(2,'0')}-${m3[2].padStart(2,'0')}`;
      try { const d = new Date(dateStr + 'T00:00:00'); d._localDateStr = dateStr; return d; } catch(e){}
    }
    return null;
  }

  // Filter filled orders only
  const filled = dataRows.filter(r => {
    if (iStatus >= 0) {
      const st = String(r[iStatus]||'').trim().toLowerCase();
      return st === 'filled' || st === 'executed' || st === 'complete';
    }
    // If no status column, assume all rows are filled
    return r[iPrice] && parseFloat(String(r[iPrice]).replace(/,/g,'')) > 0;
  });

  // Sort by time ascending
  filled.sort((a, b) => {
    const ta = iTime >= 0 ? (parseDateTime(a[iTime]) || new Date(0)) : new Date(0);
    const tb = iTime >= 0 ? (parseDateTime(b[iTime]) || new Date(0)) : new Date(0);
    return ta - tb;
  });

  // ── Position accumulator: handle partial fills and multi-leg entries/exits ──
  // pos[sym] = { dir, legs:[{price,shares,time}], totalShares, firstTime, lastTime }
  const pos = {};
  const result = [];

  function flushPosition(sym, exitPrice, exitShares, exitDt) {
    const p = pos[sym];
    if (!p || p.totalShares <= 0) return;

    // Consume exitShares from the position legs (FIFO)
    let remaining = exitShares;
    let totalEntryValue = 0;
    let totalEntryShares = 0;
    const firstEntryTime = p.legs[0] ? p.legs[0].time : null;

    while (remaining > 0 && p.legs.length > 0) {
      const leg = p.legs[0];
      const use = Math.min(remaining, leg.shares);
      totalEntryValue  += use * leg.price;
      totalEntryShares += use;
      leg.shares -= use;
      remaining  -= use;
      if (leg.shares <= 0) p.legs.shift();
    }

    if (totalEntryShares === 0) return;

    const avgEntry = totalEntryValue / totalEntryShares;
    const qty      = totalEntryShares;
    const dir      = p.dir;
    const pnl      = dir === 'long'
      ? (exitPrice - avgEntry) * qty
      : (avgEntry - exitPrice) * qty;

    const entryTime = firstEntryTime ? firstEntryTime.toTimeString().slice(0,5) : '';
    const exitTime  = exitDt         ? exitDt.toTimeString().slice(0,5)         : '';
    let duration = '';
    if (entryTime && exitTime) {
      const [eh,em] = entryTime.split(':').map(Number);
      const [xh,xm] = exitTime.split(':').map(Number);
      let mins = (xh*60+xm)-(eh*60+em); if (mins<0) mins+=1440;
      const h=Math.floor(mins/60), m=mins%60;
      duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    const dateStr = exitDt
      ? (exitDt._localDateStr || exitDt.toISOString().slice(0,10))
      : (firstEntryTime
          ? (firstEntryTime._localDateStr || firstEntryTime.toISOString().slice(0,10))
          : today.toISOString().slice(0,10));

    result.push({
      id: Date.now() + Math.floor(Math.random() * 10000),
      date: dateStr,
      sym, dir,
      entry: parseFloat(avgEntry.toFixed(4)),
      exit:  exitPrice,
      qty,
      pnl: parseFloat(pnl.toFixed(2)),
      sl: 0, tp: 0, rr: 0,
      entryTime, exitTime, duration,
      reason: '', notes: '', mood: '', rating: 0, img: ''
    });

    p.totalShares -= totalEntryShares;
    if (p.totalShares <= 0) delete pos[sym];
  }

  for (const r of filled) {
    const sym = String(r[iSym]||'').trim().toUpperCase();
    if (!sym) continue;
    const price  = parseFloat(String(r[iPrice]||'').replace(/,/g,'')) || 0;
    const shares = parseInt(String(r[iShares]||'').replace(/,/g,''))  || 0;
    if (!price || !shares) continue;

    const action = String(iAction >= 0 ? (r[iAction]||'') : '').trim().toLowerCase();
    const oc     = String(iOC >= 0     ? (r[iOC]||'')     : '').trim().toLowerCase();
    const dt     = iTime >= 0 ? parseDateTime(r[iTime]) : null;

    const isShortEntry = action.includes('sell short') || (action.includes('short') && oc === 'open');
    const isShortExit  = action.includes('buy to cover') || (action.includes('buy') && oc === 'close');
    const isLongEntry  = !isShortEntry && !isShortExit &&
                         (action.includes('buy')) &&
                         (oc === 'open' || !oc);
    const isLongExit   = !isShortEntry && !isShortExit &&
                         (action.includes('sell')) &&
                         (oc === 'close' || !oc);

    if (isLongEntry || isShortEntry) {
      const dir = isShortEntry ? 'short' : 'long';
      if (!pos[sym]) {
        pos[sym] = { dir, legs: [], totalShares: 0 };
      }
      // If direction flipped, flush existing position first
      if (pos[sym].dir !== dir && pos[sym].totalShares > 0) {
        flushPosition(sym, price, pos[sym].totalShares, dt);
      }
      pos[sym].legs.push({ price, shares, time: dt });
      pos[sym].totalShares += shares;

    } else if (isLongExit || isShortExit) {
      if (pos[sym] && pos[sym].totalShares > 0) {
        flushPosition(sym, price, shares, dt);
      }
    }
  }

  return result.reverse(); // newest first
}

// ─── DAYTRADE FORMAT PARSER ────────────────────────────────
function parseDaytradeFormat(headers, dataRows) {
  const h = name => headers.findIndex(x => x.trim().toLowerCase() === name.toLowerCase());
  const iDate    = h('T/D');
  const iSide    = h('Side');
  const iSym     = h('Symbol');
  const iQty     = h('Qty');
  const iPrice   = h('Price');
  const iTime    = h('Exec Time');
  const iComm    = h('Comm');

  if (iSym < 0 || iPrice < 0 || iSide < 0) return [];

  function parseDate(raw) {
    if (!raw) return null;
    // XLSX cellDates:true may return a JS Date object directly
    if (raw instanceof Date) {
      const y = raw.getFullYear();
      const mo = String(raw.getMonth()+1).padStart(2,'0');
      const d  = String(raw.getDate()).padStart(2,'0');
      return `${y}-${mo}-${d}`;
    }
    const s = String(raw).trim();
    // MM/DD/YYYY (with optional time)
    const m1 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m1) return `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
    // YYYY-MM-DD
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    // DD-MM-YYYY
    const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
    return null;
  }

  const rows = dataRows.filter(r => r[iSym] && r[iPrice]);
  rows.sort((a, b) => {
    const ta = String(a[iTime]||''); const tb = String(b[iTime]||'');
    return ta.localeCompare(tb);
  });

  // ── Position accumulator: supports multiple buys before sell and vice versa ──
  const pos = {}; // key=date|sym -> { dir, legs:[{price,qty,time,date,comm}], totalQty }
  const result = [];

  function flushDaytrade(key, exitPrice, exitQty, exitTime, exitDate, exitComm) {
    const p = pos[key];
    if (!p || p.totalQty <= 0) return;

    let remaining = exitQty;
    let totalEntryValue = 0;
    let totalEntryQty   = 0;
    let totalEntryComm  = 0;
    const firstTime = p.legs[0] ? p.legs[0].time : '';
    const firstDate = p.legs[0] ? p.legs[0].date : null;

    while (remaining > 0 && p.legs.length > 0) {
      const leg = p.legs[0];
      const use = Math.min(remaining, leg.qty);
      totalEntryValue += use * leg.price;
      totalEntryQty   += use;
      totalEntryComm  += (use / leg.qty) * leg.comm;
      leg.qty    -= use;
      remaining  -= use;
      if (leg.qty <= 0) p.legs.shift();
    }

    if (totalEntryQty === 0) return;

    const avgEntry = totalEntryValue / totalEntryQty;
    const pnl = parseFloat(((exitPrice - avgEntry) * totalEntryQty - exitComm - totalEntryComm).toFixed(2));

    let duration = '';
    if (firstTime && exitTime) {
      const [eh,em] = firstTime.split(':').map(Number);
      const [xh,xm] = exitTime.split(':').map(Number);
      let mins = (xh*60+xm)-(eh*60+em); if (mins<0) mins+=1440;
      const hh=Math.floor(mins/60), mm=mins%60;
      duration = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
    }

    result.push({
      id: Date.now() + Math.floor(Math.random()*100000),
      date: firstDate || exitDate || today.toISOString().slice(0,10),
      sym: key.split('|')[1],
      dir: 'long',
      entry: parseFloat(avgEntry.toFixed(4)),
      exit: exitPrice,
      qty: totalEntryQty,
      pnl, sl:0, tp:0, rr:0,
      entryTime: firstTime, exitTime, duration,
      reason:'', notes:'', mood:'', rating:0, img:''
    });

    p.totalQty -= totalEntryQty;
    if (p.totalQty <= 0) delete pos[key];
  }

  for (const r of rows) {
    const sym   = String(r[iSym]||'').trim().toUpperCase();
    const side  = String(r[iSide]||'').trim().toUpperCase();
    const price = parseFloat(String(r[iPrice]||'').replace(/,/g,'')) || 0;
    const qty   = parseInt(String(r[iQty]||'').replace(/,/g,''))   || 0;
    const date  = iDate >= 0 ? parseDate(r[iDate]) : null;
    const time  = iTime >= 0 ? String(r[iTime]||'').trim().slice(0,5) : '';
    const comm  = iComm >= 0 ? parseFloat(String(r[iComm]||'')) || 0 : 0;
    if (!sym || !price || !qty) continue;

    const key = (date||'nodate') + '|' + sym;

    if (side === 'B') {
      if (!pos[key]) pos[key] = { dir: 'long', legs: [], totalQty: 0 };
      pos[key].legs.push({ price, qty, time, date, comm });
      pos[key].totalQty += qty;
    } else if (side === 'S') {
      if (pos[key] && pos[key].totalQty > 0) {
        flushDaytrade(key, price, qty, time, date, comm);
      }
    }
  }
  return result.reverse();
}

// ─── PREVIEW STEP ─────────────────────────────────────────
function wizShowPreview(parsed, backStep) {
  wizParsedTrades = parsed;
  wizPreviewBack  = backStep;
  document.getElementById('wiz-preview-back').onclick = () => wizGoStep(backStep);

  const existing = new Set(trades.map(t => `${t.sym}|${t.date}|${t.entryTime}|${t.entry}`));
  const newOnes  = parsed.filter(t => !existing.has(`${t.sym}|${t.date}|${t.entryTime}|${t.entry}`));
  const dupCount = parsed.length - newOnes.length;
  wizParsedTrades = newOnes;

  const wins = newOnes.filter(t => t.pnl > 0).length;
  const totalPnl = newOnes.reduce((s,t) => s+t.pnl, 0);
  document.getElementById('wiz-preview-summary').innerHTML = `
    <div class="wiz-summary-kv"><div class="wiz-summary-k">New Trades</div><div class="wiz-summary-v">${newOnes.length}</div></div>
    <div class="wiz-summary-kv"><div class="wiz-summary-k">Duplicates Skipped</div><div class="wiz-summary-v" style="color:var(--text3)">${dupCount}</div></div>
    <div class="wiz-summary-kv"><div class="wiz-summary-k">Win Rate</div><div class="wiz-summary-v" style="color:${wins/newOnes.length>=.5?'var(--green)':'var(--red)'}">${newOnes.length?Math.round(wins/newOnes.length*100):0}%</div></div>
    <div class="wiz-summary-kv"><div class="wiz-summary-k">Total P&L</div><div class="wiz-summary-v" style="color:${totalPnl>=0?'var(--green)':'var(--red)'}">${totalPnl>=0?'+':'-'}$${Math.abs(totalPnl).toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>`;

  const preview5 = newOnes.slice(0, 5);
  const tbl = document.getElementById('wiz-preview-table');
  tbl.innerHTML = `<thead><tr><th>Date</th><th>Symbol</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Qty</th><th>P&L</th></tr></thead><tbody>` +
    preview5.map(t => {
      const pnlCls = t.pnl>0?'color:var(--green)':t.pnl<0?'color:var(--red)':'';
      return `<tr><td>${t.date}</td><td><b>${t.sym}</b></td><td>${t.dir}</td><td>$${t.entry}</td><td>$${t.exit}</td><td>${t.qty}</td><td style="${pnlCls}">${t.pnl>=0?'+':''}$${t.pnl.toLocaleString('en-US',{maximumFractionDigits:0})}</td></tr>`;
    }).join('') + `</tbody>`;

  const btn = document.getElementById('wiz-confirm-btn');
  btn.disabled = newOnes.length === 0;
  btn.textContent = newOnes.length ? `✓ Import ${newOnes.length} Trades` : 'No new trades to import';
  wizGoStep('preview');
}

function wizConfirmImport() {
  if (!wizParsedTrades.length) return;

  const mode = typeof window.activeAccount !== 'undefined' ? window.activeAccount : 'live';

  if (typeof showModeConfirm === 'function') {
    showModeConfirm(mode, _doWizImport);
  } else {
    _doWizImport();
  }
}

function _doWizImport() {
  trades.unshift(...wizParsedTrades);
  save();
  closeImportWizard();
  toast(`✓ Imported ${wizParsedTrades.length} new trades`);
  showPage('home');
}

// ─── FILE HANDLERS ────────────────────────────────────────
function handleXlsImport(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
      if (rows.length < 2) { alert('File is empty'); return; }
      const headers = rows[0].map(h => String(h).trim());
      const dataRows = rows.slice(1);
      const parsed = parseOrdersFile(headers, dataRows);
      if (!parsed.length) { alert('No completed trades found (Buy Open + Sell Close)'); return; }
      input.value = '';
      wizShowPreview(parsed, 'generic');
    } catch(err) { alert('Error reading file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function handleDaytradeImport(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
      if (rows.length < 2) { alert('File is empty'); return; }
      const headers = rows[0].map(h => String(h).trim());
      const dataRows = rows.slice(1);
      const parsed = parseDaytradeFormat(headers, dataRows);
      if (!parsed.length) { alert('No trades found. Make sure Side column has B/S values.'); return; }
      input.value = '';
      wizShowPreview(parsed, 'daytrade');
    } catch(err) { alert('Error reading file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function handleManualImport(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
      if (rows.length < 2) { alert('File is empty'); return; }
      wizManualHeaders = rows[0].map(h => String(h).trim());
      wizManualRows    = rows.slice(1);
      input.value = '';
      buildMappingUI();
      wizGoStep('mapping');
    } catch(err) { alert('Error reading file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

// ─── MANUAL MAPPING UI ────────────────────────────────────
function autoDetectMapping(headers) {
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = headers.findIndex(h =>
      aliases.some(a => h.trim().toLowerCase() === a.toLowerCase())
    );
    if (idx >= 0) mapping[field] = idx;
  }
  return mapping;
}

function buildMappingUI() {
  const autoMap = autoDetectMapping(wizManualHeaders);
  const grid    = document.getElementById('wiz-map-grid');

  grid.innerHTML = `
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Your Column</div>
    <div></div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Journal Field</div>`;

  for (const field of JOURNAL_FIELDS) {
    const detectedIdx = autoMap[field.key] ?? -1;
    const isMatched   = detectedIdx >= 0;
    const srcLabel = isMatched ? wizManualHeaders[detectedIdx] : '—';
    const opts = `<option value="">— skip —</option>` +
      wizManualHeaders.map((h, i) =>
        `<option value="${i}" ${i === detectedIdx ? 'selected' : ''}>${h}</option>`
      ).join('');

    grid.insertAdjacentHTML('beforeend', `
      <div class="wiz-map-label" title="${srcLabel}">${srcLabel}</div>
      <div class="wiz-map-arrow">→</div>
      <select class="wiz-map-select ${isMatched?'matched':''}" data-field="${field.key}" onchange="wizOnMapChange(this)">
        ${opts}
      </select>`);
  }

  const preview = document.getElementById('wiz-map-preview');
  const cols    = wizManualHeaders;
  preview.innerHTML =
    `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>` +
    `<tbody>${wizManualRows.slice(0,3).map(r =>
      `<tr>${cols.map((_,i)=>`<td>${r[i]??''}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
}

function wizOnMapChange(sel) {
  const grid = document.getElementById('wiz-map-grid');
  const selects = [...grid.querySelectorAll('select[data-field]')];
  const idx = selects.indexOf(sel);
  if (idx < 0) return;
  const labelEl = grid.children[3 + idx * 3];
  const chosen  = sel.value !== '' ? wizManualHeaders[+sel.value] : '—';
  if (labelEl) labelEl.textContent = chosen;
  sel.classList.toggle('matched', sel.value !== '');
}

function wizDoManualImport() {
  const grid    = document.getElementById('wiz-map-grid');
  const selects = [...grid.querySelectorAll('select[data-field]')];
  const colMap  = {};
  for (const sel of selects) {
    if (sel.value !== '') colMap[sel.dataset.field] = +sel.value;
  }
  if (!colMap.sym || !colMap.price || !colMap.side) {
    alert('Please map at minimum: Symbol, Price, and Side (B/S)'); return;
  }

  function parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) {
      const y = raw.getFullYear();
      const mo = String(raw.getMonth()+1).padStart(2,'0');
      const d  = String(raw.getDate()).padStart(2,'0');
      return `${y}-${mo}-${d}`;
    }
    const s = String(raw).trim();
    const m1 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m1) return `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
    return null;
  }

  const rows = wizManualRows.filter(r => r[colMap.price] && r[colMap.sym]);
  rows.sort((a,b) => {
    const ta = colMap.time!=null ? String(a[colMap.time]||'') : '';
    const tb = colMap.time!=null ? String(b[colMap.time]||'') : '';
    return ta.localeCompare(tb);
  });

  const opens = {};
  const result = [];

  for (const r of rows) {
    const sym   = String(r[colMap.sym]||'').trim().toUpperCase();
    const sideRaw = String(colMap.side!=null ? r[colMap.side]||'' : '').trim().toLowerCase();
    const side  = sideRaw === 'b' || sideRaw.startsWith('buy') ? 'B' : sideRaw === 's' || sideRaw.startsWith('sell') ? 'S' : '';
    const price = parseFloat(String(r[colMap.price]||'').replace(/,/g,'')) || 0;
    const qty   = colMap.qty!=null ? parseInt(String(r[colMap.qty]||'').replace(/,/g,''))||1 : 1;
    const date  = colMap.date!=null ? parseDate(r[colMap.date]) : null;
    const time  = colMap.time!=null ? String(r[colMap.time]||'').trim().slice(0,5) : '';
    const comm  = colMap.comm!=null ? parseFloat(String(r[colMap.comm]||''))||0 : 0;
    const notes = colMap.notes!=null ? String(r[colMap.notes]||'').trim() : '';
    if (!sym || !price || !side) continue;

    const key = (date||'nodate') + '|' + sym;
    if (!opens[key]) opens[key] = [];

    if (side === 'B') {
      opens[key].push({ price, qty, time, date, comm, notes });
    } else if (side === 'S' && opens[key].length > 0) {
      const op = opens[key].shift();
      const usedQty = Math.min(qty, op.qty);
      const pnl = parseFloat(((price - op.price)*usedQty - comm - op.comm).toFixed(2));
      let duration = '';
      if (op.time && time) {
        const [eh,em]=op.time.split(':').map(Number);
        const [xh,xm]=time.split(':').map(Number);
        let mins=(xh*60+xm)-(eh*60+em); if(mins<0)mins+=1440;
        const hh=Math.floor(mins/60),mm=mins%60;
        duration = hh>0?`${hh}h ${mm}m`:`${mm}m`;
      }
      result.push({
        id: Date.now()+Math.floor(Math.random()*100000),
        date: op.date||date||today.toISOString().slice(0,10),
        sym, dir:'long', entry:op.price, exit:price, qty:usedQty,
        pnl, sl:0, tp:0, rr:0,
        entryTime:op.time, exitTime:time, duration,
        reason:'', notes:op.notes||notes, mood:'', rating:0, img:''
      });
    }
  }

  if (!result.length) { alert('No matched Buy→Sell pairs found. Check your Side mapping.'); return; }
  wizShowPreview(result.reverse(), 'mapping');
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.openImportWizard   = openImportWizard;
window.closeImportWizard  = closeImportWizard;
window.wizGoStep          = wizGoStep;
window.wizSelectFormat    = wizSelectFormat;
window.parseDaytradeFormat= parseDaytradeFormat;
window.parseOrdersFile    = parseOrdersFile;
window.handleXlsImport    = handleXlsImport;
window.handleDaytradeImport = handleDaytradeImport;
window.handleManualImport = handleManualImport;
window.wizShowPreview     = wizShowPreview;
window.wizConfirmImport   = wizConfirmImport;
window._doWizImport       = _doWizImport;
window.buildMappingUI     = buildMappingUI;
window.wizOnMapChange     = wizOnMapChange;
window.wizDoManualImport  = wizDoManualImport;
window.autoDetectMapping  = autoDetectMapping;