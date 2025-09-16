import React, { useEffect, useRef, useState } from "react";

type Vec = { x: number; y: number };
type JourneyEvt = {
    type: "journey";
    journey_id: string;
    ship_symbol: string;
    departure_ts: number;   // unix seconds
    arrival_ts: number;     // unix seconds
    origin: { symbol: string; x: number | null; y: number | null };
    destination: { symbol: string; x: number | null; y: number | null };
    flight_mode?: string;
};
type Segment = { jid: string; from: Vec; to: Vec; depMs: number; arrMs: number };
type ShipTrail = { recent: Segment[]; older: Segment[]; active?: Segment };
type Trails = Map<string, ShipTrail>;
type Waypoint = { symbol: string; x: number; y: number; is_market: boolean };

// View transform for world <-> screen
type View = {
    scale: number;  // px per world unit (with y-flip baked into ty)
    tx: number;     // screen translation X
    ty: number;     // screen translation Y
    pad: number;
    // world bbox used for fit
    minX: number; maxX: number; minY: number; maxY: number;
    _needsFit?: boolean; // request refit to bbox on next frame
};

const RECENT_LIMIT = 5;
const RECENT_ALPHAS = [1.0, 0.8, 0.6, 0.4, 0.25];
const OLDER_ALPHA = 0.12;

type HudRow = { ship: string; origin: string; destination: string; progress: number; etaSec: number; };

