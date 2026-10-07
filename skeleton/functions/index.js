// EdgeBook Firebase Functions.
//   tzWebhook         (HTTP)       Receiver: validate, dedupe, answer fast.
//                                  ENTRIES are sent to the broker right here (fast path, no queue hop).
//                                  Heartbeats are recorded here. Everything else is queued.
//   tzFollowUp        (Firestore)  After a fast entry: waits for the fill, places the protective stop.
//   tzProcessSignal   (Firestore)  Processor: the position manager, runs when a signal is queued.
//   tzReconcile       (schedule)   Every minute: finishes pending entries, notices filled stops,
//                                  warns when a symbol with a position has no heartbeat.
//   tzWebhookTest     (HTTP)       Legacy connectivity test.
// Design: docs/WEBHOOK_CONTRACT_V02.md

const crypto = require("crypto");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");

// Every function runs in the same region as the Firestore database
// (europe-west1 for this project). The receiver makes several Firestore round
// trips per signal, so keeping them in one region matters for latency.
setGlobalOptions({region: "europe-west1"});

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const {createClient} = require("./tradezero");
const {validateSignal, signalKey} = require("./lib/validate");
const {mergeConfig} = require("./lib/config");
const {processSignal, placeSignal, completeSignal, reconcileAll} = require("./lib/process");
const {createDryRunBroker, createTradeZeroBroker} = require("./lib/brokers");
const {createFirestoreStore} = require("./lib/firestoreStore");

const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");
const TZ_API_KEY_ID = defineSecret("TZ_API_KEY_ID");
const TZ_API_SECRET_KEY = defineSecret("TZ_API_SECRET_KEY");
const TZ_ACCOUNT_ID = defineSecret("TZ_ACCOUNT_ID");

// Config is read on every signal; a short in-memory cache keeps the fast path
// quick (a Kill Switch change takes effect within a few seconds).
let configCache = null;
async function loadConfig(maxAgeMs = 0) {
  if (maxAgeMs && configCache && Date.now() - configCache.at < maxAgeMs) return configCache.value;
  const snap = await db.collection("control").doc("config").get();
  configCache = {at: Date.now(), value: mergeConfig(snap.exists ? snap.data() : {})};
  return configCache.value;
}

function makeBroker(config) {
  return config.dryRun ?
    createDryRunBroker() :
    createTradeZeroBroker(createClient({
      apiKeyId: TZ_API_KEY_ID.value(),
      apiSecretKey: TZ_API_SECRET_KEY.value(),
      accountId: TZ_ACCOUNT_ID.value(),
    }));
}

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
    {
      secrets: [WEBHOOK_SECRET, TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID],
      invoker: "public",
      // NO paid warm instance (minInstances) on purpose: it costs about $2.88 a
      // month. The chart's heartbeat every few minutes keeps the instance warm
      // in practice. If cold starts turn out to hurt, add `minInstances: 1`
      // here, but only after deciding to pay for it.
      timeoutSeconds: 30,
    },
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
      const signal = checked.signal;
      if (signal.event === "heartbeat") {
        await createFirestoreStore(db, FieldValue).setHeartbeat(signal.symbol, {
          lastBarTime: signal.barTime, lastSentAt: signal.sentAt, receivedAt: Date.now(),
          tf: signal.tf, strategy: signal.strategy,
        });
        res.status(200).json({ok: true, status: "heartbeat"});
        return;
      }
      const key = signalKey(signal);
      const fast = signal.event === "entry";
      const ref = db.collection("signals").doc(key);
      try {
        // create() fails if the document exists: that is the dedupe.
        await ref.create({
          // "fast": the receiver itself sends the entry order, so the queue
          // trigger (which only takes "queued") leaves it alone.
          status: fast ? "fast" : "queued",
          signal,
          latencyMs: Date.now() - signal.sentAt, // TradingView -> us (clock skew included)
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
      if (!fast) {
        res.status(200).json({ok: true, status: "queued"});
        return;
      }

      // FAST PATH: send the entry order now, then answer.
      let outcome;
      try {
        const config = await loadConfig(5000);
        outcome = await placeSignal({
          signal, store: createFirestoreStore(db, FieldValue), broker: makeBroker(config), config,
        });
      } catch (err) {
        logger.error("fast entry crashed", err);
        outcome = {status: "error", reason: "exception", error: String(err)};
      }
      // "entry_placed" wakes tzFollowUp, which waits for the fill and places the stop.
      await ref.update({
        status: outcome.followUp ? "entry_placed" : outcome.status,
        outcome: JSON.parse(JSON.stringify(outcome)),
        placedAtMs: Date.now(),
      });
      res.status(200).json({ok: true, status: outcome.status});
    },
);

// ─── Follow-up of a fast entry ──────────────────────────────────
exports.tzFollowUp = onDocumentUpdated(
    {
      document: "signals/{signalId}",
      secrets: [TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID],
      timeoutSeconds: 120, // waits up to entryTimeoutSec for the fill
    },
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();
      if (after.status !== "entry_placed" || before.status === "entry_placed") return;
      const ref = event.data.after.ref;
      // Claim (delivery is at-least-once).
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== "entry_placed") return null;
        tx.update(ref, {status: "following_up"});
        return snap.data();
      });
      if (!claimed) return;
      const config = await loadConfig();
      let result;
      try {
        result = await completeSignal({
          symbol: claimed.signal.symbol, store: createFirestoreStore(db, FieldValue),
          broker: makeBroker(config), config,
        });
      } catch (err) {
        logger.error("follow-up crashed", err);
        result = {status: "error", reason: "exception", error: String(err)};
      }
      await ref.update({
        status: "accepted",
        followUp: JSON.parse(JSON.stringify(result)),
        completedAt: FieldValue.serverTimestamp(),
      });
      logger.info("entry follow-up", {key: ref.id, position: result.position || null, reason: result.reason || null});
    },
);

