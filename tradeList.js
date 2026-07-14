// ─── tradeList.js ──────────────────────────────────────────────────────────
// Extracted from EdgeBook_v29.html — Trade List + Grouping module
//
// External globals this module reads (must remain defined in the main file):
//   trades              — global array (mutated by deleteGroup/deleteSelected)
//   getFilteredTrades() — returns time-filtered trades array
//   save()              — persists trades[], calls updateStats()
//   deleteTrade(id)     — confirm + delete single trade by id
//   openEdit(id)        — opens edit modal for a trade (tradeForm.js)
//   fmtDate(d)          — formats YYYY-MM-DD → "Jan 5" display string
//   escHtml(s)          — escapes HTML special chars
//   zoomImg(src)        — lightbox overlay for images
//   toast(msg)          — shows toast notification
//
// Public surface (called from main file or inline onclick strings):
//   renderLog()         — renders Trades page grouped table
//   renderHomeList()    — renders Home page latest-trades table
//   toggleExpandRow(id) — expand/collapse a group row
//   onGroupCbChange(cb) — group checkbox change handler
//   toggleSelectAll(cb) — select-all checkbox handler
//   deleteGroup(ids)    — delete all trades in a group
//   deleteSelected()    — delete all checked trades
// ────────────────────────────────────────────────────────────────────────────

