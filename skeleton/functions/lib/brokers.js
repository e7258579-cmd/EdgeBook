// Broker adapters with the interface the Processor expects:
//   placeOrder(order), getOrder(clientOrderId), cancelOrder(clientOrderId),
//   findOrder(clientOrderId) (poll for an order that may not be registered yet),
//   settleOrder(clientOrderId, {timeoutMs}) (poll until the order reaches a
//     terminal status or the time runs out; returns the last order seen),
//   getAccountType() ("Paper" or anything else)

// DRY_RUN: nothing leaves the building. Every order "fills" instantly.
function createDryRunBroker() {
  return {
    async placeOrder(order) {
      return {orderStatus: "DryRun", clientOrderId: order.clientOrderId, simulated: true};
    },
    async getOrder(clientOrderId) {
      return {orderStatus: "Filled", clientOrderId, simulated: true};
    },
    async cancelOrder() {
      return {simulated: true};
    },
    async findOrder() {
      return null;
    },
    async settleOrder(clientOrderId) {
      return {orderStatus: "Filled", clientOrderId, simulated: true};
    },
    // Note: the Processor never queries a DRY_RUN broker about order state;
    // simulated positions are handled inside process.js.
    async getAccountType() {
      return "Paper";
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live adapter over the TradeZero client (tradezero.js).
function createTradeZeroBroker(tz) {
  let accountTypeCache = null;
  return {
    async placeOrder(order) {
      const placed = await tz.placeOrder(order);
      if (placed.orderStatus === "PendingNew") {
        return tz.awaitTerminal(order.clientOrderId).catch(() => placed);
      }
      return placed;
    },
    getOrder: (id) => tz.getOrder(id),
    cancelOrder: (id) => tz.cancelOrder(id),
    // After an ambiguous failure, the order may exist but not be registered
    // yet (TradeZero: retry the 404 for ~1-2 seconds). null = does not exist.
    async findOrder(id) {
      for (let i = 0; i < 6; i++) {
        const o = await tz.getOrder(id);
        if (o) return o;
        await sleep(350);
      }
      return null;
    },
    // Poll (250 ms) until the order is Filled / Canceled / Rejected / Expired /
    // DoneForDay. Returns the last order seen, which may still be non-terminal
    // (e.g. a resting limit, or PendingCancel) if the time ran out.
    async settleOrder(id, {timeoutMs = 6000} = {}) {
      const terminal = new Set(["Filled", "Canceled", "Cancelled", "Rejected", "Expired", "DoneForDay"]);
      let last = null;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const o = await tz.getOrder(id);
        if (o) {
          last = o;
          if (terminal.has(o.orderStatus)) return o;
        }
        await sleep(250);
      }
      return last;
    },
    // Cached for a minute: the Processor asks before every write, and this
    // call would otherwise add a round trip to every order.
    async getAccountType() {
      if (accountTypeCache && Date.now() - accountTypeCache.at < 60000) return accountTypeCache.value;
      const a = await tz.getAccount();
      accountTypeCache = {at: Date.now(), value: a && a.accountType};
      return accountTypeCache.value;
    },
  };
}

module.exports = {createDryRunBroker, createTradeZeroBroker};
