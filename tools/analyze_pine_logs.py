#!/usr/bin/env python3
"""Summarize Pine Logs lines (TRADE / SYNC / SETTINGS) from an .xlsx, .csv or .txt file.

Usage:  python3 tools/analyze_pine_logs.py [--until HHMM] [--sample docs/V_MIN_SAMPLE.csv] logs.xlsx [more files...]
        --sample FILE ignore trades entered BEFORE the stock's watchlist_time (same symbol and New York date), and add a
                      summary by source (AH_gapper / intraday_alert). A trade with no row in the sample file is kept and
                      listed as "unlisted". A blank watchlist_time means 04:00 (no filtering).
        --until 1600  ignore trades that were ENTERED at or after that New York time (e.g. to apply the 0400-1600 window
                      to logs that were produced with wider hours).
Every cell / line is scanned for lines starting with TRADE, SYNC or SETTINGS (a timestamp
prefix such as "[2026-10-15T07:55:00.000-04:00]:" is ignored), duplicates are dropped.
TRADE fields: symbol,entryTime,exitTime,entry,stop,stopPct,qty,exit,pnlUsd,pnlPct,R,reason,bars
"""
import csv, re, sys, collections, statistics as st

# Time-of-day windows (New York) used for the summary by entry time.
WINDOWS = [("0400-0700", 400, 700), ("0700-0800", 700, 800), ("0800-0925", 800, 925),
           ("0925-0940", 925, 940), ("0940-1000", 940, 1000), ("1000-1600", 1000, 1600), ("1600+", 1600, 2400)]

def hhmm(text):
    text = (text or "").strip().replace(":", "")
    return int(text) if text.isdigit() else None

def load_sample(path):
    rows = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows[(r["symbol"].strip().upper(), r["date"].strip())] = r
    return rows

def apply_sample(trades, sample):
    kept = []; dropped = []
    for t in trades:
        row = sample.get((t["sym"].upper(), t["et"][:10]))
        t["source"] = (row["source"].strip() or "no_source") if row else "unlisted"
        t["day_type"] = (row.get("day_type", "").strip() or "-") if row else "-"
        wl = hhmm(row["watchlist_time"]) if row else None
        entry = hhmm(t["et"][11:16])
        if wl is not None and entry is not None and entry < wl:
            dropped.append(t)
        else:
            kept.append(t)
    return kept, dropped

def read_text(path):
    if path.lower().endswith(".xlsx"):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True)
        for ws in wb:
            for row in ws.iter_rows(values_only=True):
                for c in row:
                    if isinstance(c, str):
                        yield c
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                yield line

def parse(paths):
    seen = set(); trades = []; sync = []; settings = set()
    for p in paths:
        for text in read_text(p):
            for m in re.finditer(r"(TRADE|SYNC|SETTINGS),[^\n\]]*", text):
                line = m.group(0).strip()
                if line in seen: continue
                seen.add(line)
                f = line.split(",")
                if f[0] == "TRADE":
                    trades.append(dict(sym=f[1], et=f[2], xt=f[3], entry=float(f[4]), stop=float(f[5]), stoppct=float(f[6]),
                                       qty=int(f[7]), exit=float(f[8]), usd=float(f[9]), pct=float(f[10]), R=float(f[11]),
                                       reason=f[12], bars=int(f[13])))
                elif f[0] == "SYNC": sync.append(line)
                else: settings.add(",".join(f[3:]))
    trades.sort(key=lambda t: t["et"])
    return trades, sync, settings

def summary(trades, label="ALL"):
    n = len(trades)
    if not n:
        print(label, "no trades"); return
    wins = [t for t in trades if t["usd"] > 0]; losses = [t for t in trades if t["usd"] <= 0]
    gp = sum(t["usd"] for t in wins); gl = -sum(t["usd"] for t in losses)
    print(f"{label}: {n} trades, win rate {len(wins)/n*100:.0f}% ({len(wins)}/{n}), total {sum(t['usd'] for t in trades):.2f} USD, "
          f"sum R {sum(t['R'] for t in trades):.2f}, avg R {st.mean(t['R'] for t in trades):.2f}, median R {st.median(t['R'] for t in trades):.2f}, "
          f"avg win R {st.mean(t['R'] for t in wins) if wins else 0:.2f}, avg loss R {st.mean(t['R'] for t in losses) if losses else 0:.2f}, "
          f"profit factor {gp/gl if gl else float('inf'):.2f}")

def main(paths, until=None, sample_path=None):
    trades, sync, settings = parse(paths)
    if sample_path:
        kept, dropped = apply_sample(trades, load_sample(sample_path))
        print(f"--sample: {len(dropped)} trades entered before the stock's watchlist_time were ignored, {len(kept)} kept")
        for t in dropped: print("  ignored:", t["sym"], t["et"])
        trades = kept
    if until is not None:
        before = len(trades)
        trades = [t for t in trades if int(t["et"][11:13]) * 100 + int(t["et"][14:16]) < until]
        print(f"--until {until}: kept {len(trades)} of {before} trades")
    print(len(trades), "trades,", len(sync), "SYNC lines;", len(settings), "different SETTINGS lines")
    for s in settings: print("  settings:", s)
    summary(trades)
    if trades:
        top = max(trades, key=lambda t: t["usd"])
        rest = [t for t in trades if t is not top]
        summary(rest, f"without the best trade ({top['sym']} {top['et']})")
    by = collections.defaultdict(list)
    for t in trades: by[t["reason"]].append(t)
    print("by exit reason:")
    for k, v in sorted(by.items()): summary(v, "  " + k)
    print("by entry time window (New York):")
    for name, a, b in WINDOWS:
        v = [t for t in trades if a <= int(t["et"][11:13]) * 100 + int(t["et"][14:16]) < b]
        if v: summary(v, "  " + name)
    if sample_path:
        print("by source:")
        src = collections.defaultdict(list)
        for t in trades: src[t.get("source", "unlisted")].append(t)
        for k, v in sorted(src.items()): summary(v, "  " + k)
        print("by day type:")
        dt = collections.defaultdict(list)
        for t in trades: dt[t.get("day_type", "-")].append(t)
        for k, v in sorted(dt.items()): summary(v, "  " + k)
    print("trades:")
    for t in trades:
        print(f"  {t['sym']:6}{t['et']} entry {t['entry']:<8} stop% {t['stoppct']:<6} qty {t['qty']:<3} exit {t['exit']:<8} usd {t['usd']:<7} R {t['R']:<6} {t['reason']} ({t['bars']} bars)")
    for s in sync: print("SYNC:", s)

if __name__ == "__main__":
    args = sys.argv[1:]
    until = None; sample_path = None
    while args and args[0] in ("--until", "--sample"):
        if args[0] == "--until": until = int(args[1])
        else: sample_path = args[1]
        args = args[2:]
    if not args:
        sys.exit(__doc__)
    main(args, until, sample_path)