// ── renderLog (lines 1444–1568 in source)
function renderLog() {
  const filtDir   = document.getElementById('filt-dir')?.value   || '';
  const filtRes   = document.getElementById('filt-res')?.value   || '';
  const filtMonth = document.getElementById('filt-month')?.value || '';
  const filtSym   = (document.getElementById('filt-sym')?.value  || '').trim().toUpperCase();
  const filtPrice = document.getElementById('filt-price')?.value || '';
  const filtHour  = document.getElementById('filt-hour')?.value  || '';
  let list = getFilteredTrades().filter(t => {
    if (filtDir && t.dir !== filtDir) return false;
    if (filtRes === 'win' && t.pnl <= 0) return false;
    if (filtRes === 'loss' && t.pnl >= 0) return false;
    if (filtMonth && !t.date.startsWith(filtMonth)) return false;
    if (filtSym && !t.sym.includes(filtSym)) return false;
    if (filtPrice) {
      const [pMin, pMax] = filtPrice.split('-').map(Number);
      if (!t.entry || t.entry < pMin || t.entry >= pMax) return false;
    }
    if (filtHour) {
      const h = parseInt(filtHour);
      const m = t.entryTime?.match(/^(\d{1,2}):/);
      if (!m || parseInt(m[1]) !== h) return false;
    }
    return true;
  });
  const el = document.getElementById('trades-list');
  if (!list.length) { el.innerHTML = '<div class="empty">No trades match the filter</div>'; return; }

  list.sort((a, b) => b.date.localeCompare(a.date) || (b.entryTime||'').localeCompare(a.entryTime||''));

  // Group by date+sym
  const groupMap = {};
  const groupOrder = [];
  list.forEach(t => {
    const key = t.date + '|' + t.sym;
    if (!groupMap[key]) { groupMap[key] = { date: t.date, sym: t.sym, key, trades: [] }; groupOrder.push(key); }
    groupMap[key].trades.push(t);
  });

  // Group by year
  const years = [];
  const byYear = {};
  groupOrder.forEach(key => {
    const g = groupMap[key];
    const y = g.date ? g.date.slice(0,4) : 'Unknown';
    if (!byYear[y]) { byYear[y] = []; years.push(y); }
    byYear[y].push(g);
  });

  const thead = `<thead><tr>
    <th style="width:32px"><input type="checkbox" id="select-all-cb-inner" onchange="toggleSelectAll(this)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--text)"></th>
    <th class="col-date-hd">Date</th><th>Symbol</th><th>Dir</th>
    <th>Trades</th><th>Shares traded</th><th>P&amp;L</th><th>% P&amp;L</th><th></th>
  </tr></thead>`;

  let html = '';

  years.forEach((year, yi) => {
    const yearGroups = byYear[year];
    const yearTrades = yearGroups.flatMap(g => g.trades);
    const yearPnl = yearTrades.reduce((s,x)=>s+x.pnl-(typeof calcCommission === 'function' ? calcCommission(x) : 0),0); // net
    const yearPnlCls = yearPnl>0?'var(--green)':yearPnl<0?'var(--red)':'var(--text3)';

    html += `<div style="${yi>0?'margin-top:1.75rem':''}">
      <div style="position:sticky;top:52px;z-index:10;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.6rem">
          <span style="font-size:20px;font-weight:700;color:var(--text2);letter-spacing:.18em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${year}</span>
          <span style="display:flex;align-items:baseline;gap:14px">
            <span style="font-size:11px;color:var(--text3)">${yearTrades.length} trade${yearTrades.length!==1?'s':''}</span>
            <span style="font-size:12px;font-weight:600;color:${yearPnlCls}" title="Net of fees">${yearPnl>0?'+':yearPnl<0?'-':''}$${Math.abs(yearPnl).toLocaleString('en-US',{maximumFractionDigits:0})} <span style="font-size:9px;color:var(--text3);font-weight:400">net</span></span>
          </span>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <table class="trade-table">${thead}<tbody>`;

    yearGroups.forEach(g => {
      const ts = g.trades;
      const gid = (g.date + '_' + g.sym).replace(/[^a-zA-Z0-9]/g,'_');
      const totalPnl = ts.reduce((s,t)=>s+t.pnl,0);
      const totalQty  = ts.reduce((s,t)=>s+(t.qty||0),0);
      const pnlCls  = totalPnl>0?'pos':totalPnl<0?'neg':'';
      const pnlSign = totalPnl>0?'+':totalPnl<0?'-':'';
      // Gross % P&L — no fee deduction
      const pctVals = ts.filter(t=>t.entry&&t.qty).map(t=>t.pnl/(t.entry*t.qty)*100);
      const avgPct  = pctVals.length ? pctVals.reduce((a,b)=>a+b,0)/pctVals.length : null;
      const pctStr  = avgPct!==null ? (avgPct>=0?'+':'')+avgPct.toFixed(2)+'%' : '—';
      const allDirs = ts.every(t=>t.dir==='long')?'long':ts.every(t=>t.dir==='short')?'short':'mixed';
      const dirBadge = allDirs==='mixed'
        ? `<span class="dir-badge" style="background:var(--bg2);color:var(--text3)">Mixed</span>`
        : `<span class="dir-badge ${allDirs==='long'?'long-badge':'short-badge'}">${allDirs==='long'?'Long':'Short'}</span>`;

      const tradeIds = ts.map(t=>t.id).join(',');

      // Date as dd/mm/yyyy
      const [y,m,d] = g.date.split('-');
      const dateFmt = `${d}/${m}/${y}`;

      // Shared style for all non-P&L cells — same font, size, weight, color
      const cellStyle = 'font-size:13px;font-weight:400;color:var(--text2)';
      const tdPad     = 'padding:10px 12px';

      html += `
        <tr class="data-row" onclick="toggleExpandRow('${gid}')">
          <td style="${tdPad}" onclick="event.stopPropagation()">
            <input type="checkbox" class="row-cb group-cb" data-ids="${tradeIds}" onchange="onGroupCbChange(this)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--text)">
          </td>
          <td style="${tdPad}"><span style="${cellStyle}">${dateFmt}</span></td>
          <td style="${tdPad}"><span style="${cellStyle}">${g.sym}</span></td>
          <td style="${tdPad}">${dirBadge}</td>
          <td style="${tdPad};text-align:center" class="col-num">${ts.length}</td>
          <td style="${tdPad};text-align:center" class="col-num">${totalQty ? totalQty.toLocaleString() : '—'}</td>
          <td style="${tdPad}"><span class="col-pnl ${pnlCls}" style="font-size:13px;font-weight:400">${pnlSign}$${Math.abs(totalPnl).toFixed(2)}</span></td>
          <td style="${tdPad}"><span style="${cellStyle}">${pctStr}</span></td>
          <td style="${tdPad};white-space:nowrap;width:1px">
            <button title="Delete" data-ids="${tradeIds}" onclick="event.stopPropagation();deleteGroup(this.dataset.ids)"
              style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text);opacity:.55;transition:opacity .15s"
              onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.55'">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </td>
        </tr>
        <tr class="trade-expand-row" id="expand-${gid}" onclick="event.stopPropagation()">
          <td colspan="9">${buildGroupPanel(ts)}</td>
        </tr>`;
    });

    html += '</tbody></table></div></div>';
  });

  el.innerHTML = html;
  document.getElementById('bulk-bar').style.display = 'flex';
  document.getElementById('sel-count').textContent = '0 selected';
  const selAllCbInner = document.getElementById('select-all-cb-inner');
  if (selAllCbInner) selAllCbInner.checked = false;
}

