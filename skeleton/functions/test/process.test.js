const test = require("node:test");
const assert = require("node:assert/strict");
const {processSignal, placeSignal, completeSignal, reconcileAll} = require("../lib/process");
const {nyDateKey} = require("../lib/config");
const {memoryStore, simBroker, NOW, entrySignal, exitSignal, stopSignal, cfg} = require("./helpers");

const sleep = async () => {};
const run = (signal, store, broker, config = cfg(), clock = {now: () => NOW, sleep}) =>
  processSignal({signal, store, broker, config, ...clock});
const rec = (store, broker, config = cfg(), clock = {now: () => NOW, sleep}) =>
  reconcileAll({store, broker, config, ...clock});
const placed = (broker, filter = () => true) => broker.calls.filter((c) => c[0] === "place").map((c) => c[1]).filter(filter);
const isStop = (o) => o.orderType === "StopLimit";
const isSell = (o) => o.side === "Sell" && o.orderType === "Limit";

// A position that is open at the broker with its protective stop working.
// Entry: limit 4.16 (4.06 + 0.10), 13 shares, filled at the ask 4.10.
async function openPosition(extra = {}) {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10, ...extra});
  const r = await run(entrySignal(), store, broker, extra.config || cfg());
  assert.equal(r.status, "accepted");
  return {store, broker};
}

// ─── entry ──────────────────────────────────────────────────────

test("entry: Limit buy at price + 0.10, sized by risk; on fill the protective StopLimit is placed", async () => {
  const {store, broker} = await openPosition();
  const [buy, stop] = placed(broker);
  assert.equal(buy.side, "Buy");
  assert.equal(buy.orderType, "Limit");
  assert.equal(buy.limitPrice, 4.16);
  assert.equal(buy.orderQuantity, 13);
  assert.equal(stop.orderType, "StopLimit");
  assert.equal(stop.side, "Sell");
  assert.equal(stop.openClose, "Close");
  assert.equal(stop.stopPrice, 3.78);
  assert.equal(stop.limitPrice, 3.68); // stop - 0.10
  assert.equal(stop.orderQuantity, 13);
  assert.equal(stop.timeInForce, "Day"); // paper
  const pos = await store.getPosition("WHLR");
  assert.equal(pos.state, "open");
  assert.equal(pos.filledQty, 13);
  assert.equal(pos.entryFillPrice, 4.10);
  assert.equal(pos.stopClientOrderId, stop.clientOrderId);
  assert.equal((await store.getStats(nyDateKey(NOW))).tradesToday, 1);
});

test("entry: still working after the wait -> pending, no stop yet", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50}); // above our limit
  const r = await run(entrySignal(), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal((await store.getPosition("WHLR")).state, "entry_pending");
  assert.equal(placed(broker, isStop).length, 0);
});

test("reconcile: a pending entry that filled gets its stop", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await run(entrySignal(), store, broker);
  broker.market.ask = 4.12;
  const [r] = await rec(store, broker);
  assert.equal(r.action, "open");
  assert.equal(placed(broker, isStop).length, 1);
  assert.equal((await store.getPosition("WHLR")).entryFillPrice, 4.12);
});

test("reconcile: an entry unfilled for too long is cancelled and released", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await run(entrySignal(), store, broker);
  const later = {now: () => NOW + 31000, sleep};
  const [r] = await rec(store, broker, cfg(), later);
  assert.equal(r.action, "released");
  assert.equal(await store.getPosition("WHLR"), null);
  assert.equal(broker.calls.filter((c) => c[0] === "cancel").length, 1);
});

test("reconcile: a protective stop that filled closes the position and books the loss", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 3.70; // stop 3.78 triggered, limit 3.68 <= 3.70: fills at 3.70
  const [r] = await rec(store, broker);
  assert.equal(r.action, "stop_filled_closed");
  assert.equal(await store.getPosition("WHLR"), null);
  const {realizedPnl} = await store.getStats(nyDateKey(NOW));
  assert.ok(Math.abs(realizedPnl - (3.70 - 4.10) * 13) < 1e-9);
  assert.equal(store.trades[0].exitReason, "stop_filled");
});

test("a protective stop the broker rejected is reported and retried", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10, rejectPlace: isStop});
  await run(entrySignal(), store, broker);
  const pos = await store.getPosition("WHLR");
  assert.equal(pos.stopClientOrderId, null);
  assert.match(pos.stopError, /rejected/);
  assert.equal(store.alerts[0].type, "stop_not_placed");
});

