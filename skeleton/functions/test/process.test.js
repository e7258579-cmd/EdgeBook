const test = require("node:test");
const assert = require("node:assert/strict");
const {processSignal} = require("../lib/process");
const {nyDateKey} = require("../lib/config");
const {memoryStore, fakeBroker, NOW, entrySignal, exitSignal, cfg} = require("./helpers");

const run = (signal, store, broker, config = cfg()) =>
  processSignal({signal, store, broker, config, now: () => NOW});

test("entry: sends a buy limit with the +0.10 offset and reserves the symbol", async () => {
  const store = memoryStore();
  const broker = fakeBroker();
  const r = await run(entrySignal(), store, broker);
  assert.equal(r.status, "accepted");
  const [, order] = broker.calls[0];
  assert.equal(order.side, "Buy");
  assert.equal(order.orderType, "Limit");
  assert.equal(order.limitPrice, 4.16);
  assert.equal(order.orderQuantity, 13);
  assert.ok(store.positions.WHLR);
  assert.equal((await store.getStats(nyDateKey(NOW))).tradesToday, 1);
});

test("entry: a second entry on the same symbol is rejected, nothing sent", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker();
  const r = await run(entrySignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.reason, "already_in_position");
  assert.equal(broker.calls.length, 0);
});

test("entry: kill switch, daily loss, trade cap and rate limit all block", async () => {
  const day = nyDateKey(NOW);
  for (const [config, stats, orders, reason] of [
    [cfg({killSwitch: true}), {}, [], "kill_switch"],
    [cfg(), {[day]: {realizedPnl: -20}}, [], "daily_loss_limit"],
    [cfg(), {[day]: {tradesToday: 10}}, [], "max_trades_per_day"],
    [cfg(), {}, Array.from({length: 6}, () => ({placedAt: NOW - 1000})), "rate_limit"],
  ]) {
    const broker = fakeBroker();
    const r = await run(entrySignal(), memoryStore({stats, orders}), broker, config);
    assert.equal(r.status, "rejected");
    assert.equal(r.reason, reason);
    assert.equal(broker.calls.length, 0);
  }
});

test("entry: stale signals are dropped", async () => {
  const r = await run(entrySignal({barTime: NOW - 10 * 60000}), memoryStore(), fakeBroker());
  assert.equal(r.reason, "stale_signal");
});

test("entry: failed placement releases the reservation", async () => {
  const store = memoryStore();
  const r = await run(entrySignal(), store, fakeBroker({failPlace: true}));
  assert.equal(r.status, "error");
  assert.equal(store.positions.WHLR, undefined);
});

test("exit: no position is ignored", async () => {
  const broker = fakeBroker();
  const r = await run(exitSignal(), memoryStore(), broker);
  assert.deepEqual([r.status, r.reason], ["ignored", "no_position"]);
  assert.equal(broker.calls.length, 0);
});

test("exit: sells the full quantity with the -0.10 offset and books the P&L", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker();
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.status, "accepted");
  const sell = broker.calls.find((c) => c[0] === "place")[1];
  assert.equal(sell.side, "Sell");
  assert.equal(sell.limitPrice, 3.66);
  assert.equal(sell.orderQuantity, 13);
  assert.equal(store.positions.WHLR, undefined);
  assert.ok(Math.abs((await store.getStats(nyDateKey(NOW))).realizedPnl - (3.76 - 4.06) * 13) < 1e-9);
});

test("exit is allowed even with the kill switch on", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const r = await run(exitSignal({barTime: NOW - 1000}), store, fakeBroker(), cfg({killSwitch: true}));
  assert.equal(r.status, "accepted");
});

test("losses add up to the daily limit and then block new entries", async () => {
  const store = memoryStore();
  // entry 4.06 -> exit 1.00, qty 13: about -39.8, beyond the 20$ limit
  await run(entrySignal(), store, fakeBroker());
  await run(exitSignal({barTime: NOW - 1000, price: 1.0}), store, fakeBroker());
  const r = await run(entrySignal({barTime: NOW - 500}), store, fakeBroker());
  assert.equal(r.reason, "daily_loss_limit");
});

test("live exit: entry that never filled is released, no sell sent", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker({entryStatus: "Canceled"});
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.reason, "entry_never_filled");
  assert.equal(broker.calls.filter((c) => c[0] === "place").length, 0);
  assert.equal(store.positions.WHLR, undefined);
});

test("live exit: working entry is cancelled and the position released", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker({entryStatus: "New"});
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.reason, "entry_cancelled_before_fill");
  assert.equal(broker.calls.filter((c) => c[0] === "cancel").length, 1);
  assert.equal(broker.calls.filter((c) => c[0] === "place").length, 0);
  assert.equal(store.positions.WHLR, undefined);
});

test("live exit: cancel fails because the entry filled meanwhile -> sells", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker({entryStatus: ["New", "Filled"], cancelThrows: true});
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.status, "accepted");
  assert.equal(broker.calls.filter((c) => c[0] === "place").length, 1);
  assert.equal(store.positions.WHLR, undefined);
});

test("live exit: working entry whose cancel fails for real errors loudly", async () => {
  const store = memoryStore();
  await run(entrySignal(), store, fakeBroker());
  const broker = fakeBroker({entryStatus: "New", cancelThrows: true});
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker);
  assert.equal(r.status, "error");
  assert.equal(r.reason, "entry_not_filled_cancel_failed");
  assert.ok(store.positions.WHLR); // still reserved
  assert.equal(broker.calls.filter((c) => c[0] === "place").length, 0);
});

test("dry run: exit does not consult the broker for the entry status", async () => {
  const store = memoryStore();
  const dry = cfg({dryRun: true});
  await run(entrySignal(), store, fakeBroker(), dry);
  const broker = fakeBroker({entryStatus: "New", cancelThrows: true});
  const r = await run(exitSignal({barTime: NOW - 1000}), store, broker, dry);
  assert.equal(r.status, "accepted");
  assert.equal(broker.calls.filter((c) => c[0] === "get").length, 0);
});
