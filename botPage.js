/**
 * botPage.js — Live Bot dashboard (read-only)
 * EdgeBook
 *
 * Shows what the trading backend (Firebase Functions) is doing, live:
 *   control/config            mode (DRY RUN / PAPER), kill switch, daily limits
 *   stats/{day}, {day}-dry    today's real and simulated P&L / trade count
 *   positions                 open and pending positions, with their stop
 *   signals (last 30)         every webhook signal and what the backend did with it
 *   trades (last 40)          closed trades
 *   alerts (last 10)          stop problems, missing heartbeats
 *   heartbeats                last message per symbol
 *
 * Read-only: Firestore rules allow only the owner to read these collections and
 * nobody to write them from the browser (see skeleton/firestore.rules).
 *
 * Depends on globals: _db (accounts.js). Public: renderBotPage(), stopBotPage().
 * Called from showPage() in pageShell.js. Loaded after settingsPage.js.
 */

const _bot = {
  unsubs: [],
  timer: null,
  data: {config: null, statsReal: null, statsDry: null, positions: [], signals: [], trades: [], alerts: [], heartbeats: [], errors: {}},
};

const _botEsc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const _botNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const _botMoney = (x) => {
  const n = _botNum(x);
  if (n === null) return '–';
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);
};
const _botPx = (x) => {
  const n = _botNum(x);
  return n === null ? '–' : n.toFixed(n < 1 ? 4 : 2);
};
const _botClass = (n) => (n > 0 ? 'bot-pos' : n < 0 ? 'bot-neg' : '');

function _botNyDay(ms) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms));
}
function _botNyTime(ms) {
  if (!ms) return '–';
  return new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(new Date(ms));
}
function _botTsMs(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return _botNum(ts);
}
function _botAge(ms) {
  if (!ms) return '–';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return s + 's';
  if (s < 5400) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h';
}

// ─── data listeners ─────────────────────────────────────────────

function _botListen(key, query, mapFn) {
  const un = query.onSnapshot(
    (snap) => { _bot.data[key] = mapFn(snap); delete _bot.data.errors[key]; _botDraw(); },
    (err) => { _bot.data.errors[key] = err && err.code ? err.code : String(err); _botDraw(); }
  );
  _bot.unsubs.push(un);
}

function _botStart() {
  if (_bot.unsubs.length || typeof _db === 'undefined') return;
  const day = _botNyDay(Date.now());
  const docData = (snap) => (snap.exists ? snap.data() : null);
  const list = (snap) => snap.docs.map((d) => ({id: d.id, ...d.data()}));

  _botListen('config', _db.collection('control').doc('config'), docData);
  _botListen('statsReal', _db.collection('stats').doc(day), docData);
  _botListen('statsDry', _db.collection('stats').doc(day + '-dry'), docData);
  _botListen('positions', _db.collection('positions'), list);
  _botListen('signals', _db.collection('signals').orderBy('receivedAt', 'desc').limit(30), list);
  _botListen('trades', _db.collection('trades').orderBy('closedAt', 'desc').limit(40), list);
  _botListen('alerts', _db.collection('alerts').orderBy('at', 'desc').limit(10), list);
  _botListen('heartbeats', _db.collection('heartbeats'), list);
  _bot.timer = setInterval(_botDraw, 15000); // keeps the "age" columns fresh
}

function stopBotPage() {
  _bot.unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
  _bot.unsubs = [];
  if (_bot.timer) clearInterval(_bot.timer);
  _bot.timer = null;
}

// ─── rendering ──────────────────────────────────────────────────

function renderBotPage() {
  const root = document.getElementById('tab-bot');
  if (!root) return;
  if (!document.getElementById('bot-style')) {
    const st = document.createElement('style');
    st.id = 'bot-style';
    st.textContent = `
      #tab-bot .bot-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:1rem}
      #tab-bot .bot-pill{font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 9px;border-radius:99px;border:1px solid var(--border2);color:var(--text2);text-transform:uppercase}
      #tab-bot .bot-pill.ok{color:var(--green);border-color:var(--green)}
      #tab-bot .bot-pill.warn{color:var(--amber);border-color:var(--amber)}
      #tab-bot .bot-pill.bad{color:var(--red);border-color:var(--red)}
      #tab-bot .bot-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:1.2rem}
      #tab-bot .bot-kpi{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:.8rem 1rem}
      #tab-bot .bot-kpi .l{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
      #tab-bot .bot-kpi .v{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
      #tab-bot .bot-kpi .s{font-size:11px;color:var(--text3);margin-top:2px}
      #tab-bot .bot-sec{margin-bottom:1.4rem}
      #tab-bot .bot-sec h3{font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin:0 0 .5rem}
      #tab-bot .bot-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)}
      #tab-bot table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
      #tab-bot th{text-align:left;font-size:11px;color:var(--text2);font-weight:600;padding:7px 10px;background:var(--bg2);white-space:nowrap}
      #tab-bot td{padding:7px 10px;border-top:1px solid var(--border);white-space:nowrap}
      #tab-bot td.wrap{white-space:normal;min-width:180px}
      #tab-bot .bot-empty{padding:14px;color:var(--text3);font-size:13px}
      #tab-bot .bot-pos{color:var(--green)} #tab-bot .bot-neg{color:var(--red)} #tab-bot .bot-mut{color:var(--text3)}
      #tab-bot .bot-err{background:rgba(216,90,48,.1);border:1px solid var(--red);color:var(--red);border-radius:var(--radius);padding:.6rem .9rem;margin-bottom:1rem;font-size:13px}
    `;
    document.head.appendChild(st);
  }
  _botStart();
  _botDraw();
}

