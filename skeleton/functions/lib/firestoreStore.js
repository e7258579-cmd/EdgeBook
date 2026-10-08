// Firestore implementation of the store used by process.js.
//   control/config          operator overrides (dryRun, killSwitch, limits)
//   signals/{key}           one document per webhook signal
//   heartbeats/{symbol}     last heartbeat per chart
//   positions/{symbol}      open or pending positions (deleted when closed)
//   locks/{symbol}          short lease so one signal per symbol runs at a time
//   stats/{YYYY-MM-DD}      daily counters
//   orders/{clientOrderId}  every order sent
//   trades/{auto}           closed trades
//   alerts/{auto}           things that need a human

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
    async listPositions() {
      const snap = await db.collection("positions").get();
      return snap.docs.map((d) => d.data());
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
    async updatePosition(symbol, patch) {
      await positions(symbol).update(patch);
    },
    async releasePosition(symbol) {
      await positions(symbol).delete();
    },
    async acquireLock(symbol, token, ttlMs, nowMs) {
      return db.runTransaction(async (tx) => {
        const ref = db.collection("locks").doc(symbol);
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().until > nowMs) return false;
        tx.set(ref, {token, until: nowMs + ttlMs});
        return true;
      });
    },
    async releaseLock(symbol, token) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("locks").doc(symbol);
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().token === token) tx.delete(ref);
      });
    },
    async recordOrder(o) {
      await db.collection("orders").doc(o.clientOrderId).set(o);
    },
    async recordAlert(a) {
      await db.collection("alerts").add(a);
    },
    async addEntryToStats(day) {
      await db.collection("stats").doc(day).set(
          {tradesToday: FieldValue.increment(1)}, {merge: true});
    },
    async closePosition(symbol, {day, pnl, exitReason, closedAt, qty}) {
      const pos = await this.getPosition(symbol);
      await db.collection("trades").add({
        symbol, pnl, exitReason, closedAt, qty,
        entryPrice: pos && (pos.entryFillPrice || pos.entryPrice),
      });
      await db.collection("stats").doc(day).set(
          {realizedPnl: FieldValue.increment(pnl)}, {merge: true});
      await positions(symbol).delete();
    },
    async getHeartbeat(symbol) {
      const snap = await db.collection("heartbeats").doc(symbol).get();
      return snap.exists ? snap.data() : null;
    },
    async setHeartbeat(symbol, data) {
      await db.collection("heartbeats").doc(symbol).set(data, {merge: true});
    },
  };
}

module.exports = {createFirestoreStore};
