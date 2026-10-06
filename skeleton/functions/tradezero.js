// Minimal TradeZero REST client — built from developer.tradezero.com docs
// (Authentication + Equity Trading pages), fetched and verified today.
// Deliberately small: only what the connectivity skeleton needs.
// Orders endpoints (incl. cancel, today's orders, routes) follow the path table
// on TradeZero's Orders page. NOT yet built: positions, WebSocket stream.

const BASE_URL = "https://webapi.tradezero.com";

function createClient({apiKeyId, apiSecretKey, accountId}) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "TZ-API-KEY-ID": apiKeyId,
    "TZ-API-SECRET-KEY": apiSecretKey,
  };

  // GET /v1/api/account/{accountId} — note: SINGULAR "account" here.
  // Every other endpoint below uses PLURAL "accounts". This isn't a typo —
  // it's how TradeZero's own docs show it. Confirms auth + finds out
  // paper vs live (accountType) before we try anything that places an order.
  async function getAccount() {
    const res = await fetch(`${BASE_URL}/v1/api/account/${accountId}`, {headers});
    if (!res.ok) {
      throw new Error(`getAccount HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  // POST /v1/api/accounts/{accountId}/order
  // HTTP 200 does NOT mean the order was accepted for trading — it means
  // the request was received. Always read orderStatus in the response.
  async function placeOrder(body) {
    const res = await fetch(`${BASE_URL}/v1/api/accounts/${accountId}/order`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // This is a transport/schema-level failure (400/404/405) — not a
      // trading rejection. Trading rejections come back as HTTP 200 with
      // orderStatus: "Rejected" instead, and are NOT thrown here.
      throw new Error(`placeOrder HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  // GET /v1/api/accounts/{accountId}/order/{clientOrderId}
  // Returns null on 404 (which can mean "not registered yet" right after
  // POST — a known race per TradeZero's own docs) rather than throwing,
  // so the caller can decide whether to retry.
  async function getOrder(clientOrderId) {
    const res = await fetch(
        `${BASE_URL}/v1/api/accounts/${accountId}/order/${encodeURIComponent(clientOrderId)}`,
        {headers},
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`getOrder HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  // Poll every 50ms until the order leaves "PendingNew" — this is
  // TradeZero's own documented pattern (their docs note async rejections
  // on live routed orders typically resolve within ~50ms).
  async function awaitTerminal(clientOrderId, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const order = await getOrder(clientOrderId);
      if (order && order.orderStatus !== "PendingNew") return order;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
        `Order ${clientOrderId} still unresolved after ${timeoutMs}ms — check GET /orders manually`,
    );
  }

  // DELETE /v1/api/accounts/{accountId}/orders/{clientOrderId}
  // Note the PLURAL "orders" here, while GET of a single order is the
  // singular "order". Per TradeZero's Orders page. Do not call this for an
  // order that is already Rejected.
  async function cancelOrder(clientOrderId) {
    const res = await fetch(
        `${BASE_URL}/v1/api/accounts/${accountId}/orders/${encodeURIComponent(clientOrderId)}`,
        {method: "DELETE", headers},
    );
    if (!res.ok) {
      throw new Error(`cancelOrder HTTP ${res.status}: ${await res.text()}`);
    }
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {ok: true};
    } catch (e) {
      return {ok: true, raw: text};
    }
  }

  // GET /v1/api/accounts/{accountId}/orders — today's orders.
  async function getTodaysOrders() {
    const res = await fetch(`${BASE_URL}/v1/api/accounts/${accountId}/orders`, {headers});
    if (!res.ok) {
      throw new Error(`getTodaysOrders HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  // GET /v1/api/accounts/{accountId}/routes — valid routes and time in force.
  async function getRoutes() {
    const res = await fetch(`${BASE_URL}/v1/api/accounts/${accountId}/routes`, {headers});
    if (!res.ok) {
      throw new Error(`getRoutes HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  return {getAccount, placeOrder, getOrder, awaitTerminal, cancelOrder, getTodaysOrders, getRoutes};
}

module.exports = {createClient};
