const test = require("node:test");
const assert = require("node:assert/strict");
const {createClient} = require("../tradezero");

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({url, method: init.method || "GET"});
    return handler(url, init);
  };
  return fn(calls).finally(() => {
    globalThis.fetch = real;
  });
}
const client = () => createClient({apiKeyId: "k", apiSecretKey: "s", accountId: "ACC1"});
const ok = (body) => ({ok: true, status: 200, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body});

test("cancelOrder: DELETE on the plural /orders/ path", () => withFetch(() => ok(), async (calls) => {
  const r = await client().cancelOrder("eb-WHLR-1-B");
  assert.deepEqual(r, {ok: true});
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, "https://webapi.tradezero.com/v1/api/accounts/ACC1/orders/eb-WHLR-1-B");
}));

test("cancelOrder: a non-2xx response throws", () => withFetch(
    () => ({ok: false, status: 409, text: async () => "already filled"}),
    async () => {
      await assert.rejects(client().cancelOrder("x"), /cancelOrder HTTP 409/);
    },
));

test("getOrder uses the singular /order/ path, getTodaysOrders and getRoutes the list paths", () => withFetch(() => ok({}), async (calls) => {
  const c = client();
  await c.getOrder("abc");
  await c.getTodaysOrders();
  await c.getRoutes();
  assert.deepEqual(calls.map((x) => x.url.replace("https://webapi.tradezero.com/v1/api", "")), [
    "/accounts/ACC1/order/abc",
    "/accounts/ACC1/orders",
    "/accounts/ACC1/routes",
  ]);
}));