export default function FleetCanvas() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const trailsRef = useRef<Trails>(new Map());
    const waypointsRef = useRef<Waypoint[] | null>(null);
    const viewRef = useRef<View | null>(null);

    // NEW: once the user interacts (zoom/pan), don’t auto-refit on new journeys
    const userAdjustedRef = useRef(false); // NEW

    const [hudVisible, setHudVisible] = useState(true);
    const [hudRows, setHudRows] = useState<HudRow[]>([]);

    // --- Load waypoints and create initial view bbox ---
    useEffect(() => {
        fetch("http://localhost:8001/waypoints")
            .then(r => r.json())
            .then((wps: Waypoint[]) => {
                waypointsRef.current = wps;
                const xs = wps.map(w => Number(w.x));
                const ys = wps.map(w => Number(w.y));
                const minX = wps.length ? Math.min(...xs) : -100;
                const maxX = wps.length ? Math.max(...xs) : 100;
                const minY = wps.length ? Math.min(...ys) : -100;
                const maxY = wps.length ? Math.max(...ys) : 100;
                viewRef.current = { scale: 1, tx: 0, ty: 0, pad: 40, minX, maxX, minY, maxY, _needsFit: true };
                userAdjustedRef.current = false; // allow one-time initial fit // NEW
            })
            .catch(() => {
                waypointsRef.current = [];
                viewRef.current = { scale: 1, tx: 0, ty: 0, pad: 40, minX: -100, maxX: 100, minY: -100, maxY: 100, _needsFit: true };
                userAdjustedRef.current = false; // NEW
            });
    }, []);

    // --- WebSocket: receive journeys, store segments, request refit if needed ---
    useEffect(() => {
        const ws = new WebSocket("ws://localhost:8001/ws/journeys");
        ws.onmessage = (ev) => {
            let evt: JourneyEvt; try { evt = JSON.parse(ev.data); } catch { return; }
            if (evt.type !== "journey") return;
            if (evt.origin.x == null || evt.origin.y == null || evt.destination.x == null || evt.destination.y == null) return;

            const from = { x: Number(evt.origin.x), y: Number(evt.origin.y) };
            const to = { x: Number(evt.destination.x), y: Number(evt.destination.y) };
            const seg: Segment = {
                jid: evt.journey_id,
                from, to,
                depMs: Number(evt.departure_ts) * 1000,
                arrMs: Number(evt.arrival_ts) * 1000,
            };

            const ship = evt.ship_symbol;
            let trail = trailsRef.current.get(ship);
            if (!trail) { trail = { recent: [], older: [] }; trailsRef.current.set(ship, trail); }

            const iR = trail.recent.findIndex(s => s.jid === seg.jid);
            if (iR >= 0) trail.recent.splice(iR, 1);
            const iO = trail.older.findIndex(s => s.jid === seg.jid);
            if (iO >= 0) trail.older.splice(iO, 1);

            trail.recent.unshift(seg);
            while (trail.recent.length > RECENT_LIMIT) trail.older.unshift(trail.recent.pop()!);

            // widen bbox to include this segment…
            const v = viewRef.current;
            if (v) {
                v.minX = Math.min(v.minX, seg.from.x, seg.to.x);
                v.maxX = Math.max(v.maxX, seg.from.x, seg.to.x);
                v.minY = Math.min(v.minY, seg.from.y, seg.to.y);
                v.maxY = Math.max(v.maxY, seg.from.y, seg.to.y);
                // …but ONLY trigger auto-fit if the user hasn’t interacted yet (initial load)
                if (!userAdjustedRef.current) v._needsFit = true; // CHANGED
            }
        };
        return () => ws.close();
    }, []);

    // --- Transform helpers ---
    const ensureFit = (w: number, h: number): View => {
        const v = viewRef.current!;
        if (!v) return { scale: 1, tx: 0, ty: 0, pad: 40, minX: -100, maxX: 100, minY: -100, maxY: 100 };
        // Only fit when explicitly requested (_needsFit), which is true initially and on manual reset
        if (v._needsFit) {
            const pad = v.pad;
            const worldW = Math.max(1, v.maxX - v.minX);
            const worldH = Math.max(1, v.maxY - v.minY);
            const scale = Math.min((w - 2 * pad) / worldW, (h - 2 * pad) / worldH);
            // y is flipped: we want world +Y up -> screen -Y
            const tx = pad - v.minX * scale;
            const ty = pad + v.maxY * (-scale);
            v.scale = scale; v.tx = tx; v.ty = ty; v._needsFit = false;
        }
        return v;
    };
    const worldToScreen = (p: Vec, w: number, h: number): Vec => {
        const v = ensureFit(w, h);
        const yFlip = -1;
        return { x: p.x * v.scale + v.tx, y: p.y * v.scale * yFlip + v.ty };
    };
    const screenToWorld = (p: Vec, w: number, h: number): Vec => {
        const v = ensureFit(w, h);
        const yFlip = -1;
        return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / (v.scale * yFlip) };
    };

    // --- Input: wheel zoom, drag pan, double-click reset ---
    useEffect(() => {
        const canvas = canvasRef.current!;
        let pointerId: number | null = null;
        let dragging = false;
        let start = { mx: 0, my: 0, tx0: 0, ty0: 0 };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const v = viewRef.current; if (!v) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const w = canvas.clientWidth, h = canvas.clientHeight;

            // world coord under cursor before zoom
            const before = screenToWorld({ x: mx, y: my }, w, h);

            // zoom factor
            const zoomIntensity = 1.15;
            const factor = e.deltaY > 0 ? 1 / zoomIntensity : zoomIntensity;
            v.scale = clamp(v.scale * factor, 0.1, 50);

            // recompute tx/ty so the point under cursor stays fixed
            const after = worldToScreen(before, w, h);
            v.tx += mx - after.x;
            v.ty += my - after.y;

            userAdjustedRef.current = true; // NEW: freeze auto-fit from now on
        };

        const onPointerDown = (e: PointerEvent) => {
            const v = viewRef.current; if (!v) return;
            dragging = true;
            pointerId = e.pointerId;
            try { canvas.setPointerCapture(pointerId); } catch { }
            const rect = canvas.getBoundingClientRect();
            start = { mx: e.clientX - rect.left, my: e.clientY - rect.top, tx0: v.tx, ty0: v.ty };
            (canvas.style as any).cursor = "grabbing";
            userAdjustedRef.current = true; // NEW
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!dragging) return;
            const v = viewRef.current; if (!v) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            v.tx = start.tx0 + (mx - start.mx);
            v.ty = start.ty0 + (my - start.my);
        };
        const onPointerUp = () => {
            dragging = false;
            (canvas.style as any).cursor = "grab";
            if (pointerId != null) { try { canvas.releasePointerCapture(pointerId); } catch { } pointerId = null; }
        };
        const onDblClick = () => {
            // Manual reset: refit to bbox of all waypoints + known segments
            const v = viewRef.current; if (!v) return;
            const cvs = canvasRef.current!; const w = cvs.clientWidth, h = cvs.clientHeight;
            // include known segments in bbox so reset shows “everything”
            trailsRef.current.forEach(t => {
                [...t.recent, ...t.older].forEach(s => {
                    v.minX = Math.min(v.minX, s.from.x, s.to.x);
                    v.maxX = Math.max(v.maxX, s.from.x, s.to.x);
                    v.minY = Math.min(v.minY, s.from.y, s.to.y);
                    v.maxY = Math.max(v.maxY, s.from.y, s.to.y);
                });
            });
            v._needsFit = true;        // request a fit on next frame
            userAdjustedRef.current = true; // keep auto-fit disabled after manual reset // NEW
        };

        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("dblclick", onDblClick);
        (canvas.style as any).cursor = "grab";
        return () => {
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("dblclick", onDblClick);
        };
    }, []);

    // --- Render loop ---
    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        let raf = 0;

        const draw = () => {
            const dpr = devicePixelRatio || 1;
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            ctx.resetTransform();
            ctx.scale(dpr, dpr);

            const w = canvas.clientWidth, h = canvas.clientHeight;
            ensureFit(w, h); // does the one-time initial fit; won’t auto-refit again after user interaction

            // bg
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            for (let i = 0; i < 60; i++) ctx.fillRect((i * 47) % w, (i * 83) % h, 1, 1);

            // waypoints
            const wps = waypointsRef.current ?? [];
            for (const wp of wps) {
                const p = worldToScreen({ x: Number(wp.x), y: Number(wp.y) }, w, h);
                ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.stroke();
                ctx.beginPath(); ctx.arc(p.x, p.y, 2.9, 0, Math.PI * 2);
                ctx.fillStyle = wp.is_market ? "#8afc84ff" : "rgba(255, 249, 249, 1)"; ctx.fill();
            }

            const now = Date.now();
            // trails
            trailsRef.current.forEach((trail) => {
                // older
                ctx.lineWidth = 1;
                ctx.strokeStyle = `rgba(159,231,255,${OLDER_ALPHA})`;
                for (const seg of trail.older) {
                    const a = worldToScreen(seg.from, w, h);
                    const b = worldToScreen(seg.to, w, h);
                    drawLine(ctx, a, b);
                }
                // recent graded
                for (let i = 0; i < trail.recent.length; i++) {
                    const seg = trail.recent[i];
                    const alpha = RECENT_ALPHAS[i] ?? RECENT_ALPHAS[RECENT_ALPHAS.length - 1];
                    ctx.strokeStyle = `rgba(159,231,255,${alpha})`;
                    ctx.lineWidth = 1.25;
                    const a = worldToScreen(seg.from, w, h);
                    const b = worldToScreen(seg.to, w, h);
                    drawLine(ctx, a, b);
                }
                // animate active
                const active = trail.recent.find(s => now >= s.depMs && now <= s.arrMs);
                trail.active = active;
                if (active) {
                    const t = (now - active.depMs) / (active.arrMs - active.depMs);
                    const pos = lerp(active.from, active.to, easeInOutCubic(clamp01(t)));
                    const p = worldToScreen(pos, w, h);
                    drawShip(ctx, p, 3, 1.0);
                }
            });

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, []);

    // --- HUD updater ---
    useEffect(() => {
        const id = setInterval(() => {
            const now = Date.now();
            const rows: HudRow[] = [];
            trailsRef.current.forEach((trail, ship) => {
                const a = trail.recent.find(s => now >= s.depMs && now <= s.arrMs);
                if (!a) return;
                const progress = clamp01((now - a.depMs) / (a.arrMs - a.depMs));
                const etaSec = Math.max(0, Math.floor((a.arrMs - now) / 1000));
                rows.push({
                    ship,
                    origin: findSymbolForPoint(a.from, waypointsRef.current) ?? "?",
                    destination: findSymbolForPoint(a.to, waypointsRef.current) ?? "?",
                    progress, etaSec
                });
            });
            rows.sort((x, y) => x.ship.localeCompare(y.ship));
            setHudRows(rows);
        }, 250);
        return () => clearInterval(id);
    }, []);

    // HUD toggle by keyboard
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "h") setHudVisible(v => !v); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block", background: "black", cursor: "grab" }}
            />
            {/* Controls */}
            <div style={{
                position: "absolute", top: 10, left: 12, display: "flex", gap: 8, alignItems: "center",
                background: "rgba(0,0,0,0.5)", border: "1px solid #222", borderRadius: 8, padding: "6px 10px", fontSize: 12
            }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={hudVisible} onChange={(e) => setHudVisible(e.target.checked)} />
                    <span style={{ color: "#ddd" }}>Debug HUD (H)</span>
                </label>
                <span style={{ color: "#aaa", marginLeft: 8 }}>Wheel: zoom • Drag: pan • Double-click: reset</span>
            </div>

            {/* HUD */}
            {hudVisible && (
                <div style={{
                    position: "absolute", top: 48, left: 12, minWidth: 320, maxHeight: "40%", overflow: "auto",
                    background: "rgba(10,10,10,0.85)", border: "1px solid #2a2a2a", borderRadius: 8, padding: 10,
                    color: "#ddd", boxShadow: "0 4px 14px rgba(0,0,0,0.6)", fontSize: 12
                }}>
                    <div style={{ marginBottom: 6, opacity: 0.9 }}>
                        <strong>Active Journeys</strong>
                        <span style={{ opacity: 0.7 }}> — {hudRows.length || 0}</span>
                    </div>
                    {hudRows.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No active journeys right now.</div>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr>
                                    <th style={thStyle}>Ship</th>
                                    <th style={thStyle}>From → To</th>
                                    <th style={thStyle}>Prog</th>
                                    <th style={thStyle}>ETA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hudRows.map((r) => (
                                    <tr key={`${r.ship}-${r.origin}-${r.destination}`}>
                                        <td style={tdStyle}>{r.ship}</td>
                                        <td style={tdStyle} title={`${r.origin} → ${r.destination}`}>{r.origin} → {r.destination}</td>
                                        <td style={tdStyle}>{Math.round(r.progress * 100)}%</td>
                                        <td style={tdStyle}>{fmtETA(r.etaSec)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

/* ---------- helpers ---------- */
function drawLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function drawShip(ctx: CanvasRenderingContext2D, p: Vec, r = 3, alpha = 1) {
    const prev = ctx.fillStyle; ctx.fillStyle = `rgba(159,231,255,${alpha})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = prev as string;
}
function lerp(a: Vec, b: Vec, t: number): Vec { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }
function clamp01(x: number) { return clamp(x, 0, 1); }
function easeInOutCubic(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function findSymbolForPoint(p: Vec, wps: Waypoint[] | null): string | null {
    if (!wps || !wps.length) return null;
    const hit = wps.find(w => Number(w.x) === p.x && Number(w.y) === p.y);
    if (hit) return hit.symbol;
    let best: { sym: string; d2: number } | null = null;
    for (const w of wps) {
        const dx = Number(w.x) - p.x, dy = Number(w.y) - p.y;
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.d2) best = { sym: w.symbol, d2 };
    }
    return best?.sym ?? null;
}
const thStyle: React.CSSProperties = { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #2a2a2a", position: "sticky", top: 0, background: "rgba(12,12,12,0.95)", zIndex: 1 };
const tdStyle: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #1a1a1a", whiteSpace: "nowrap" };
function fmtETA(sec: number): string { const s = Math.max(0, (sec | 0)); const m = Math.floor(s / 60), rs = s % 60; return m ? `${m}m ${rs}s` : `${rs}s`; }