function _botTable(headers, rows, emptyText) {
  if (!rows.length) return `<div class="bot-wrap"><div class="bot-empty">${_botEsc(emptyText)}</div></div>`;
  return `<div class="bot-wrap"><table><thead><tr>${headers.map((h) => `<th>${_botEsc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function _botDraw() {
  const root = document.getElementById('tab-bot');
  if (!root || root.style.display === 'none') return;
  const d = _bot.data;
  const cfg = d.config || {};
  const errKeys = Object.keys(d.errors);

  // mode pills
  const dry = cfg.dryRun !== false; // the backend default is DRY RUN
  const killed = cfg.killSwitch === true;
  const hbNow = d.heartbeats.map((h) => _botNum(h.receivedAt)).filter(Boolean);
  const lastHb = hbNow.length ? Math.max(...hbNow) : null;
  const hbSec = lastHb ? (Date.now() - lastHb) / 1000 : null;
  const hbPill = hbSec === null ? ['bad', 'no heartbeat'] : hbSec < 600 ? ['ok', 'heartbeat ' + _botAge(lastHb)] : ['warn', 'heartbeat ' + _botAge(lastHb)];

  // KPIs
  const sr = d.statsReal || {};
  const sd = d.statsDry || {};
  const pnl = _botNum(sr.realizedPnl) || 0;
  const maxLoss = _botNum(cfg.maxDailyLossUsd) || 20;
  const maxTrades = _botNum(cfg.maxTradesPerDay) || 10;
  const room = maxLoss + pnl;
  const kpis = [
    ['Today P&L (real)', `<span class="${_botClass(pnl)}">${_botMoney(pnl)}</span>`, dry ? 'DRY RUN is on: no real orders' : 'Paper account'],
    ['Trades today', `${_botNum(sr.tradesToday) || 0} / ${maxTrades}`, 'entries sent to the broker'],
    ['Room to daily loss limit', `<span class="${room <= maxLoss * 0.25 ? 'bot-neg' : ''}">${_botMoney(Math.max(0, room))}</span>`, 'limit ' + _botMoney(maxLoss)],
    ['Open positions', String(d.positions.length), d.positions.filter((p) => p.state === 'entry_pending').length + ' pending'],
    ['Simulated today', `<span class="${_botClass(_botNum(sd.realizedPnl) || 0)}">${_botMoney(_botNum(sd.realizedPnl) || 0)}</span>`, (_botNum(sd.tradesToday) || 0) + ' dry-run entries'],
  ].map(([l, v, s]) => `<div class="bot-kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${_botEsc(s)}</div></div>`).join('');

  // positions
  const posRows = d.positions.slice().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).map((p) => {
    const waiting = p.stopError === 'waiting_regular_hours';
    const stopState = p.stopClientOrderId ? 'at broker' : (waiting ? 'waits for 09:30 NY' : (p.stopError ? p.stopError : 'none'));
    const stopCls = p.stopClientOrderId ? 'bot-pos' : (waiting ? 'bot-mut' : (p.state === 'open' ? 'bot-neg' : 'bot-mut'));
    return `<tr><td><b>${_botEsc(p.symbol || p.id)}</b>${p.dryRun ? ' <span class="bot-mut">(sim)</span>' : ''}</td>
      <td>${_botEsc(p.state)}</td><td>${_botEsc(p.filledQty || p.qty)}</td>
      <td>${_botPx(p.entryFillPrice || p.entryPrice)}</td><td>${_botPx(p.stopLevel)}</td>
      <td class="${stopCls}">${_botEsc(stopState)}</td><td>${_botNyTime(p.openedAt)}</td></tr>`;
  });

  // signals
  const sigRows = d.signals.map((s) => {
    const sig = s.signal || {};
    const out = s.outcome || {};
    const ms = _botTsMs(s.receivedAt);
    const status = s.status || '';
    const cls = status === 'rejected' || status === 'error' ? 'bot-neg' : (status === 'accepted' || status === 'entry_placed' || status === 'following_up' ? 'bot-pos' : 'bot-mut');
    const qty = out.order && out.order.orderQuantity ? out.order.orderQuantity : '';
    const why = out.reason || (s.followUp && s.followUp.reason) || '';
    return `<tr><td>${_botNyTime(ms)}</td><td><b>${_botEsc(sig.symbol)}</b></td><td>${_botEsc(sig.event)}</td>
      <td class="${cls}">${_botEsc(status)}${s.dryRun ? ' (sim)' : ''}</td>
      <td class="wrap ${cls}">${_botEsc(why)}</td><td>${_botPx(sig.price)}</td><td>${_botPx(sig.stop)}</td><td>${_botEsc(qty)}</td>
      <td class="bot-mut">${_botEsc(sig.session)}</td></tr>`;
  });

  // trades (today first; show all of the last 40 with the day visible)
  const today = _botNyDay(Date.now());
  const tradeRows = d.trades.map((t) => {
    const ms = _botNum(t.closedAt);
    const pn = _botNum(t.pnl);
    const isToday = ms && _botNyDay(ms) === today;
    return `<tr><td>${ms ? (isToday ? '' : _botNyDay(ms) + ' ') + _botNyTime(ms) : '–'}</td><td><b>${_botEsc(t.symbol)}</b></td>
      <td>${_botEsc(t.qty)}</td><td>${_botPx(t.entryPrice)}</td><td class="${_botClass(pn)}">${_botMoney(pn)}</td><td>${_botEsc(t.exitReason)}</td></tr>`;
  });

  // alerts
  const alertRows = d.alerts.map((a) => `<tr><td>${_botNyTime(_botNum(a.at))}</td><td class="bot-neg">${_botEsc(a.type)}</td>
    <td><b>${_botEsc(a.symbol)}</b></td><td class="wrap">${_botEsc(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail)}</td></tr>`);

  // heartbeats
  const hbRows = d.heartbeats.map((h) => {
    const ms = _botNum(h.receivedAt);
    const sec = ms ? (Date.now() - ms) / 1000 : null;
    const cls = sec === null ? 'bot-neg' : sec < 600 ? 'bot-pos' : 'bot-neg';
    return `<tr><td><b>${_botEsc(h.id)}</b></td><td class="${cls}">${_botAge(ms)} ago</td><td>${_botEsc(h.tf)}</td><td class="bot-mut">${_botEsc(h.strategy)}</td></tr>`;
  });

  root.innerHTML = `
    <div class="bot-head">
      <div class="page-title">Live Bot</div>
      <span class="bot-pill ${dry ? 'warn' : 'ok'}">${dry ? 'DRY RUN' : 'PAPER'}</span>
      <span class="bot-pill ${killed ? 'bad' : 'ok'}">${killed ? 'KILL SWITCH ON' : 'entries enabled'}</span>
      <span class="bot-pill ${hbPill[0]}">${_botEsc(hbPill[1])}</span>
      <span class="bot-mut" style="font-size:12px;margin-left:auto">NY time &middot; read-only</span>
    </div>
    ${errKeys.length ? `<div class="bot-err">Cannot read: ${errKeys.map(_botEsc).join(', ')}. ${_botEsc(d.errors[errKeys[0]])}. Check that you are signed in with the owner account and the Firestore rules are published.</div>` : ''}
    <div class="bot-kpis">${kpis}</div>
    <div class="bot-sec"><h3>Open positions</h3>${_botTable(['Symbol', 'State', 'Qty', 'Entry', 'Stop', 'Stop at broker', 'Opened (NY)'], posRows, 'No open positions.')}</div>
    <div class="bot-sec"><h3>Recent signals</h3>${_botTable(['Time (NY)', 'Symbol', 'Event', 'Status', 'Reason', 'Price', 'Stop', 'Qty', 'Session'], sigRows, 'No signals yet.')}</div>
    <div class="bot-sec"><h3>Closed trades</h3>${_botTable(['Closed (NY)', 'Symbol', 'Qty', 'Entry', 'P&L', 'Exit reason'], tradeRows, 'No closed trades yet.')}</div>
    <div class="bot-sec"><h3>Alerts</h3>${_botTable(['Time (NY)', 'Type', 'Symbol', 'Detail'], alertRows, 'No alerts.')}</div>
    <div class="bot-sec"><h3>Heartbeats</h3>${_botTable(['Symbol', 'Last message', 'Timeframe', 'Strategy'], hbRows, 'No heartbeats received.')}</div>
  `;
}

window.renderBotPage = renderBotPage;
window.stopBotPage = stopBotPage;
