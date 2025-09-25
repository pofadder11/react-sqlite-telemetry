import React, { useEffect, useState } from "react";
const API = (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8001";

type Row = {
    trade_symbol: string; buy_waypoint: string; buy_price: number;
    sell_waypoint: string; sell_price: number; delta: number;
    buy_observed_at: string; sell_observed_at: string; computed_at: string;
};

export default function ArbitrageSnapshotPanel() {
    const [rows, setRows] = useState<Row[]>([]);
    const [symbols, setSymbols] = useState<string[]>([]);
    const [symbol, setSymbol] = useState<string>("");

    useEffect(() => {
        const url = `${API}/arb/snapshot` + (symbol ? `?trade_symbol=${encodeURIComponent(symbol)}` : "");
        fetch(url).then(r => r.json()).then((data: Row[]) => {
            setRows(data);
            if (!symbols.length) setSymbols(Array.from(new Set(data.map(d => d.trade_symbol))).sort());
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);

    const fmt = (n: number) => n.toLocaleString();
    return (
        <div style={{ height: "100%", display: "grid", gridTemplateRows: "40px 1fr" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #222" }}>
                <label style={{ color: "#ddd", fontSize: 12 }}>Trade symbol</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)} style={sel}>
                    <option value="">All</option>
                    {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ flex: 1 }} />
                <span style={{ color: "#aaa", fontSize: 12 }}>{rows.length} routes</span>
            </div>

            <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#ddd" }}>
                    <thead>
                        <tr>
                            {["trade", "buy@wp", "buy", "sell@wp", "sell", "Δ", "freshness"].map(h => <th key={h} style={th}>{h.toUpperCase()}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i}>
                                <td style={td}>{r.trade_symbol}</td>
                                <td style={td}>{r.buy_waypoint}</td>
                                <td style={td}>{fmt(r.buy_price)}</td>
                                <td style={td}>{r.sell_waypoint}</td>
                                <td style={td}>{fmt(r.sell_price)}</td>
                                <td style={{ ...td, color: r.delta >= 0 ? "#22c55e" : "#f87171" }}>{fmt(r.delta)}</td>
                                <td style={td} title={`buy:${r.buy_observed_at} / sell:${r.sell_observed_at}`}>{new Date(r.computed_at).toLocaleTimeString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
const sel: React.CSSProperties = { background: "#121212", color: "#eee", border: "1px solid #2a2a2a", borderRadius: 6, padding: "4px 6px" };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #222", position: "sticky", top: 0, background: "#0f0f0f" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #1a1a1a", whiteSpace: "nowrap" };