// ─── entry: rejections, limits, failures ────────────────────────

test("entry: a second entry on the same symbol is rejected, nothing sent", async () => {
  const {store, broker} = await openPosition();
  const before = placed(broker).length;
  const r = await run(entrySignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.reason, "already_in_position");
  assert.equal(placed(broker).length, before);
});

test("entry: kill switch, daily loss, trade cap and rate limit all block", async () => {
  const day = nyDateKey(NOW);
  for (const [config, stats, orders, reason] of [
    [cfg({killSwitch: true}), {}, [], "kill_switch"],
    [cfg(), {[day]: {realizedPnl: -20}}, [], "daily_loss_limit"],
    [cfg(), {[day]: {tradesToday: 10}}, [], "max_trades_per_day"],
    [cfg(), {}, Array.from({length: 6}, () => ({placedAt: NOW - 1000})), "rate_limit"],
  ]) {
    const broker = simBroker();
    const r = await run(entrySignal(), memoryStore({stats, orders}), broker, config);
    assert.deepEqual([r.status, r.reason], ["rejected", reason]);
    assert.equal(placed(broker).length, 0);
  }
});

test("a stale entry is dropped but a stale exit still executes", async () => {
  const old = NOW - 10 * 60000;
  assert.equal((await run(entrySignal({barTime: old}), memoryStore(), simBroker())).reason, "stale_signal");
  const {store, broker} = await openPosition();
  broker.market.bid = 4.30; // above the protective stop
  const r = await run(exitSignal({barTime: old, price: 4.30, last: 4.30}), store, broker);
  assert.equal(r.status, "accepted");
});

test("environment guard: a live account is refused when paper is expected, and writes nothing", async () => {
  const broker = simBroker({accountType: "Margin"});
  const r = await run(entrySignal(), memoryStore(), broker);
  assert.deepEqual([r.status, r.reason], ["error", "environment_mismatch"]);
  assert.equal(placed(broker).length, 0);
});

test("entry: 4xx means no order (released); 5xx is looked up and never re-posted", async () => {
  let store = memoryStore();
  let broker = simBroker({failPlace: () => true, failStatus: 400});
  assert.equal((await run(entrySignal(), store, broker)).reason, "place_order_failed");
  assert.equal(await store.getPosition("WHLR"), null);
  assert.equal(broker.calls.filter((c) => c[0] === "find").length, 0);

  // 5xx but the order exists at the broker -> recovered, carries on
  store = memoryStore();
  broker = simBroker({bid: 4.10, ask: 4.10, failPlace: (o) => o.side === "Buy", failStatus: 503});
  broker.orders.set("eb-WHLR-" + (NOW - 5000) + "-B", {orderStatus: "New", executed: 0, orderQuantity: 13});
  assert.equal((await run(entrySignal(), store, broker)).status, "accepted");
  assert.equal(placed(broker, (o) => o.side === "Buy").length, 1);

  // 5xx and confirmed absent -> released
  store = memoryStore();
  broker = simBroker({failPlace: () => true, failStatus: 503});
  assert.equal((await run(entrySignal(), store, broker)).reason, "place_order_failed");
  assert.equal(await store.getPosition("WHLR"), null);

  // 5xx and the lookup fails too -> unknown: the symbol stays reserved
  store = memoryStore();
  broker = simBroker({failPlace: () => true, failStatus: 503, findThrows: true});
  assert.equal((await run(entrySignal(), store, broker)).reason, "order_state_unknown");
  assert.ok(await store.getPosition("WHLR"));
});

test("entry: HTTP 200 with Rejected is a rejection, not a success", async () => {
  const store = memoryStore();
  const r = await run(entrySignal(), store, simBroker({rejectPlace: (o) => o.side === "Buy"}));
  assert.deepEqual([r.status, r.reason], ["rejected", "broker_rejected"]);
  assert.equal(await store.getPosition("WHLR"), null);
  assert.equal((await store.getStats(nyDateKey(NOW))).tradesToday, 0);
});

// ─── stop updates ───────────────────────────────────────────────

