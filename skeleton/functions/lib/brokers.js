// Broker adapters with the interface the Processor expects:
//   placeOrder(order), getOrder(clientOrderId), cancelOrder(clientOrderId),
//   findOrder(clientOrderId) (poll for an order that may not be registered yet),
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
    async getAccountType() {
      return "Paper";
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live adapter over the TradeZero client (tradezero.js).
function createTradeZeroBroker(tz) {
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
    async getAccountType() {
      const a = await tz.getAccount();
      return a && a.accountType;
    },
  };
}

module.exports = {createDryRunBroker, createTradeZeroBroker};
