import React, { useEffect, useRef, useState } from "react";

type TxRow = {
    ts: number; // unix seconds
    waypoint_symbol: string;
    ship_symbol: string;
    trade_symbol: string;
    tx_type: "PURCHASE" | "SELL" | string;
    units: number;
    price_per_unit: number;
    total_price: number;
};
type ApiResp = { now: number; since_unix: number; rows: TxRow[] };

const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 18;
const PAD_BOTTOM = 28;

export default function TransactionsChart({
    defaultSinceHours = 6,
    defaultSymbol = "",
    pollMs = 10000,
}: {
    defaultSinceHours?: number;
    defaultSymbol?: string; // e.g., "FUEL" or "" = all
    pollMs?: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [rows, setRows] = useState<TxRow[]>([]);
    const [since, setSince] = useState(defaultSinceHours);
    const [symbol, setSymbol] = useState(defaultSymbol);
    const [loading, setLoading] = useState(false);
    const hoverRef = useRef<{ x: number; y: number } | null>(null);

    // ----- Fetch -----
    const fetchData = async () => {
        setLoading(true);
        const qs = new URLSearchParams({ since_hours: String(since) });
        if (symbol) qs.set("trade_symbol", symbol);
        const res = await fetch(`http://localhost:8001/transactions?${qs.toString()}`);
        const data: ApiResp = await res.json();
        setRows((data.rows || []).slice().sort((a, b) => a.ts - b.ts)); // ensure sorted
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
        const id = setInterval(fetchData, pollMs);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [since, symbol, pollMs]);

    // ----- Build cumulative series -----
    // SELL  -> income
    // PURCHASE -> expense
    const series = buildCumulative(rows);

    // ----- Draw -----
    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        let raf = 0;

        const onMove = (ev: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            hoverRef.current = {
                x: (ev.clientX - rect.left) * (canvas.width / rect.width),
                y: (ev.clientY - rect.top) * (canvas.height / rect.height),
            };
        };
        const onLeave = () => (hoverRef.current = null);

        canvas.addEventListener("mousemove", onMove);
        canvas.addEventListener("mouseleave", onLeave);

        const draw = () => {
            const dpr = devicePixelRatio || 1;
            const wCSS = canvas.clientWidth;
            const hCSS = canvas.clientHeight;
            canvas.width = Math.max(300, wCSS * dpr);
            canvas.height = Math.max(160, hCSS * dpr);
            ctx.resetTransform();
            ctx.scale(dpr, dpr);

            const w = wCSS, h = hCSS;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#0b0b0b";
            ctx.fillRect(0, 0, w, h);

            const x0 = PAD_LEFT, x1 = w - PAD_RIGHT;
            const y0 = PAD_TOP, y1 = h - PAD_BOTTOM;

            // ranges
            const allTs = series.ts.length ? series.ts : [0, 1];
            const minX = allTs[0];
            const maxX = allTs[allTs.length - 1] === minX ? minX + 1 : allTs[allTs.length - 1];
            const maxY = Math.max(1,
                (series.income.length ? series.income[series.income.length - 1] : 0),
                (series.expense.length ? series.expense[series.expense.length - 1] : 0)
            ) * 1.05;
            const minY = 0;

            const xToPx = (ts: number) =>
                x0 + ((ts - minX) / (maxX - minX)) * (x1 - x0);
            const yToPx = (v: number) =>
                y1 - ((v - minY) / (maxY - minY)) * (y1 - y0);

            // grid + axes
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

            // x ticks
            ctx.fillStyle = "rgba(220,220,220,0.85)";
            ctx.font = "12px system-ui, sans-serif";
            const xTicks = 5;
            for (let i = 0; i <= xTicks; i++) {
                const t = minX + (i / xTicks) * (maxX - minX);
                const px = xToPx(t);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
                const label = fmtTime(t);
                const m = ctx.measureText(label);
                ctx.fillText(label, px - m.width / 2, y1 + 16);
            }

            // y ticks
            const yTicks = 4;
            for (let i = 0; i <= yTicks; i++) {
                const v = minY + (i / yTicks) * (maxY - minY);
                const py = yToPx(v);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
                const label = fmtMoney(v);
                const m = ctx.measureText(label);
                ctx.fillStyle = "rgba(220,220,220,0.85)";
                ctx.fillText(label, x0 - 8 - m.width, py + 4);
            }

            // title + legend
            ctx.fillStyle = "#ddd";
            ctx.fillText(
                `Cumulative ${symbol ? `${symbol} ` : ""}Income & Expenses (last ${since}h)`,
                x0, y0 - 4
            );

            // legend
            const legY = y0 - 4;
            drawLegend(ctx, x1 - 180, legY, [
                { label: "Income (SELL)", color: "#22c55e" },
                { label: "Expenses (PURCHASE)", color: "#f43f5e" },
            ]);

            // lines
            drawSeriesLine(ctx, series.ts, series.income, xToPx, yToPx, "#22c55e", 2);
            drawSeriesLine(ctx, series.ts, series.expense, xToPx, yToPx, "#f43f5e", 2);

            // hover: nearest x
            const hover = hoverRef.current;
            if (hover && series.ts.length) {
                const mx = hover.x / dpr;
                // invert x -> ts
                const invTs = (px: number) => minX + ((px - x0) / (x1 - x0)) * (maxX - minX);
                const targetTs = invTs(mx);
                const idx = nearestIndex(series.ts, targetTs);
                const ts = series.ts[idx];
                const px = xToPx(ts);
                const incomeVal = series.income[idx] || 0;
                const expenseVal = series.expense[idx] || 0;

                // vertical line
                ctx.strokeStyle = "rgba(255,255,255,0.25)";
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
                ctx.setLineDash([]);

                // tooltip
                const lines = [
                    new Date(ts * 1000).toLocaleTimeString(),
                    `Income:   ${fmtMoney(incomeVal)}`,
                    `Expenses: ${fmtMoney(expenseVal)}`,
                    `Net:      ${fmtMoney(incomeVal - expenseVal)}`
                ];
                drawTooltip(ctx, Math.min(px + 10, x1 - 180), y0 + 10, lines);
            }

            if (loading) {
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                const msg = "loading…";
                const m = ctx.measureText(msg);
                ctx.fillText(msg, x1 - m.width, y0 + 14);
            }

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(raf);
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mouseleave", onLeave);
        };
    }, [rows, since, symbol, loading, series]);

    return (
        <div style={{ position: "relative", width: "100%", height: 260, background: "black", border: "1px solid #222", borderRadius: 8 }}>
            <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#ddd", zIndex: 1 }}>
                <label>Symbol:</label>
                <input
                    placeholder="e.g. FUEL (blank=all)"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.trim().toUpperCase())}
                    style={{ background: "#111", color: "#ddd", border: "1px solid #333", borderRadius: 6, padding: "4px 6px", width: 120 }}
                />
                <label>Window (h):</label>
                <input
                    type="number"
                    min={1}
                    max={24 * 30}
                    value={since}
                    onChange={(e) => setSince(Math.max(1, Math.min(24 * 30, Number(e.target.value || 1))))}
                    style={{ background: "#111", color: "#ddd", border: "1px solid #333", borderRadius: 6, padding: "4px 6px", width: 70 }}
                />
                <button onClick={fetchData} style={{ background: "#1f2937", color: "#fff", border: "1px solid #374151", borderRadius: 6, padding: "4px 8px" }}>
                    Refresh
                </button>
            </div>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
    );
}

