import React from "react";
import FleetCanvas from "./components/FleetCanvas";

export default function App() {
    return (
        <div style={{ height: "100%", display: "grid", gridTemplateRows: "48px 1fr" }}>
            <header style={{ display: "flex", alignItems: "center", padding: "0 12px", background: "#111", borderBottom: "1px solid #222" }}>
                <strong>SQLite Telemetry</strong>
                <span style={{ marginLeft: 12, fontSize: 12, opacity: 0.7 }}>React + Canvas + WS (delta updates)</span>
            </header>
            <FleetCanvas />
        </div>
    );
}
