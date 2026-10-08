// The Processor's brain: the position manager.
//
// Pure orchestration over two injected interfaces, so it can be tested
// without Firebase or TradeZero:
//   store  - persistence (positions, locks, daily stats, order log, alerts)
//   broker - order placement (placeOrder, getOrder, settleOrder, cancelOrder,
//            findOrder, getAccountType)
//
// A position moves through:   entry_pending -> open -> (deleted when closed)
//   entry_pending  the entry Limit is working. Not protected yet.
//   open           the entry filled; a protective StopLimit sits AT THE BROKER
//                  (so the position stays protected even if TradingView, the
//                  alert or the internet goes down). Pine only reports levels.
//
// TradeZero rules this code follows (API Conventions / Equity Trading pages):
//  - HTTP 200 is not success: read orderStatus ("Rejected" comes back as 200).
//  - clientOrderId is a dedup key: never POST the same id twice. After an
//    ambiguous failure (5xx / network) look the order up instead of retrying.
//  - A 4xx on POST means the order was NOT created.
//  - Do not cancel a Rejected order. After a cancel, wait for a terminal
//    status: the cancel response alone proves nothing.
//  - There is no modify: a stop is moved by cancel-then-replace with a new id.
//  - Place the protective stop only after the entry is Filled.

const {checkEntryLimits} = require("./limits");
const {sizeEntry, roundPrice} = require("./sizing");
const {nyDateKey} = require("./config");

const FILLED = new Set(["Filled"]);
// Terminal and not filled. (DoneForDay is effectively terminal for Day orders.)
const DEAD = new Set(["Rejected", "Canceled", "Cancelled", "Expired", "DoneForDay"]);
const isTerminal = (st) => FILLED.has(st) || DEAD.has(st);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── entry points ───────────────────────────────────────────────

// signal: validated signal. Returns an outcome:
//   {status: "accepted"|"rejected"|"ignored"|"error", reason?, ...}
async function processSignal({signal, store, broker, config, now = Date.now, sleep = defaultSleep}) {
  const ctx = {store, broker, config, now, sleep};
  const t = now();
  // A stale ENTRY or stop update is dropped. A stale EXIT is still executed:
  // a late exit is far better than none.
  if (signal.event !== "exit" && t - signal.barTime > config.maxSignalAgeSec * 1000) {
    return {status: "rejected", reason: "stale_signal"};
  }
  const guard = await guardEnvironment(ctx);
  if (guard) return guard;

  return withLock(ctx, signal.symbol, async () => {
    if (signal.event === "entry") return processEntry(ctx, signal);
    if (signal.event === "stop_update") return processStopUpdate(ctx, signal);
    if (signal.event === "exit") return processExit(ctx, signal);
    return {status: "ignored", reason: "unsupported_event"};
  });
}

// FAST PATH for entries (called straight from the HTTP receiver, no queue hop):
// does everything up to and including sending the entry order, then returns.
// The wait for the fill and the protective stop are done by completeSignal.
async function placeSignal({signal, store, broker, config, now = Date.now, sleep = defaultSleep}) {
  const ctx = {store, broker, config, now, sleep};
  if (signal.event !== "entry") return {status: "error", reason: "not_an_entry"};
  if (now() - signal.barTime > config.maxSignalAgeSec * 1000) return {status: "rejected", reason: "stale_signal"};
  const guard = await guardEnvironment(ctx);
  if (guard) return guard;
  return placeEntry(ctx, signal); // no lock: reservePosition is atomic and is the guard
}

// Follow-up of a fast entry: waits (up to entryTimeoutSec) for the fill, then
// places the protective stop, or cancels the entry if it did not fill.
async function completeSignal({symbol, store, broker, config, now = Date.now, sleep = defaultSleep}) {
  const ctx = {store, broker, config, now, sleep};
  const guard = await guardEnvironment(ctx);
  if (guard) return guard;
  return withLock(ctx, symbol, () => completeEntry(ctx, symbol));
}

// One pass over every open or pending position: finishes pending entries,
// cancels stale ones, and notices a protective stop that has filled.
async function reconcileAll({store, broker, config, now = Date.now, sleep = defaultSleep}) {
  const ctx = {store, broker, config, now, sleep};
  const guard = await guardEnvironment(ctx);
  if (guard) return [guard];
  const results = [];
  for (const pos of await store.listPositions()) {
    if (pos.dryRun) continue; // simulated positions have nothing at the broker
    results.push(await withLock(ctx, pos.symbol, () => reconcileOne(ctx, pos.symbol)));
  }
  return results;
}

