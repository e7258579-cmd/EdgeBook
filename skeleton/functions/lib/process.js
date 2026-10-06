// The Processor's brain: decides what to do with one validated signal.
// Pure orchestration over two injected interfaces, so it can be tested
// without Firebase or TradeZero:
//   store  - persistence (positions, daily stats, order log)
//   broker - order placement (placeOrder, getOrder, cancelOrder)

const {checkEntryLimits} = require("./limits");
const {sizeEntry, sellLimit} = require("./sizing");
const {nyDateKey} = require("./config");

const DEAD_ORDER = new Set(["Rejected", "Canceled", "Cancelled", "Expired"]);
const FILLED_ORDER = new Set(["Filled"]);

// signal: validated signal. config: merged config. Returns an outcome:
//   {status: "accepted"|"rejected"|"ignored"|"error", reason?, order?, ...}
async function processSignal({signal, store, broker, config, now = Date.now}) {
  const t = now();
  if (t - signal.barTime > config.maxSignalAgeSec * 1000) {
    return {status: "rejected", reason: "stale_signal"};
  }
  return signal.event === "entry" ?
    processEntry({signal, store, broker, config, t}) :
    processExit({signal, store, broker, config, t});
}

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

  const order = {
    securityType: "Stock", symbol: signal.symbol, side: "Buy", openClose: "Open",
    orderType: "Limit", limitPrice: size.limitPrice, orderQuantity: size.qty,
    timeInForce: config.timeInForce, clientOrderId,
  };
  try {
    const placed = await broker.placeOrder(order);
    await store.recordOrder({clientOrderId, symbol: signal.symbol, side: "Buy", placedAt: t, order, placed});
    await store.addEntryToStats(day);
    return {status: "accepted", order, placed};
  } catch (err) {
    await store.releasePosition(signal.symbol);
    return {status: "error", reason: "place_order_failed", error: String(err), order};
  }
}

async function processExit({signal, store, broker, config, t}) {
  const pos = await store.getPosition(signal.symbol);
  if (!pos) return {status: "ignored", reason: "no_position"};

  // Live only: make sure the entry really filled before selling. Selling a
  // position that was never opened would create a short.
  if (!config.dryRun) {
    const entry = await broker.getOrder(pos.entryClientOrderId);
    const st = entry && entry.orderStatus;
    if (DEAD_ORDER.has(st)) {
      await store.releasePosition(signal.symbol);
      return {status: "ignored", reason: "entry_never_filled", entryStatus: st};
    }
    if (!FILLED_ORDER.has(st)) {
      // Entry still working or unknown: it must be cancelled first.
      let cancelled = false;
      let cancelErr = null;
      try {
        await broker.cancelOrder(pos.entryClientOrderId);
        cancelled = true;
      } catch (err) {
        cancelErr = err;
      }
      if (cancelled) {
        await store.releasePosition(signal.symbol);
        return {status: "ignored", reason: "entry_cancelled_before_fill", entryStatus: st || null};
      }
      // The cancel failed. Most likely the order filled in the meantime:
      // look again, and if so carry on and sell. Otherwise fail loudly.
      const again = await broker.getOrder(pos.entryClientOrderId);
      if (!(again && FILLED_ORDER.has(again.orderStatus))) {
        return {status: "error", reason: "entry_not_filled_cancel_failed", entryStatus: st || null, error: String(cancelErr)};
      }
    }
  }

  const limitPrice = sellLimit(signal.price, config);
  const clientOrderId = `eb-${signal.symbol}-${signal.barTime}-S`;
  const order = {
    securityType: "Stock", symbol: signal.symbol, side: "Sell", openClose: "Close",
    orderType: "Limit", limitPrice, orderQuantity: pos.qty,
    timeInForce: config.timeInForce, clientOrderId,
  };
  try {
    const placed = await broker.placeOrder(order);
    await store.recordOrder({clientOrderId, symbol: signal.symbol, side: "Sell", placedAt: t, order, placed});
  } catch (err) {
    // The position stays reserved: it is still open. A later exit retries.
    return {status: "error", reason: "place_order_failed", error: String(err), order};
  }
  // Estimated from signal prices, not fills (fills are not tracked yet).
  const pnl = (signal.price - pos.entryPrice) * pos.qty;
  await store.closePosition(signal.symbol, {day: nyDateKey(t), pnl, exitReason: signal.reason, closedAt: t});
  return {status: "accepted", order, estimatedPnl: pnl};
}

module.exports = {processSignal};