test("stop_update: the old stop is cancelled and a higher one placed (new id)", async () => {
  const {store, broker} = await openPosition();
  const oldId = (await store.getPosition("WHLR")).stopClientOrderId;
  const r = await run(stopSignal({stop: 3.90}), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(broker.orders.get(oldId).orderStatus, "Canceled");
  const stops = placed(broker, isStop);
  assert.equal(stops.length, 2);
  assert.equal(stops[1].stopPrice, 3.90);
  assert.equal(stops[1].limitPrice, 3.80);
  assert.notEqual(stops[1].clientOrderId, oldId);
  const pos = await store.getPosition("WHLR");
  assert.equal(pos.stopLevel, 3.90);
  assert.equal(pos.stopClientOrderId, stops[1].clientOrderId);
});

test("stop_update: a stop never moves down", async () => {
  const {store, broker} = await openPosition();
  const r = await run(stopSignal({stop: 3.70}), store, broker);
  assert.deepEqual([r.status, r.reason], ["ignored", "not_higher"]);
  assert.equal(placed(broker, isStop).length, 1);
});

test("stop_update: if the old stop already filled, the position is booked closed", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 3.70;
  const r = await run(stopSignal({stop: 3.90}), store, broker);
  assert.equal(r.reason, "stop_already_filled");
  assert.equal(await store.getPosition("WHLR"), null);
  assert.equal(placed(broker, isStop).length, 1); // no new stop
});

test("stop_update while the entry is pending is stored for later", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await run(entrySignal(), store, broker);
  const r = await run(stopSignal({stop: 3.90}), store, broker);
  assert.equal(r.reason, "stored_until_filled");
  broker.market.ask = 4.10;
  await rec(store, broker);
  assert.equal(placed(broker, isStop)[0].stopPrice, 3.90);
});

test("stop_update with no position is ignored", async () => {
  const r = await run(stopSignal(), memoryStore(), simBroker());
  assert.deepEqual([r.status, r.reason], ["ignored", "no_position"]);
});

// ─── exit ───────────────────────────────────────────────────────

test("exit: cancels the stop, sells at LAST - 0.10 (not the modeled price), books the P&L", async () => {
  const {store, broker} = await openPosition();
  const stopId = (await store.getPosition("WHLR")).stopClientOrderId;
  broker.market.bid = 4.30;
  const r = await run(exitSignal({price: 4.35, last: 4.30, reason: "ema9_trail"}), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(broker.orders.get(stopId).orderStatus, "Canceled");
  const sell = placed(broker, isSell)[0];
  assert.equal(sell.limitPrice, 4.20); // last 4.30 - 0.10 (the modeled 4.35 would give 4.25)
  assert.equal(sell.orderQuantity, 13);
  assert.equal(await store.getPosition("WHLR"), null);
  assert.ok(Math.abs((await store.getStats(nyDateKey(NOW))).realizedPnl - (4.30 - 4.10) * 13) < 1e-9);
});

test("exit: the market fell below our limit -> re-priced lower until it fills", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 4.00; // the signal said 4.30, it is already 4.00
  const r = await run(exitSignal({last: 4.30, price: 4.30}), store, broker);
  assert.equal(r.status, "accepted");
  const sells = placed(broker, isSell);
  assert.deepEqual(sells.map((o) => o.limitPrice), [4.20, 4.10, 4.00]);
  assert.equal(new Set(sells.map((o) => o.clientOrderId)).size, 3);
  assert.equal(await store.getPosition("WHLR"), null);
  assert.ok(Math.abs((await store.getStats(nyDateKey(NOW))).realizedPnl - (4.00 - 4.10) * 13) < 1e-9);
});

test("a gap through the stop's limit leaves the stop unfilled; the exit still gets us out", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 3.40; // below the stop (3.78) AND below its limit (3.68): the StopLimit cannot fill
  const x = await rec(store, broker);
  assert.equal(x[0].status, "ignored"); // nothing happened at the stop
  const r = await run(exitSignal({last: 3.40, price: 3.76}), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(placed(broker, isSell)[0].limitPrice, 3.30);
  assert.equal(await store.getPosition("WHLR"), null);
});

test("exit that never fills: keeps the position and puts the stop back", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 2.0; // nobody pays our limits
  const r = await run(exitSignal({last: 4.30, price: 4.30}), store, broker);
  assert.deepEqual([r.status, r.reason], ["error", "exit_not_filled"]);
  assert.equal(placed(broker, isSell).length, 4); // first try + 3 re-prices
  const pos = await store.getPosition("WHLR");
  assert.equal(pos.filledQty, 13);
  assert.ok(pos.stopClientOrderId); // protected again
  assert.equal(placed(broker, isStop).length, 2);
  assert.equal(store.alerts[0].type, "exit_not_filled");
});

