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
| 19 | Visibility toggles | KEEP 8, ALL ON by default: PB start, reclaim@, INVALID, keyLevel line, VWAP, EMA9, state background, diagnostics table (+ its position). REMOVE: EMA20, trail line, Climax markers, V/W diagnostics, Reload and Brake markers. ADD (not a parameter): export of every trade as one line to Pine Logs (symbol, time, entry, stop, stop %, qty, P&L, R, exit reason, active settings). | The in-chart table stays. |
| 20 | keyLevel definition | KEEP as is (pre-market: max of today's pre-market high and the last regular-session high, i.e. yesterday's until today's regular session starts; after 09:30 also the first-5-minute high). | Variant "today only" to be compared later. Verify the keyLevel line on a chart. |
| 21 | Protective stop evaluation | KEEP bar-close based (`close <= stop`): exit at the close of a bar that closes at or below the stop. | Conservative baseline. "Touch-based" (like a broker stop) to be tested separately; decide about the real broker stop before going Live. |
| 22 | VWAP condition on entry | KEEP: the stop-buy is placed only when the trigger level is above VWAP (fixed rule, no parameter). | |

## To remove together at the end (apply in one pass)
- Close entry mode and its code path (stop-buy stays the only mode), if confirmed.

## Still to decide
Volume thresholds (5-min and daily), trading hours, trigger reference, retracement %,
EMA9 entry path, stop distance cap, exits (trail mode / tiers / peak trail / climax / stall /
pre-open), cooldown, reload, brakes, position sizing, webhook settings.


## V-min spec (summary of the decisions above)

**Flow:** SEARCHING -> (green candle closes above keyLevel, volume filter OK, inside trading hours, no entry pause, trades today < max) -> PULLBACK_ACTIVE -> stop-buy at the OPEN of the last red candle (only if above VWAP), stop = that candle's low (optionally tightened to max stop %) -> IN_POSITION -> exit.

**Exits (only these):** (1) protective stop: bar CLOSE at or below the stop; (2) EMA9 trail: bar CLOSE below `EMA9 x (1 - buffer%)`; (3) end of pre-market: force close at the close of the 09:29 bar.
**No new entries:** outside 04:00-16:00 NY, and 09:25-09:40 NY. One trade per symbol per day (input).

**Visible inputs:** trading hours (0400-1600), max stop distance % (0 = off) with action Tighten, EMA buffer % (0 = baseline), max trades per symbol per day (1), date range (off), position sizing (equity 500, risk % 1, min shares 5, max risk per trade 10 USD, max shares 10), webhook (master switch, secret, debug labels), 8 visibility toggles (all on).
**Hidden constants:** volume filter (5-min >= 50,000; daily >= 200,000), entry trigger = Open of the last red candle, retracement 50%, sell-volume invalidation, EMA length 9, cooldown 1 bar, minimum stop options (off), webhook intrabar entry (on), max 12 messages per 3 min, heartbeat every 5 bars, pre-open pause 09:25-09:40, end-of-pre-market close at the 09:29 bar.
**Added:** Pine Logs export (one line per trade, with the active settings).
**Removed from the core (kept in the debug file and in git):** Hold confirmation and gap threshold, EMA9 arming path with the L lock and EMA tolerance and volume-decline lock, Tiered EMA (and EMA20), intrabar EMA exit, Peak trail, Climax exit, Stall detector, Scalp Exit, Brakes, Reload, Minimum stop options (hidden), Close entry mode, old 09:25 force exit.

**Open items:** real commission (assumed 0.49 USD per order); decide about the real broker stop before going Live; compare variants one at a time on the fixed sample (buffer 0/1/2/3 %, max stop 20/15/10 %, max trades 1/2/3, retracement 40/50/60, trigger Open/High/Close, then re-add removed components one at a time).

## Parameter registry (file: edgebook_trade_strategy_min.pine, version m1)

| Parameter | Status | Default | Notes |
|-----------|--------|---------|-------|
| Trading hours | visible input | `0400-1600` | NY time; also forces the exit at the end of the hours |
| Date range (use / from / to) | visible input | off | for running the fixed test sample |
| Maximum stop distance % | visible input | 0 (off) | Tighten only; compare 20 / 15 / 10 |
| EMA9 exit buffer % | visible input | 0 | compare 0 / 1 / 2 / 3 |
| Max trades per symbol per day | visible input | 1 | compare 1 / 2 / 3 |
| Equity / risk % / min shares / max risk USD / max shares | visible inputs | 500 / 1 / 5 / 10 / 10 | mirror skeleton/functions/lib/sizing.js |
| Webhook: enabled / secret / debug labels | visible inputs | off / empty / off | never publish with the secret |
| Visibility toggles (8) + table position | visible inputs | all on | PB start, reclaim@, INVALID, keyLevel line, VWAP, EMA9, background, trades table |
| Volume filter | hidden constant | 5-min 50,000; daily 200,000 | |
| Retracement | hidden constant | 50 % | compare 40 / 50 / 60 |
| Trigger | hidden constant | Open of the last red candle | compare High / Close |
| EMA length | hidden constant | 9 | |
| Cooldown after exit | hidden constant | 1 bar | |
| Entry pause | hidden constant | 09:25-09:40 NY | tested on the bar start |
| Close before the regular open | hidden constant | the bar that ends at 09:30 (the 09:29 bar) | |
| Backend safety net replicated | hidden constant | stop farther than 50 % = no entry | plus min 5 shares, 10 USD risk ceiling |
| Webhook budget / heartbeat | hidden constants | 12 messages per 3 min / every 5 bars | |
| Commission | hidden constant | 0.49 USD per order | ASSUMPTION, not confirmed |

### Notes on this build
- The size uses the TRIGGER level as the price (the backend uses the last price at the crossing): an approximation.
- `end_of_window` is now part of the exit chain (the state machine leaves the position at the same time as the order), instead of closing only the order as in the debug file.
- With no Peak trail there are no `stop_update` messages: the stop at the broker stays at the initial level.
- The EMA exit guard compares the BUFFERED level (EMA9 x (1 - buffer)) with the stop.
- keyLevel only: expect far fewer setups than with the EMA9 path (zero-trade days are normal).
- All labels are on by default and `reclaim@` fires on every red pullback candle: on long backtests the 500-label cap pushes older entry/exit arrows off the chart. Turn `reclaim@` / `PB start` off when needed.
- The table shows: Entry NY, Px, Qty, Stop %, P&L %, R, P&L $, Exit, Bars.

### Pine Logs format (open the Pine Logs panel, copy, paste)
`TRADE,symbol,entryTime,exitTime,entry,stop,stopPct,qty,exit,pnlUsd,pnlPct,R,reason,bars`
`SETTINGS,version,symbol,hours=...,maxStopPct=...,emaBufferPct=...,...` (one line at the last historical bar)
`SYNC,symbol,time,price` (the order layer held a position the state machine did not know)
