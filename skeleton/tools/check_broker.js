// Read-only check of the TradeZero connection, through the deployed tzCheck function.
//
//   node tools/check_broker.js <secret>
//
// The secret can also come from the WEBHOOK_SECRET environment variable.
// tzCheck only reads (account, routes, today's orders). It sends no order.

const URL_CHECK = process.env.TZ_CHECK_URL || "https://europe-west1-edgebook-55d06.cloudfunctions.net/tzCheck";
const secret = process.argv[2] || process.env.WEBHOOK_SECRET;
if (!secret) {
  console.log("usage: node tools/check_broker.js <secret>");
  process.exit(1);
}

(async () => {
  const res = await fetch(URL_CHECK, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({secret})});
  const text = await res.text();
  console.log(res.status);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (e) {
    console.log(text);
  }
})().catch((e) => {
  console.error("request failed:", e.message);
  process.exit(1);
});