// ─── infrastructure ─────────────────────────────────────────────

// Environment guard: never write to an account of the wrong type.
async function guardEnvironment(ctx) {
  const {broker, config} = ctx;
  if (config.dryRun) return null;
  let accountType;
  try {
    accountType = await broker.getAccountType();
  } catch (err) {
    return {status: "error", reason: "account_check_failed", error: String(err)};
  }
  const isPaper = accountType === "Paper";
  if ((config.environment === "paper" && !isPaper) || (config.environment === "live" && isPaper)) {
    return {status: "error", reason: "environment_mismatch", accountType: accountType || null};
  }
  return null;
}

// One signal at a time per symbol (several Functions can run at once).
async function withLock(ctx, symbol, fn, maxWaitMs = 20000) {
  const {store, now, sleep} = ctx;
  const token = `${now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = now() + maxWaitMs;
  while (!(await store.acquireLock(symbol, token, 60000, now()))) {
    if (now() > deadline) return {status: "error", reason: "symbol_busy"};
    await sleep(250);
  }
  try {
    return await fn();
  } finally {
    await store.releaseLock(symbol, token);
  }
}

// Sends one order and classifies the outcome:
//   placed       the broker has the order (it may still be working)
//   rejected     the broker accepted the request but rejected the order
//   not_placed   the request was refused (4xx) or is confirmed absent
//   unknown      ambiguous failure and the order could not be looked up
async function sendOrder(broker, order) {
  const classify = (o) => ({kind: o && o.orderStatus === "Rejected" ? "rejected" : "placed", placed: o});
  try {
    return classify(await broker.placeOrder(order));
  } catch (err) {
    const status = err && err.status;
    if (status >= 400 && status < 500) return {kind: "not_placed", error: String(err)};
    // 5xx / network / timeout: the order may exist. Look it up; never re-POST.
    try {
      const found = await broker.findOrder(order.clientOrderId);
      if (found) return {...classify(found), recovered: true};
      return {kind: "not_placed", error: String(err)}; // confirmed absent
    } catch (lookupErr) {
      return {kind: "unknown", error: `${err}; lookup: ${lookupErr}`};
    }
  }
}

function mkOrder(config, f) {
  const o = {
    securityType: "Stock", symbol: f.symbol, side: f.side, openClose: f.openClose,
    orderType: f.orderType, orderQuantity: f.qty, timeInForce: f.tif, clientOrderId: f.id,
  };
  if (f.limitPrice !== undefined) o.limitPrice = f.limitPrice;
  if (f.stopPrice !== undefined) o.stopPrice = f.stopPrice;
  if (config.route) o.route = config.route;
  return o;
}

// New unique clientOrderId for this position (<= 36 chars on live).
async function nextId(ctx, pos) {
  const seq = (pos.seq || 0) + 1;
  pos.seq = seq;
  await ctx.store.updatePosition(pos.symbol, {seq});
  return `eb-${pos.symbol}-${pos.entryBarTime}-${seq}`;
}

const stopTif = (config) => config.stopTimeInForce || (config.environment === "live" ? "Day_Plus" : "Day");

// Cancel, then wait for a terminal status (PendingCancel can still fill).
async function cancelAndSettle(ctx, id) {
  let cancelErr = null;
  try {
    await ctx.broker.cancelOrder(id);
  } catch (err) {
    cancelErr = err; // 404 usually means "already terminal": the read below tells
  }
  const order = await ctx.broker.settleOrder(id, {timeoutMs: 6000});
  return {order, status: order && order.orderStatus, cancelErr};
}

async function alertOnce(ctx, type, symbol, detail) {
  await ctx.store.recordAlert({type, symbol, detail, at: ctx.now()});
}

// ─── protective stop ────────────────────────────────────────────

// Places the protective StopLimit for the filled quantity at `level`.
async function placeStop(ctx, pos, level) {
  const {store, broker, config, now} = ctx;
  const id = await nextId(ctx, pos);
  const stopPrice = roundPrice(level);
  const limitPrice = Math.max(0.0001, roundPrice(level - config.stopOffsetUsd));
  const order = mkOrder(config, {
    symbol: pos.symbol, side: "Sell", openClose: "Close", orderType: "StopLimit",
    qty: pos.filledQty || pos.qty, stopPrice, limitPrice, tif: stopTif(config), id,
  });
  const r = await sendOrder(broker, order);
  await store.recordOrder({clientOrderId: id, symbol: pos.symbol, side: "Sell", purpose: "stop", placedAt: now(), order, result: r.kind});
  if (r.kind === "placed") {
    const patch = {stopClientOrderId: id, stopLevel: level, stopError: null};
    await store.updatePosition(pos.symbol, patch);
    Object.assign(pos, patch);
    return {ok: true, id, order};
  }
  const detail = r.error || (r.placed && r.placed.text) || r.kind;
  const patch = {stopClientOrderId: null, stopLevel: level, stopError: `${r.kind}: ${detail}`};
  await store.updatePosition(pos.symbol, patch);
  Object.assign(pos, patch);
  await alertOnce(ctx, "stop_not_placed", pos.symbol, patch.stopError);
  return {ok: false, kind: r.kind, detail, order};
}

// ─── entry ──────────────────────────────────────────────────────

// Everything up to and including sending the entry order.
// Returns {status:"accepted", followUp:true} when the order is live at the
// broker and its fill still has to be waited for.
async function placeEntry(ctx, signal) {
  const {store, broker, config, now} = ctx;
  const t = now();
  const day = nyDateKey(t);
  const [stats, ordersLastMinute] = await Promise.all([store.getStats(day), store.countOrdersSince(t - 60000)]);
  const blocked = checkEntryLimits({config, stats, ordersLastMinute});
  if (blocked) return {status: "rejected", reason: blocked};

  // Do not chase: the bar may have closed far above the trigger.
  if (signal.last && signal.price && signal.last - signal.price > config.maxChaseUsd) {
    return {status: "rejected", reason: "chase_too_far", detail: {price: signal.price, last: signal.last}};
  }

  // Size from the freshest price the signal carries.
  const size = sizeEntry({price: signal.last || signal.price, stop: signal.stop, config});
  if (size.reject) return {status: "rejected", reason: size.reject};

  const id = `eb-${signal.symbol}-${signal.barTime}-B`;
  // Reserve the symbol BEFORE sending anything: this prevents two entries on
  // the same symbol.
  const reserved = await store.reservePosition(signal.symbol, {
    symbol: signal.symbol, state: "entry_pending", qty: size.qty, filledQty: 0,
    entryPrice: signal.price, entryFillPrice: null, limitPrice: size.limitPrice,
    stopLevel: signal.stop, entryClientOrderId: id, entryBarTime: signal.barTime,
    seq: 0, stopClientOrderId: null, realized: 0, openedAt: t, dryRun: config.dryRun,
  });
  if (!reserved) return {status: "rejected", reason: "already_in_position"};

  const order = mkOrder(config, {
    symbol: signal.symbol, side: "Buy", openClose: "Open", orderType: "Limit",
    qty: size.qty, limitPrice: size.limitPrice, tif: config.timeInForce, id,
  });
  const r = await sendOrder(broker, order);
  await store.recordOrder({clientOrderId: id, symbol: signal.symbol, side: "Buy", purpose: "entry", placedAt: t, order, result: r.kind});

  if (r.kind === "rejected") {
    await store.releasePosition(signal.symbol);
    return {status: "rejected", reason: "broker_rejected", detail: r.placed && (r.placed.text || null), order};
  }
  if (r.kind === "not_placed") {
    await store.releasePosition(signal.symbol);
    return {status: "error", reason: "place_order_failed", error: r.error, order};
  }
  if (r.kind === "unknown") {
    // Keep the symbol reserved (the order may be live). Needs a human.
    return {status: "error", reason: "order_state_unknown", error: r.error, order};
  }

  await store.addEntryToStats(day);
  if (config.dryRun) {
    // Simulated: the entry "fills" at its limit and the stop is "placed".
    const pos = await store.getPosition(signal.symbol);
    await store.updatePosition(signal.symbol, {state: "open", filledQty: size.qty, entryFillPrice: size.limitPrice});
    Object.assign(pos, {state: "open", filledQty: size.qty, entryFillPrice: size.limitPrice});
    await placeStop(ctx, pos, pos.stopLevel);
    return {status: "accepted", order, simulated: true};
  }
  return {status: "accepted", order, placed: r.placed, recovered: !!r.recovered, followUp: true};
}

// Queue path: place, give the entry a moment to fill, then protect it. If it
// is still working, the reconcile pass (or completeSignal) finishes the job.
async function processEntry(ctx, signal) {
  const {store, broker, config} = ctx;
  const out = await placeEntry(ctx, signal);
  if (!out.followUp) return out;
  const pos = await store.getPosition(signal.symbol);
  const o = await broker.settleOrder(pos.entryClientOrderId, {timeoutMs: config.entryWaitMs});
  const res = await applyEntryOrder(ctx, pos, o, {timeoutCancel: false});
  return {...out, position: res.pos ? res.pos.state : "released"};
}

// Waits (up to entryTimeoutSec) for the entry to fill, then protects it; an
// entry that did not fill in time is cancelled.
async function completeEntry(ctx, symbol) {
  const {store, broker, config} = ctx;
  const pos = await store.getPosition(symbol);
  if (!pos || pos.state !== "entry_pending") return {status: "ignored", reason: "nothing_to_complete"};
  const o = await broker.settleOrder(pos.entryClientOrderId, {timeoutMs: config.entryTimeoutSec * 1000});
  const res = await applyEntryOrder(ctx, pos, o, {timeoutCancel: true});
  return {status: "accepted", position: res.pos ? res.pos.state : "released", reason: res.reason || null};
}

// Advances an entry_pending position from the state of its entry order.
// Returns {pos, reason?}: pos is the updated position, or null if released.
async function applyEntryOrder(ctx, pos, o, {timeoutCancel}) {
  const {store} = ctx;
  let order = o;
  let cancelled = false;
  let st = order && order.orderStatus;

  if (!isTerminal(st) && timeoutCancel) {
    const c = await cancelAndSettle(ctx, pos.entryClientOrderId);
    order = c.order;
    st = c.status;
    cancelled = true;
    if (!isTerminal(st)) {
      await alertOnce(ctx, "entry_cancel_unsettled", pos.symbol, st || "unknown");
      return {pos, reason: "entry_cancel_unsettled"};
    }
  }
  if (!isTerminal(st)) return {pos}; // still working, leave it

  const executed = num(order && order.executed);
  const filledQty = FILLED.has(st) ? (executed > 0 ? executed : pos.qty) : executed;
  if (!(filledQty > 0)) {
    await store.releasePosition(pos.symbol);
    return {pos: null, reason: cancelled ? "entry_cancelled_before_fill" : "entry_never_filled"};
  }
  const entryFillPrice = num(order && order.priceAvg) || pos.limitPrice;
  const patch = {state: "open", filledQty, entryFillPrice};
  await store.updatePosition(pos.symbol, patch);
  Object.assign(pos, patch);
  await placeStop(ctx, pos, pos.stopLevel);
  return {pos};
}

// ─── stop update (the trailing floor moved) ─────────────────────

async function processStopUpdate(ctx, signal) {
  const {store, config} = ctx;
  const pos = await store.getPosition(signal.symbol);
  if (!pos) return {status: "ignored", reason: "no_position"};
  // A protective stop only ever moves up.
  if (!(signal.stop > (pos.stopLevel || 0))) return {status: "ignored", reason: "not_higher"};

  if (pos.state === "entry_pending") {
    await store.updatePosition(signal.symbol, {stopLevel: signal.stop});
    return {status: "accepted", reason: "stored_until_filled"};
  }
  if (!config.dryRun && pos.stopClientOrderId) {
    const c = await cancelAndSettle(ctx, pos.stopClientOrderId);
    if (FILLED.has(c.status)) {
      await bookStopFilled(ctx, pos, c.order);
      return {status: "ignored", reason: "stop_already_filled"};
    }
    if (!isTerminal(c.status)) {
      return {status: "error", reason: "stop_cancel_failed", entryStatus: c.status || null, error: c.cancelErr ? String(c.cancelErr) : null};
    }
    const ex = num(c.order && c.order.executed);
    if (ex > 0) await consumeFill(ctx, pos, ex, num(c.order.priceAvg) || pos.stopLevel);
    if (!(pos.filledQty > 0)) return {status: "ignored", reason: "stop_already_filled"};
  }
  const r = await placeStop(ctx, pos, signal.stop);
  if (!r.ok) return {status: "error", reason: "stop_not_placed", detail: r.detail, kind: r.kind};
  return {status: "accepted", order: r.order};
}

// ─── exit ───────────────────────────────────────────────────────

async function processExit(ctx, signal) {
  const {store, broker, config, now} = ctx;
  const t = now();
  let pos = await store.getPosition(signal.symbol);
  if (!pos) return {status: "ignored", reason: "no_position"};
  const sim = !!pos.dryRun;
  // The freshest price the signal carries: the limit is built from it, so it
  // matches the real market and not the strategy's modeled fill.
  const ref = signal.last || signal.price;

  if (!sim) {
    // 1. An entry that has not filled yet: resolve it first.
    if (pos.state === "entry_pending") {
      const o = await broker.getOrder(pos.entryClientOrderId);
      const res = await applyEntryOrder(ctx, pos, o, {timeoutCancel: true});
      if (!res.pos) return {status: "ignored", reason: res.reason};
      if (res.pos.state !== "open") return {status: "error", reason: res.reason || "entry_unsettled"};
      pos = res.pos;
    }
    // 2. The protective stop: cancel it, the exit takes over.
    if (pos.stopClientOrderId) {
      const c = await cancelAndSettle(ctx, pos.stopClientOrderId);
      if (FILLED.has(c.status)) {
        await bookStopFilled(ctx, pos, c.order); // the stop got there first
        return {status: "ignored", reason: "stop_already_filled"};
      }
      if (!isTerminal(c.status)) {
        // Still working: selling now would sell the same shares twice.
        return {status: "error", reason: "stop_cancel_failed", entryStatus: c.status || null, error: c.cancelErr ? String(c.cancelErr) : null};
      }
      await store.updatePosition(pos.symbol, {stopClientOrderId: null});
      pos.stopClientOrderId = null;
      const ex = num(c.order && c.order.executed);
      if (ex > 0) await consumeFill(ctx, pos, ex, num(c.order.priceAvg) || pos.stopLevel);
      if (!(pos.filledQty > 0)) {
        await store.closePosition(pos.symbol, {day: nyDateKey(t), pnl: pos.realized || 0, exitReason: "stop_filled_before_exit", closedAt: t, qty: 0});
        return {status: "ignored", reason: "stop_already_filled"};
      }
    }
  }

  // 3. Sell. If it does not fill, cancel and re-price lower (new id each time).
  let remaining = pos.filledQty || pos.qty;
  let soldQty = 0;
  let soldValue = 0;
  let failure = null;
  const orders = [];
  for (let attempt = 0; attempt <= config.maxReprices && remaining > 0; attempt++) {
    const limitPrice = Math.max(0.0001, roundPrice(ref - config.limitOffsetUsd - attempt * config.repriceStepUsd));
    const id = await nextId(ctx, pos);
    const order = mkOrder(config, {
      symbol: pos.symbol, side: "Sell", openClose: "Close", orderType: "Limit",
      qty: remaining, limitPrice, tif: config.timeInForce, id,
    });
    orders.push(order);
    const r = await sendOrder(broker, order);
    await store.recordOrder({clientOrderId: id, symbol: pos.symbol, side: "Sell", purpose: "exit", placedAt: now(), order, result: r.kind});
    if (r.kind !== "placed") {
      failure = {reason: r.kind === "rejected" ? "exit_rejected" : (r.kind === "unknown" ? "order_state_unknown" : "place_order_failed"), detail: r.error || (r.placed && r.placed.text) || null};
      break;
    }
    if (sim) {
      soldQty += remaining;
      soldValue += remaining * limitPrice;
      remaining = 0;
      break;
    }
    let o = await broker.settleOrder(id, {timeoutMs: config.sellWaitMs});
    let st = o && o.orderStatus;
    if (!isTerminal(st)) {
      const c = await cancelAndSettle(ctx, id);
      o = c.order || o;
      st = c.status;
      if (!isTerminal(st)) {
        failure = {reason: "sell_cancel_unsettled", detail: st || null};
        break;
      }
    }
    const ex = num(o && o.executed);
    const qty = FILLED.has(st) ? (ex > 0 ? ex : remaining) : ex;
    if (qty > 0) {
      soldQty += qty;
      soldValue += qty * (num(o && o.priceAvg) || limitPrice);
      remaining -= qty;
    }
    if (st === "Rejected" && !(qty > 0)) {
      failure = {reason: "exit_rejected", detail: (o && o.text) || null};
      break;
    }
  }

  if (remaining <= 0) {
    const exitAvg = soldValue / soldQty;
    await bookClosed(ctx, pos, {exitPrice: exitAvg, qty: soldQty, reason: signal.reason});
    return {status: "accepted", orders, exitAvg, estimatedPnl: (exitAvg - (pos.entryFillPrice || pos.entryPrice)) * soldQty + (pos.realized || 0)};
  }

  // Not (fully) sold. Keep what is left, protected again.
  if (soldQty > 0) await consumeFill(ctx, pos, soldQty, soldValue / soldQty);
  if (!sim && !failure) failure = {reason: "exit_not_filled", detail: `${remaining} shares left`};
  if (!sim && pos.stopLevel && !pos.stopClientOrderId && pos.filledQty > 0) {
    await placeStop(ctx, pos, pos.stopLevel); // never leave a live position without its stop
  }
  await alertOnce(ctx, failure.reason, pos.symbol, failure.detail);
  return {status: "error", reason: failure.reason, detail: failure.detail, remaining, orders};
}

// ─── bookkeeping ────────────────────────────────────────────────

// `qty` shares were sold at `px` (a stop or a partial sell): record the
// realized P&L and shrink the position.
async function consumeFill(ctx, pos, qty, px) {
  const entry = pos.entryFillPrice || pos.entryPrice;
  const patch = {
    filledQty: Math.max(0, (pos.filledQty || pos.qty) - qty),
    realized: (pos.realized || 0) + (px - entry) * qty,
  };
  await ctx.store.updatePosition(pos.symbol, patch);
  Object.assign(pos, patch);
}

async function bookClosed(ctx, pos, {exitPrice, qty, reason}) {
  const entry = pos.entryFillPrice || pos.entryPrice;
  const pnl = (exitPrice - entry) * qty + (pos.realized || 0);
  await ctx.store.closePosition(pos.symbol, {day: nyDateKey(ctx.now()), pnl, exitReason: reason, closedAt: ctx.now(), qty});
}

async function bookStopFilled(ctx, pos, order) {
  const qty = num(order && order.executed) || pos.filledQty || pos.qty;
  const px = num(order && order.priceAvg) || pos.stopLevel;
  await bookClosed(ctx, pos, {exitPrice: px, qty, reason: "stop_filled"});
}

// ─── reconcile (scheduled) ──────────────────────────────────────

async function reconcileOne(ctx, symbol) {
  const {store, broker, config, now} = ctx;
  const pos = await store.getPosition(symbol);
  if (!pos) return {status: "ignored", symbol, reason: "no_position"};

  if (pos.state === "entry_pending") {
    const o = await broker.getOrder(pos.entryClientOrderId);
    const timedOut = now() - pos.openedAt > config.entryTimeoutSec * 1000;
    const res = await applyEntryOrder(ctx, pos, o, {timeoutCancel: timedOut});
    return {status: "accepted", symbol, action: res.pos ? res.pos.state : "released"};
  }
  // open
  if (!pos.stopClientOrderId) {
    const r = await placeStop(ctx, pos, pos.stopLevel);
    return {status: r.ok ? "accepted" : "error", symbol, action: "stop_replaced"};
  }
  const o = await broker.getOrder(pos.stopClientOrderId);
  const st = o && o.orderStatus;
  if (FILLED.has(st)) {
    await bookStopFilled(ctx, pos, o);
    return {status: "accepted", symbol, action: "stop_filled_closed"};
  }
  if (DEAD.has(st)) {
    // The stop vanished (day order expired, cancelled by hand, ...).
    await alertOnce(ctx, "stop_vanished", symbol, st);
    const r = await placeStop(ctx, pos, pos.stopLevel);
    return {status: r.ok ? "accepted" : "error", symbol, action: "stop_replaced"};
  }
  return {status: "ignored", symbol, reason: "ok"};
}

module.exports = {processSignal, placeSignal, completeSignal, reconcileAll};
