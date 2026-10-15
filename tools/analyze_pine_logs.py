#!/usr/bin/env python3
"""Summarize Pine Logs lines (TRADE / SYNC / SETTINGS) from an .xlsx, .csv or .txt file.

Usage:  python3 tools/analyze_pine_logs.py [--until HHMM] logs.xlsx [more files...]
        --until 1600  ignore trades that were ENTERED at or after that New York time (e.g. to apply the 0400-1600 window
                      to logs that were produced with wider hours).
Every cell / line is scanned for lines starting with TRADE, SYNC or SETTINGS (a timestamp
prefix such as "[2026-10-15T07:55:00.000-04:00]:" is ignored), duplicates are dropped.
TRADE fields: symbol,entryTime,exitTime,entry,stop,stopPct,qty,exit,pnlUsd,pnlPct,R,reason,bars
"""
import re, sys, collections, statistics as st

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

def main(paths, until=None):
    trades, sync, settings = parse(paths)
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
    print("by entry hour (New York):")
    hrs = collections.defaultdict(list)
    for t in trades: hrs[t["et"][11:13]].append(t)
    for k in sorted(hrs): summary(hrs[k], "  " + k + ":00")
    print("trades:")
    for t in trades:
        print(f"  {t['sym']:6}{t['et']} entry {t['entry']:<8} stop% {t['stoppct']:<6} qty {t['qty']:<3} exit {t['exit']:<8} usd {t['usd']:<7} R {t['R']:<6} {t['reason']} ({t['bars']} bars)")
    for s in sync: print("SYNC:", s)

if __name__ == "__main__":
    args = sys.argv[1:]
    until = None
    if args and args[0] == "--until":
        until = int(args[1]); args = args[2:]
    if not args:
        sys.exit(__doc__)
    main(args, until)
