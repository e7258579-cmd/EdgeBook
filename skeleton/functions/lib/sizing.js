// Position sizing. The webhook's qtyHint is never used.

const round2 = (x) => Math.round(x * 100) / 100;
// Tick size (Reg NMS): $0.01 at or above $1.00, $0.0001 below.
const roundPrice = (x) => (x >= 1 ? round2(x) : Math.round(x * 10000) / 10000);

// Returns {qty, limitPrice} or {reject: reason}.
function sizeEntry({price, stop, config}) {
  const limitPrice = roundPrice(price + config.limitOffsetUsd);
  const riskPerShare = limitPrice - stop;
  if (!(riskPerShare > 0)) return {reject: "invalid_stop"};
  const riskBudget = config.accountEquityUsd * (config.riskPct / 100);
  const riskQty = Math.floor(riskBudget / riskPerShare);
  const caps = Math.min(
      config.maxShares,
      Math.floor(config.maxPositionUsd / limitPrice),
      Math.floor(config.accountEquityUsd / limitPrice),
  );
  if (!(caps >= 1)) return {reject: "qty_zero"};
  // Small accounts: a far stop would give 1-2 shares. Lift to minShares, but the
  // risk ceiling (maxRiskPerTradeUsd) always wins.
  let qty = Math.min(Math.max(riskQty, config.minShares), caps);
  if (qty < config.minShares && riskQty < config.minShares) return {reject: "qty_below_min"};
  if (config.maxRiskPerTradeUsd > 0) {
    const riskCap = Math.floor(config.maxRiskPerTradeUsd / riskPerShare);
    if (qty > riskCap) {
      if (riskCap < Math.max(1, config.minShares)) return {reject: "risk_too_high"};
      qty = riskCap;
    }
  }
  if (!(qty >= 1)) return {reject: "qty_zero"};
  return {qty, limitPrice};
}

function sellLimit(price, config) {
  return Math.max(0.0001, roundPrice(price - config.limitOffsetUsd));
}

module.exports = {sizeEntry, sellLimit, round2, roundPrice};
