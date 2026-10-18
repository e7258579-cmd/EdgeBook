/**
 * botPage.js — Live Bot dashboard
 * EdgeBook
 *
 * Shows what the trading backend (Firebase Functions) is doing, live, and lets the owner
 * control it in a limited, safe way.
 *
 * Reads (all collections are readable only by the owner, see skeleton/firestore.rules):
 *   control/config            mode (DRY RUN / PAPER / LIVE), kill switch, limits
 *   stats/{day}, -dry, -live  today's counters
 *   positions, signals (30), trades (40), alerts (10), heartbeats
 *
 * Writes (version 2): ONLY control/config and an audit entry in control_log. The Firestore rules
 * allow just a short list of fields, with number ranges, and never the `environment` field; DRY_RUN
 * can be switched off only while the environment is "paper". Everything else stays read-only.
 *
 * The account switch of the app (Live / Demo) selects what is shown: Demo = Paper and simulated
 * activity, Live = real-money activity (documents without an `env` field are Paper).
 *
 * Depends on globals: _db (accounts.js), firebase. Public: renderBotPage(), stopBotPage().
 * Called from showPage() in pageShell.js and from switchAccount() in accounts.js.
 */

const _bot = {
  unsubs: [],
  timer: null,
  view: null,
  mounted: false,
  data: null,
  ui: {filter: 'all', draft: {}, pending: null, msg: null, busy: false, cfgSig: ''},
};

function _botResetData() {
  _bot.data = {config: null, statsReal: null, statsDry: null, positions: [], signals: [], trades: [], alerts: [], heartbeats: [], errors: {}, updatedAt: null};
}
_botResetData();

