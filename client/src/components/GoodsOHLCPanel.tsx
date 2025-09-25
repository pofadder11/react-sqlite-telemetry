import React, { useEffect, useMemo, useState } from "react";
const API = (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8001";

type Row = {
    waypoint_symbol: string; trade_symbol: string; bucket_start: string;
    open_buy: number; high_buy: number; low_buy: number; close_buy: number;
    open_sell: number; high_sell: number; low_sell: number; close_sell: number;
    sample_count: number;
};

export default function GoodsOHLCPanel() {
    const [rows, setRows] = useState<Row[]>([]);
    const [symbols, setSymbols] = useState<string[]>([]);
    const [symbol, setSymbol] = useState<string>("");
    const [start, setStart] = useState<string>(""); // 'YYYY-MM-DD HH:MM:SS'
    const [end, setEnd] = useState<string>("");

    useEffect(() => {
        const params = new URLSearchParams();
        if (symbol) params.set("trade_symbol", symbol);
        if (start) params.set("start", start);
        if (end) params.set("end", end);
        params.set("limit", "2000");
        fetch(`${API}/goods/ohlc?` + params.toString()).then(r => r.json()).then((data: Row[]) => {
            setRows(data);
            // load full symbols set once (you can improve by separate endpoint)
            if (!symbols.length) setSymbols(Array.from(new Set(data.map(d => d.trade_symbol))).sort());
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, start, end]);

    const series = useMemo(() => {
        return rows
            .map(r => ({ t: new Date(r.bucket_start).getTime(), buy: r.close_buy, sell: r.close_sell }))
            .sort((a, b) => a.t - b.t);
    }, [rows]);

    const { minT, maxT, minV, maxV } = useMemo(() => {
        const ts = series.map(s => s.t);
        const vs = series.flatMap(s => [s.buy, s.sell]);
        return {
            minT: Math.min(...ts, Date.now() - 3600_000),
            maxT: Math.max(...ts, Date.now()),
            minV: Math.min(...vs, 0),
            maxV: Math.max(...vs, 10),
        };
    }, [series]);

    return (
        <div style={{ height: "100%", display: "grid", gridTemplateRows: "40px 1fr 36px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #222" }}>
                <label style={{ color: "#ddd", fontSize: 12 }}>Trade symbol</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={sel}>
                    <option value="">(pick one)</option>
                    {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <label style={{ color: "#ddd", fontSize: 12, marginLeft: 8 }}>From</label>
                <input value={start} onChange={e => setStart(e.target.value)} placeholder="YYYY-MM-DD HH:MM:SS" style={inp} />
                <label style={{ color: "#ddd", fontSize: 12 }}>To</label>
                <input value={end} onChange={e => setEnd(e.target.value)} placeholder="YYYY-MM-DD HH:MM:SS" style={inp} />
                <div style={{ flex: 1 }} />
                <span style={{ color: "#aaa", fontSize: 12 }}>{series.length} pts</span>
            </div>

            <div style={{ position: "relative" }}>
                <LineChart
                    series={[
                        { name: "Buy close", points: series.map(s => ({ x: s.t, y: s.buy })), stroke: "#22c55e" },
                        { name: "Sell close", points: series.map(s => ({ x: s.t, y: s.sell })), stroke: "#60a5fa" },
                    ]}
                    minX={minT} maxX={maxT} minY={minV} maxY={maxV}
                />
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", borderTop: "1px solid #222", color: "#aaa", fontSize: 12 }}>
                <span>Keys:</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <i style={{ width: 12, height: 2, background: "#22c55e", display: "inline-block" }} /> Buy close
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <i style={{ width: 12, height: 2, background: "#60a5fa", display: "inline-block" }} /> Sell close
                </span>
            </div>
        </div>
    );
}

function LineChart({ series, minX, maxX, minY, maxY }: { series: { name: string; points: { x: number; y: number }[]; stroke: string; }[]; minX: number; maxX: number; minY: number; maxY: number; }) {
    const pad = 32;
    const w = 900, h = 300; // container will scale
    const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - 2 * pad);
    const sy = (y: number) => (h - pad) - ((y - minY) / Math.max(1, maxY - minY)) * (h - 2 * pad);

    // grid ticks
    const ticks = 5;
    const xs = Array.from({ length: ticks + 1 }, (_, i) => minX + (i * (maxX - minX) / ticks));
    const ys = Array.from({ length: ticks + 1 }, (_, i) => minY + (i * (maxY - minY) / ticks));

    return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", background: "#0d0d0d" }}>
            {/* grid */}
            {xs.map((x, i) => <line key={"x" + i} x1={sx(x)} y1={pad} x2={sx(x)} y2={h - pad} stroke="#1b1b1b" />)}
            {ys.map((y, i) => <line key={"y" + i} x1={pad} y1={sy(y)} x2={w - pad} y2={sy(y)} stroke="#1b1b1b" />)}
            {/* axes */}
            <rect x={pad} y={pad} width={w - 2 * pad} height={h - 2 * pad} fill="none" stroke="#2a2a2a" />
            {/* series */}
            {series.map((s, si) => {
                const d = s.points.length
                    ? "M" + s.points.map((p, i) => `${sx(p.x)},${sy(p.y)}`).join(" L")
                    : "";
                return <path key={si} d={d} stroke={s.stroke} strokeWidth={2} fill="none" />;
            })}
            {/* min/max labels */}
            <text x={pad} y={pad - 8} fill="#888" fontSize="10">{new Date(minX).toLocaleTimeString()}</text>
            <text x={w - pad} y={pad - 8} fill="#888" fontSize="10" textAnchor="end">{new Date(maxX).toLocaleTimeString()}</text>
            <text x={pad - 6} y={sy(minY)} fill="#888" fontSize="10" textAnchor="end">{minY}</text>
            <text x={pad - 6} y={sy(maxY)} fill="#888" fontSize="10" textAnchor="end">{maxY}</text>
        </svg>
    );
}
const sel: React.CSSProperties = { background: "#121212", color: "#eee", border: "1px solid #2a2a2a", borderRadius: 6, padding: "4px 6px" };
const inp: React.CSSProperties = { background: "#121212", color: "#eee", border: "1px solid #2a2a2a", borderRadius: 6, padding: "4px 6px", width: 180 };