// ─── Processor ──────────────────────────────────────────────────
exports.tzProcessSignal = onDocumentCreated(
    {
      document: "signals/{signalId}",
      secrets: [TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID],
      timeoutSeconds: 120, // an exit may wait for fills and re-price a few times
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
      // How long the signal waited in the queue before we started on it.
      const queueDelayMs = claimed.receivedAt && claimed.receivedAt.toMillis ? Date.now() - claimed.receivedAt.toMillis() : null;

      const config = await loadConfig();
      const broker = makeBroker(config);
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
        queueDelayMs,
        completedAt: FieldValue.serverTimestamp(),
      });
      logger.info("signal processed", {key: ref.id, status: outcome.status, reason: outcome.reason || null});
    },
);

// ─── Reconcile + watchdog (every minute) ─────────────────────────
exports.tzReconcile = onSchedule(
    {
      schedule: "every 1 minutes",
      secrets: [TZ_API_KEY_ID, TZ_API_SECRET_KEY, TZ_ACCOUNT_ID],
      timeoutSeconds: 120,
    },
    async () => {
      const config = await loadConfig();
      if (config.dryRun) return; // simulated positions have nothing at the broker
      const store = createFirestoreStore(db, FieldValue);
      const results = await reconcileAll({store, broker: makeBroker(config), config});
      const acted = results.filter((r) => r && r.status !== "ignored");
      if (acted.length) logger.info("reconcile", acted);

      // Watchdog: a position is open, but its chart stopped sending heartbeats.
      // The protective stop is still at the broker; this only warns a human.
      const now = Date.now();
      for (const pos of await store.listPositions()) {
        const hb = await store.getHeartbeat(pos.symbol);
        const age = hb ? (now - hb.receivedAt) / 1000 : Infinity;
        if (age > config.heartbeatMaxAgeSec) {
          const slot = Math.floor(now / 600000); // at most one warning per 10 minutes
          await db.collection("alerts").doc(`heartbeat_${pos.symbol}_${slot}`).set({
            type: "heartbeat_missing", symbol: pos.symbol, ageSec: Number.isFinite(age) ? Math.round(age) : null, at: now,
          });
          logger.error("heartbeat missing for a symbol with a position", {symbol: pos.symbol, ageSec: age});
        }
      }
    },
);

// ─── Legacy connectivity test ───────────────────────────────────
exports.tzWebhookTest = require("./legacyTest").tzWebhookTest;
