import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------------- types ---------------- */
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
type RangeMode = "full" | "last:6h" | "last:24h" | "last:3d" | "last:7d";

/* ---------------- layout ---------------- */
const PAD_LEFT = 64;
const PAD_RIGHT = 16;
const PAD_TOP = 24;
const PAD_BOTTOM = 34;

const API_BASE =
    (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8001";

/* ---------------- component ---------------- */
export default function TransactionsChart({ pollMs = 10000 }: { pollMs?: number }) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [rows, setRows] = useState<TxRow[]>([]);
    const [symbol, setSymbol] = useState<string>("");
    const [range, setRange] = useState<RangeMode>("full");
    const [loading, setLoading] = useState(false);
    const [symbols, setSymbols] = useState<string[]>([]);
    const hoverRef = useRef<{ x: number; y: number } | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Fullscreen helpers
    const enterFs = async () => {
        const el = wrapRef.current!;
        if (document.fullscreenElement) return;
        try {
            await el.requestFullscreen();
        } catch {
            // fallback: just stretch with CSS
            setIsFullscreen(true);
        }
    };
    const exitFs = async () => {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
        setIsFullscreen(false);
    };
    useEffect(() => {
        const onFs = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    // Fetch EVERYTHING; normalize numbers
    const fetchAll = async () => {
        setLoading(true);
        const qs = new URLSearchParams();
        if (symbol.trim()) qs.set("trade_symbol", symbol.trim().toUpperCase());
        const res = await fetch(`${API_BASE}/transactions?${qs.toString()}`);
        const data: ApiResp = await res.json();
        const rowsSan: TxRow[] = (data.rows || []).map((r: any) => ({
            ...r,
            ts: Number(r.ts),
            units: Number(r.units ?? 0),
            price_per_unit: Number(r.price_per_unit ?? 0),
            total_price: Number(r.total_price ?? 0),
            trade_symbol: String(r.trade_symbol || ""),
            tx_type: String(r.tx_type || ""),
        }));
        rowsSan.sort((a, b) => a.ts - b.ts);
        setRows(rowsSan);
        // Build available symbols list from all rows regardless of current filter
        const allRes = await fetch(`${API_BASE}/transactions`);
        const allData: ApiResp = await allRes.json();
        const syms = Array.from(
            new Set((allData.rows || []).map((r: any) => String(r.trade_symbol || "")).filter(Boolean))
        ).sort();
        setSymbols(syms);
        setLoading(false);
    };

    useEffect(() => {
        fetchAll();
        const id = setInterval(fetchAll, pollMs);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, pollMs]);

    // Build cumulative (full), then slice/offset for display
    const modelFull = useMemo(() => buildModel(rows), [rows]);
    const model = useMemo(() => sliceAndOffset(modelFull, range), [modelFull, range]);

    // Draw
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
            canvas.height = Math.max(220, hCSS * dpr);
            ctx.resetTransform();
            ctx.scale(dpr, dpr);

            const w = wCSS, h = hCSS;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#0b0b0b"; ctx.fillRect(0, 0, w, h);

            const x0 = PAD_LEFT, x1 = w - PAD_RIGHT;
            const y0 = PAD_TOP, y1 = h - PAD_BOTTOM;

            const ts = model.ts.length ? model.ts : [0, 1];
            const minX = ts[0];
            const maxX = ts[ts.length - 1] === minX ? minX + 1 : ts[ts.length - 1];

            const yVals: number[] = [];
            yVals.push(...model.totalIncome, ...model.totalExpense, ...model.balance);
            Object.values(model.perSymbol).forEach(se => {
                yVals.push(...se.income, ...se.expense);
            });
            let yMin = Math.min(0, ...yVals);
            let yMax = Math.max(1, ...yVals);
            const spanY = Math.max(1e-9, yMax - yMin);
            yMin -= 0.05 * spanY;
            yMax += 0.05 * spanY;

            const xToPx = (t: number) => x0 + ((t - minX) / (maxX - minX)) * (x1 - x0);
            const yToPx = (v: number) => y1 - ((v - yMin) / (yMax - yMin)) * (y1 - y0);

            // Axes & grid
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

            // X ticks (include ends)
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
                ctx.fillText(label, px - m.width / 2, y1 + 18);
            }

            // Y ticks (include ends)
            const yTicks = 4;
            for (let i = 0; i <= yTicks; i++) {
                const v = yMin + (i / yTicks) * (yMax - yMin);
                const py = yToPx(v);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
                const label = fmtMoney(v);
                const m = ctx.measureText(label);
                ctx.fillStyle = "rgba(220,220,220,0.85)";
                ctx.fillText(label, x0 - 8 - m.width, py + 4);
            }

            // Per-item thin (optional filter)
            Object.entries(model.perSymbol).forEach(([sym, se]) => {
                if (symbol && sym !== symbol) return;
                drawLine(ctx, model.ts, se.income, xToPx, yToPx, "rgba(34,197,94,0.45)", 1);
                drawLine(ctx, model.ts, se.expense, xToPx, yToPx, "rgba(244,63,94,0.45)", 1);
            });

            // Totals (thick)
            drawLine(ctx, model.ts, model.totalIncome, xToPx, yToPx, "#22c55e", 2.5);
            drawLine(ctx, model.ts, model.totalExpense, xToPx, yToPx, "#f43f5e", 2.5);
            drawLine(ctx, model.ts, model.balance, xToPx, yToPx, "#60a5fa", 2.5);

            // Hover line & tooltip
            const hover = hoverRef.current;
            if (hover && model.ts.length) {
                const mx = hover.x / dpr;
                const invTs = (px: number) => minX + ((px - x0) / (x1 - x0)) * (maxX - minX);
                const targetTs = invTs(mx);
                const idx = nearestIndex(model.ts, targetTs);
                const t = model.ts[idx];
                const px = xToPx(t);

                ctx.strokeStyle = "rgba(255,255,255,0.25)";
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
                ctx.setLineDash([]);

                const lines: string[] = [
                    new Date(t * 1000).toLocaleString(),
                    `Total Income:  ${fmtMoney(model.totalIncome[idx] || 0)}`,
                    `Total Expense: ${fmtMoney(model.totalExpense[idx] || 0)}`,
                    `Balance:       ${fmtMoney(model.balance[idx] || 0)}`,
                ];
                if (symbol && model.perSymbol[symbol]) {
                    lines.push(
                        `— ${symbol} —`,
                        `Income:  ${fmtMoney(model.perSymbol[symbol].income[idx] || 0)}`,
                        `Expense: ${fmtMoney(model.perSymbol[symbol].expense[idx] || 0)}`
                    );
                }
                drawTooltip(ctx, Math.min(px + 10, x1 - 220), y0 + 10, lines);
            }

            if (loading) {
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                const msg = "loading…";
                const m = ctx.measureText(msg);
                ctx.fillText(msg, x1 - m.width, y0 + 16);
            }

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(raf);
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mouseleave", onLeave);
        };
    }, [model, range, symbol, loading]);

    return (
        <div
            ref={wrapRef}
            style={{
                position: "relative",
                width: "100%",
                height: isFullscreen ? "100vh" : 260,
                background: "black",
                border: "1px solid #222",
                borderRadius: 8,
                zIndex: isFullscreen ? 9999 : "auto",
            }}
        >
            {/* Controls (HTML legend + filters) */}
            <div
                style={{
                    position: "absolute",
                    top: 8,
                    left: 10,
                    right: 10,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                    fontSize: 12,
                    color: "#ddd",
                    zIndex: 2,
                }}
            >
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <LegendSwatch color="#22c55e" label="Total Income" thick />
                    <LegendSwatch color="#f43f5e" label="Total Expense" thick />
                    <LegendSwatch color="#60a5fa" label="Balance" thick />
                    <LegendSwatch color="rgba(34,197,94,0.45)" label="Per-item Income" />
                    <LegendSwatch color="rgba(244,63,94,0.45)" label="Per-item Expense" />
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    <label>Symbol:</label>
                    <select
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        style={{ background: "#111", color: "#ddd", border: "1px solid #333", borderRadius: 6, padding: "4px 6px", minWidth: 120 }}
                    >
                        <option value="">All</option>
                        {symbols.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>

                    <label>Range:</label>
                    <select
                        value={range}
                        onChange={(e) => setRange(e.target.value as RangeMode)}
                        style={{ background: "#111", color: "#ddd", border: "1px solid #333", borderRadius: 6, padding: "4px 6px" }}
                    >
                        <option value="full">Full</option>
                        <option value="last:6h">Last 6h</option>
                        <option value="last:24h">Last 24h</option>
                        <option value="last:3d">Last 3d</option>
                        <option value="last:7d">Last 7d</option>
                    </select>

                    {!isFullscreen ? (
                        <button onClick={enterFs} style={btnStyle}>Full-screen</button>
                    ) : (
                        <button onClick={exitFs} style={btnStyle}>Exit</button>
                    )}
                    <button onClick={fetchAll} style={btnStyle}>Refresh</button>
                </div>
            </div>

            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
    );
}

