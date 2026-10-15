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
| 2 | Volume filter (5-min >= 50,000; daily >= 200,000) | KEEP, fixed constants | Already constants in the code (not shown in Inputs). Keep default values for now. |
| 3 | Trading hours | KEEP `0400-1600`, visible input | Many dead hours inside it; accepted for now (strategy does not yet filter them). |
| 4 | Pre-open protection | CHANGE: no new entries 09:25-09:40; an open position may stay until the end of pre-market and is force-closed at the close of the 09:29 bar (09:30:00). No force-close at 09:25. | Never enter the regular session with an open position, even if it is rising. Replaces the old 09:25 exit. Paper backend places stops only from 09:30, consistent with this. |
| 5 | Arming path | keyLevel ONLY. REMOVE the EMA9 path: `input_ema9_consolidation_enabled`, `input_ema9_tolerance_pct`, `ema9LockLevel` (the "L" lock), `armedVia`, the volume-decline constants/lock (`input_vol_decline_*`), and the test switch `input_disable_keylevel_check`. | EMA9 entry is to be re-tested later as a separate addition. |
| 6 | Invalidation rules (retracement `input_retracement_pct` 50% + red candle volume above the last green leg candle) | KEEP both as is | Retracement value to be compared later (e.g. 40/50/60). |
| 7 | Entry trigger reference | KEEP `Open` (constant) | High/Close to be compared later. |
| 8 | Stop distance | Stop = low of the last red candle. KEEP only `Maximum stop distance %` with action `Tighten the stop to the maximum` (visible input, default 0 = off). REMOVE the Minimum options (`input_min_stop_pct`, `input_min_stop_atr`) from the Inputs: keep them hidden as constants, off (0). Remove the `Skip entry` action. | Backend still has its own safety net: min 5 shares, 10 USD risk ceiling, reject if stop > 50% away. |
| 9 | EMA trail exit | Single EMA9 (length fixed 9), NO Tiered, NO intrabar (live) exit; exit on bar CLOSE below `EMA9 x (1 - buffer%)`. New input `buffer %` (default 0 = baseline), to compare 0 / 1 / 2 / 3. | Fixes "price touches/crosses EMA9 by a few % in an uptrend". Same logic in backtest and live. EMA length 10/11 rejected (almost no effect). |
| 10 | File policy | The V-min Pine file is CLEAN (no dead/hidden code). Everything removed stays in the debug file and in git history. A full parameter registry (in / out / default / calibrated value) is added to this document at the end. | |
| 11 | Peak trail (ATR from the peak; `input_atr_*`, `input_peak_trail_min_profit`) | REMOVE | To be re-tested later as a separate addition (does it raise total profit or only cut winners?). The `stop_update` webhook then follows only the protective stop. |
| 12 | Climax exit (`input_climax_*`, climax markers) | REMOVE | To be re-tested later as a separate addition. |
| 13 | Stall detector (`input_stall_*`) | REMOVE | To be re-tested later as a separate addition. Note: Tiered EMA (already removed) used the same tier boundaries. |
| 14 | Scalp Exit / weak market mode (`input_weak_market_mode`, `input_scalp_exit_bars`) | REMOVE | Was fixed off in the code, never ran. |
| 15 | Trades per day | NEW visible input `max trades per symbol per day`, default 1 (to compare 1 / 2 / 3). Cooldown after exit (`input_cooldown_bars` = 1) stays as a hidden constant. | New York calendar day. Overtrading brakes and Reload are REMOVED from the core (tested later as separate additions). |
| 16 | Position size in Pine | CHANGE: quantity computed like the backend (visible inputs: equity 500, risk % 1, min shares 5, max risk per trade 10 USD, max shares 10). Replaces the fixed 25 shares. | Commission stays 0.49 USD per order as an ASSUMPTION (real TradeZero Paper/Live commission not confirmed). |
| 17 | Date range (`input_use_date_range`, from, to) | KEEP as is (visible, off by default) | Needed to run the fixed test sample (symbol + day). Off in live. |
| 18 | Webhook settings | VISIBLE: master switch (`input_webhook_enabled`), secret, debug labels. HIDDEN CONSTANTS: intrabar entry always on, max messages 12 per 3 min, heartbeat every 5 bars. | Never publish the script with the secret filled in. |

## To remove together at the end (apply in one pass)
- Close entry mode and its code path (stop-buy stays the only mode), if confirmed.

## Still to decide
Volume thresholds (5-min and daily), trading hours, trigger reference, retracement %,
EMA9 entry path, stop distance cap, exits (trail mode / tiers / peak trail / climax / stall /
pre-open), cooldown, reload, brakes, position sizing, webhook settings.
