import React, { useEffect, useMemo, useState } from "react";
const API = (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8001";

type Row = {
    trade_symbol: string; buy_waypoint: string; buy_price: number;
    sell_waypoint: string; sell_price: number; delta: number;
    computed_bucket: string; computed_at: string;
};

export default function ArbitrageHistoryPanel() {
    const [rows, setRows] = useState<Row[]>([]);
    const [symbols, setSymbols] = useState<string[]>([]);
    const [pick, setPick] = useState<string[]>([]);
    const [start, setStart] = useState<string>("");
    const [end, setEnd] = useState<string>("");

    useEffect(() => {
        const params = new URLSearchParams();
        if (start) params.set("start", start);
        if (end) params.set("end", end);
        params.set("limit", "5000");
        fetch(`${API}/arb/history?` + params.toString()).then(r => r.json()).then((data: Row[]) => {
            setRows(data);
            const syms = Array.from(new Set(data.map(d => d.trade_symbol))).sort();
            setSymbols(syms);
            if (!pick.length) setPick(syms.slice(0, 6));
        });

    }, [start, end]);

    const grouped = useMemo(() => {
        const m = new Map<string, { x: number; y: number }[]>();
        for (const r of rows) {
            if (pick.length && !pick.includes(r.trade_symbol)) continue;
            const t = new Date(r.computed_bucket).getTime();
            const arr = m.get(r.trade_symbol) || [];
            arr.push({ x: t, y: r.delta });
            m.set(r.trade_symbol, arr);
        }
        for (const arr of m.values()) arr.sort((a, b) => a.x - b.x);
        return m;
    }, [rows, pick]);

    const allPts = Array.from(grouped.values()).flat();
    const minX = Math.min(...allPts.map(p => p.x), Date.now() - 6 * 3600_000);
    const maxX = Math.max(...allPts.map(p => p.x), Date.now());
    const minY = Math.min(...allPts.map(p => p.y), -10);
    const maxY = Math.max(...allPts.map(p => p.y), 10);

    return (
        <div style={{ height: "100%", display: "grid", gridTemplateRows: "40px 1fr 52px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #222" }}>
                <label style={{ color: "#ddd", fontSize: 12 }}>Symbols</label>
                <MultiSelect all={symbols} pick={pick} setPick={setPick} />
                <label style={{ color: "#ddd", fontSize: 12, marginLeft: 8 }}>From</label>
                <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="YYYY-MM-DD HH:MM:SS" style={inp} />
                <label style={{ color: "#ddd", fontSize: 12 }}>To</label>
                <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="YYYY-MM-DD HH:MM:SS" style={inp} />
                <div style={{ flex: 1 }} />
                <span style={{ color: "#aaa", fontSize: 12 }}>{grouped.size} series</span>
            </div>

            <div style={{ position: "relative" }}>
                <SvgLines grouped={grouped} minX={minX} maxX={maxX} minY={minY} maxY={maxY} />
            </div>

            {/* legend */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", borderTop: "1px solid #222", color: "#aaa", fontSize: 12, flexWrap: "wrap" }}>
                {pick.map((s, i) => (
                    <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8 }}>
                        <i style={{ width: 14, height: 3, background: pal(i), display: "inline-block" }} /> {s}
                    </span>
                ))}
            </div>
        </div>
    );
}

function SvgLines({ grouped, minX, maxX, minY, maxY }: { grouped: Map<string, { x: number; y: number }[]>; minX: number; maxX: number; minY: number; maxY: number; }) {
    const pad = 36, w = 900, h = 320;
    const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - 2 * pad);
    const sy = (y: number) => (h - pad) - ((y - minY) / Math.max(1, maxY - minY)) * (h - 2 * pad);

    const ticks = 5;
    const xs = Array.from({ length: ticks + 1 }, (_, i) => minX + (i * (maxX - minX) / ticks));
    const ys = Array.from({ length: ticks + 1 }, (_, i) => minY + (i * (maxY - minY) / ticks));

    return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", background: "#0d0d0d" }}>
            {xs.map((x, i) => <line key={"x" + i} x1={sx(x)} y1={pad} x2={sx(x)} y2={h - pad} stroke="#1b1b1b" />)}
            {ys.map((y, i) => <line key={"y" + i} x1={pad} y1={sy(y)} x2={w - pad} y2={sy(y)} stroke="#1b1b1b" />)}
            <rect x={pad} y={pad} width={w - 2 * pad} height={h - 2 * pad} fill="none" stroke="#2a2a2a" />

            {Array.from(grouped.entries()).map(([sym, pts], i) => {
                const d = pts.length ? "M" + pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(" L") : "";
                return <path key={sym} d={d} stroke={pal(i)} strokeWidth={2} fill="none" />;
            })}

            <text x={pad} y={pad - 8} fill="#888" fontSize="10">{new Date(minX).toLocaleTimeString()}</text>
            <text x={w - pad} y={pad - 8} fill="#888" fontSize="10" textAnchor="end">{new Date(maxX).toLocaleTimeString()}</text>
            <text x={pad - 6} y={sy(minY)} fill="#888" fontSize="10" textAnchor="end">{minY}</text>
            <text x={pad - 6} y={sy(maxY)} fill="#888" fontSize="10" textAnchor="end">{maxY}</text>
        </svg>
    );
}

function MultiSelect({
    all, pick, setPick
}: {
    all: string[];
    pick: string[];
    setPick: React.Dispatch<React.SetStateAction<string[]>>;
}) {
    const [query, setQuery] = useState("");
    const filtered = all.filter(s => s.toLowerCase().includes(query.toLowerCase()));
    const toggle = (s: string) =>
        setPick(p => (p.includes(s) ? p.filter(x => x !== s) : [...p, s]));
    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter…" style={inp} />
            <div style={{ maxHeight: 140, overflow: "auto", border: "1px solid #2a2a2a", borderRadius: 6, padding: 6 }}>
                {filtered.map(s => (
                    <label key={s} style={{ display: "flex", gap: 6, color: "#ddd", fontSize: 12 }}>
                        <input type="checkbox" checked={pick.includes(s)} onChange={() => toggle(s)} />
                        {s}
                    </label>
                ))}
            </div>
        </div>
    );
}

function pal(i: number) {
    const colors = ["#22c55e", "#60a5fa", "#f59e0b", "#a78bfa", "#ef4444", "#14b8a6", "#f472b6", "#84cc16", "#eab308", "#38bdf8"];
    return colors[i % colors.length];
}
const inp: React.CSSProperties = { background: "#121212", color: "#eee", border: "1px solid #2a2a2a", borderRadius: 6, padding: "4px 6px" };