// ── buildGroupPanel (lines 1570–1624 in source)
function wrapAt40(str) {
  if (!str) return '';
  const words = str.split(' ');
  const lines = [];
  let line = '';
  words.forEach(word => {
    // if a single word itself is >40 chars, break it hard
    while (word.length > 40) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, 40));
      word = word.slice(40);
    }
    if ((line + (line ? ' ' : '') + word).length > 40) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  });
  if (line) lines.push(line);
  return lines.join('<br>');
}

function buildGroupPanel(ts) {
  const rows = ts.map((t, i) => {
    const pnlCls  = t.pnl>0?'pos':t.pnl<0?'neg':'';
    const pnlSign = t.pnl>0?'+':t.pnl<0?'-':'';
    const allImgs = t.imgs && t.imgs.length ? t.imgs : (t.img ? [t.img] : []);
    const hasExtra = t.notes || t.reason || t.mood || allImgs.length;
    const isLast   = i === ts.length - 1;

    const dataRow = `<tr style="background:var(--bg2)${!hasExtra && !isLast ? ';border-bottom:1px solid var(--border)' : ''}">
      <td style="padding-right:4px"><span class="dir-badge ${t.dir==='long'?'long-badge':'short-badge'}" style="font-size:10px;padding:2px 7px">${t.dir==='long'?'Long':'Short'}</span></td>
      <td class="col-num" style="padding-left:4px">${t.entryTime||'—'} → ${t.exitTime||'—'}</td>
      <td class="col-num">${t.entry?'$'+Number(t.entry).toFixed(2):'—'}</td>
      <td class="col-num">${t.exit?'$'+Number(t.exit).toFixed(2):'—'}</td>
      <td class="col-num">${t.qty?t.qty.toLocaleString():'—'}</td>
      <td><span class="col-pnl ${pnlCls}" style="font-size:13px">${pnlSign}$${Math.abs(t.pnl).toFixed(2)}</span></td>
      <td style="white-space:nowrap;width:1px;padding-left:16px">
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <button title="Edit" data-id="${t.id}" onclick="event.stopPropagation();openEdit(+this.dataset.id||this.dataset.id)"
            style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text);opacity:.55;transition:opacity .15s"
            onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.55'">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
          <button title="Delete" data-id="${t.id}" onclick="event.stopPropagation();deleteTrade(+this.dataset.id||this.dataset.id)"
            style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text);opacity:.55;transition:opacity .15s"
            onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.55'">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;

    const extraRow = hasExtra ? `<tr style="background:var(--bg2)${!isLast ? ';border-bottom:1px solid var(--border)' : ''}">
      <td colspan="7" style="padding:2px 12px 8px;word-break:break-word;overflow-wrap:break-word">
        <div style="display:flex;flex-direction:column;gap:4px">
          ${t.mood   ? `<div style="font-size:11px;color:var(--text3)"><strong style="color:var(--text2)">Mood:</strong> ${escHtml(t.mood)}</div>` : ''}
          ${t.reason ? `<div style="font-size:11px;color:var(--text3)"><strong style="color:var(--text2)">Setup:</strong> ${wrapAt40(escHtml(t.reason))}</div>` : ''}
          ${t.notes  ? `<div style="font-size:11px;color:var(--text3)"><strong style="color:var(--text2)">Thoughts &amp; Feelings:</strong> ${wrapAt40(escHtml(t.notes))}</div>` : ''}
          ${allImgs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${allImgs.map(src=>`<img src="${src}" style="max-height:80px;max-width:120px;border-radius:6px;border:1px solid var(--border);object-fit:cover;cursor:zoom-in" onclick="event.stopPropagation();zoomImg(this.src)">`).join('')}</div>` : ''}
        </div>
      </td>
    </tr>` : '';

    return dataRow + extraRow;
  }).join('');

  const sub_thead = `<tr style="background:var(--bg2)">
    <th style="font-size:12px;padding:6px 12px 6px 12px;background:var(--bg2);border-bottom:1px solid var(--border)">Dir</th>
    <th style="font-size:12px;padding:6px 4px;background:var(--bg2);border-bottom:1px solid var(--border)">Time</th>
    <th style="font-size:12px;padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--border)">Entry</th>
    <th style="font-size:12px;padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--border)">Exit</th>
    <th style="font-size:12px;padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--border)">Qty</th>
    <th style="font-size:12px;padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--border)">P&L</th>
    <th style="background:var(--bg2);border-bottom:1px solid var(--border);width:1px;white-space:nowrap"></th>
  </tr>`;

  return `<div style="padding:4px 0 6px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>${sub_thead}</thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── onGroupCbChange (lines 1626–1632 in source)
function onGroupCbChange(cb) {
  const ids = cb.dataset.ids.split(',');
  document.querySelectorAll('.row-cb').forEach(c => {
    if (ids.includes(String(c.dataset.id))) c.checked = cb.checked;
  });
  updateSelCount();
}

// ── deleteGroup (lines 1634–1639 in source)
function deleteGroup(idsStr) {
  const ids = idsStr.split(',');
  if (!confirm(`Delete ${ids.length} trade${ids.length>1?'s':''}?`)) return;
  trades = trades.filter(t => !ids.includes(String(t.id)));
  save(); renderLog(); renderHomeList();
}

// ── updateSelCount (lines 1641–1649 in source)
function updateSelCount() {
  const cbs = document.querySelectorAll('.group-cb');
  const sel = [...cbs].filter(c => c.checked).length;
  const totalTrades = [...document.querySelectorAll('.group-cb:checked')].reduce((s,c)=>s+c.dataset.ids.split(',').length,0);
  document.getElementById('sel-count').textContent = totalTrades + ' trade' + (totalTrades!==1?'s':'') + ' selected';
  const allChecked = sel === cbs.length && cbs.length > 0;
  const cbInner = document.getElementById('select-all-cb-inner');
  if (cbInner) cbInner.checked = allChecked;
}

// ── toggleSelectAll (lines 1651–1657 in source)
function toggleSelectAll(cb) {
  const checked = cb.checked;
  document.querySelectorAll('.group-cb').forEach(c => c.checked = checked);
  const cbInner = document.getElementById('select-all-cb-inner');
  if (cbInner) cbInner.checked = checked;
  updateSelCount();
}

// ── deleteSelected (lines 1659–1667 in source)
function deleteSelected() {
  const ids = [...document.querySelectorAll('.group-cb:checked')].flatMap(c => c.dataset.ids.split(','));
  if (!ids.length) { alert('No trades selected'); return; }
  if (!confirm(`Delete ${ids.length} trade${ids.length > 1 ? 's' : ''}?`)) return;
  trades = trades.filter(t => !ids.includes(String(t.id)));
  save();
  renderLog();
  renderHomeList();
}

// ── renderHomeList (lines 3864–3921 in source)
function renderHomeList() {
  const el = document.getElementById('home-trades-list');
  const ft = getFilteredTrades();
  if (!ft.length) { el.innerHTML = '<div class="empty">No trades in this period</div>'; return; }

  // Sort newest first, group by date+sym, take top 5 groups
  ft.sort((a,b) => b.date.localeCompare(a.date) || (b.entryTime||'').localeCompare(a.entryTime||''));
  const groupMap = {};
  const groupOrder = [];
  ft.forEach(t => {
    const key = t.date + '|' + t.sym;
    if (!groupMap[key]) { groupMap[key] = { date: t.date, sym: t.sym, trades: [] }; groupOrder.push(key); }
    groupMap[key].trades.push(t);
  });
  const maxGroups = (window.screen.width >= 1200 && window.screen.width <= 1380) ? 3 : 5;
  const groups = groupOrder.slice(0, maxGroups).map(k => groupMap[k]);

  const rows = groups.map(g => {
    const ts = g.trades;
    const gid = ('home_' + g.date + '_' + g.sym).replace(/[^a-zA-Z0-9]/g,'_');
    // Gross P&L — no commission deduction
    const totalPnl = ts.reduce((s,t) => s + t.pnl, 0);
    const wins = ts.filter(t=>t.pnl>0).length;
    const wr = ts.length ? Math.round(wins/ts.length*100) : 0;
    const pnlCls = totalPnl>0?'pos':totalPnl<0?'neg':'';
    const pnlSign = totalPnl>0?'+':totalPnl<0?'-':'';
    const allDirs = ts.every(t=>t.dir==='long')?'long':ts.every(t=>t.dir==='short')?'short':'mixed';
    const dirBadge = allDirs==='mixed'
      ? `<span class="dir-badge" style="background:var(--bg2);color:var(--text3)">Mixed</span>`
      : `<span class="dir-badge ${allDirs==='long'?'long-badge':'short-badge'}">${allDirs==='long'?'Long':'Short'}</span>`;

    // Date as dd/mm/yyyy
    const [y, m, d] = g.date.split('-');
    const dateFmt = `${d}/${m}/${y}`;

    return `
      <tr class="data-row" onclick="toggleExpandRow('${gid}')">
        <td><span class="col-date">${dateFmt}</span></td>
        <td><span class="col-sym">${g.sym}</span></td>
        <td>${dirBadge}</td>
        <td class="col-num">${ts.length}</td>
        <td><span class="col-pnl ${pnlCls}" style="font-size:13px">${pnlSign}$${Math.abs(totalPnl).toFixed(2)}</span></td>
        <td class="col-num">${ts.length>1?`<span style="color:${wr>=50?'var(--green)':'var(--red)'}">${wr}%</span>`:'—'}</td>
      </tr>
      <tr class="trade-expand-row" id="expand-${gid}">
        <td colspan="6">${buildGroupPanel(ts)}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="trade-table">
      <thead><tr>
        <th class="col-date-hd">Date</th><th>Symbol</th><th>Dir</th>
        <th>Trades</th><th>P&amp;L</th><th>Win Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── buildExpandPanel (lines 3923–3946 in source)
function buildExpandPanel(t) {
  const note = t.reason || t.notes ? `
    <div class="expand-note-box">${t.reason ? '<strong>Setup:</strong> ' + escHtml(t.reason) : ''}${t.reason && t.notes ? '<br>' : ''}${t.notes ? '<strong>Notes:</strong> ' + escHtml(t.notes) : ''}</div>` : '';
  const allImgs = t.imgs && t.imgs.length ? t.imgs : (t.img ? [t.img] : []);
  const imgHtml = allImgs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">`
    + allImgs.map((src, i) =>
        `<img src="${src}" style="max-height:90px;max-width:140px;border-radius:6px;border:1px solid var(--border);object-fit:cover;cursor:zoom-in"
          onclick="event.stopPropagation();zoomImg(this.src)">`
      ).join('') + `</div>` : '';
  return `<div class="expand-grid">
    <div class="expand-kv"><span class="expand-k">Entry Time</span><span class="expand-v">${t.entryTime||'—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Exit Time</span><span class="expand-v">${t.exitTime||'—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Duration</span><span class="expand-v">${t.duration||'—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Stop Loss</span><span class="expand-v">${t.sl ? '$'+Number(t.sl).toFixed(2) : '—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Take Profit</span><span class="expand-v">${t.tp ? '$'+Number(t.tp).toFixed(2) : '—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Mood</span><span class="expand-v">${t.mood||'—'}</span></div>
    <div class="expand-kv"><span class="expand-k">Rating</span><span class="expand-v" style="color:var(--amber)">${t.rating ? '★'.repeat(t.rating)+'☆'.repeat(5-t.rating) : '—'}</span></div>
  </div>
  ${note}${imgHtml}
  <div class="expand-actions-row">
    <button class="btn-edit" data-id="${t.id}" onclick="event.stopPropagation();openEdit(+this.dataset.id||this.dataset.id)">Edit</button>
    <button class="btn-sm"   data-id="${t.id}" onclick="event.stopPropagation();deleteTrade(+this.dataset.id||this.dataset.id)">Delete</button>
  </div>`;
}

// ── toggleExpandRow (lines 3948–3954 in source)
function toggleExpandRow(safeId) {
  const row = document.getElementById('expand-' + safeId);
  if (!row) return;
  const isOpen = row.classList.contains('open');
  document.querySelectorAll('.trade-expand-row.open').forEach(r => r.classList.remove('open'));
  if (!isOpen) row.classList.add('open');
}

// ── deleteTrade (from HTML step-4)
function deleteTrade(id) {
  if (!confirm('Permanently delete this trade?')) return;
  trades = trades.filter(t => String(t.id) !== String(id));
  save();
  const logVisible = document.getElementById('tab-log').style.display !== 'none';
  if (logVisible) renderLog(); else renderHomeList();
}

// ── openDetail (from HTML step-4)
function openDetail(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  document.getElementById('modal-content').innerHTML = `
    <h3>${t.sym} — ${t.dir==='long'?'📈 Long':'📉 Short'} — ${t.date}</h3>
    <div class="detail-row"><span class="detail-key">Direction</span><span><span class="dir-badge ${t.dir==='long'?'long-badge':'short-badge'}">${t.dir==='long'?'Long':'Short'}</span></span></div>
    <div class="detail-row"><span class="detail-key">Entry Price</span><span>${t.entry ? '$'+Number(t.entry).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}${t.entryTime?' · ⏰ '+t.entryTime:''}</span></div>
    <div class="detail-row"><span class="detail-key">Exit Price</span><span>${t.exit ? '$'+Number(t.exit).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}${t.exitTime?' · ⏰ '+t.exitTime:''}</span></div>
    ${t.duration?`<div class="detail-row"><span class="detail-key">Duration</span><span>⏱ ${t.duration}</span></div>`:''}
    <div class="detail-row"><span class="detail-key">Shares</span><span>${(t.qty||0).toLocaleString()}</span></div>
    <div class="detail-row"><span class="detail-key">Stop Loss</span><span>${t.sl ? '$'+Number(t.sl).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</span></div>
    <div class="detail-row"><span class="detail-key">Take Profit</span><span>${t.tp ? '$'+Number(t.tp).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</span></div>
    <div class="detail-row"><span class="detail-key">R:R</span><span>${t.rr||'—'}</span></div>
    <div class="detail-row"><span class="detail-key">P&L Gross</span><span class="${t.pnl>0?'pos':t.pnl<0?'neg':''}" style="font-weight:600">${fmtFull(t.pnl)}</span></div>
    <div class="detail-row"><span class="detail-key">Fees</span><span class="neg" style="font-weight:600">-$${(typeof calcCommission === 'function' ? calcCommission(t) : 0).toFixed(2)}</span></div>
    <div class="detail-row"><span class="detail-key">P&L Net</span><span class="${(t.pnl-(typeof calcCommission === 'function' ? calcCommission(t) : 0))>0?'pos':(t.pnl-(typeof calcCommission === 'function' ? calcCommission(t) : 0))<0?'neg':''}" style="font-weight:600">${fmtFull(t.pnl-(typeof calcCommission === 'function' ? calcCommission(t) : 0))}</span></div>
    <div class="detail-row"><span class="detail-key">Mood</span><span>${t.mood||'—'}</span></div>
    <div class="detail-row"><span class="detail-key">Rating</span><span style="color:var(--amber)">${t.rating?'★'.repeat(t.rating)+'☆'.repeat(5-t.rating):'—'}</span></div>
    ${t.reason?'<div class="note-label">Setup / Reason</div><div class="note-box">'+escHtml(t.reason)+'</div>':''}
    ${t.notes?'<div class="note-label">Thoughts & Feelings</div><div class="note-box">'+escHtml(t.notes)+'</div>':''}
    ${(()=>{ const imgs = t.imgs&&t.imgs.length?t.imgs:(t.img?[t.img]:[]); return imgs.length?'<div class="note-label" style="margin-top:.85rem">Screenshots</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">'+imgs.map(src=>`<img src="${src}" style="height:140px;max-width:100%;border-radius:var(--radius-sm);border:1px solid var(--border);cursor:zoom-in;object-fit:cover" onclick="zoomImg(this.src)">`).join('')+'</div>':''; })()}`;
  document.getElementById('modal').classList.add('open');
}

// ── zoomImg (from HTML step-4)
function zoomImg(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  ov.onclick = () => ov.remove();
  const i = document.createElement('img');
  i.src = src; i.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px';
  ov.appendChild(i); document.body.appendChild(ov);
}

// ── escHtml (from HTML step-4)
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

// ── closeModal (from HTML step-4)
function closeModal(e) { if (e.target.id === 'modal') document.getElementById('modal').classList.remove('open'); }

// ── logBackPage / goBackFromLog / drillToLog (from HTML step-4)
// Depends on: showPage() from app.js (already on window)
let logBackPage = 'home';

function goBackFromLog() {
  const hf = document.getElementById('filt-hour');
  if (hf) hf.value = '';
  const pf = document.getElementById('filt-price');
  if (pf) pf.value = '';
  const backWrap = document.getElementById('log-back-wrap');
  if (backWrap) backWrap.style.display = 'none';
  showPage(logBackPage);
}

function drillToLog(backPage) {
  logBackPage = backPage;
  const label = document.getElementById('log-back-label');
  if (label) label.textContent = backPage === 'stats' ? 'Statistics' : backPage === 'cal' ? 'Calendar' : 'Home';
  const backWrap = document.getElementById('log-back-wrap');
  if (backWrap) backWrap.style.display = 'block';
  ['home','log','cal','stats'].forEach(id => {
    document.getElementById('tab-'+id).style.display = id==='log'?'block':'none';
  });
  document.getElementById('stats-hero').style.display = 'none';
  const rpFilters = document.getElementById('right-panel-filters');
  if (rpFilters) rpFilters.style.display = 'block';
  ['home','log','cal','stats'].forEach(id => {
    const btn = document.getElementById('sb-'+id);
    if (btn) btn.classList.toggle('active', id==='log');
  });
  renderLog();
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
// Required so that inline onclick="" attributes and calls from the main script
// (showPage, refreshAll, deleteTrade, bootstrap block) resolve correctly.
window.renderLog        = renderLog;
window.renderHomeList   = renderHomeList;
window.toggleExpandRow  = toggleExpandRow;
window.buildGroupPanel  = buildGroupPanel;
window.buildExpandPanel = buildExpandPanel;
window.onGroupCbChange  = onGroupCbChange;
window.toggleSelectAll  = toggleSelectAll;
window.updateSelCount   = updateSelCount;
window.deleteGroup      = deleteGroup;
window.deleteSelected   = deleteSelected;
window.deleteTrade      = deleteTrade;
window.openDetail       = openDetail;
window.zoomImg          = zoomImg;
window.escHtml          = escHtml;
window.closeModal       = closeModal;
window.logBackPage      = logBackPage;
window.goBackFromLog    = goBackFromLog;
window.drillToLog       = drillToLog;