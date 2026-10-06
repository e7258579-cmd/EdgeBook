// LEGACY connectivity test (kept so the existing test alert keeps working).
// EdgeBook — SKELETON connectivity test, not the real strategy.
// Goal: prove every link in the chain works — TradingView webhook ->
// Firebase -> Firestore -> TradeZero — before investing more in the
// strategy logic itself.
//
// What it does, every time it's called:
//   1. Checks the shared secret (same idea as the real design, main spec §4a).
//   2. Logs receipt to Firestore IMMEDIATELY — this alone proves
//      TradingView -> Firebase works, even if every step after it fails.
//   3. Calls GET /account on TradeZero — proves the API keys work,
//      before risking an order on a broken connection.
//   4. Places ONE resting Limit order (1 share AAPL at $1.00 — far below
//      market on purpose, so it rests instead of filling). Proves order
//      placement works end-to-end.
//   5. Writes the outcome of every step back to the same Firestore
//      document, so you can see exactly how far it got if something fails.

const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");
const {createClient} = require("./tradezero");

const db = admin.firestore(); // initializeApp() is called once in index.js

const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");
const TZ_API_KEY_ID = defineSecret("TZ_API_KEY_ID");
const TZ_API_SECRET_KEY = defineSecret("TZ_API_SECRET_KEY");
const TZ_ACCOUNT_ID = defineSecret("TZ_ACCOUNT_ID");

exports.tzWebhookTest = onRequest(
    {secrets: [WEBHOOK_SECRET, TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID]},
    async (req, res) => {
      const body = req.body || {};

      // ─── Step 1 — secret check ──────────────────────────────
      if (body.secret !== WEBHOOK_SECRET.value()) {
        logger.warn("Rejected: bad or missing secret");
        res.status(401).send("unauthorized");
        return;
      }

      // ─── Step 2 — log receipt, before touching TradeZero at all ──
      const logRef = await db.collection("skeleton_test_log").add({
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        payload: body,
        stage: "received",
      });

      const tz = createClient({
        apiKeyId: TZ_API_KEY_ID.value(),
        apiSecretKey: TZ_API_SECRET_KEY.value(),
        accountId: TZ_ACCOUNT_ID.value(),
      });

      // ─── Step 3 — confirm the keys work before risking an order ──
      let account;
      try {
        account = await tz.getAccount();
        await logRef.update({
          stage: "account_ok",
          accountType: account.accountType || null,
        });
      } catch (err) {
        logger.error("TradeZero getAccount failed", err);
        await logRef.update({
          stage: "account_error",
          error: String(err),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(500).json({ok: false, step: "account", error: String(err)});
        return;
      }

      // ─── Step 4 — place one resting test order (won't fill) ──
      try {
        const clientOrderId = `skeleton-test-${Date.now()}`;
        const placed = await tz.placeOrder({
          securityType: "Stock",
          symbol: "AAPL",
          side: "Buy",
          openClose: "Open",
          orderType: "Limit",
          limitPrice: 1.00, // deliberately far below market — should rest, not fill
          orderQuantity: 1,
          timeInForce: "Day",
          clientOrderId,
        });

        const final = placed.orderStatus === "PendingNew" ?
          await tz.awaitTerminal(clientOrderId).catch((e) => ({
            orderStatus: "unresolved",
            error: String(e),
          })) :
          placed;

        await logRef.update({
          stage: "order_done",
          orderPlaced: placed,
          orderFinal: final,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({ok: true, accountType: account.accountType, orderStatus: final.orderStatus, clientOrderId});
      } catch (err) {
        logger.error("TradeZero placeOrder failed", err);
        await logRef.update({
          stage: "order_error",
          error: String(err),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(500).json({ok: false, step: "order", error: String(err)});
      }
    },
);
