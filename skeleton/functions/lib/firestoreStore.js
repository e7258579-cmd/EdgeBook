// Firestore implementation of the store used by process.js.
//   control/config        operator overrides (dryRun, killSwitch, limits)
//   signals/{key}         one document per webhook signal
//   positions/{symbol}    open positions (deleted when closed)
//   stats/{YYYY-MM-DD}    daily counters
//   orders/{clientOrderId}  every order sent
//   trades/{auto}         closed trades

function createFirestoreStore(db, FieldValue) {
  const positions = (symbol) => db.collection("positions").doc(symbol);

  return {
    async getStats(day) {
      const snap = await db.collection("stats").doc(day).get();
      const d = snap.exists ? snap.data() : {};
      return {tradesToday: d.tradesToday || 0, realizedPnl: d.realizedPnl || 0};
    },
    async countOrdersSince(ms) {
      const snap = await db.collection("orders").where("placedAt", ">=", ms).count().get();
      return snap.data().count;
    },
    async getPosition(symbol) {
      const snap = await positions(symbol).get();
      return snap.exists ? snap.data() : null;
    },
    // Atomically create the position; false if one already exists.
    async reservePosition(symbol, data) {
      return db.runTransaction(async (tx) => {
        const ref = positions(symbol);
        const snap = await tx.get(ref);
        if (snap.exists) return false;
        tx.set(ref, data);
        return true;
      });
    },
    async releasePosition(symbol) {
      await positions(symbol).delete();
    },
    async recordOrder(o) {
      await db.collection("orders").doc(o.clientOrderId).set(o);
    },
    async addEntryToStats(day) {
      await db.collection("stats").doc(day).set(
          {tradesToday: FieldValue.increment(1)}, {merge: true});
    },
    async closePosition(symbol, {day, pnl, exitReason, closedAt}) {
      const pos = await this.getPosition(symbol);
      await db.collection("trades").add({
        symbol, pnl, exitReason, closedAt, qty: pos && pos.qty,
        entryPrice: pos && pos.entryPrice,
      });
      await db.collection("stats").doc(day).set(
          {realizedPnl: FieldValue.increment(pnl)}, {merge: true});
      await positions(symbol).delete();
    },
  };
}

module.exports = {createFirestoreStore};
