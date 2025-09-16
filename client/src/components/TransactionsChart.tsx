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

const PAD_LEFT = 50;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export default function TransactionsChart({
    defaultSinceHours = 6,
    defaultSymbol = "",
    pollMs = 10000,
}: {
    defaultSinceHours?: number;
    defaultSymbol?: string; // e.g. "FUEL" or "" = all
    pollMs?: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [rows, setRows] = useState<TxRow[]>([]);
    const [since, setSince] = useState(defaultSinceHours);
    const [symbol, setSymbol] = useState(defaultSymbol);
    const [loading, setLoading] = useState(false);
    const hoverRef = useRef<{ x: number; y: number; row?: TxRow } | null>(null);

    // fetcher
    const fetchData = async () => {
        setLoading(true);
        const qs = new URLSearchParams({ since_hours: String(since) });
        if (symbol) qs.set("trade_symbol", symbol);
        const res = await fetch(`http://localhost:8001/transactions?${qs.toString()}`);
        const data: ApiResp = await res.json();
        setRows(data.rows || []);
        setLoading(false);
    };

    // initial + poll
    useEffect(() => {
        fetchData();
        const id = setInterval(fetchData, pollMs);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [since, symbol, pollMs]);

    // draw
    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        let raf = 0;

        const onMove = (ev: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const mx = (ev.clientX - rect.left) * (canvas.width / rect.width);
            const my = (ev.clientY - rect.top) * (canvas.height / rect.height);
            hoverRef.current = { x: mx, y: my };
        };
        const onLeave = () => { hoverRef.current = null; };

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

            // frame
            ctx.fillStyle = "#0b0b0b";
            ctx.fillRect(0, 0, w, h);

            // axes box
            const x0 = PAD_LEFT, x1 = w - PAD_RIGHT;
            const y0 = PAD_TOP, y1 = h - PAD_BOTTOM;

            // data ranges
            const xs = rows.map(r => r.ts);
            const ys = rows.map(r => r.total_price);
            const minX = xs.length ? Math.min(...xs) : 0;
            const maxX = xs.length ? Math.max(...xs) : 1;
            const minY = 0;
            const maxY = ys.length ? Math.max(...ys) * 1.1 : 1;

            // scales
            const xToPx = (ts: number) =>
                x0 + (maxX === minX ? 0 : (ts - minX) / (maxX - minX)) * (x1 - x0);
            const yToPx = (v: number) =>
                y1 - (maxY === minY ? 0 : (v - minY) / (maxY - minY)) * (y1 - y0);

            // grid
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1);
            ctx.stroke();

            // x ticks (5)
            ctx.fillStyle = "rgba(220,220,220,0.8)";
            ctx.font = "12px system-ui, sans-serif";
            for (let i = 0; i <= 5; i++) {
                const t = minX + (i / 5) * (maxX - minX);
                const px = xToPx(t);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
                const label = fmtTime(t);
                const m = ctx.measureText(label);
                ctx.fillText(label, px - m.width / 2, y1 + 16);
            }

            // y ticks (4)
            for (let i = 0; i <= 4; i++) {
                const v = minY + (i / 4) * (maxY - minY);
                const py = yToPx(v);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
                const label = fmtNum(v);
                const m = ctx.measureText(label);
                ctx.fillText(label, x0 - 8 - m.width, py + 4);
            }

            // legend
            ctx.fillStyle = "#ddd";
            ctx.fillText(`Transactions ${symbol ? `• ${symbol}` : "• ALL"} (last ${since}h)`, x0, y0 - 4);

            // dots
            const hover = hoverRef.current;
            let hoverHit: TxRow | undefined;
            rows.forEach((r) => {
                const px = xToPx(r.ts);
                const py = yToPx(r.total_price);
                const color = r.tx_type === "SELL" ? "#f97316" : "#22c55e"; // orange vs green
                const radius = 2 + Math.min(6, Math.sqrt(Math.max(1, r.units))); // units -> size

                // hit test for tooltip (in screen coords)
                if (hover) {
                    const dx = (hover.x / dpr) - px;
                    const dy = (hover.y / dpr) - py;
                    if (dx * dx + dy * dy < (radius + 3) * (radius + 3)) hoverHit = r;
                }

                ctx.beginPath();
                ctx.arc(px, py, radius, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.9;
                ctx.fill();
                ctx.globalAlpha = 1;
            });

            // tooltip
            if (hover && hoverHit) {
                const px = xToPx(hoverHit.ts);
                const py = yToPx(hoverHit.total_price);
                const lines = [
                    `${hoverHit.trade_symbol} • ${hoverHit.tx_type}`,
                    `units: ${hoverHit.units} @ ${fmtNum(hoverHit.price_per_unit)}`,
                    `total: ${fmtNum(hoverHit.total_price)}`,
                    new Date(hoverHit.ts * 1000).toLocaleTimeString(),
                    `wp: ${hoverHit.waypoint_symbol}`,
                ];
                const pad = 6;
                ctx.font = "12px system-ui, sans-serif";
                const wBox = Math.max(...lines.map(s => ctx.measureText(s).width)) + pad * 2;
                const hBox = lines.length * 16 + pad * 2;
                const bx = Math.min(px + 10, (x1 - wBox));
                const by = Math.max(y0, py - hBox - 10);
                ctx.fillStyle = "rgba(20,20,20,0.95)";
                ctx.fillRect(bx, by, wBox, hBox);
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.strokeRect(bx, by, wBox, hBox);
                ctx.fillStyle = "#eee";
                lines.forEach((s, i) => ctx.fillText(s, bx + pad, by + pad + 12 + i * 16));
            }

            // loading
            if (loading) {
                ctx.fillStyle = "rgba(255,255,255,0.6)";
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
    }, [rows, since, symbol, loading]);

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

/* utils */
function fmtNum(n: number) {
    if (!isFinite(n)) return String(n);
    if (n >= 1000) return n.toLocaleString();
    if (n >= 10) return n.toFixed(0);
    return n.toFixed(2);
}
function fmtTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
