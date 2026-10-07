const {mergeConfig} = require("../lib/config");

const clone = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

// In-memory store with the same interface as the Firestore store.
// Reads return copies, like Firestore does.
function memoryStore(init = {}) {
  const s = {
    positions: clone(init.positions || {}),
    stats: clone(init.stats || {}),
    orders: [...(init.orders || [])],
    trades: [],
    alerts: [],
    locks: {},
    heartbeats: {},
    async getStats(day) {
      const d = s.stats[day] || {};
      return {tradesToday: d.tradesToday || 0, realizedPnl: d.realizedPnl || 0};
    },
    async countOrdersSince(ms) {
      return s.orders.filter((o) => o.placedAt >= ms).length;
    },
    async getPosition(sym) {
      return clone(s.positions[sym]) || null;
    },
    async listPositions() {
      return Object.values(s.positions).map(clone);
    },
    async reservePosition(sym, data) {
      if (s.positions[sym]) return false;
      s.positions[sym] = clone(data);
      return true;
    },
    async updatePosition(sym, patch) {
      Object.assign(s.positions[sym], clone(patch));
    },
    async releasePosition(sym) {
      delete s.positions[sym];
    },
    async acquireLock(sym, token, ttl, nowMs) {
      if (s.locks[sym] && s.locks[sym].until > nowMs) return false;
      s.locks[sym] = {token, until: nowMs + ttl};
      return true;
    },
    async releaseLock(sym, token) {
      if (s.locks[sym] && s.locks[sym].token === token) delete s.locks[sym];
    },
    async recordOrder(o) {
      s.orders.push(clone(o));
    },
    async recordAlert(a) {
      s.alerts.push(a);
    },
    async addEntryToStats(day) {
      s.stats[day] = {...(s.stats[day] || {}), tradesToday: ((s.stats[day] || {}).tradesToday || 0) + 1};
    },
    async closePosition(sym, {day, pnl, exitReason, qty}) {
      s.trades.push({sym, pnl, exitReason, qty});
      s.stats[day] = {...(s.stats[day] || {}), realizedPnl: ((s.stats[day] || {}).realizedPnl || 0) + pnl};
      delete s.positions[sym];
    },
    async getHeartbeat(sym) {
      return s.heartbeats[sym] || null;
    },
    async setHeartbeat(sym, d) {
      s.heartbeats[sym] = {...(s.heartbeats[sym] || {}), ...d};
    },
  };
  return s;
}

// A tiny simulated exchange. Orders are evaluated lazily whenever they are read:
//   Buy Limit      fills at `ask` when limit >= ask
//   Sell Limit     fills at `bid` when limit <= bid
//   Sell StopLimit triggers when bid <= stopPrice, and then fills at `bid`
//                  when limit <= bid (otherwise it keeps working as a limit)
// Tests move `market` and can poke orders directly with `setOrder`.
function simBroker(opts = {}) {
  const orders = new Map();
  const calls = [];
  const market = {bid: opts.bid ?? 100, ask: opts.ask ?? opts.bid ?? 100};
  const httpError = (status, msg) => Object.assign(new Error(msg), {status});

  const evaluate = (r) => {
    if (r.frozen) return;
    if (r.orderStatus === "PendingNew") r.orderStatus = "New";
    if (isDone(r)) return;
    if (r.orderType === "Limit" && r.side === "Buy" && r.limitPrice >= market.ask) fill(r, market.ask);
    else if (r.orderType === "Limit" && r.side === "Sell" && r.limitPrice <= market.bid) fill(r, market.bid);
    else if (r.orderType === "StopLimit" && r.side === "Sell" && market.bid <= r.stopPrice && r.limitPrice <= market.bid) fill(r, market.bid);
  };
  const isDone = (r) => ["Filled", "Canceled", "Rejected", "Expired"].includes(r.orderStatus);
  const fill = (r, px) => Object.assign(r, {orderStatus: "Filled", executed: r.orderQuantity, leavesQuantity: 0, priceAvg: px});

  const api = {
    calls, orders, market,
    setOrder(id, patch) {
      Object.assign(orders.get(id), {frozen: true}, patch);
    },
    ids(filter = () => true) {
      return [...orders.values()].filter(filter).map((o) => o.clientOrderId);
    },
    async placeOrder(o) {
      calls.push(["place", o]);
      if (opts.failPlace && opts.failPlace(o)) throw httpError(opts.failStatus || 400, "boom");
      const rec = {...o, orderStatus: "PendingNew", executed: 0, leavesQuantity: o.orderQuantity, priceAvg: 0, text: null};
      if (opts.rejectPlace && opts.rejectPlace(o)) Object.assign(rec, {orderStatus: "Rejected", text: "R118: wrong side", frozen: true});
      orders.set(o.clientOrderId, rec);
      if (opts.onPlace) opts.onPlace(rec, api);
      return {...rec};
    },
    async getOrder(id) {
      calls.push(["get", id]);
      const r = orders.get(id);
      if (!r) return null;
      evaluate(r);
      return {...r};
    },
    async settleOrder(id, o) {
      calls.push(["settle", id, o && o.timeoutMs]);
      const r = orders.get(id);
      if (!r) return null;
      evaluate(r);
      return {...r};
    },
    async cancelOrder(id) {
      calls.push(["cancel", id]);
      const r = orders.get(id);
      if (!r) throw httpError(404, "not found");
      evaluate(r);
      if (isDone(r)) throw httpError(404, "terminal");
      if (opts.neverSettlesCancel) {
        Object.assign(r, {orderStatus: "PendingCancel", frozen: true});
        return {};
      }
      Object.assign(r, {orderStatus: "Canceled", leavesQuantity: 0, frozen: true});
      return {};
    },
    async findOrder(id) {
      calls.push(["find", id]);
      if (opts.findThrows) throw new Error("lookup failed");
      return orders.has(id) ? {...orders.get(id)} : null;
    },
    async getAccountType() {
      calls.push(["acct"]);
      return opts.accountType || "Paper";
    },
  };
  return api;
}

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0); // 08:00 New York
const entrySignal = (o = {}) => ({
  v: 2, event: "entry", symbol: "WHLR", barTime: NOW - 5000, sentAt: NOW - 4000, tf: "1",
  strategy: "V05", session: "pre", price: 4.06, stop: 3.78, mode: "stopbuy", ...o,
});
const exitSignal = (o = {}) => ({
  v: 2, event: "exit", symbol: "WHLR", barTime: NOW - 1000, sentAt: NOW - 500, tf: "1",
  strategy: "V05", session: "pre", price: 3.76, last: 3.70, reason: "peak_trail", ...o,
});
const stopSignal = (o = {}) => ({
  v: 2, event: "stop_update", symbol: "WHLR", barTime: NOW - 2000, sentAt: NOW - 1500, tf: "1",
  strategy: "V05", session: "pre", stop: 3.90, ...o,
});
const cfg = (o = {}) => mergeConfig({dryRun: false, ...o});

module.exports = {memoryStore, simBroker, NOW, entrySignal, exitSignal, stopSignal, cfg};
