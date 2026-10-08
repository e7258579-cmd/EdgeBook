// Webhook payload validation. See docs/WEBHOOK_CONTRACT_V02.md.

const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const pos = (x) => num(x) && x > 0;
const EVENTS = ["entry", "stop_update", "exit", "heartbeat"];

function validateSignal(body) {
  const errors = [];
  const b = body && typeof body === "object" ? body : {};
  if (b.v !== 2) errors.push("v must be 2");
  if (!EVENTS.includes(b.event)) errors.push("event must be entry|stop_update|exit|heartbeat");
  if (typeof b.symbol !== "string" || !SYMBOL_RE.test(b.symbol)) errors.push("bad symbol");
  if (!Number.isInteger(b.barTime) || b.barTime <= 0) errors.push("bad barTime");
  if (!Number.isInteger(b.sentAt) || b.sentAt <= 0) errors.push("bad sentAt");
  if (typeof b.tf !== "string" || !b.tf) errors.push("bad tf");
  if (typeof b.strategy !== "string" || !b.strategy) errors.push("bad strategy");
  if (!["pre", "regular", "post"].includes(b.session)) errors.push("session must be pre|regular|post");

  if (b.event === "entry") {
    if (!pos(b.price)) errors.push("price must be > 0");
    if (!pos(b.stop)) errors.push("stop must be > 0");
    else if (pos(b.price) && b.stop >= b.price) errors.push("stop must be below price");
    if (b.mode !== "stopbuy" && b.mode !== "close") errors.push("mode must be stopbuy|close");
    if (b.trigger !== undefined && !pos(b.trigger)) errors.push("bad trigger");
    if (b.qtyHint !== undefined && !pos(b.qtyHint)) errors.push("bad qtyHint");
    if (b.last !== undefined && !pos(b.last)) errors.push("bad last");
  }
  if (b.event === "stop_update") {
    if (!pos(b.stop)) errors.push("stop must be > 0");
  }
  if (b.event === "exit") {
    if (typeof b.reason !== "string" || !b.reason || b.reason.length > 64) errors.push("bad reason");
    if (!pos(b.price)) errors.push("price must be > 0");
    if (b.last !== undefined && !pos(b.last)) errors.push("bad last");
  }
  if (errors.length) return {ok: false, errors};

  const signal = {
    v: 2, event: b.event, symbol: b.symbol, barTime: b.barTime, sentAt: b.sentAt,
    tf: b.tf, strategy: b.strategy, session: b.session,
  };
  if (b.event === "entry") {
    Object.assign(signal, {price: b.price, stop: b.stop, mode: b.mode});
    for (const k of ["trigger", "qtyHint", "last"]) if (b[k] !== undefined) signal[k] = b[k];
  } else if (b.event === "stop_update") {
    signal.stop = b.stop;
  } else if (b.event === "exit") {
    Object.assign(signal, {reason: b.reason, price: b.price});
    if (b.last !== undefined) signal.last = b.last;
  }
  return {ok: true, signal};
}

// Idempotency key (also the Firestore document id).
function signalKey(s) {
  return `${s.symbol}_${s.event}_${s.barTime}`;
}

module.exports = {validateSignal, signalKey};
