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

type View = {
    scale: number; tx: number; ty: number; pad: number;
    minX: number; maxX: number; minY: number; maxY: number;
    _needsFit?: boolean;
    baseScale?: number; // recorded at first fit-all
};

// If you run API elsewhere, set VITE_API_BASE=http://127.0.0.1:8001
const API_BASE =
    (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8001";

// Ship roles → colors (edit to taste)
const SHIP_ROLES: Record<string, string> = {
    // "GLANK-1": "HAULER",
};
const ROLE_COLORS: Record<string, string> = {
    EXPLORER: "#60a5fa",
    MINER: "#f59e0b",
    HAULER: "#fcfcfcff",
    FIGHTER: "#f43f5e",
    SCOUT: "#a78bfa",
    GEN: "#ffffffff",
};

const RECENT_LIMIT = 5;
const RECENT_ALPHAS = [1.0, 0.8, 0.6, 0.4, 0.25];
const OLDER_ALPHA = 0.12;

// tiny particle for burn trail
type Particle = { p: Vec; v: Vec; life: number; max: number };
type ShipFx = { particles: Particle[] };
const fxByShip = new Map<string, ShipFx>();

export default function FleetCanvas() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const trailsRef = useRef<Trails>(new Map());
    const waypointsRef = useRef<Waypoint[] | null>(null);
    const viewRef = useRef<View | null>(null);

    const [showLabels, setShowLabels] = useState(true);   // default ON
    const [mouse, setMouse] = useState<Vec | null>(null);
    const [hoverShip, setHoverShip] = useState<string | null>(null);
    const [wpCount, setWpCount] = useState<number>(0);

    // highlight state: symbol -> color
    const [highlightOpen, setHighlightOpen] = useState(false);
    const [highlightFilter, setHighlightFilter] = useState("");
    const [highlights, setHighlights] = useState<Map<string, string>>(new Map()); // default color when added: red

    // Load waypoints + bbox
    useEffect(() => {
        fetch(`${API_BASE}/waypoints`)
            .then(r => r.json())
            .then((wps: Waypoint[]) => {
                waypointsRef.current = wps;
                setWpCount(wps.length);
                const xs = wps.map(w => Number(w.x));
                const ys = wps.map(w => Number(w.y));
                const minX = wps.length ? Math.min(...xs) : -100;
                const maxX = wps.length ? Math.max(...xs) : 100;
                const minY = wps.length ? Math.min(...ys) : -100;
                const maxY = wps.length ? Math.max(...ys) : 100;
                viewRef.current = { scale: 1, tx: 0, ty: 0, pad: 40, minX, maxX, minY, maxY, _needsFit: true };
            })
            .catch(() => {
                waypointsRef.current = [];
                setWpCount(0);
                viewRef.current = { scale: 1, tx: 0, ty: 0, pad: 40, minX: -100, maxX: 100, minY: -100, maxY: 100, _needsFit: true };
            });
    }, []);

    // WS: store segments, widen bbox
    useEffect(() => {
        const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/ws/journeys`);
        ws.onmessage = (ev) => {
            let evt: JourneyEvt; try { evt = JSON.parse(ev.data); } catch { return; }
            if (evt.type !== "journey") return;
            if (evt.origin.x == null || evt.origin.y == null || evt.destination.x == null || evt.destination.y == null) return;

            const from = { x: Number(evt.origin.x), y: Number(evt.origin.y) };
            const to = { x: Number(evt.destination.x), y: Number(evt.destination.y) };
            const seg: Segment = { jid: evt.journey_id, from, to, depMs: evt.departure_ts * 1000, arrMs: evt.arrival_ts * 1000 };
            const ship = evt.ship_symbol;

            let trail = trailsRef.current.get(ship);
            if (!trail) { trail = { recent: [], older: [] }; trailsRef.current.set(ship, trail); }

            const iR = trail.recent.findIndex(s => s.jid === seg.jid);
            if (iR >= 0) trail.recent.splice(iR, 1);
            const iO = trail.older.findIndex(s => s.jid === seg.jid);
            if (iO >= 0) trail.older.splice(iO, 1);

            trail.recent.unshift(seg);
            while (trail.recent.length > RECENT_LIMIT) trail.older.unshift(trail.recent.pop()!);

            const v = viewRef.current;
            if (v) {
                v.minX = Math.min(v.minX, seg.from.x, seg.to.x);
                v.maxX = Math.max(v.maxX, seg.from.x, seg.to.x);
                v.minY = Math.min(v.minY, seg.from.y, seg.to.y);
                v.maxY = Math.max(v.maxY, seg.from.y, seg.to.y);
                v._needsFit = v._needsFit ?? true;
            }
        };
        return () => ws.close();
    }, []);

    // Transform helpers
    const ensureFit = (w: number, h: number): View => {
        const v = viewRef.current!;
        if (!v) return { scale: 1, tx: 0, ty: 0, pad: 40, minX: -100, maxX: 100, minY: -100, maxY: 100 } as View;
        if (v._needsFit) {
            const pad = v.pad;
            const worldW = Math.max(1, v.maxX - v.minX);
            const worldH = Math.max(1, v.maxY - v.minY);
            const scale = Math.min((w - 2 * pad) / worldW, (h - 2 * pad) / worldH);
            const tx = pad - v.minX * scale;
            const ty = pad + v.maxY * (-scale);
            v.scale = scale; v.tx = tx; v.ty = ty; v._needsFit = false;
            if (!v.baseScale) v.baseScale = scale; // capture first fit
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

    // Size model that scales with zoom
    function computeSizes(v: View) {
        const base = v.baseScale ?? v.scale;
        const ratio = clamp(v.scale / (base || 1), 0.1, 64);
        const maxZoomFactor = 20; // ~16x closer ⇒ “pea sized”
        const t = clamp(Math.log2(ratio) / Math.log2(maxZoomFactor), 0, 1);
        const wpRadius = Math.max(0.8, lerpN(0.01, 6.0, t)); // pinprick → pea
        const shipSize = lerpN(3, 4, t);                   // triangle scale
        const particleSize = lerpN(0.2, 1.2, t);           // particle px
        const haloOuter = wpRadius * 6;                    // halo size scales with zoom too
        return { wpRadius, shipSize, particleSize, haloOuter };
    }

    // Input: wheel zoom, drag pan, dblclick refit; track mouse for hover
    useEffect(() => {
        const canvas = canvasRef.current!;
        let pointerId: number | null = null;
        let dragging = false;
        let start = { mx: 0, my: 0, tx0: 0, ty0: 0 };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const v = viewRef.current; if (!v) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const w = canvas.clientWidth, h = canvas.clientHeight;

            const before = screenToWorld({ x: mx, y: my }, w, h);
            const zoomIntensity = 1.15;
            const factor = e.deltaY > 0 ? 1 / zoomIntensity : zoomIntensity;
            v.scale = clamp(v.scale * factor, 0.05, 200);
            const after = worldToScreen(before, w, h);
            v.tx += mx - after.x;
            v.ty += my - after.y;
        };
        const onPointerDown = (e: PointerEvent) => {
            const v = viewRef.current; if (!v) return;
            dragging = true; pointerId = e.pointerId;
            try { canvas.setPointerCapture(pointerId); } catch { }
            const rect = canvas.getBoundingClientRect();
            start = { mx: e.clientX - rect.left, my: e.clientY - rect.top, tx0: v.tx, ty0: v.ty };
            (canvas.style as any).cursor = "grabbing";
        };
        const onPointerMove = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            if (!dragging) return;
            const v = viewRef.current; if (!v) return;
            v.tx = start.tx0 + (e.clientX - rect.left - start.mx);
            v.ty = start.ty0 + (e.clientY - rect.top - start.my);
        };
        const onPointerUp = () => {
            dragging = false; (canvas.style as any).cursor = "grab";
            if (pointerId != null) { try { canvas.releasePointerCapture(pointerId); } catch { } pointerId = null; }
        };
        const onDblClick = () => { const v = viewRef.current; if (!v) return; v._needsFit = true; };

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

    // Render loop
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
            const view = ensureFit(w, h);
            const { wpRadius, shipSize, particleSize, haloOuter } = computeSizes(view);

            // background
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            for (let i = 0; i < 60; i++) ctx.fillRect((i * 47) % w, (i * 83) % h, 1, 1);

            const wps = waypointsRef.current ?? [];
            ctx.font = "11px system-ui, sans-serif";

            // Halos first so points/labels sit atop
            if (highlights.size && wps.length) {
                for (const wp of wps) {
                    const color = highlights.get(wp.symbol);
                    if (!color) continue;
                    const p = worldToScreen({ x: Number(wp.x), y: Number(wp.y) }, w, h);
                    drawHalo(ctx, p, haloOuter, color);
                }
            }

            // Waypoints (+ labels if toggled)
            for (const wp of wps) {
                const p = worldToScreen({ x: Number(wp.x), y: Number(wp.y) }, w, h);
                // outer stroke
                ctx.beginPath(); ctx.arc(p.x, p.y, wpRadius + 0.6, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.stroke();
                // fill
                ctx.beginPath(); ctx.arc(p.x, p.y, wpRadius, 0, Math.PI * 2);
                ctx.fillStyle = wp.is_market ? "#8afc84ff" : "rgba(255,255,255,1)"; ctx.fill();

                if (showLabels) {
                    ctx.fillStyle = "rgba(220,220,220,0.9)";
                    ctx.fillText(wp.symbol, p.x + 6 + Math.max(0, wpRadius - 3), p.y - 6);
                }
            }

            const now = Date.now();

            type Nearest = { ship: string; px: number; py: number; d2: number };
            let best: Nearest | null = null;   // <-- typed and guarded usage
            const mousePx = mouse;

            // Trails & ships
            trailsRef.current.forEach((trail, ship) => {
                // older (dim)
                ctx.lineWidth = 1; ctx.strokeStyle = `rgba(159,231,255,${OLDER_ALPHA})`;
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

                // linear active
                const active = trail.recent.find(s => now >= s.depMs && now <= s.arrMs);
                trail.active = active;
                if (active) {
                    const t = (now - active.depMs) / (active.arrMs - active.depMs); // linear
                    const pos = lerpVec(active.from, active.to, clamp01(t));
                    const prev = lerpVec(active.from, active.to, clamp01(t - 0.002));
                    const p = worldToScreen(pos, w, h);
                    const q = worldToScreen(prev, w, h);

                    // direction angle
                    const ang = Math.atan2(p.y - q.y, p.x - q.x);

                    // ship color by role
                    const role = SHIP_ROLES[ship] || "GEN";
                    const color = ROLE_COLORS[role] || ROLE_COLORS.GEN;

                    // burn particles
                    const fx = (fxByShip.get(ship) || { particles: [] });
                    fxByShip.set(ship, fx);
                    spawnParticles(fx, q, p, 2, particleSize);
                    stepParticles(fx, 1 / 60);

                    // draw particles
                    for (const pt of fx.particles) {
                        const alpha = clamp01(pt.life / pt.max);
                        ctx.fillStyle = `rgba(255,255,255,${0.35 * alpha})`;
                        ctx.fillRect(pt.p.x, pt.p.y, particleSize, particleSize);
                    }

                    // draw triangle ship (size scales with zoom)
                    drawTriangleShip(ctx, p, ang, color, shipSize);

                    // hover detect (update best)
                    if (mousePx) {
                        const dx = mousePx.x - p.x, dy = mousePx.y - p.y;
                        const d2 = dx * dx + dy * dy;
                        if (!best || d2 < best.d2) best = { ship, px: p.x, py: p.y, d2 };
                    }
                }
            });

            // ship hover label (guard best)
            if (best && best.d2 < 16 * 16) {
                if (hoverShip !== best.ship) setHoverShip(best.ship);
                drawTooltip(ctx, best.px + 10, best.py - 6, [best.ship]);
            } else if (hoverShip) {
                setHoverShip(null);
            }

            // tiny debug banner (helps spot empty /waypoints)
            ctx.font = "11px system-ui, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.fillText(`waypoints: ${wpCount}`, 8, 16);

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [mouse, showLabels, wpCount, highlights, hoverShip]); // include hoverShip for clean state updates

    // UI handlers for highlight panel
    const toggleHighlight = (sym: string) => {
        setHighlights(prev => {
            const next = new Map(prev);
            if (next.has(sym)) next.delete(sym);
            else next.set(sym, "#ff4d4d"); // default color red
            return next;
        });
    };
    const setHighlightColor = (sym: string, color: string) => {
        setHighlights(prev => {
            const next = new Map(prev);
            if (next.has(sym)) next.set(sym, color);
            return next;
        });
    };

    // filtered waypoint symbols for the panel
    const filteredSymbols = (waypointsRef.current ?? [])
        .map(w => w.symbol)
        .filter(s => s.toLowerCase().includes(highlightFilter.toLowerCase()))
        .sort();

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block", background: "black", cursor: "grab" }}
            />

            {/* Controls */}
            <div style={{
                position: "absolute", top: 10, left: 12, display: "flex", gap: 12, alignItems: "center",
                background: "rgba(0,0,0,0.5)", border: "1px solid #222", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#ddd"
            }}>
                <label style={{ display: "inline-flex", gap: 6 }}>
                    <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                    Show waypoint labels
                </label>

                <button
                    onClick={() => setHighlightOpen(v => !v)}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #2a2a2a", background: "#151515", color: "#ddd", cursor: "pointer" }}
                    title="Highlight specific waypoints with colored halos"
                >
                    {highlightOpen ? "Close" : "Highlight waypoints"}
                </button>

                <span style={{ opacity: 0.7 }}>Wheel: zoom • Drag: pan • Double-click: fit</span>
            </div>

            {/* Highlight popover */}
            {highlightOpen && (
                <div style={{
                    position: "absolute", top: 46, left: 12, width: 360, maxHeight: "55%", overflow: "auto",
                    background: "rgba(12,12,12,0.95)", border: "1px solid #2a2a2a", borderRadius: 8, padding: 10,
                    color: "#ddd", boxShadow: "0 4px 14px rgba(0,0,0,0.6)", fontSize: 12, backdropFilter: "blur(2px)"
                }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input
                            placeholder="Filter symbols…"
                            value={highlightFilter}
                            onChange={(e) => setHighlightFilter(e.target.value)}
                            style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #2a2a2a", background: "#0c0c0c", color: "#eee" }}
                        />
                        <button
                            onClick={() => setHighlights(new Map())}
                            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #2a2a2a", background: "#151515", color: "#ddd", cursor: "pointer" }}
                            title="Clear all highlights"
                        >
                            Clear
                        </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", columnGap: 8, rowGap: 6 }}>
                        {filteredSymbols.length === 0 ? (
                            <div style={{ opacity: 0.6 }}>No matches</div>
                        ) : filteredSymbols.map(sym => {
                            const selected = highlights.has(sym);
                            const color = highlights.get(sym) || "#ff4d4d";
                            return (
                                <React.Fragment key={sym}>
                                    <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggleHighlight(sym)}
                                        style={{ alignSelf: "center" }}
                                    />
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>
                                        {sym}
                                    </div>
                                    <input
                                        type="color"
                                        value={color}
                                        disabled={!selected}
                                        onChange={(e) => setHighlightColor(sym, e.target.value)}
                                        title="Halo color"
                                        style={{ width: 32, height: 24, alignSelf: "center", cursor: selected ? "pointer" : "not-allowed", opacity: selected ? 1 : 0.4 }}
                                    />
                                </React.Fragment>
                            );
                        })}
                    </div>
                    {highlights.size > 0 && (
                        <div style={{ marginTop: 10, opacity: 0.8 }}>
                            Selected: {Array.from(highlights.keys()).join(", ")}
                        </div>
                    )}
                </div>
            )}

            {/* Hover HUD */}
            {hoverShip && (
                <div style={{ position: "absolute", bottom: 10, left: 12, color: "#ddd", fontSize: 12, opacity: 0.85 }}>
                    Hover: {hoverShip}
                </div>
            )}
        </div>
    );
}

/* ---------- helpers ---------- */
function drawLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function lerpVec(a: Vec, b: Vec, t: number): Vec { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function lerpN(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }
function clamp01(x: number) { return clamp(x, 0, 1); }

function drawTriangleShip(ctx: CanvasRenderingContext2D, p: Vec, angleRad: number, color: string, size = 10) {
    const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
    const tip = { x: p.x + cos * (size + 2), y: p.y + sin * (size + 2) };
    const left = { x: p.x + (-cos * size + -sin * size * 0.8), y: p.y + (-sin * size + cos * size * 0.8) };
    const right = { x: p.x + (-cos * size + sin * size * 0.8), y: p.y + (-sin * size + -cos * size * 0.8) };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawTooltip(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[]) {
    const pad = 6;
    ctx.font = "12px system-ui, sans-serif";
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + pad * 2;
    const h = lines.length * 16 + pad * 2;
    ctx.fillStyle = "rgba(20,20,20,0.95)"; ctx.fillRect(x, y - h, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.strokeRect(x, y - h, w, h);
    ctx.fillStyle = "#eee"; lines.forEach((s, i) => ctx.fillText(s, x + pad, y - h + pad + 12 + i * 16));
}

function drawHalo(ctx: CanvasRenderingContext2D, p: Vec, outerR: number, colorHex: string) {
    const innerR = Math.max(outerR * 0.35, 6);
    const grad = ctx.createRadialGradient(p.x, p.y, innerR, p.x, p.y, outerR);
    // convert hex to rgb
    const { r, g, b } = hexToRgb(colorHex) ?? { r: 255, g: 77, b: 77 };
    grad.addColorStop(0, `rgba(${r},${g},${b},0.28)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, outerR, 0, Math.PI * 2);
    ctx.fill();

    // subtle ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(outerR * 0.55, innerR + 2), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
    ctx.lineWidth = 1;
    ctx.stroke();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

// particles
function spawnParticles(fx: ShipFx, prev: Vec, cur: Vec, count = 2, pxSize = 1.5) {
    for (let i = 0; i < count; i++) {
        const dir = Math.atan2(cur.y - prev.y, cur.x - prev.x);
        const speed = 0.6 + Math.random() * 0.6;
        const spread = (Math.random() - 0.5) * 0.6;
        const v = { x: -Math.cos(dir + spread) * speed, y: -Math.sin(dir + spread) * speed };
        const life = 0.35 + Math.random() * 0.35; // seconds
        fx.particles.push({ p: { x: cur.x, y: cur.y }, v, life, max: life });
    }
    if (fx.particles.length > 500) fx.particles.splice(0, fx.particles.length - 500);
}
function stepParticles(fx: ShipFx, dt: number) {
    for (let i = fx.particles.length - 1; i >= 0; i--) {
        const pt = fx.particles[i];
        pt.p.x += pt.v.x;
        pt.p.y += pt.v.y;
        pt.life -= dt;
        if (pt.life <= 0) fx.particles.splice(i, 1);
    }
}
