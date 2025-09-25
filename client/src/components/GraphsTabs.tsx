// client/src/components/GraphsTabs.tsx
import React, { useMemo, useState } from "react";

type Tab = { key: string; label: string; content: React.ReactNode };

export default function GraphsTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const [full, setFull] = useState(false);

  const ActiveContent = useMemo(
    () => tabs.find(t => t.key === active)?.content ?? null,
    [tabs, active]
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map(({ key, label }) => {
            const isActive = key === active;
            return (
              <button
                key={key}
                onClick={() => setActive(key)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #2a2a2a",
                  background: isActive ? "#222" : "#151515",
                  color: isActive ? "#fff" : "#ddd",
                  cursor: "pointer",
                }}
                title={label}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => setFull(v => !v)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #2a2a2a",
              background: "#151515",
              color: "#ddd",
              cursor: "pointer",
            }}
            title={full ? "Exit Fullscreen" : "Full Screen"}
          >
            {full ? "Exit Fullscreen" : "Full Screen"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          position: "absolute",
          top: 44, // below header
          left: 0,
          right: 0,
          bottom: 0,
          border: "1px solid #222",
          borderRadius: 8,
          background: "#0b0b0b",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "100%", height: "100%" }}>{ActiveContent}</div>
      </div>

      {/* Fullscreen overlay */}
      {full && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.92)",
            zIndex: 9999,
            display: "grid",
            gridTemplateRows: "48px 1fr",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "#111",
              borderBottom: "1px solid #222",
            }}
          >
            <strong style={{ color: "#fff" }}>
              {tabs.find(t => t.key === active)?.label ?? "Graph"}
            </strong>
            <button
              onClick={() => setFull(false)}
              style={{
                marginLeft: "auto",
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #2a2a2a",
                background: "#151515",
                color: "#ddd",
                cursor: "pointer",
              }}
            >
              Exit Fullscreen
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: 0 }}>{ActiveContent}</div>
          </div>
        </div>
      )}
    </div>
  );
}
