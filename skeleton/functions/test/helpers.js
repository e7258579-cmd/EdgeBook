const {mergeConfig} = require("../lib/config");

// In-memory store with the same interface as the Firestore store.
function memoryStore(init = {}) {
  const s = {
    positions: {...(init.positions || {})},
    stats: {...(init.stats || {})},
    orders: [...(init.orders || [])],
    trades: [],
    async getStats(day) {
      const d = s.stats[day] || {};
      return {tradesToday: d.tradesToday || 0, realizedPnl: d.realizedPnl || 0};
    },
    async countOrdersSince(ms) {
      return s.orders.filter((o) => o.placedAt >= ms).length;
    },
    async getPosition(sym) {
      return s.positions[sym] || null;
    },
    async reservePosition(sym, data) {
      if (s.positions[sym]) return false;
      s.positions[sym] = data;
      return true;
    },
    async releasePosition(sym) {
      delete s.positions[sym];
    },
    async recordOrder(o) {
      s.orders.push(o);
    },
    async addEntryToStats(day) {
      s.stats[day] = {...(s.stats[day] || {}), tradesToday: ((s.stats[day] || {}).tradesToday || 0) + 1};
    },
    async closePosition(sym, {day, pnl, exitReason}) {
      s.trades.push({sym, pnl, exitReason});
      s.stats[day] = {...(s.stats[day] || {}), realizedPnl: ((s.stats[day] || {}).realizedPnl || 0) + pnl};
      delete s.positions[sym];
    },
  };
  return s;
}

// Fake broker that records what it was asked to do.
function fakeBroker(opts = {}) {
  const calls = [];
  return {
    calls,
    async placeOrder(o) {
      calls.push(["place", o]);
      if (opts.failPlace) throw new Error("boom");
      return {orderStatus: "New"};
    },
    async getOrder(id) {
      calls.push(["get", id]);
      // entryStatus can be a list: one status per call, the last one repeats.
      const seq = Array.isArray(opts.entryStatus) ? opts.entryStatus : [opts.entryStatus || "Filled"];
      const i = Math.min(calls.filter((c) => c[0] === "get").length - 1, seq.length - 1);
      return {orderStatus: seq[i]};
    },
    async cancelOrder(id) {
      calls.push(["cancel", id]);
      if (opts.cancelThrows) throw new Error("not implemented");
    },
  };
}

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0); // 08:00 New York
const entrySignal = (o = {}) => ({
  v: 1, event: "entry", symbol: "WHLR", barTime: NOW - 5000, tf: "1", strategy: "V05",
  session: "pre", price: 4.06, stop: 3.78, mode: "stopbuy", ...o,
});
const exitSignal = (o = {}) => ({
  v: 1, event: "exit", symbol: "WHLR", barTime: NOW - 5000, tf: "1", strategy: "V05",
  session: "pre", price: 3.76, reason: "peak_trail", ...o,
});
const cfg = (o = {}) => mergeConfig({dryRun: false, ...o});

module.exports = {memoryStore, fakeBroker, NOW, entrySignal, exitSignal, cfg};