test("exit: a partly filled sell is cancelled and the rest is sold lower", async () => {
  let n = 0;
  const onPlace = (r, api) => {
    if (r.side === "Sell" && r.orderType === "Limit" && n++ === 0) {
      Object.assign(r, {frozen: true, orderStatus: "PartiallyFilled", executed: 5, priceAvg: 4.32, leavesQuantity: 8});
    }
  };
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10, onPlace});
  await run(entrySignal(), store, broker);
  broker.market.bid = 4.30;
  const r = await run(exitSignal({last: 4.30, price: 4.30}), store, broker);
  assert.equal(r.status, "accepted");
  assert.deepEqual(placed(broker, isSell).map((o) => o.orderQuantity), [13, 8]);
  assert.equal(await store.getPosition("WHLR"), null);
  const expected = (4.32 - 4.10) * 5 + (4.30 - 4.10) * 8;
  assert.ok(Math.abs((await store.getStats(nyDateKey(NOW))).realizedPnl - expected) < 1e-9);
});

test("exit: the stop filled first -> booked, nothing is sold twice", async () => {
  const {store, broker} = await openPosition();
  broker.market.bid = 3.70;
  broker.orders.get((await store.getPosition("WHLR")).stopClientOrderId); // read triggers the fill on cancel
  const r = await run(exitSignal({last: 3.70}), store, broker);
  // the cancel hits a stop that already filled
  assert.equal(r.reason, "stop_already_filled");
  assert.equal(placed(broker, isSell).length, 0);
  assert.equal(await store.getPosition("WHLR"), null);
});

test("exit: a cancel that never settles keeps the stop and sells nothing", async () => {
  const {store, broker} = await openPosition({neverSettlesCancel: true});
  broker.market.bid = 4.30;
  const r = await run(exitSignal({last: 4.30, price: 4.30}), store, broker);
  assert.deepEqual([r.status, r.reason], ["error", "stop_cancel_failed"]);
  assert.equal(placed(broker, isSell).length, 0);
  assert.ok(await store.getPosition("WHLR"));
});

test("exit with no position is ignored", async () => {
  const broker = simBroker();
  const r = await run(exitSignal(), memoryStore(), broker);
  assert.deepEqual([r.status, r.reason], ["ignored", "no_position"]);
  assert.equal(placed(broker).length, 0);
});

test("exit while the entry is still pending cancels the entry", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await run(entrySignal(), store, broker);
  const r = await run(exitSignal(), store, broker);
  assert.deepEqual([r.status, r.reason], ["ignored", "entry_cancelled_before_fill"]);
  assert.equal(await store.getPosition("WHLR"), null);
  assert.equal(placed(broker, isSell).length, 0);
});

test("exit while the entry is partly filled: sells only what was bought", async () => {
  let n = 0;
  const onPlace = (r) => {
    if (r.side === "Buy" && n++ === 0) Object.assign(r, {frozen: true, orderStatus: "PartiallyFilled", executed: 5, priceAvg: 4.12, leavesQuantity: 8});
  };
  const store = memoryStore();
  const broker = simBroker({bid: 4.30, ask: 4.30, onPlace});
  await run(entrySignal(), store, broker);
  assert.equal((await store.getPosition("WHLR")).state, "entry_pending");
  const r = await run(exitSignal({last: 4.30, price: 4.30}), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(placed(broker, isSell)[0].orderQuantity, 5);
  assert.equal(await store.getPosition("WHLR"), null);
});

// ─── dry run ────────────────────────────────────────────────────

test("dry run: simulated entry, stop and exit; the broker is never queried", async () => {
  const store = memoryStore();
  const broker = simBroker({accountType: "Margin"}); // would fail the guard if it were consulted
  const dry = cfg({dryRun: true});
  const r = await run(entrySignal(), store, broker, dry);
  assert.equal(r.status, "accepted");
  let pos = await store.getPosition("WHLR");
  assert.equal(pos.state, "open");
  assert.ok(pos.stopClientOrderId);
  assert.equal(pos.dryRun, true);
  const x = await run(exitSignal({last: 3.70}), store, broker, dry);
  assert.equal(x.status, "accepted");
  assert.equal(await store.getPosition("WHLR"), null);
  const reads = broker.calls.filter((c) => ["get", "settle", "cancel", "find", "acct"].includes(c[0]));
  assert.equal(reads.length, 0);
  assert.equal(store.trades.length, 1);
});

test("reconcile skips simulated positions", async () => {
  const store = memoryStore();
  const broker = simBroker();
  await run(entrySignal(), store, broker, cfg({dryRun: true}));
  const out = await rec(store, broker, cfg({dryRun: true}));
  assert.deepEqual(out, []);
});

// ─── plumbing ───────────────────────────────────────────────────

test("live: the stop uses Day_Plus and the configured route; ids fit 36 characters", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10, accountType: "Margin"});
  const live = cfg({environment: "live", route: "SMART"});
  await run(entrySignal({symbol: "ABCDEFGHIJ"}), store, broker, live);
  const orders = placed(broker);
  assert.equal(orders.find(isStop).timeInForce, "Day_Plus");
  assert.ok(orders.every((o) => o.route === "SMART"));
  assert.ok(orders.every((o) => o.clientOrderId.length <= 36), orders.map((o) => o.clientOrderId).join());
});

