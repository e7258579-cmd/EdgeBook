// Entry circuit breakers. Exits are NEVER blocked: the system must always be
// able to get out of a position, even with the kill switch on.

// Returns null if an entry is allowed, otherwise the rejection reason.
function checkEntryLimits({config, stats, ordersLastMinute}) {
  if (config.killSwitch) return "kill_switch";
  if (stats.realizedPnl <= -config.maxDailyLossUsd) return "daily_loss_limit";
  if (stats.tradesToday >= config.maxTradesPerDay) return "max_trades_per_day";
  if (ordersLastMinute >= config.maxOrdersPerMinute) return "rate_limit";
  return null;
}

module.exports = {checkEntryLimits};
