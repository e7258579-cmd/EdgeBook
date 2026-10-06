// EdgeBook Firebase Functions.
//   tzWebhook         (HTTP)       Receiver: validate, dedupe, queue the signal, answer fast.
//   tzProcessSignal   (Firestore)  Processor: all the trading logic, runs when a signal is queued.
//   tzWebhookTest     (HTTP)       Legacy connectivity test.
// Design: docs/WEBHOOK_CONTRACT_V01.md

const crypto = require("crypto");
const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const {createClient} = require("./tradezero");
const {validateSignal, signalKey} = require("./lib/validate");
const {mergeConfig} = require("./lib/config");
const {processSignal} = require("./lib/process");
const {createDryRunBroker, createTradeZeroBroker} = require("./lib/brokers");
const {createFirestoreStore} = require("./lib/firestoreStore");

const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");
const TZ_API_KEY_ID = defineSecret("TZ_API_KEY_ID");
const TZ_API_SECRET_KEY = defineSecret("TZ_API_SECRET_KEY");
const TZ_ACCOUNT_ID = defineSecret("TZ_ACCOUNT_ID");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// TradingView sends application/json only when the message is valid JSON;
// otherwise text/plain. Handle both.
function parseBody(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) return req.body;
  const raw = typeof req.body === "string" && req.body ? req.body :
    (req.rawBody ? req.rawBody.toString("utf8") : "");
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ─── Receiver ───────────────────────────────────────────────────
exports.tzWebhook = onRequest(
    {secrets: [WEBHOOK_SECRET], invoker: "public"},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("method not allowed");
        return;
      }
      const body = parseBody(req);
      if (!body || typeof body !== "object") {
        res.status(400).json({ok: false, error: "body is not JSON"});
        return;
      }
      if (!safeEqual(body.secret || "", WEBHOOK_SECRET.value())) {
        logger.warn("Rejected: bad or missing secret");
        res.status(401).send("unauthorized");
        return;
      }
      const checked = validateSignal(body);
      if (!checked.ok) {
        logger.warn("Rejected: invalid signal", checked.errors);
        res.status(400).json({ok: false, error: checked.errors});
        return;
      }
      const key = signalKey(checked.signal);
      try {
        // create() fails if the document exists: that is the dedupe.
        await db.collection("signals").doc(key).create({
          status: "queued",
          signal: checked.signal,
          receivedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        if (err && (err.code === 6 || /already exists/i.test(String(err.message)))) {
          res.status(200).json({ok: true, status: "duplicate"});
          return;
        }
        logger.error("Could not queue signal", err);
        res.status(500).json({ok: false, error: "queue_failed"});
        return;
      }
      res.status(200).json({ok: true, status: "queued"});
    },
);

// ─── Processor ──────────────────────────────────────────────────
exports.tzProcessSignal = onDocumentCreated(
    {
      document: "signals/{signalId}",
      secrets: [TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID],
    },
    async (event) => {
      const ref = event.data.ref;
      // Claim: delivery is at-least-once, so only one run may proceed.
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== "queued") return null;
        tx.update(ref, {status: "processing", startedAt: FieldValue.serverTimestamp()});
        return snap.data();
      });
      if (!claimed) return;

      const cfgSnap = await db.collection("control").doc("config").get();
      const config = mergeConfig(cfgSnap.exists ? cfgSnap.data() : {});
      const broker = config.dryRun ?
        createDryRunBroker() :
        createTradeZeroBroker(createClient({
          apiKeyId: TZ_API_KEY_ID.value(),
          apiSecretKey: TZ_API_SECRET_KEY.value(),
          accountId: TZ_ACCOUNT_ID.value(),
        }));
      const store = createFirestoreStore(db, FieldValue);

      let outcome;
      try {
        outcome = await processSignal({signal: claimed.signal, store, broker, config});
      } catch (err) {
        logger.error("processSignal crashed", err);
        outcome = {status: "error", reason: "exception", error: String(err)};
      }
      await ref.update({
        status: outcome.status,
        outcome: JSON.parse(JSON.stringify(outcome)),
        dryRun: config.dryRun,
        completedAt: FieldValue.serverTimestamp(),
      });
      logger.info("signal processed", {key: ref.id, status: outcome.status, reason: outcome.reason || null});
    },
);

// ─── Legacy connectivity test ───────────────────────────────────
exports.tzWebhookTest = require("./legacyTest").tzWebhookTest;
