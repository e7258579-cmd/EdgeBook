const test = require("node:test");
const assert = require("node:assert/strict");
const {validateSignal, signalKey} = require("../lib/validate");
const {sizeEntry, sellLimit} = require("../lib/sizing");
const {checkEntryLimits} = require("../lib/limits");
const {mergeConfig, nyDateKey} = require("../lib/config");
const {entrySignal, exitSignal} = require("./helpers");

const base = (o) => ({secret: "x", ...o});

test("validate: good entry and exit pass, secret is stripped", () => {
  const e = validateSignal(base(entrySignal()));
  assert.equal(e.ok, true);
  assert.equal("secret" in e.signal, false);
  assert.equal(validateSignal(base(exitSignal())).ok, true);
});

test("validate: rejects bad shapes", () => {
  assert.equal(validateSignal(null).ok, false);
  assert.equal(validateSignal(base(entrySignal({v: 2}))).ok, false);
  assert.equal(validateSignal(base(entrySignal({symbol: "aapl"}))).ok, false);
  assert.equal(validateSignal(base(entrySignal({stop: 5}))).ok, false); // stop above price
  assert.equal(validateSignal(base(entrySignal({mode: "x"}))).ok, false);
  assert.equal(validateSignal(base(exitSignal({reason: ""}))).ok, false);
  assert.equal(validateSignal(base(entrySignal({barTime: 1.5}))).ok, false);
});

test("signalKey is deterministic", () => {
  assert.equal(signalKey(entrySignal()), signalKey(entrySignal()));
  assert.notEqual(signalKey(entrySignal()), signalKey(exitSignal()));
});

test("sizing: 1% risk, offset 0.10, caps", () => {
  const config = mergeConfig({});
  // limit 4.16, stop 3.78 -> risk/share 0.38, budget $5 -> 13 shares
  assert.deepEqual(sizeEntry({price: 4.06, stop: 3.78, config}), {qty: 13, limitPrice: 4.16});
  // tight stop would give a huge qty: capped by maxShares (25)
  assert.equal(sizeEntry({price: 4.06, stop: 4.05, config}).qty, 25);
  // position value cap: $500 / 30 = 16
  assert.equal(sizeEntry({price: 29.9, stop: 29.75, config: mergeConfig({maxShares: 100})}).qty, 16);
  assert.equal(sizeEntry({price: 600, stop: 590, config}).reject, "qty_zero");
});

test("sellLimit applies the offset below, never below the minimum tick", () => {
  const config = mergeConfig({});
  assert.equal(sellLimit(3.76, config), 3.66);
  assert.equal(sellLimit(0.05, config), 0.0001);
});

test("prices use 2 decimals at/above $1 and 4 decimals below", () => {
  const config = mergeConfig({limitOffsetUsd: 0.0123});
  assert.equal(sizeEntry({price: 2.0, stop: 1.5, config}).limitPrice, 2.01);
  assert.equal(sizeEntry({price: 0.5, stop: 0.4, config}).limitPrice, 0.5123);
});

test("limits", () => {
  const config = mergeConfig({});
  const ok = {config, stats: {tradesToday: 0, realizedPnl: 0}, ordersLastMinute: 0};
  assert.equal(checkEntryLimits(ok), null);
  assert.equal(checkEntryLimits({...ok, config: mergeConfig({killSwitch: true})}), "kill_switch");
  assert.equal(checkEntryLimits({...ok, stats: {tradesToday: 0, realizedPnl: -20}}), "daily_loss_limit");
  assert.equal(checkEntryLimits({...ok, stats: {tradesToday: 10, realizedPnl: 0}}), "max_trades_per_day");
  assert.equal(checkEntryLimits({...ok, ordersLastMinute: 6}), "rate_limit");
});

test("mergeConfig ignores unknown keys and wrong types", () => {
  const c = mergeConfig({maxShares: "lots", bogus: 1, dryRun: false});
  assert.equal(c.maxShares, 25);
  assert.equal(c.dryRun, false);
  assert.equal("bogus" in c, false);
});

test("nyDateKey uses New York time", () => {
  assert.equal(nyDateKey(Date.UTC(2026, 9, 6, 3, 0, 0)), "2026-10-05"); // 23:00 on the 5th in NY
});
