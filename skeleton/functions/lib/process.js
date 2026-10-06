// The Processor's brain: decides what to do with one validated signal.
// Pure orchestration over two injected interfaces, so it can be tested
// without Firebase or TradeZero:
//   store  - persistence (positions, daily stats, order log)
//   broker - order placement (placeOrder, getOrder, cancelOrder, findOrder, getAccountType)
//
// TradeZero rules this code follows (API Conventions page):
//  - HTTP 200 is not success: read orderStatus ("Rejected" comes back as 200).
//  - clientOrderId is a dedup key: never POST the same id twice. After an
//    ambiguous failure (5xx / network) look the order up instead of retrying.
//  - A 4xx on POST means the order was NOT created.
//  - Do not cancel a Rejected order.

const {checkEntryLimits} = require("./limits");
const {sizeEntry, sellLimit} = require("./sizing");
const {nyDateKey} = require("./config");

// Statuses per TradeZero's Order lifecycle table.
const FILLED_ORDER = new Set(["Filled"]);
// Terminal and not filled. (DoneForDay is effectively terminal for Day orders.)
const DEAD_ORDER = new Set(["Rejected", "Canceled", "Cancelled", "Expired", "DoneForDay"]);
const isTerminal = (st) => FILLED_ORDER.has(st) || DEAD_ORDER.has(st);

// signal: validated signal. config: merged config. Returns an outcome:
//   {status: "accepted"|"rejected"|"ignored"|"error", reason?, order?, ...}
async function processSignal({signal, store, broker, config, now = Date.now}) {
  const t = now();
  if (t - signal.barTime > config.maxSignalAgeSec * 1000) {
    return {status: "rejected", reason: "stale_signal"};
  }
  // Environment guard: never write to an account of the wrong type.
  if (!config.dryRun) {
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
  }
  return signal.event === "entry" ?
    processEntry({signal, store, broker, config, t}) :
    processExit({signal, store, broker, config, t});
}

// Sends one order and classifies the outcome:
//   placed       the broker has the order (it may still be working)
//   rejected     the broker accepted the request but rejected the order
//   not_placed   the request was refused (4xx): the order does not exist
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

const withRoute = (order, config) => (config.route ? {...order, route: config.route} : order);

async function processEntry({signal, store, broker, config, t}) {
  const day = nyDateKey(t);
  const stats = await store.getStats(day);
  const ordersLastMinute = await store.countOrdersSince(t - 60000);
  const blocked = checkEntryLimits({config, stats, ordersLastMinute});
  if (blocked) return {status: "rejected", reason: blocked};

  const size = sizeEntry({price: signal.price, stop: signal.stop, config});
  if (size.reject) return {status: "rejected", reason: size.reject};

  const clientOrderId = `eb-${signal.symbol}-${signal.barTime}-B`;
  // Reserve the symbol BEFORE sending anything: this is what prevents two
  // concurrent entries on the same symbol.
  const reserved = await store.reservePosition(signal.symbol, {
    symbol: signal.symbol, qty: size.qty, entryPrice: signal.price,
    limitPrice: size.limitPrice, stop: signal.stop,
    entryClientOrderId: clientOrderId, openedAt: t, fillConfirmed: false,
    dryRun: config.dryRun,
  });
  if (!reserved) return {status: "rejected", reason: "already_in_position"};

  const order = withRoute({
    securityType: "Stock", symbol: signal.symbol, side: "Buy", openClose: "Open",
    orderType: "Limit", limitPrice: size.limitPrice, orderQuantity: size.qty,
    timeInForce: config.timeInForce, clientOrderId,
  }, config);

  const r = await sendOrder(broker, order);
  await store.recordOrder({clientOrderId, symbol: signal.symbol, side: "Buy", placedAt: t, order, result: r.kind});
  if (r.kind === "placed") {
    await store.addEntryToStats(day);
    return {status: "accepted", order, placed: r.placed, recovered: !!r.recovered};
  }
  if (r.kind === "rejected") {
    await store.releasePosition(signal.symbol);
    return {status: "rejected", reason: "broker_rejected", detail: r.placed && (r.placed.text || null), order};
  }
  if (r.kind === "not_placed") {
    await store.releasePosition(signal.symbol);
    return {status: "error", reason: "place_order_failed", error: r.error, order};
  }
  // unknown: keep the symbol reserved (the order may be live). Needs a human.
  return {status: "error", reason: "order_state_unknown", error: r.error, order};
}

async function processExit({signal, store, broker, config, t}) {
  const pos = await store.getPosition(signal.symbol);
  if (!pos) return {status: "ignored", reason: "no_position"};

  let sellQty = pos.qty;
  // Live only: find out what the entry really did before selling. Selling a
  // position that was never opened would create a short.
  if (!config.dryRun) {
    let entry = await broker.getOrder(pos.entryClientOrderId);
    let st = entry && entry.orderStatus;
    let weCancelled = false;
    if (!isTerminal(st)) {
      // Still working (or unknown): cancel it, then wait for a final status.
      // The cancel response alone proves nothing (404 can mean "already
      // filled"), and a PendingCancel order can still fill.
      let cancelErr = null;
      try {
        await broker.cancelOrder(pos.entryClientOrderId);
        weCancelled = true;
      } catch (err) {
        cancelErr = err;
      }
      entry = await broker.settleOrder(pos.entryClientOrderId);
      st = entry && entry.orderStatus;
      if (!isTerminal(st)) {
        return {
          status: "error",
          reason: cancelErr ? "entry_not_filled_cancel_failed" : "entry_cancel_unsettled",
          entryStatus: st || null,
          error: cancelErr ? String(cancelErr) : null,
        };
      }
    }
    // `executed` = shares filled so far (also covers partial fills).
    const executed = Number(entry && entry.executed) || 0;
    if (FILLED_ORDER.has(st)) {
      sellQty = executed > 0 ? executed : pos.qty;
    } else if (executed > 0) {
      sellQty = executed;
    } else {
      await store.releasePosition(signal.symbol);
      return {
        status: "ignored",
        reason: weCancelled ? "entry_cancelled_before_fill" : "entry_never_filled",
        entryStatus: st || null,
      };
    }
  }

  const limitPrice = sellLimit(signal.price, config);
  const clientOrderId = `eb-${signal.symbol}-${signal.barTime}-S`;
  const order = withRoute({
    securityType: "Stock", symbol: signal.symbol, side: "Sell", openClose: "Close",
    orderType: "Limit", limitPrice, orderQuantity: sellQty,
    timeInForce: config.timeInForce, clientOrderId,
  }, config);

  const r = await sendOrder(broker, order);
  await store.recordOrder({clientOrderId, symbol: signal.symbol, side: "Sell", placedAt: t, order, result: r.kind});
  // In every failure case the position stays reserved: it is still open.
  if (r.kind === "rejected") {
    return {status: "error", reason: "exit_rejected", detail: r.placed && (r.placed.text || null), order};
  }
  if (r.kind === "not_placed") return {status: "error", reason: "place_order_failed", error: r.error, order};
  if (r.kind === "unknown") return {status: "error", reason: "order_state_unknown", error: r.error, order};

  // Estimated from signal prices, not fills (sell fills are not tracked yet).
  const pnl = (signal.price - pos.entryPrice) * sellQty;
  await store.closePosition(signal.symbol, {day: nyDateKey(t), pnl, exitReason: signal.reason, closedAt: t, qty: sellQty});
  return {status: "accepted", order, estimatedPnl: pnl};
}

module.exports = {processSignal};