/* -------- Helpers -------- */

function buildCumulative(rows: TxRow[]): { ts: number[]; income: number[]; expense: number[] } {
    const ts: number[] = [];
    const income: number[] = [];
    const expense: number[] = [];

    let cumIn = 0;
    let cumEx = 0;

    // Combine rows with the same timestamp by summing into the same step
    let i = 0;
    while (i < rows.length) {
        const t = rows[i].ts;
        let deltaIn = 0;
        let deltaEx = 0;
        while (i < rows.length && rows[i].ts === t) {
            const r = rows[i];
            if (r.tx_type === "SELL") deltaIn += r.total_price;
            else if (r.tx_type === "PURCHASE") deltaEx += r.total_price;
            i++;
        }
        cumIn += deltaIn;
        cumEx += deltaEx;
        ts.push(t);
        income.push(cumIn);
        expense.push(cumEx);
    }

    return { ts, income, expense };
}

function drawSeriesLine(
    ctx: CanvasRenderingContext2D,
    xs: number[],
    ys: number[],
    xToPx: (x: number) => number,
    yToPx: (y: number) => number,
    color: string,
    width = 2
) {
    if (!xs.length) return;
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(xToPx(xs[0]), yToPx(ys[0]));
    for (let i = 1; i < xs.length; i++) {
        ctx.lineTo(xToPx(xs[i]), yToPx(ys[i]));
    }
    ctx.stroke();

    // end cap dot
    const px = xToPx(xs[xs.length - 1]);
    const py = yToPx(ys[ys.length - 1]);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

function drawLegend(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    items: { label: string; color: string }[]
) {
    let cx = x;
    items.forEach((it, idx) => {
        ctx.fillStyle = it.color;
        ctx.fillRect(cx, y - 10, 18, 3);
        cx += 24;
        ctx.fillStyle = "#ccc";
        ctx.fillText(it.label, cx, y);
        cx += ctx.measureText(it.label).width + 16;
    });
}

function drawTooltip(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[]) {
    const pad = 6;
    ctx.font = "12px system-ui, sans-serif";
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + pad * 2;
    const h = lines.length * 16 + pad * 2;

    ctx.fillStyle = "rgba(20,20,20,0.95)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = "#eee";
    lines.forEach((s, i) => ctx.fillText(s, x + pad, y + pad + 12 + i * 16));
}

function nearestIndex(xs: number[], x: number): number {
    if (!xs.length) return 0;
    // binary search
    let lo = 0, hi = xs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(xs[lo] - x) > Math.abs(xs[lo - 1] - x)) return lo - 1;
    return lo;
}

function fmtTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtMoney(n: number) {
    if (!isFinite(n)) return String(n);
    if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    if (n >= 10) return n.toFixed(0);
    return n.toFixed(2);
}
