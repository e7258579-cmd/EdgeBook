// Position sizing. The webhook's qtyHint is never used.

const round2 = (x) => Math.round(x * 100) / 100;

// Returns {qty, limitPrice} or {reject: reason}.
function sizeEntry({price, stop, config}) {
  const limitPrice = round2(price + config.limitOffsetUsd);
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
  return Math.max(0.01, round2(price - config.limitOffsetUsd));
}

module.exports = {sizeEntry, sellLimit, round2};
