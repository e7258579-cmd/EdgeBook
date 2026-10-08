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
  const qty = Math.min(
      Math.floor(riskBudget / riskPerShare),
      config.maxShares,
      Math.floor(config.maxPositionUsd / limitPrice),
      Math.floor(config.accountEquityUsd / limitPrice),
  );
  if (!(qty >= 1)) return {reject: "qty_zero"};
  return {qty, limitPrice};
}

function sellLimit(price, config) {
  return Math.max(0.0001, roundPrice(price - config.limitOffsetUsd));
}

module.exports = {sizeEntry, sellLimit, round2, roundPrice};
