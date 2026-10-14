// Sends one test webhook message to the deployed tzWebhook, with fresh timestamps.
//
//   node tools/send_test.js <url> <secret> <heartbeat|entry|stop_update|exit> [symbol]
//
// The secret can also come from the WEBHOOK_SECRET environment variable.
// With dryRun=true in Firestore (control/config, the default) nothing is sent to
// TradeZero: you only see the result in Firestore.
//
// Run the messages in this order for a full simulated trade:
//   heartbeat -> entry -> stop_update -> exit
// Use a symbol you never trade (default TEST). Each run uses the CURRENT minute
// as the bar time, so send one message of each kind per minute.

const [, , url, secretArg, kind, symbolArg] = process.argv;
const secret = secretArg && !["heartbeat", "entry", "stop_update", "exit"].includes(secretArg) ? secretArg : process.env.WEBHOOK_SECRET;
if (!url || !secret || !["heartbeat", "entry", "stop_update", "exit"].includes(kind || secretArg)) {
  console.log("usage: node tools/send_test.js <url> <secret> <heartbeat|entry|stop_update|exit> [symbol]");
  process.exit(1);
}
const event = kind || secretArg;
const symbol = (symbolArg || "TEST").toUpperCase();
const now = Date.now();
const barTime = Math.floor(now / 60000) * 60000 + 60000; // end of the current minute, like time_close
const base = {secret, v: 2, event, symbol, barTime, sentAt: now, tf: "1", strategy: "V05", session: "pre"};
const extra = {
  heartbeat: {},
  entry: {price: 4.06, stop: 3.78, trigger: 4.06, mode: "stopbuy", qtyHint: 25, last: 4.08},
  stop_update: {stop: 3.90, last: 4.20},
  exit: {reason: "test_exit", price: 4.30, last: 4.30},
}[event];

(async () => {
  const res = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({...base, ...extra})});
  console.log(res.status, await res.text());
})().catch((e) => {
  console.error("request failed:", e.message);
  process.exit(1);
});