/* ---------------- helpers ---------------- */
function LegendSwatch({ color, label, thick = false }: { color: string; label: string; thick?: boolean }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: thick ? 26 : 18, height: thick ? 4 : 3, background: color, borderRadius: 2 }} />
            <span>{label}</span>
        </span>
    );
}

const btnStyle: React.CSSProperties = {
    background: "#1f2937",
    color: "#fff",
    border: "1px solid #374151",
    borderRadius: 6,
    padding: "4px 8px",
};

function buildModel(rows: TxRow[]) {
    if (!rows.length) return { ts: [] as number[], perSymbol: {} as any, totalIncome: [] as number[], totalExpense: [] as number[], balance: [] as number[] };

    const deltasIn: Record<number, Record<string, number>> = {};
    const deltasEx: Record<number, Record<string, number>> = {};
    const symbols = new Set<string>();
    rows.forEach((r) => {
        const t = Number(r.ts);
        const sym = String(r.trade_symbol);
        const amt = Number(r.total_price) || 0;
        if (!Number.isFinite(t) || !Number.isFinite(amt)) return;
        symbols.add(sym);
        if (String(r.tx_type).toUpperCase() === "SELL") {
            (deltasIn[t] ||= {});
            deltasIn[t][sym] = (Number(deltasIn[t][sym]) || 0) + amt;
        } else if (String(r.tx_type).toUpperCase() === "PURCHASE") {
            (deltasEx[t] ||= {});
            deltasEx[t][sym] = (Number(deltasEx[t][sym]) || 0) + amt;
        }
    });

    const ts = Array.from(new Set([...Object.keys(deltasIn), ...Object.keys(deltasEx)].map(Number))).sort((a, b) => a - b);
    const perSymbol: Record<string, { income: number[]; expense: number[] }> = {};
    Array.from(symbols).forEach((s) => (perSymbol[s] = { income: new Array(ts.length).fill(0), expense: new Array(ts.length).fill(0) }));

    const totalIncome = new Array(ts.length).fill(0);
    const totalExpense = new Array(ts.length).fill(0);
    const balance = new Array(ts.length).fill(0);

    const runIn: Record<string, number> = {};
    const runEx: Record<string, number> = {};
    let rin = 0,
        rex = 0;

    ts.forEach((t, i) => {
        const addIn = deltasIn[t] || {};
        const addEx = deltasEx[t] || {};
        Object.entries(addIn).forEach(([s, v]) => {
            runIn[s] = (runIn[s] || 0) + Number(v || 0);
            rin += Number(v || 0);
        });
        Object.entries(addEx).forEach(([s, v]) => {
            runEx[s] = (runEx[s] || 0) + Number(v || 0);
            rex += Number(v || 0);
        });

        Object.keys(perSymbol).forEach((s) => {
            perSymbol[s].income[i] = runIn[s] || 0;
            perSymbol[s].expense[i] = runEx[s] || 0;
        });

        totalIncome[i] = rin;
        totalExpense[i] = rex;
        balance[i] = rin - rex;
    });

    return { ts, perSymbol, totalIncome, totalExpense, balance };
}

