import React from "react";
import FleetCanvas from "./components/FleetCanvas";
import TransactionsChart from "./components/TransactionsChart";

export default function App() {
    return (
        // Use viewport height to avoid relying on parent CSS
        <div style={{ height: "100vh", display: "grid", gridTemplateRows: "48px minmax(0, 1fr)" }}>
            <header
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    background: "#111",
                    borderBottom: "1px solid #222",
                }}
            >
                <strong>SQLite Telemetry</strong>
                <span style={{ marginLeft: 12, fontSize: 12, opacity: 0.7 }}>
                    React + Canvas + WS (delta updates)
                </span>
            </header>

            {/* Main area: map (flexible) + chart (fixed) */}
            <div
                style={{
                    display: "grid",
                    gridTemplateRows: "minmax(0, 1fr) 260px", // map gets flexible space, chart is fixed 260px
                    gap: 12,
                    minHeight: 0, // IMPORTANT so the first row can actually shrink/grow
                    background: "black",
                    padding: 12,
                }}
            >
                {/* Map row must also allow shrinking/growing */}
                <div style={{ minHeight: 0 }}>
                    <FleetCanvas />
                </div>

                <div>
                    <TransactionsChart defaultSinceHours={6} defaultSymbol="FUEL" />
                </div>
            </div>
        </div>
    );
}
