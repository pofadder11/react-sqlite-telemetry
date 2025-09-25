import React, { useEffect, useMemo, useState } from "react";

type Row = {
    id: string;
    waypoint_symbol: string;
    trade_symbol: string;
    type: string;
    trade_volume: number | string;
    supply: string;
    activity: string;
    purchase_price: number | string;
    sell_price: number | string;
    observed_at: string;
    updated_at: string;
};

// If you run API elsewhere, set VITE_API_BASE=http://127.0.0.1:8001
const API_BASE =
    (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8001";

export default function GoodsSnapshotPanel() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [sortBy, setSortBy] = useState<keyof Row>("sell_price");
    const [desc, setDesc] = useState<boolean>(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setLoading(true);
                const r = await fetch(`${API_BASE}/goods/snapshots`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data: Row[] = await r.json();
                if (alive) setRows(data);
            } catch (e: any) {
                if (alive) setErr(e?.message || String(e));
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    const sorted = useMemo(() => {
        const copy = [...rows];
        const num = (v: unknown) => {
            if (typeof v === "number") return v;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        copy.sort((a, b) => {
            const av = a[sortBy];
            const bv = b[sortBy];
            const an = num(av);
            const bn = num(bv);
            let cmp: number;
            if (an !== null && bn !== null) {
                cmp = an - bn;
            } else {
                cmp = String(av).localeCompare(String(bv));
            }
            return desc ? -cmp : cmp;
        });
        return copy;
    }, [rows, sortBy, desc]);

    const clickHeader = (k: keyof Row) => {
        if (k === sortBy) setDesc(d => !d);
        else {
            setSortBy(k);
            setDesc(true);
        }
    };

    if (loading) return <div style={panelStyle}>Loading…</div>;
    if (err) return <div style={panelStyle}>Error: {err}</div>;

    return (
        <div style={panelStyle}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                <strong>Goods (latest snapshots)</strong>
                <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}>
                    Click a column to sort {desc ? "↓" : "↑"}
                </span>
            </div>
            <div style={{ overflow: "auto" }}>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            {headerCell("waypoint_symbol", "Waypoint", sortBy, desc, clickHeader)}
                            {headerCell("trade_symbol", "Trade Symbol", sortBy, desc, clickHeader)}
                            {headerCell("type", "Type", sortBy, desc, clickHeader)}
                            {headerCell("trade_volume", "Volume", sortBy, desc, clickHeader)}
                            {headerCell("supply", "Supply", sortBy, desc, clickHeader)}
                            {headerCell("activity", "Activity", sortBy, desc, clickHeader)}
                            {headerCell("purchase_price", "Buy", sortBy, desc, clickHeader)}
                            {headerCell("sell_price", "Sell", sortBy, desc, clickHeader)}
                            {headerCell("observed_at", "Observed", sortBy, desc, clickHeader)}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((r) => (
                            <tr key={r.id}>
                                <td>{r.waypoint_symbol}</td>
                                <td>{r.trade_symbol}</td>
                                <td>{r.type}</td>
                                <td style={{ textAlign: "right" }}>{r.trade_volume}</td>
                                <td>{r.supply}</td>
                                <td>{r.activity}</td>
                                <td style={{ textAlign: "right" }}>{r.purchase_price}</td>
                                <td style={{ textAlign: "right" }}>{r.sell_price}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{r.observed_at.replace("T", " ").slice(0, 19)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const panelStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#0b0b0b",
    color: "#ddd",
};

const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
};

function headerCell<K extends keyof Row>(
    key: K,
    label: string,
    sortBy: keyof Row,
    desc: boolean,
    onClick: (k: keyof Row) => void
) {
    const active = key === sortBy;
    return (
        <th
            key={String(key)}
            onClick={() => onClick(key)}
            style={{
                position: "sticky",
                top: 0,
                background: active ? "#191919" : "#141414",
                cursor: "pointer",
                borderBottom: "1px solid #222",
                padding: "8px 10px",
                textAlign: key.toString().includes("price") || key === "trade_volume" ? "right" as const : "left" as const,
                whiteSpace: "nowrap",
            }}
            title={`Sort by ${label}`}
        >
            {label} {active ? (desc ? "↓" : "↑") : ""}
        </th>
    );
}
