#!/usr/bin/env python3
import argparse, os, sqlite3, sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ---------- helpers ----------
def parse_iso_ts(s: str) -> datetime:
    s = s.strip().replace(" ", "T")
    if s.endswith("Z"): s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def fmt_money(n: float) -> str:
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1_000_000: return f"{sign}{n/1_000_000:.2f}M"
    if n >= 1000: return f"{sign}{n/1000:.1f}k"
    if n >= 10: return f"{sign}{n:.0f}"
    return f"{sign}{n:.2f}"

def pad(s, w, align="left"):
    s = str(s)
    if len(s) >= w: return s
    return (" " * (w - len(s)) + s) if align == "right" else (s + " " * (w - len(s)))

def unique_sorted(xs): return sorted(set(xs))

# ---------- core ----------
def load_transactions(conn, symbol=None):
    q = """
    SELECT timestamp, waypoint_symbol, ship_symbol, trade_symbol, tx_type, units, price_per_unit, total_price
    FROM market_transactions
    """
    params = []
    if symbol:
        q += " WHERE trade_symbol = ?"
        params.append(symbol)
    q += " ORDER BY timestamp ASC"
    rows = []
    for r in conn.execute(q, params):
        ts_s, wp, ship, sym, tx_type, units, ppu, total = r
        dt = parse_iso_ts(ts_s)
        rows.append({
            "dt": dt, "ts": int(dt.timestamp()),
            "timestamp_str": ts_s,
            "waypoint_symbol": wp, "ship_symbol": ship, "trade_symbol": sym,
            "tx_type": tx_type, "units": units, "price_per_unit": ppu, "total_price": float(total or 0)
        })
    rows.sort(key=lambda r: r["ts"])
    return rows

def build_cumulative(rows):
    if not rows: return {"ts": [], "per_symbol": {}, "tot_in": [], "tot_ex": [], "bal": []}
    deltas_in = defaultdict(lambda: defaultdict(float))
    deltas_ex = defaultdict(lambda: defaultdict(float))
    syms = set()
    for r in rows:
        t = r["ts"]; sym = r["trade_symbol"]; syms.add(sym)
        amt = float(r["total_price"] or 0)
        if str(r["tx_type"]).upper() == "SELL":      deltas_in[t][sym] += amt
        elif str(r["tx_type"]).upper() == "PURCHASE": deltas_ex[t][sym] += amt

    ts = unique_sorted(list(deltas_in.keys()) + list(deltas_ex.keys()))
    per_symbol = {s: {"in": [0.0]*len(ts), "ex": [0.0]*len(ts)} for s in sorted(syms)}
    tot_in = [0.0]*len(ts); tot_ex = [0.0]*len(ts); bal = [0.0]*len(ts)

    run_in = defaultdict(float); run_ex = defaultdict(float)
    rin = rex = 0.0
    for i, t in enumerate(ts):
        for s, v in deltas_in[t].items(): run_in[s] += v; rin += v
        for s, v in deltas_ex[t].items(): run_ex[s] += v; rex += v
        for s in per_symbol.keys():
            per_symbol[s]["in"][i] = run_in[s]
            per_symbol[s]["ex"][i] = run_ex[s]
        tot_in[i] = rin; tot_ex[i] = rex; bal[i] = rin - rex
    return {"ts": ts, "per_symbol": per_symbol, "tot_in": tot_in, "tot_ex": tot_ex, "bal": bal}

def slice_range(model, range_spec: str):
    """range_spec: 'full' | 'last:6h' | 'last:24h' | 'last:3d' ..."""
    ts = model["ts"]
    if not ts: return model, "full"
    if not range_spec or range_spec == "full": return model, "full"
    try:
        kind, span = range_spec.split(":")
        assert kind == "last"
        unit = span[-1].lower()
        qty = int(span[:-1])
        seconds = qty * (3600 if unit == "h" else 86400 if unit == "d" else 3600)
    except Exception:
        return model, "full"
    end = ts[-1]; start = end - seconds
    # find first index >= start
    i0 = 0
    while i0 < len(ts) and ts[i0] < start: i0 += 1
    if i0 == 0: return model, range_spec
    # To keep cumulative continuity, we offset series by their value at i0-1
    def cut(arr):
        base = arr[i0-1]
        return [v - base for v in arr[i0-1:]]  # include baseline at start
    new_ts = ts[i0-1:]
    per_symbol = {}
    for s, se in model["per_symbol"].items():
        per_symbol[s] = {"in": cut(se["in"]), "ex": cut(se["ex"])}
    return {
        "ts": new_ts,
        "per_symbol": per_symbol,
        "tot_in": cut(model["tot_in"]),
        "tot_ex": cut(model["tot_ex"]),
        "bal":    cut(model["bal"]),
    }, range_spec