test("a busy symbol: a signal waits for the lock and gives up with an error", async () => {
  const store = memoryStore();
  store.locks.WHLR = {token: "someone-else", until: NOW + 10 * 60000};
  let clock = NOW;
  const clk = {now: () => clock, sleep: async (ms) => { clock += ms; }};
  const r = await run(exitSignal({barTime: NOW}), store, simBroker(), cfg(), clk);
  assert.deepEqual([r.status, r.reason], ["error", "symbol_busy"]);
});

// ─── fast entry (receiver) + follow-up ──────────────────────────

const place = (signal, store, broker, config = cfg(), clock = {now: () => NOW, sleep}) =>
  placeSignal({signal, store, broker, config, ...clock});
const complete = (store, broker, config = cfg(), clock = {now: () => NOW, sleep}) =>
  completeSignal({symbol: "WHLR", store, broker, config, ...clock});

test("fast entry: only the buy goes out; no fill wait, no stop yet", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10});
  const r = await place(entrySignal(), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(r.followUp, true);
  assert.equal(placed(broker).length, 1);
  assert.equal(placed(broker)[0].side, "Buy");
  assert.equal(broker.calls.filter((c) => c[0] === "settle").length, 0);
  assert.equal((await store.getPosition("WHLR")).state, "entry_pending");
});

test("fast entry is sized from `last` (the price at the crossing), not the modeled price", async () => {
  const broker = simBroker({bid: 4.30, ask: 4.30});
  await place(entrySignal({price: 4.06, last: 4.20, stop: 3.78}), memoryStore(), broker);
  assert.equal(placed(broker)[0].limitPrice, 4.30); // last 4.20 + 0.10
});

test("follow-up: the entry filled -> the protective stop is placed", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10});
  await place(entrySignal(), store, broker);
  const r = await complete(store, broker);
  assert.equal(r.position, "open");
  assert.equal(placed(broker, isStop).length, 1);
});

test("follow-up: the entry never fills -> cancelled and released", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await place(entrySignal(), store, broker);
  const r = await complete(store, broker);
  assert.deepEqual([r.position, r.reason], ["released", "entry_cancelled_before_fill"]);
  assert.equal(await store.getPosition("WHLR"), null);
});

test("follow-up waits up to entryTimeoutSec for the fill", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.50, ask: 4.50});
  await place(entrySignal(), store, broker);
  await complete(store, broker);
  const settle = broker.calls.find((c) => c[0] === "settle");
  assert.equal(settle[2], 30000);
});

test("fast entry: duplicate symbol, limits and stale signals still apply", async () => {
  const store = memoryStore();
  const broker = simBroker({bid: 4.10, ask: 4.10});
  await place(entrySignal(), store, broker);
  assert.equal((await place(entrySignal({barTime: NOW - 1000}), store, broker)).reason, "already_in_position");
  assert.equal((await place(entrySignal({barTime: NOW - 10 * 60000}), memoryStore(), broker)).reason, "stale_signal");
  assert.equal((await place(entrySignal(), memoryStore(), broker, cfg({killSwitch: true}))).reason, "kill_switch");
});

test("a fast placeSignal refuses non-entry events", async () => {
  const r = await place(exitSignal(), memoryStore(), simBroker());
  assert.equal(r.reason, "not_an_entry");
});
