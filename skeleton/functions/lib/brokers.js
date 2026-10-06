// Broker adapters with the interface the Processor expects:
//   placeOrder(order), getOrder(clientOrderId), cancelOrder(clientOrderId)

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
  };
}

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
  };
}

module.exports = {createDryRunBroker, createTradeZeroBroker};