def print_rows(rows):
    if not rows: print("No transactions."); return
    cols = ["timestamp","trade_symbol","tx_type","units","price_per_unit","total_price","waypoint","ship"]
    widths = [27,14,10,7,14,12,12,16]
    print("\nROWS")
    print(" ".join(pad(c,w) for c,w in zip(cols,widths)))
    print("-"*sum(widths))
    for r in rows:
        vals = [r["timestamp_str"], r["trade_symbol"], r["tx_type"], r["units"] or "",
                f'{(r["price_per_unit"] or 0):.2f}', f'{r["total_price"]:.2f}',
                r["waypoint_symbol"], r["ship_symbol"]]
        print(" ".join(pad(v,w) for v,w in zip(vals,widths)))

def print_table(model):
    ts = model["ts"]; if not ts: print("\nAGG: empty"); return
    syms = list(model["per_symbol"].keys())
    base = ["time(utc)","TotIn","TotEx","Bal"]
    cols = base + [f"{s}:In" for s in syms] + [f"{s}:Ex" for s in syms]
    widths = [19,10,10,10] + [max(8,len(c)) for c in cols[4:]]
    print("\nAGGREGATED (cumulative)")
    print(" ".join(pad(c,w) for c,w in zip(cols,widths)))
    print("-"*sum(widths))
    for i,t in enumerate(ts):
        row = [
            datetime.fromtimestamp(t,tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            fmt_money(model["tot_in"][i]),
            fmt_money(model["tot_ex"][i]),
            fmt_money(model["bal"][i]),
        ]
        for s in syms: row.append(fmt_money(model["per_symbol"][s]["in"][i]))
        for s in syms: row.append(fmt_money(model["per_symbol"][s]["ex"][i]))
        print(" ".join(pad(v,w) for v,w in zip(row,widths)))

def export_svg(model, out_path, title_suffix="(full)"):
    ts = model["ts"]
    width, height = 1100, 420
    PAD_LEFT, PAD_RIGHT, PAD_TOP, PAD_BOTTOM = 64, 16, 28, 40
    if not ts:
        with open(out_path,"w",encoding="utf-8") as f:
            f.write("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='200' style='background:#0b0b0b'><text x='10' y='20' fill='#fff'>No data</text></svg>")
        return out_path

    tot_in = model["tot_in"]; tot_ex = model["tot_ex"]; bal = model["bal"]
    # Ensure y includes true min & max (across all series)
    y_values = [*tot_in, *tot_ex, *bal]
    for s, se in model["per_symbol"].items(): y_values += se["in"] + se["ex"]
    y_min = min(0.0, min(y_values))  # allow negative balances
    y_max = max(1.0, max(y_values))
    # pad 5%
    span_y = max(1e-9, y_max - y_min)
    y_min -= 0.05 * span_y
    y_max += 0.05 * span_y

    x0,x1 = PAD_LEFT, width-PAD_RIGHT
    y0,y1 = PAD_TOP,  height-PAD_BOTTOM
    t_min, t_max = ts[0], ts[-1] if ts[-1] > ts[0] else ts[0] + 1

    def xpx(t): return x0 + (t - t_min)/(t_max - t_min) * (x1 - x0)
    def ypx(v): return y1 - (v - y_min)/(y_max - y_min) * (y1 - y0)

    def poly(xs, ys): return " ".join(f"{xpx(x):.2f},{ypx(y):.2f}" for x,y in zip(xs,ys))

    sym_cols = list(model["per_symbol"].keys())

    svg = []
    svg.append(f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' style='background:#0b0b0b'>")

    # Title & range
    svg.append(f"<text x='{x0}' y='{y0-10}' fill='#ddd' font-size='13'>Cumulative Income/Expense per item + Totals {title_suffix}</text>")

    # Axes
    svg.append(f"<g stroke='rgba(255,255,255,0.12)' stroke-width='1' fill='none'><path d='M{x0},{y0} L{x0},{y1} L{x1},{y1}'/></g>")

    # X ticks including endpoints
    ticks = 5
    for i in range(ticks+1):
        t = t_min + i/ticks * (t_max - t_min)
        px = xpx(t)
        svg.append(f"<line x1='{px:.2f}' y1='{y0}' x2='{px:.2f}' y2='{y1}' stroke='rgba(255,255,255,0.05)'/>")
        label = datetime.fromtimestamp(t, tz=timezone.utc).strftime('%H:%M')
        svg.append(f"<text x='{px:.2f}' y='{y1+18}' fill='rgba(220,220,220,0.85)' font-size='12' text-anchor='middle'>{label}</text>")

    # Y ticks including min/max
    for i in range(5):
        v = y_min + i/4 * (y_max - y_min)
        py = ypx(v)
        svg.append(f"<line x1='{x0}' y1='{py:.2f}' x2='{x1}' y2='{py:.2f}' stroke='rgba(255,255,255,0.05)'/>")
        svg.append(f"<text x='{x0-8}' y='{py+4:.2f}' fill='rgba(220,220,220,0.85)' font-size='12' text-anchor='end'>{fmt_money(v)}</text>")

    # Per-symbol thin lines
    for s in sym_cols:
        se = model["per_symbol"][s]
        svg.append(f"<polyline fill='none' stroke='rgba(34,197,94,0.35)' stroke-width='1' points='{poly(ts, se['in'])}'/>")
        svg.append(f"<polyline fill='none' stroke='rgba(244,63,94,0.35)'  stroke-width='1' points='{poly(ts, se['ex'])}'/>")

    # Totals (thick)
    svg.append(f"<polyline fill='none' stroke='#22c55e' stroke-width='2.5' points='{poly(ts, tot_in)}'/>")
    svg.append(f"<polyline fill='none' stroke='#f43f5e' stroke-width='2.5' points='{poly(ts, tot_ex)}'/>")
    svg.append(f"<polyline fill='none' stroke='#60a5fa' stroke-width='2.5' points='{poly(ts, bal)}'/>")

    # Endpoint markers/labels
    def mark(x, y, label, color):
        svg.append(f"<circle cx='{xpx(x):.2f}' cy='{ypx(y):.2f}' r='3' fill='{color}'/>")
        svg.append(f"<text x='{xpx(x)+6:.2f}' y='{ypx(y)-6:.2f}' fill='{color}' font-size='11'>{label}</text>")

    mark(t_min, tot_in[0], "start", "#22c55e")
    mark(t_max, tot_in[-1], fmt_money(tot_in[-1]), "#22c55e")
    mark(t_min, tot_ex[0], "start", "#f43f5e")
    mark(t_max, tot_ex[-1], fmt_money(tot_ex[-1]), "#f43f5e")
    mark(t_max, bal[-1],   fmt_money(bal[-1]),     "#60a5fa")

    svg.append("</svg>")
    with open(out_path,"w",encoding="utf-8") as f: f.write("\n".join(svg))
    return out_path

def main():
    ap = argparse.ArgumentParser(description="TX tester with calibrated axes and selectable time range.")
    ap.add_argument("--db", required=True)
    ap.add_argument("--symbol", default="")
    ap.add_argument("--range", default="full", help="full | last:6h | last:24h | last:3d | last:7d ...")
    ap.add_argument("--out", default="transactions.svg")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print("DB not found:", args.db); sys.exit(2)

    conn = sqlite3.connect(args.db)
    try:
        rows = load_transactions(conn, symbol=(args.symbol.strip().upper() or None))
        print_rows(rows)
        model_full = build_cumulative(rows)
        model, label = slice_range(model_full, args.range)
        print_table(model)
        out = export_svg(model, args.out, title_suffix=f"({label})")
        print("\nSVG written to:", out)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