const _botEsc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _botNum = (x) => (x !== null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
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

// The account switch of the app (Live / Demo) also selects what the bot page shows.
function _botView() {
  const a = (typeof activeAccount !== 'undefined') ? activeAccount : (localStorage.getItem('edgebook_active_account') || 'live');
  return a === 'live' ? 'live' : 'paper';
}
const _botEnvOf = (d) => (d && d.env) || 'paper';

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

// What a rejection / outcome reason means, in plain words.
const _BOT_REASONS = {
  daily_loss_limit: 'Daily loss limit reached',
  max_trades_per_day: 'Maximum trades per day reached',
  kill_switch: 'Kill switch is on',
  rate_limit: 'Too many orders in the last minute',
  chase_too_far: 'Price ran too far above the trigger',
  stop_too_far: 'Stop too far below the price (safety net)',
  risk_too_high: 'Risk above the per-trade ceiling',
  qty_below_min: 'Size below the minimum',
  qty_zero: 'Computed size is zero',
  invalid_stop: 'Stop is not below the price',
  stale_signal: 'Signal was too old',
  already_in_position: 'Already in a position on this symbol',
  broker_rejected: 'The broker rejected the order',
  environment_mismatch: 'Account type does not match the setting',
  place_order_failed: 'The order could not be placed',
  order_state_unknown: 'Order state unknown: check by hand',
  entry_never_filled: 'Entry never filled',
  entry_cancelled_before_fill: 'Entry cancelled before it filled',
  no_position: 'No open position',
  not_higher: 'Stop not higher than the current one',
  stop_deferred_until_regular_hours: 'Stop waits for 09:30',
  stored_until_filled: 'Stop stored until the entry fills',
};

// Editable limits: key, label, min, max, step. The ranges must match skeleton/firestore.rules.
const _BOT_LIMITS = [
  ['maxDailyLossUsd', 'Daily loss limit (USD)', 1, 100, 1],
  ['maxTradesPerDay', 'Max trades per day', 1, 20, 1],
  ['maxShares', 'Max shares per entry', 1, 100, 1],
  ['minShares', 'Min shares per entry (0 = off)', 0, 50, 1],
  ['maxRiskPerTradeUsd', 'Max risk per trade (USD, 0 = off)', 0, 50, 1],
  ['riskPct', 'Risk per trade (% of equity)', 0.1, 5, 0.1],
  ['maxStopDistancePct', 'Reject a stop farther than (%, 0 = off)', 0, 90, 1],
  ['maxChaseUsd', 'Max chase above the trigger (USD)', 0, 1, 0.05],
];

// The backend defaults (skeleton/functions/lib/config.js), used when control/config has no value.
const _BOT_DEFAULTS = {maxDailyLossUsd: 20, maxTradesPerDay: 10, maxShares: 25, minShares: 5, maxRiskPerTradeUsd: 10, riskPct: 1, maxStopDistancePct: 50, maxChaseUsd: 0.2};

// ─── data listeners ─────────────────────────────────────────────

function _botListen(key, query, mapFn) {
  const un = query.onSnapshot(
    (snap) => { _bot.data[key] = mapFn(snap); delete _bot.data.errors[key]; _bot.data.updatedAt = Date.now(); _botDraw(); },
    (err) => { _bot.data.errors[key] = err && err.code ? err.code : String(err); _botDraw(); }
  );
  _bot.unsubs.push(un);
}

function _botStart() {
  if (_bot.unsubs.length || typeof _db === 'undefined') return;
  const day = _botNyDay(Date.now());
  const view = _botView();
  _bot.view = view;
  const docData = (snap) => (snap.exists ? snap.data() : null);
  const list = (snap) => snap.docs.map((d) => ({id: d.id, ...d.data()}));

  _botListen('config', _db.collection('control').doc('config'), docData);
  _botListen('statsReal', _db.collection('stats').doc(view === 'live' ? day + '-live' : day), docData);
  if (view !== 'live') _botListen('statsDry', _db.collection('stats').doc(day + '-dry'), docData);
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

// ─── mount (once) ───────────────────────────────────────────────

function _botStyle() {
  if (document.getElementById('bot-style')) return;
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
    #tab-bot .bot-sec h3{font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin:0 0 .5rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    #tab-bot .bot-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)}
    #tab-bot table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
    #tab-bot th{text-align:left;font-size:11px;color:var(--text2);font-weight:600;padding:7px 10px;background:var(--bg2);white-space:nowrap}
    #tab-bot td{padding:7px 10px;border-top:1px solid var(--border);white-space:nowrap}
    #tab-bot td.wrap{white-space:normal;min-width:180px}
    #tab-bot .bot-empty{padding:14px;color:var(--text3);font-size:13px}
    #tab-bot .bot-pos{color:var(--green)} #tab-bot .bot-neg{color:var(--red)} #tab-bot .bot-mut{color:var(--text3)}
    #tab-bot .bot-err{background:rgba(216,90,48,.1);border:1px solid var(--red);color:var(--red);border-radius:var(--radius);padding:.6rem .9rem;margin-bottom:1rem;font-size:13px}
    #tab-bot .bot-info{background:var(--bg2);border:1px solid var(--border);color:var(--text2);border-radius:var(--radius);padding:.6rem .9rem;margin-bottom:1rem;font-size:13px}
    #tab-bot .bot-chips{display:flex;gap:6px;font-weight:500;text-transform:none;letter-spacing:0}
    #tab-bot .bot-chip{border:1px solid var(--border2);background:transparent;color:var(--text2);border-radius:99px;padding:2px 10px;font-size:11px;cursor:pointer;font-family:inherit}
    #tab-bot .bot-chip.on{background:var(--text);color:var(--bg);border-color:var(--text)}
    #tab-bot .bot-ctl{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;display:grid;gap:1rem}
    #tab-bot .bot-ctl-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}
    #tab-bot .bot-ctl-row .t{font-size:13px;color:var(--text)} #tab-bot .bot-ctl-row .t small{display:block;color:var(--text3);font-size:11px;margin-top:2px}
    #tab-bot .bot-btn{border:1px solid var(--border2);background:var(--bg);color:var(--text);border-radius:var(--radius-sm);padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
    #tab-bot .bot-btn:hover{background:var(--bg3)} #tab-bot .bot-btn[disabled]{opacity:.5;cursor:not-allowed}
    #tab-bot .bot-btn.danger{border-color:var(--red);color:var(--red)} #tab-bot .bot-btn.go{border-color:var(--green);color:var(--green)}
    #tab-bot .bot-limits{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
    #tab-bot .bot-limits label{font-size:11px;color:var(--text2);display:grid;gap:4px}
    #tab-bot .bot-limits input{font-family:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);width:100%;box-sizing:border-box}
    #tab-bot .bot-limits input.chg{border-color:var(--amber)}
    #tab-bot .bot-confirm{border:1px solid var(--amber);border-radius:var(--radius-sm);padding:.7rem .9rem;background:var(--bg);font-size:13px;display:grid;gap:8px}
    #tab-bot .bot-confirm ul{margin:0;padding-left:1.1rem}
    #tab-bot .bot-msg{font-size:12px;padding:.4rem .7rem;border-radius:var(--radius-sm)}
    #tab-bot .bot-msg.ok{background:rgba(29,158,117,.12);color:var(--green)} #tab-bot .bot-msg.bad{background:rgba(216,90,48,.1);color:var(--red)}
  `;
  document.head.appendChild(st);
}

function _botMount() {
  const root = document.getElementById('tab-bot');
  if (!root || _bot.mounted) return;
  _botStyle();
  root.innerHTML = `
    <div id="bot-head" class="bot-head"></div>
    <div id="bot-notices"></div>
    <div id="bot-kpis" class="bot-kpis"></div>
    <div id="bot-controls" class="bot-sec"></div>
    <div id="bot-tables"></div>`;
  root.addEventListener('click', _botOnClick);
  root.addEventListener('input', _botOnInput);
  _bot.mounted = true;
}

function renderBotPage() {
  const root = document.getElementById('tab-bot');
  if (!root) return;
  if (_bot.view && _bot.view !== _botView()) { // the account switch changed: listen to the other counters
    stopBotPage();
    _botResetData();
    _bot.ui.cfgSig = '';
  }
  _botMount();
  _botStart();
  _botDraw();
}

// ─── drawing ────────────────────────────────────────────────────

function _botTable(headers, rows, emptyText) {
  if (!rows.length) return `<div class="bot-wrap"><div class="bot-empty">${_botEsc(emptyText)}</div></div>`;
  return `<div class="bot-wrap"><table><thead><tr>${headers.map((h) => `<th>${_botEsc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function _botDraw() {
  const root = document.getElementById('tab-bot');
  if (!root || root.style.display === 'none' || !_bot.mounted) return;
  const d = _bot.data;
  const cfg = d.config || {};
  const view = _botView();
  const posV = d.positions.filter((p) => _botEnvOf(p) === view);
  const sigV = d.signals.filter((x) => _botEnvOf(x) === view);
  const trV = d.trades.filter((x) => _botEnvOf(x) === view);
  const alV = d.alerts.filter((x) => _botEnvOf(x) === view);
  const cfgEnv = cfg.environment || 'paper';
  const errKeys = Object.keys(d.errors);

  const dry = cfg.dryRun !== false; // the backend default is DRY RUN
  const killed = cfg.killSwitch === true;
  const hbNow = d.heartbeats.map((h) => _botNum(h.receivedAt)).filter(Boolean);
  const lastHb = hbNow.length ? Math.max(...hbNow) : null;
  const hbSec = lastHb ? (Date.now() - lastHb) / 1000 : null;
  const hbPill = hbSec === null ? ['bad', 'no heartbeat'] : hbSec < 600 ? ['ok', 'heartbeat ' + _botAge(lastHb)] : ['warn', 'heartbeat ' + _botAge(lastHb)];

  // head
  document.getElementById('bot-head').innerHTML = `
      <div class="page-title">Live Bot</div>
      <span class="bot-pill">${view === 'live' ? 'Live account' : 'Demo account (Paper)'}</span>
      <span class="bot-pill ${dry ? 'warn' : 'ok'}">${dry ? 'DRY RUN' : _botEsc(cfgEnv.toUpperCase())}</span>
      <span class="bot-pill ${killed ? 'bad' : 'ok'}">${killed ? 'KILL SWITCH ON' : 'entries enabled'}</span>
      <span class="bot-pill ${hbPill[0]}">${_botEsc(hbPill[1])}</span>
      ${view === 'live' && cfgEnv !== 'live' ? '<span class="bot-pill warn">live trading not active</span>' : ''}
      ${view !== 'live' && cfgEnv === 'live' ? '<span class="bot-pill bad">bot is configured for LIVE</span>' : ''}
      <span class="bot-mut" style="font-size:12px;margin-left:auto">NY time &middot; updated ${d.updatedAt ? _botNyTime(d.updatedAt) : '–'}</span>`;

  // notices
  let notices = '';
  if (errKeys.length) {
    notices += `<div class="bot-err">Cannot read: ${errKeys.map(_botEsc).join(', ')}. ${_botEsc(d.errors[errKeys[0]])}. Check that you are signed in with the owner account and the Firestore rules are published.</div>`;
  }
  if (view === 'live' && cfgEnv !== 'live') {
    notices += `<div class="bot-info">The bot is configured for <b>${_botEsc(cfgEnv.toUpperCase())}</b>, so there is no real-money activity to show here yet. Switch the account selector to Demo to see the Paper activity.</div>`;
  }
  document.getElementById('bot-notices').innerHTML = notices;

  // KPIs
  const sr = d.statsReal || {};
  const sd = d.statsDry || {};
  const pnl = _botNum(sr.realizedPnl) || 0;
  const maxLoss = _botNum(cfg.maxDailyLossUsd) || 20;
  const maxTrades = _botNum(cfg.maxTradesPerDay) || 10;
  const room = maxLoss + pnl;
  const today = _botNyDay(Date.now());
  const trToday = trV.filter((t) => _botNum(t.closedAt) && _botNyDay(_botNum(t.closedAt)) === today && !t.dryRun);
  const winsToday = trToday.filter((t) => (_botNum(t.pnl) || 0) > 0).length;
  const kpis = [
    ['Today P&L (realized)', `<span class="${_botClass(pnl)}">${_botMoney(pnl)}</span>`, dry ? 'DRY RUN is on: no real orders' : (cfgEnv === 'live' ? 'Live account' : 'Paper account')],
    ['Trades today', `${_botNum(sr.tradesToday) || 0} / ${maxTrades}`, 'entries sent to the broker'],
    ['Closed today', `${trToday.length}`, trToday.length ? `${winsToday} won, ${trToday.length - winsToday} lost` : 'no closed trades yet'],
    ['Room to daily loss limit', `<span class="${room <= maxLoss * 0.25 ? 'bot-neg' : ''}">${_botMoney(Math.max(0, room))}</span>`, 'limit ' + _botMoney(maxLoss)],
    ['Open positions', String(posV.length), posV.filter((p) => p.state === 'entry_pending').length + ' pending'],
  ];
  if (view !== 'live') kpis.push(['Simulated today', `<span class="${_botClass(_botNum(sd.realizedPnl) || 0)}">${_botMoney(_botNum(sd.realizedPnl) || 0)}</span>`, (_botNum(sd.tradesToday) || 0) + ' dry-run entries']);
  document.getElementById('bot-kpis').innerHTML = kpis.map(([l, v, s]) => `<div class="bot-kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${_botEsc(s)}</div></div>`).join('');

  // controls: redrawn only when the config or the UI state changes (so typing is never wiped)
  _botDrawControls(cfg, false);

  // tables
  const posRows = posV.slice().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).map((p) => {
    const waiting = p.stopError === 'waiting_regular_hours';
    const stopState = p.stopClientOrderId ? 'at broker' : (waiting ? 'waits for 09:30 NY' : (p.stopError ? p.stopError : 'none'));
    const stopCls = p.stopClientOrderId ? 'bot-pos' : (waiting ? 'bot-mut' : (p.state === 'open' ? 'bot-neg' : 'bot-mut'));
    const entry = _botNum(p.entryFillPrice || p.entryPrice);
    const stop = _botNum(p.stopLevel);
    const qty = _botNum(p.filledQty || p.qty);
    const dist = entry && stop ? (entry - stop) / entry * 100 : null;
    const risk = entry && stop && qty ? (entry - stop) * qty : null;
    return `<tr><td><b>${_botEsc(p.symbol || p.id)}</b>${p.dryRun ? ' <span class="bot-mut">(sim)</span>' : ''}</td>
      <td>${_botEsc(p.state)}</td><td>${_botEsc(qty)}</td>
      <td>${_botPx(entry)}</td><td>${_botPx(stop)}</td>
      <td>${dist === null ? '–' : dist.toFixed(1) + '%'}</td><td>${risk === null ? '–' : _botMoney(risk)}</td>
      <td class="${stopCls}">${_botEsc(stopState)}</td><td>${_botNyTime(p.openedAt)}</td></tr>`;
  });

  const flt = _bot.ui.filter;
  const sigShown = sigV.filter((s) => {
    const sig = s.signal || {};
    const st = s.status || '';
    if (flt === 'entries') return sig.event === 'entry';
    if (flt === 'rejected') return st === 'rejected' || st === 'error';
    return true;
  });
  const sigRows = sigShown.map((s) => {
    const sig = s.signal || {};
    const out = s.outcome || {};
    const ms = _botTsMs(s.receivedAt);
    const status = s.status || '';
    const cls = status === 'rejected' || status === 'error' ? 'bot-neg' : (status === 'accepted' || status === 'entry_placed' || status === 'following_up' ? 'bot-pos' : 'bot-mut');
    const qty = out.order && out.order.orderQuantity ? out.order.orderQuantity : '';
    const code = out.reason || (s.followUp && s.followUp.reason) || '';
    const why = code ? (_BOT_REASONS[code] || code) : '';
    return `<tr><td>${_botNyTime(ms)}</td><td><b>${_botEsc(sig.symbol)}</b></td><td>${_botEsc(sig.event)}</td>
      <td class="${cls}">${_botEsc(status)}${s.dryRun ? ' (sim)' : ''}</td>
      <td class="wrap ${cls}" title="${_botEsc(code)}">${_botEsc(why)}</td><td>${_botPx(sig.price)}</td><td>${_botPx(sig.stop)}</td><td>${_botEsc(qty)}</td>
      <td class="bot-mut">${_botEsc(sig.session)}</td></tr>`;
  });

  const tradeRows = trV.map((t) => {
    const ms = _botNum(t.closedAt);
    const pn = _botNum(t.pnl);
    const isToday = ms && _botNyDay(ms) === today;
    return `<tr><td>${ms ? (isToday ? '' : _botNyDay(ms) + ' ') + _botNyTime(ms) : '–'}</td><td><b>${_botEsc(t.symbol)}</b>${t.dryRun ? ' <span class="bot-mut">(sim)</span>' : ''}</td>
      <td>${_botEsc(t.qty)}</td><td>${_botPx(t.entryPrice)}</td><td class="${_botClass(pn)}">${_botMoney(pn)}</td><td>${_botEsc(t.exitReason)}</td></tr>`;
  });

  const alertRows = alV.map((a) => `<tr><td>${_botNyTime(_botNum(a.at))}</td><td class="bot-neg">${_botEsc(a.type)}</td>
    <td><b>${_botEsc(a.symbol)}</b></td><td class="wrap">${_botEsc(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail)}</td></tr>`);

  const hbRows = d.heartbeats.map((h) => {
    const ms = _botNum(h.receivedAt);
    const sec = ms ? (Date.now() - ms) / 1000 : null;
    const cls = sec === null ? 'bot-neg' : sec < 600 ? 'bot-pos' : 'bot-neg';
    return `<tr><td><b>${_botEsc(h.id)}</b></td><td class="${cls}">${_botAge(ms)} ago</td><td>${_botEsc(h.tf)}</td><td class="bot-mut">${_botEsc(h.strategy)}</td></tr>`;
  });

  const chip = (k, label) => `<button class="bot-chip${flt === k ? ' on' : ''}" data-act="filter" data-v="${k}">${label}</button>`;
  document.getElementById('bot-tables').innerHTML = `
    <div class="bot-sec"><h3>Open positions</h3>${_botTable(['Symbol', 'State', 'Qty', 'Entry', 'Stop', 'Stop dist.', 'Risk', 'Stop at broker', 'Opened (NY)'], posRows, 'No open positions.')}</div>
    <div class="bot-sec"><h3>Recent signals <span class="bot-chips">${chip('all', 'All')}${chip('entries', 'Entries')}${chip('rejected', 'Rejected / errors')}</span></h3>${_botTable(['Time (NY)', 'Symbol', 'Event', 'Status', 'Reason', 'Price', 'Stop', 'Qty', 'Session'], sigRows, 'No signals to show.')}</div>
    <div class="bot-sec"><h3>Closed trades</h3>${_botTable(['Closed (NY)', 'Symbol', 'Qty', 'Entry', 'P&L', 'Exit reason'], tradeRows, 'No closed trades yet.')}</div>
    <div class="bot-sec"><h3>Alerts</h3>${_botTable(['Time (NY)', 'Type', 'Symbol', 'Detail'], alertRows, 'No alerts.')}</div>
    <div class="bot-sec"><h3>Heartbeats</h3>${_botTable(['Symbol', 'Last message', 'Timeframe', 'Strategy'], hbRows, 'No heartbeats received.')}</div>`;
}

// ─── controls (version 2) ───────────────────────────────────────

function _botDrawControls(cfg, force) {
  const el = document.getElementById('bot-controls');
  if (!el) return;
  const ui = _bot.ui;
  const sig = JSON.stringify([cfg, ui.pending, ui.msg, ui.busy, ui.draft]);
  if (!force && sig === ui.cfgSig) return;
  ui.cfgSig = sig;

  const killed = cfg.killSwitch === true;
  const dry = cfg.dryRun !== false;
  const env = cfg.environment || 'paper';
  const hasCfg = !!_bot.data.config;

  const limitInputs = _BOT_LIMITS.map(([k, label, lo, hi, step]) => {
    const cur = _botNum(cfg[k]);
    const dv = k in ui.draft ? ui.draft[k] : (cur === null ? '' : cur);
    const changed = k in ui.draft && String(ui.draft[k]) !== String(cur === null ? '' : cur);
    return `<label>${_botEsc(label)}<input type="number" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${_botEsc(dv)}" placeholder="${_botEsc(_BOT_DEFAULTS[k])}" class="${changed ? 'chg' : ''}"><span class="bot-mut">now ${cur === null ? _BOT_DEFAULTS[k] + ' (default)' : cur} &middot; allowed ${lo}-${hi}</span></label>`;
  }).join('');

  const draftKeys = Object.keys(ui.draft).filter((k) => String(ui.draft[k]) !== String(_botNum(cfg[k]) === null ? '' : _botNum(cfg[k])));

  let pendingHtml = '';
  if (ui.pending) {
    pendingHtml = `<div class="bot-confirm"><b>${_botEsc(ui.pending.title)}</b>
      <ul>${ui.pending.lines.map((l) => `<li>${_botEsc(l)}</li>`).join('')}</ul>
      ${ui.pending.warn ? `<div class="bot-neg">${_botEsc(ui.pending.warn)}</div>` : ''}
      <div style="display:flex;gap:8px"><button class="bot-btn go" data-act="apply" ${ui.busy ? 'disabled' : ''}>Apply</button><button class="bot-btn" data-act="cancel" ${ui.busy ? 'disabled' : ''}>Cancel</button></div></div>`;
  }

  const canModeSwitch = hasCfg && env === 'paper';
  el.innerHTML = `
    <h3>Controls <span class="bot-mut" style="font-weight:400;text-transform:none;letter-spacing:0">applies to the bot (environment: ${_botEsc(env.toUpperCase())}); every change is logged</span></h3>
    <div class="bot-ctl">
      <div class="bot-ctl-row">
        <div class="t">Kill switch<small>${killed ? 'No new entries. Exits and stops still work.' : 'Entries are enabled. Turn on to stop NEW entries at once.'}</small></div>
        ${killed
          ? `<button class="bot-btn go" data-act="kill-off" ${!hasCfg || ui.busy ? 'disabled' : ''}>Allow entries again</button>`
          : `<button class="bot-btn danger" data-act="kill-on" ${!hasCfg || ui.busy ? 'disabled' : ''}>STOP new entries</button>`}
      </div>
      <div class="bot-ctl-row">
        <div class="t">Mode: ${dry ? 'DRY RUN' : _botEsc(env.toUpperCase())}<small>${dry ? 'Simulation only: no order reaches the broker.' : 'Orders are sent to the broker.'}${canModeSwitch ? '' : ' Changing the mode here works only while the environment is PAPER.'}</small></div>
        ${dry
          ? `<button class="bot-btn go" data-act="mode-real" ${!canModeSwitch || ui.busy ? 'disabled' : ''}>Switch to PAPER trading</button>`
          : `<button class="bot-btn" data-act="mode-dry" ${!hasCfg || ui.busy ? 'disabled' : ''}>Switch to DRY RUN</button>`}
      </div>
      <div>
        <div class="t" style="margin-bottom:8px">Limits</div>
        <div class="bot-limits">${limitInputs}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="bot-btn" data-act="review" ${!hasCfg || !draftKeys.length || ui.busy ? 'disabled' : ''}>Review changes (${draftKeys.length})</button>
          <button class="bot-btn" data-act="reset" ${!Object.keys(ui.draft).length ? 'disabled' : ''}>Reset fields</button>
        </div>
      </div>
      ${pendingHtml}
      ${ui.msg ? `<div class="bot-msg ${ui.msg.ok ? 'ok' : 'bad'}">${_botEsc(ui.msg.text)}</div>` : ''}
    </div>`;
}

function _botCfgNum(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

function _botOnInput(ev) {
  const el = ev.target;
  if (!el || !el.dataset || !el.dataset.k) return;
  _bot.ui.draft[el.dataset.k] = el.value;
  _bot.ui.msg = null;
  // update the buttons without redrawing the inputs (the focus must stay in the field)
  const cfg = (_bot.data.config || {});
  const cur = _botNum(cfg[el.dataset.k]);
  el.classList.toggle('chg', String(el.value) !== String(cur === null ? '' : cur));
  const n = Object.keys(_bot.ui.draft).filter((k) => String(_bot.ui.draft[k]) !== String(_botNum(cfg[k]) === null ? '' : _botNum(cfg[k]))).length;
  const rv = document.querySelector('#bot-controls [data-act="review"]');
  if (rv) { rv.textContent = `Review changes (${n})`; rv.disabled = !n || _bot.ui.busy; }
  const rs = document.querySelector('#bot-controls [data-act="reset"]');
  if (rs) rs.disabled = false;
  _bot.ui.cfgSig = JSON.stringify([cfg, _bot.ui.pending, _bot.ui.msg, _bot.ui.busy, _bot.ui.draft]);
}

function _botOnClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const ui = _bot.ui;
  const cfg = _bot.data.config || {};
  if (act === 'filter') { ui.filter = b.dataset.v; _botDraw(); return; }
  if (ui.busy) return;
  ui.msg = null;
  if (act === 'kill-on') {
    // protective: applies at once, no confirmation
    _botApply({killSwitch: true}, 'Kill switch ON');
    return;
  }
  if (act === 'kill-off') {
    ui.pending = {title: 'Allow new entries again?', lines: ['Kill switch: ON -> OFF'], patch: {killSwitch: false}, label: 'Kill switch OFF'};
  } else if (act === 'mode-dry') {
    // the safer direction: applies at once
    _botApply({dryRun: true}, 'Mode: DRY RUN');
    return;
  } else if (act === 'mode-real') {
    ui.pending = {title: 'Switch from DRY RUN to PAPER trading?', lines: ['Mode: DRY RUN -> PAPER'], patch: {dryRun: false}, label: 'Mode: PAPER', warn: 'From now on the bot sends real orders to the TradeZero Paper account.'};
  } else if (act === 'reset') {
    ui.draft = {};
  } else if (act === 'cancel') {
    ui.pending = null;
  } else if (act === 'review') {
    const patch = {}; const lines = []; const bad = [];
    for (const [k, label, lo, hi] of _BOT_LIMITS) {
      if (!(k in ui.draft)) continue;
      const cur = _botNum(cfg[k]);
      const nv = _botCfgNum(ui.draft[k]);
      if (String(ui.draft[k]) === String(cur === null ? '' : cur)) continue;
      if (nv === null || !Number.isFinite(nv) || nv < lo || nv > hi) { bad.push(`${label}: allowed ${lo}-${hi}`); continue; }
      patch[k] = nv;
      lines.push(`${label}: ${cur === null ? _BOT_DEFAULTS[k] + ' (default)' : cur} -> ${nv}`);
    }
    if (bad.length) ui.msg = {ok: false, text: 'Check the values: ' + bad.join('; ')};
    else if (!lines.length) ui.msg = {ok: false, text: 'Nothing changed.'};
    else ui.pending = {title: 'Apply these limits?', lines, patch, label: 'Limits updated'};
  } else if (act === 'apply') {
    const p = ui.pending;
    if (p) _botApply(p.patch, p.label);
    return;
  }
  _botDrawControls(cfg, true);
}

async function _botApply(patch, label) {
  const ui = _bot.ui;
  const cfg = _bot.data.config || {};
  ui.busy = true; ui.msg = null;
  _botDrawControls(cfg, true);
  try {
    const changes = {};
    Object.keys(patch).forEach((k) => { changes[k] = [cfg[k] === undefined ? null : cfg[k], patch[k]]; });
    await _db.collection('control').doc('config').update(patch);
    // audit entry (best effort: the change itself already succeeded)
    try {
      const user = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || null;
      await _db.collection('control_log').add({
        at: firebase.firestore.FieldValue.serverTimestamp(),
        by: user && user.email ? user.email : 'unknown',
        changes,
        view: _botView(),
      });
    } catch (e) { /* the log is optional */ }
    ui.pending = null;
    ui.draft = {};
    ui.msg = {ok: true, text: label + ' (saved)'};
  } catch (err) {
    const code = err && err.code ? err.code : String(err);
    ui.msg = {ok: false, text: code === 'permission-denied'
      ? 'Rejected by the Firestore rules (not the owner account, a value out of range, or the new rules are not published yet).'
      : 'Could not save: ' + code};
  }
  ui.busy = false;
  _botDrawControls(_bot.data.config || {}, true);
}

window.renderBotPage = renderBotPage;
window.stopBotPage = stopBotPage;
