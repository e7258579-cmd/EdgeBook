// Webhook payload validation. See docs/WEBHOOK_CONTRACT_V01.md.

const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const pos = (x) => num(x) && x > 0;

function validateSignal(body) {
  const errors = [];
  const b = body && typeof body === "object" ? body : {};
  if (b.v !== 1) errors.push("v must be 1");
  if (b.event !== "entry" && b.event !== "exit") errors.push("event must be entry|exit");
  if (typeof b.symbol !== "string" || !SYMBOL_RE.test(b.symbol)) errors.push("bad symbol");
  if (!Number.isInteger(b.barTime) || b.barTime <= 0) errors.push("bad barTime");
  if (typeof b.tf !== "string" || !b.tf) errors.push("bad tf");
  if (typeof b.strategy !== "string" || !b.strategy) errors.push("bad strategy");
  if (!["pre", "regular", "post"].includes(b.session)) errors.push("session must be pre|regular|post");
  if (!pos(b.price)) errors.push("price must be > 0");

  if (b.event === "entry") {
    if (!pos(b.stop)) errors.push("stop must be > 0");
    else if (pos(b.price) && b.stop >= b.price) errors.push("stop must be below price");
    if (b.mode !== "stopbuy" && b.mode !== "close") errors.push("mode must be stopbuy|close");
    if (b.trigger !== undefined && !pos(b.trigger)) errors.push("bad trigger");
    if (b.qtyHint !== undefined && !pos(b.qtyHint)) errors.push("bad qtyHint");
  }
  if (b.event === "exit") {
    if (typeof b.reason !== "string" || !b.reason || b.reason.length > 64) errors.push("bad reason");
  }
  if (errors.length) return {ok: false, errors};

  const signal = {
    v: 1, event: b.event, symbol: b.symbol, barTime: b.barTime, tf: b.tf,
    strategy: b.strategy, session: b.session, price: b.price,
  };
  if (b.event === "entry") {
    signal.stop = b.stop;
    signal.mode = b.mode;
    if (b.trigger !== undefined) signal.trigger = b.trigger;
    if (b.qtyHint !== undefined) signal.qtyHint = b.qtyHint;
  } else {
    signal.reason = b.reason;
  }
  return {ok: true, signal};
}

// Idempotency key (also the Firestore document id).
function signalKey(s) {
  return `${s.symbol}_${s.event}_${s.barTime}`;
}

module.exports = {validateSignal, signalKey};
