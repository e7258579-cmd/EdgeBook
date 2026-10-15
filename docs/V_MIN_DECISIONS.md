# V-min decisions (log)

Goal: reduce the strategy to a minimal core, then add one parameter at a time and
test each addition across a fixed sample (same symbols/days/windows, same metrics).
All changes are applied together at the end, only in a new Pine file
(`edgebook_trade_strategy_min.pine`). V05 and the debug file stay as they are.

## Decisions so far
| # | Parameter | Decision | Notes |
|---|-----------|----------|-------|
| 1 | Hold confirmation (`input_hold_seconds`) | REMOVE | Only used in the old Close entry mode. Stop-buy mode (the live mode) ignores it. |
| 1b | Gap day threshold (`input_gap_threshold_pct`, `isGapDay`) | REMOVE (follows #1) | Only used to double the hold time. |

## To remove together at the end (apply in one pass)
- Close entry mode and its code path (stop-buy stays the only mode), if confirmed.

## Still to decide
Volume thresholds (5-min and daily), trading hours, trigger reference, retracement %,
EMA9 entry path, stop distance cap, exits (trail mode / tiers / peak trail / climax / stall /
pre-open), cooldown, reload, brakes, position sizing, webhook settings.
