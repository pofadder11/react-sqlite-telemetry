import os
import asyncio
import json
from typing import Dict, Tuple
import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketState

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "fleet.db"))
POLL_MS = int(os.getenv("POLL_MS", "200"))  # poll interval for sqlite, ms

app = FastAPI(title="SQLite Telemetry Relay")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock down in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

clients: set[WebSocket] = set()
db: aiosqlite.Connection | None = None

@app.on_event("startup")
async def startup() -> None:
    global db
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA synchronous=NORMAL;")
    await db.commit()

@app.on_event("shutdown")
async def shutdown() -> None:
    if db:
        await db.close()

@app.get("/health")
async def health():
    return {"ok": True}

@app.websocket("/ws/fleet")
async def fleet_ws(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        # per-connection change cursor
        last_seen_updated_at = 0  # unix seconds
        # Immediately push current latest positions to prime the client
        await send_latest_snapshot(ws)
        while True:
            await asyncio.sleep(POLL_MS / 1000)
            # Fetch changes since last_seen_updated_at
            changes = await fetch_changes_since(last_seen_updated_at)
            if changes:
                # Broadcast to this ws only; you can fan out to all if you want shared cursor
                for change in changes:
                    payload = json.dumps({
                        "ship_symbol": change[0],
                        "x": change[1],
                        "y": change[2],
                        "t": change[3]
                    })
                    try:
                        if ws.client_state == WebSocketState.CONNECTED:
                            await ws.send_text(payload)
                    except Exception:
                        # connection problem; drop out
                        raise
                # advance watermark
                last_seen_updated_at = max(last_seen_updated_at, max(c[4] for c in changes))
    except WebSocketDisconnect:
        clients.discard(ws)
    except Exception:
        clients.discard(ws)

async def send_latest_snapshot(ws: WebSocket):
    # Sends the latest known position per ship as initial state (small burst)
    assert db is not None
    q = """
    SELECT fp.ship_symbol, fp.x, fp.y, fp.t, fp.updated_at
    FROM fleet_positions fp
    JOIN (
      SELECT ship_symbol, MAX(t) as mt
      FROM fleet_positions
      GROUP BY ship_symbol
    ) last ON last.ship_symbol = fp.ship_symbol AND last.mt = fp.t
    """
    async with db.execute(q) as cur:
        rows = await cur.fetchall()
    for r in rows:
        payload = json.dumps({
            "ship_symbol": r[0],
            "x": r[1],
            "y": r[2],
            "t": r[3]
        })
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(payload)
        except Exception:
            break

async def fetch_changes_since(watermark: int) -> list[Tuple[str, float, float, int, int]]:
    assert db is not None
    # We treat each write as an event; the table can keep history (append-only).
    q = """
    SELECT ship_symbol, x, y, t, updated_at
    FROM fleet_positions
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    """
    async with db.execute(q, (watermark,)) as cur:
        return await cur.fetchall()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)