function sliceAndOffset(model: ReturnType<typeof buildModel>, range: RangeMode) {
    const { ts } = model;
    if (!ts.length || range === "full") return model;

    const lastTs = ts[ts.length - 1];
    const seconds =
        range === "last:6h" ? 6 * 3600 :
            range === "last:24h" ? 24 * 3600 :
                range === "last:3d" ? 3 * 86400 :
                    range === "last:7d" ? 7 * 86400 : 24 * 3600;

    const start = lastTs - seconds;
    let i0 = 0;
    while (i0 < ts.length && ts[i0] < start) i0++;
    if (i0 === 0) return model;

    const cut = (arr: number[]) => {
        const base = arr[i0 - 1];
        return arr.slice(i0 - 1).map((v) => v - base);
    };
    const outTs = ts.slice(i0 - 1);

    const perSymbol: Record<string, { income: number[]; expense: number[] }> = {};
    Object.entries(model.perSymbol).forEach(([k, se]) => {
        perSymbol[k] = { income: cut(se.income), expense: cut(se.expense) };
    });

    return {
        ts: outTs,
        perSymbol,
        totalIncome: cut(model.totalIncome),
        totalExpense: cut(model.totalExpense),
        balance: cut(model.balance),
    };
}

function drawLine(
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
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xToPx(xs[i]), yToPx(ys[i]));
    ctx.stroke();
}

function drawTooltip(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[]) {
    const pad = 6;
    ctx.font = "12px system-ui, sans-serif";
    const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + pad * 2;
    const h = lines.length * 16 + pad * 2;
    ctx.fillStyle = "rgba(20,20,20,0.95)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#eee"; lines.forEach((s, i) => ctx.fillText(s, x + pad, y + pad + 12 + i * 16));
}

function nearestIndex(xs: number[], x: number): number {
    if (!xs.length) return 0;
    let lo = 0, hi = xs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < x) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(xs[lo] - x) > Math.abs(xs[lo - 1] - x)) return lo - 1;
    return lo;
}

function fmtTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtMoney(n: number) {
    if (!Number.isFinite(n)) return "—";
    const sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n >= 1_000_000) return sign + (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1000) return sign + (n / 1000).toFixed(1) + "k";
    if (n >= 10) return sign + n.toFixed(0);
    return sign + n.toFixed(2);
}
