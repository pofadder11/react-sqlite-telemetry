import React, { useEffect, useRef } from "react";

type FleetEvent = { ship_symbol: string; x: number; y: number; t: number };
type Track = { from: FleetEvent; to: FleetEvent; startedAt: number };
type Tracks = Map<string, Track>;

export default function FleetCanvas() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const tracksRef = useRef<Tracks>(new Map());

    // Connect to the relay
    useEffect(() => {
        const ws = new WebSocket("ws://localhost:8001/ws/fleet");
        ws.onmessage = (ev) => {
            try {
                const evt = JSON.parse(ev.data) as FleetEvent;
                const key = evt.ship_symbol;
                const now = performance.now();
                const existing = tracksRef.current.get(key);
                const to = evt;
                const from = existing?.to ?? to; // seed from==to to avoid jump
                tracksRef.current.set(key, { from, to, startedAt: now });
            } catch {
                // ignore malformed
            }
        };
        return () => ws.close();
    }, []);

    // Draw loop (kept outside React state)
    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        let raf = 0;

        const draw = () => {
            // HiDPI
            const dpr = devicePixelRatio || 1;
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            ctx.resetTransform();
            ctx.scale(dpr, dpr);

            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            // background
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            for (let i = 0; i < 60; i++) ctx.fillRect((i * 47) % w, (i * 83) % h, 1, 1);

            ctx.strokeStyle = "rgba(159,231,255,0.3)";
            ctx.fillStyle = "#9fe7ff";
            ctx.lineWidth = 1;

            const now = performance.now();
            tracksRef.current.forEach(({ from, to, startedAt }) => {
                const t = Math.min(1, (now - startedAt) / 400);
                const d = easeOutCubic(t);
                const x = from.x + (to.x - from.x) * d;
                const y = from.y + (to.y - from.y) * d;

                // trail
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();

                // ship
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            });

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div style= {{ width: "100%", height: "100%", position: "relative" }
}>
    <canvas ref={ canvasRef } style = {{ width: "100%", height: "100%", display: "block", background: "black" }} />
        < div style = {{ position: "absolute", top: 8, right: 12, fontSize: 12, opacity: 0.7 }}>
            Latest only • delta updates • client - side interpolation
                </div>
                </div>
  );
}

function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
}
