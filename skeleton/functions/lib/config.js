// Trading configuration. Safe defaults live here; the operator can override
// any of them (and flip the kill switch / DRY_RUN) by editing the Firestore
// document control/config, with no redeploy.

const DEFAULTS = {
  dryRun: true, // true = log what would be sent, never call TradeZero
  killSwitch: false, // true = no NEW entries (exits are always allowed)
  accountEquityUsd: 500, // demo account size; sizing is based on this
  riskPct: 1, // % of equity risked per trade (entry price to stop)
  maxShares: 25, // hard cap on shares per entry
  maxPositionUsd: 500, // hard cap on position value
  maxDailyLossUsd: 20, // no new entries once today's net realized P&L <= -this
  maxTradesPerDay: 10, // entries per New York day
  maxOrdersPerMinute: 6, // orders sent in the last 60 seconds
  limitOffsetUsd: 0.10, // buy limit = price + offset, sell limit = price - offset
  maxSignalAgeSec: 180, // a signal older than this (by barTime) is dropped
  timeInForce: "Day", // unverified for extended hours, see README
};

function mergeConfig(overrides) {
  const out = {...DEFAULTS};
  const o = overrides || {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key in o && typeof o[key] === typeof DEFAULTS[key] &&
        (typeof o[key] !== "number" || Number.isFinite(o[key]))) {
      out[key] = o[key];
    }
  }
  return out;
}

// New York calendar day, e.g. "2026-10-06". Used for the daily counters.
function nyDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

module.exports = {DEFAULTS, mergeConfig, nyDateKey};
