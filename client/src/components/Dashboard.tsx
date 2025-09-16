import React from "react";
import FleetCanvas from "./FleetCanvas";
import TransactionsChart from "./TransactionsChart";

export default function Dashboard() {
    return (
        <div
            style={{
                display: "grid",
                gridTemplateRows: "1fr auto", // map on top, chart at bottom
                gap: 12,
                height: "100vh",
                background: "black",
            }}
        >
            {/* Map / ship journeys */}
            <div style={{ minHeight: 500 }}>
                <FleetCanvas />
            </div>

            {/* Transactions graph */}
            <div style={{ height: 260 }}>
                <TransactionsChart defaultSinceHours={6} defaultSymbol="FUEL" />
            </div>
        </div>
    );
}
