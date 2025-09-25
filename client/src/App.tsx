import React from "react";
import FleetCanvas from "./components/FleetCanvas";
import GraphsTabs from "./components/GraphsTabs";
import TransactionsChart from "./components/TransactionsChart";
import GoodsSnapshotPanel from "./components/GoodsSnapshotPanel";
import GoodsOHLCPanel from "./components/GoodsOHLCPanel";
import ArbitrageSnapshotPanel from "./components/ArbitrageSnapshotPanel";
import ArbitrageHistoryPanel from "./components/ArbitrageHistoryPanel";

export default function App() {
    return (
        <div style={{ height: "100%", display: "grid", gridTemplateRows: "48px 1fr" }}>
            <header style={{ display: "flex", alignItems: "center", padding: "0 12px", background: "#111", borderBottom: "1px solid #222", gap: 12 }}>
                <strong>SQLite Telemetry</strong>
                <span style={{ fontSize: 12, opacity: 0.7 }}>React + Canvas + WS (delta updates)</span>
            </header>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 42%) 1fr", gap: 12, padding: 12 }}>
                <div style={{ minHeight: 320, border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
                    <FleetCanvas />
                </div>

                <GraphsTabs
                    tabs={[
                        { key: "tx", label: "Transactions", content: <TransactionsChart /> },
                        { key: "goods-snap", label: "Goods (Snapshots)", content: <GoodsSnapshotPanel /> },
                        { key: "goods-ohlc", label: "Goods (OHLC)", content: <GoodsOHLCPanel /> },
                        { key: "arb-snap", label: "Arbitrage (Now)", content: <ArbitrageSnapshotPanel /> },
                        { key: "arb-history", label: "Arbitrage (History)", content: <ArbitrageHistoryPanel /> },
                    ]}
                />
            </div>
        </div>
    );
}
