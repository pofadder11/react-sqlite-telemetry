import os, asyncio, json, time
from typing import Tuple
import aiosqlite
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import os
import sqlite3
from dotenv import load_dotenv

# ---- config ----
from dotenv import load_dotenv
load_dotenv()  # loads .env into os.environ

DB_PATH = os.getenv("DB_PATH") or os.path.join(os.path.dirname(__file__), "spacetraders.db")
CHECK_HZ = float(os.getenv("CHECK_HZ", "20"))
WS_PATH = "/ws/journeys"

# ---- app ----
app = FastAPI(title="SpaceTraders Journeys Relay")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

clients: set[WebSocket] = set()
db: aiosqlite.Connection | None = None

@app.on_event("startup")
async def startup():
    """Open DB, log actual path, start single notifier task."""
    global db
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA synchronous=NORMAL;")
    await db.commit()

    # Log the exact file in use (helps with path confusion)
    import os as _os
    async with db.execute("PRAGMA database_list;") as cur:
        rows = await cur.fetchall()
    print(f"[DB] Using DB_PATH={_os.path.abspath(DB_PATH)}")
    for r in rows:
        print(f"[DB] attached: name={r[1]} file={r[2]}")

    # start ONE notifier (remove the duplicate call)
    asyncio.create_task(journey_notifier())



@app.on_event("shutdown")
async def shutdown():
    if db:
        await db.close()

@app.get("/health")
async def health():
    return {"ok": True}

@app.websocket(WS_PATH)
async def ws_journeys(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        await send_inflight_snapshot(ws)
        while True:
            await asyncio.sleep(60)
    finally:
        clients.discard(ws)

@app.get("/debug/inflight")
async def debug_inflight():
    assert db is not None
    now = int(time.time())
    q = """
    WITH j AS (
      SELECT id, ship_symbol, origin_waypoint, destination_waypoint,
             CAST((julianday(departure_time)-2440587.5)*86400 AS INTEGER) dep_unix,
             CAST((julianday(arrival_time)  -2440587.5)*86400 AS INTEGER) arr_unix
      FROM journeys
    )
    SELECT j.id, j.ship_symbol,
           j.origin_waypoint, wo.x AS ox, wo.y AS oy,
           j.destination_waypoint, wd.x AS dx, wd.y AS dy,
           j.dep_unix, j.arr_unix
    FROM j
    LEFT JOIN waypoint_refs wo ON wo.symbol=j.origin_waypoint
    LEFT JOIN waypoint_refs wd ON wd.symbol=j.destination_waypoint
    WHERE j.dep_unix IS NOT NULL AND j.arr_unix IS NOT NULL
      AND j.dep_unix <= ? AND j.arr_unix >= ?
    ORDER BY j.dep_unix DESC LIMIT 20
    """
    async with db.execute(q, (now, now)) as cur:
        cols = [c[0] for c in cur.description]
        rows = await cur.fetchall()
    return [dict(zip(cols, r)) for r in rows]

from typing import Optional
from fastapi import Query

@app.get("/transactions")
async def transactions(
    since_hours: int = Query(24, ge=1, le=24*30),
    trade_symbol: Optional[str] = None,
    ship_symbol: Optional[str] = None,
):
    """
    Returns recent transactions (default: last 24h).
    Each row: {ts, waypoint_symbol, ship_symbol, trade_symbol, tx_type, units, price_per_unit, total_price}
    """
    assert db is not None

    # Now in unix seconds
    now_unix = int(time.time())
    since_unix = now_unix - since_hours * 3600

    # Build WHERE clauses
    where = ["CAST((julianday(timestamp) - 2440587.5) * 86400 AS INTEGER) >= ?"]
    params: list = [since_unix]
    if trade_symbol:
        where.append("trade_symbol = ?")
        params.append(trade_symbol)
    if ship_symbol:
        where.append("ship_symbol = ?")
        params.append(ship_symbol)

    q = f"""
    SELECT
      CAST((julianday(timestamp) - 2440587.5) * 86400 AS INTEGER) AS ts,
      waypoint_symbol, ship_symbol, trade_symbol, tx_type, units, price_per_unit, total_price
    FROM market_transactions
    WHERE {" AND ".join(where)}
    ORDER BY ts ASC
    """
    rows = []
    async with db.execute(q, params) as cur:
        cols = [c[0] for c in cur.description]
        async for r in cur:
            rows.append({k: v for k, v in zip(cols, r)})

    return {"now": now_unix, "since_unix": since_unix, "rows": rows}



# -------- change detection (option 4) --------

async def journey_notifier():
    assert db is not None
    last_data_version = -1
    wm_rowid = await get_current_watermark()
    print(f"[notifier] start watermark rowid={wm_rowid}")

    while True:
        await asyncio.sleep(1.0 / CHECK_HZ)
        try:
            async with db.execute("PRAGMA data_version") as cur:
                (dv,) = await cur.fetchone()
            if dv == last_data_version:
                continue
            last_data_version = dv

            rows = await fetch_new_journeys_since(wm_rowid)
            if not rows:
                continue

            print(f"[notifier] dv={dv} new_rows={len(rows)} (from rowid>{wm_rowid})")
            for r in rows:
                # sanity: log a short summary
                print(
                f"  + jid={r['id']} ship={r['ship_symbol']} "
                f"{r['origin_waypoint']}({r['ox']},{r['oy']})→{r['destination_waypoint']}({r['dx']},{r['dy']}) "
                f"dep={r['dep_unix']} arr={r['arr_unix']} rowid={r['rowid']}"
                )
                payload = json.dumps({
                    "type": "journey",
                    "journey_id": r["id"],
                    "ship_symbol": r["ship_symbol"],
                    "departure_ts": r["dep_unix"],
                    "arrival_ts": r["arr_unix"],
                    "origin": {"symbol": r["origin_waypoint"], "x": r["ox"], "y": r["oy"]},
                    "destination": {"symbol": r["destination_waypoint"], "x": r["dx"], "y": r["dy"]},
                    "flight_mode": r["flight_mode"],
                })
                await broadcast(payload)
                wm_rowid = max(wm_rowid, int(r["rowid"]))
        except Exception as e:
            print("[notifier] error:", repr(e))
            await asyncio.sleep(0.25)


async def get_current_watermark() -> int:
    """Return the highest rowid currently in journeys (0 if empty)."""
    assert db is not None
    q = "SELECT COALESCE(MAX(ROWID), 0) FROM journeys"
    async with db.execute(q) as cur:
        (rid,) = await cur.fetchone()
    return int(rid or 0)

async def fetch_new_journeys_since(watermark_rowid: int) -> list[dict]:
    """
    Return journeys with ROWID > watermark_rowid, joined to waypoint_refs.
    Use julianday() for dep/arr parsing; if unparsable, values become NULL (we guard on client).
    """
    assert db is not None
    q = """
    WITH j AS (
      SELECT
        ROWID AS rowid,
        id,
        ship_symbol,
        origin_waypoint,
        destination_waypoint,
        flight_mode,
        CAST((julianday(departure_time) - 2440587.5) * 86400 AS INTEGER) AS dep_unix,
        CAST((julianday(arrival_time)   - 2440587.5) * 86400 AS INTEGER) AS arr_unix
      FROM journeys
      WHERE ROWID > ?
    )
    SELECT
      j.rowid,
      j.id,
      j.ship_symbol,
      j.origin_waypoint,
      j.destination_waypoint,
      j.flight_mode,
      j.dep_unix,
      j.arr_unix,
      wo.x AS ox, wo.y AS oy,
      wd.x AS dx, wd.y AS dy
    FROM j
    LEFT JOIN waypoint_refs AS wo ON wo.symbol = j.origin_waypoint
    LEFT JOIN waypoint_refs AS wd ON wd.symbol = j.destination_waypoint
    ORDER BY j.rowid ASC
    """
    rows: list[dict] = []
    async with db.execute(q, (watermark_rowid,)) as cur:
        cols = [c[0] for c in cur.description]
        async for r in cur:
            rows.append({k: v for k, v in zip(cols, r)})
    return rows

async def send_inflight_snapshot(ws: WebSocket):
    """
    Send journeys currently in-flight (now between departure and arrival).
    If dep/arr parse to NULL, they’ll be ignored (OK).
    """
    assert db is not None
    now_unix = int(time.time())
    q = """
    WITH j AS (
      SELECT
        id, ship_symbol, origin_waypoint, destination_waypoint, flight_mode,
        CAST((julianday(departure_time) - 2440587.5) * 86400 AS INTEGER) AS dep_unix,
        CAST((julianday(arrival_time)   - 2440587.5) * 86400 AS INTEGER) AS arr_unix
      FROM journeys
    )
    SELECT
      j.id, j.ship_symbol, j.origin_waypoint, j.destination_waypoint, j.flight_mode,
      j.dep_unix, j.arr_unix,
      wo.x AS ox, wo.y AS oy,
      wd.x AS dx, wd.y AS dy
    FROM j
    LEFT JOIN waypoint_refs AS wo ON wo.symbol = j.origin_waypoint
    LEFT JOIN waypoint_refs AS wd ON wd.symbol = j.destination_waypoint
    WHERE j.dep_unix IS NOT NULL AND j.arr_unix IS NOT NULL
      AND j.dep_unix <= ? AND j.arr_unix >= ?
    ORDER BY j.dep_unix ASC
    """
    async with db.execute(q, (now_unix, now_unix)) as cur:
        cols = [c[0] for c in cur.description]
        rows = await cur.fetchall()
    for r in rows:
        d = {k: v for k, v in zip(cols, r)}
        payload = json.dumps({
            "type": "journey",
            "journey_id": d["id"],
            "ship_symbol": d["ship_symbol"],
            "departure_ts": d["dep_unix"],
            "arrival_ts": d["arr_unix"],
            "origin": {"symbol": d["origin_waypoint"], "x": d["ox"], "y": d["oy"]},
            "destination": {"symbol": d["destination_waypoint"], "x": d["dx"], "y": d["dy"]},
            "flight_mode": d["flight_mode"],
        })
        try:
            await ws.send_text(payload)
        except Exception:
            break


@app.get("/waypoints")
async def list_waypoints():
    """
    Returns: [{symbol, x, y, is_market: bool, traits: [str, ...]}, ...]
    is_market = waypoint has trait_symbol == 'MARKETPLACE'
    traits    = all trait_symbol values for the waypoint (plus 'MARKET' alias if is_market)
    """
    assert db is not None
    q = """
    SELECT
      wr.symbol,
      wr.x,
      wr.y,
      EXISTS(
        SELECT 1
        FROM waypoint_traits wt2
        WHERE wt2.waypoint_symbol = wr.symbol
          AND wt2.trait_symbol = 'MARKETPLACE'
      ) AS is_market,
      GROUP_CONCAT(wt.trait_symbol) AS trait_csv
    FROM waypoint_refs wr
    LEFT JOIN waypoint_traits wt
      ON wt.waypoint_symbol = wr.symbol
    GROUP BY wr.symbol, wr.x, wr.y
    ORDER BY wr.symbol
    """
    async with db.execute(q) as cur:
        rows = await cur.fetchall()

    out = []
    for sym, x, y, is_market, trait_csv in rows:
        # split CSV, dedupe, drop empties
        traits = [t for t in (trait_csv.split(",") if trait_csv else []) if t]
        # ensure MARKETPLACE is present when is_market is true
        if is_market and "MARKETPLACE" not in traits:
            traits.append("MARKETPLACE")
        # optional UX-friendly alias
        if is_market and "MARKET" not in traits:
            traits.append("MARKET")

        out.append({
            "symbol": sym,
            "x": x,
            "y": y,
            "is_market": bool(is_market),
            "traits": sorted(set(traits)),
        })
    return out

from typing import Optional

def _to_iso(dt: Optional[str]) -> Optional[str]:
    return dt

@app.get("/goods/snapshots")
async def goods_snapshots(
    trade_symbol: Optional[str] = None,
    waypoint: Optional[str] = None,
    limit: int = 500,
):
    """
    One most-recent row per (waypoint, trade_symbol).
    Sorted by highest sell_price per unit (descending).
    Optional filters: trade_symbol, waypoint_symbol.
    """
    assert db is not None

    # Subquery: find the latest observed_at per (waypoint_symbol, trade_symbol)
    base = """
    SELECT mgs.*
    FROM market_goods_snapshots mgs
    INNER JOIN (
        SELECT waypoint_symbol, trade_symbol, MAX(observed_at) AS max_obs
        FROM market_goods_snapshots
        GROUP BY waypoint_symbol, trade_symbol
    ) latest
      ON mgs.waypoint_symbol = latest.waypoint_symbol
     AND mgs.trade_symbol    = latest.trade_symbol
     AND mgs.observed_at     = latest.max_obs
    """

    where = []
    params: list = []
    if trade_symbol:
        where.append("mgs.trade_symbol = ?"); params.append(trade_symbol)
    if waypoint:
        where.append("mgs.waypoint_symbol = ?"); params.append(waypoint)
    if where:
        base += " WHERE " + " AND ".join(where)

    # Now order by best unit price (change column if you prefer purchase_price)
    q = f"""
    {base}
    ORDER BY mgs.sell_price DESC
    LIMIT ?
    """
    params.append(limit)

    async with db.execute(q, params) as cur:
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) async for r in cur]

    return rows


@app.get("/goods/ohlc")
async def goods_ohlc(trade_symbol: Optional[str] = None,
                     waypoint: Optional[str] = None,
                     start: Optional[str] = None,  # 'YYYY-MM-DD HH:MM:SS'
                     end: Optional[str] = None,
                     limit: int = 1000):
    """
    OHLC per hour from market_goods_ohlc_hourly; filterable by symbol/waypoint/time.
    """
    assert db is not None
    q = """
      SELECT waypoint_symbol, trade_symbol, bucket_start,
             open_buy, high_buy, low_buy, close_buy,
             open_sell, high_sell, low_sell, close_sell,
             sample_count
      FROM market_goods_ohlc_hourly
    """
    where = []
    params: list = []
    if trade_symbol:
        where.append("trade_symbol = ?"); params.append(trade_symbol)
    if waypoint:
        where.append("waypoint_symbol = ?"); params.append(waypoint)
    if start:
        where.append("bucket_start >= ?"); params.append(start)
    if end:
        where.append("bucket_start <= ?"); params.append(end)
    if where:
        q += " WHERE " + " AND ".join(where)
    q += " ORDER BY bucket_start ASC LIMIT ?"
    params.append(limit)
    async with db.execute(q, params) as cur:
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) async for r in cur]
    return rows

@app.get("/arb/snapshot")
async def arb_snapshot(trade_symbol: Optional[str] = None, limit: int = 500):
    """
    Current arbitrage candidates from trade_arbitrage (delta = sell - buy).
    Optional filter by trade_symbol.
    """
    assert db is not None
    q = """
      SELECT trade_symbol, buy_waypoint, buy_price, sell_waypoint, sell_price, delta,
             buy_observed_at, sell_observed_at, computed_at
      FROM trade_arbitrage
    """
    params: list = []
    if trade_symbol:
        q += " WHERE trade_symbol = ?"; params.append(trade_symbol)
    q += " ORDER BY delta DESC LIMIT ?"
    params.append(limit)
    async with db.execute(q, params) as cur:
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) async for r in cur]
    return rows

@app.get("/arb/history")
async def arb_history(trade_symbol: Optional[str] = None,
                      start: Optional[str] = None,
                      end: Optional[str] = None,
                      limit: int = 2000):
    """
    Time-binned arbitrage deltas from trade_arbitrage_history.
    """
    assert db is not None
    q = """
      SELECT trade_symbol, buy_waypoint, buy_price, sell_waypoint, sell_price, delta,
             computed_bucket, computed_at
      FROM trade_arbitrage_history
    """
    where = []
    params: list = []
    if trade_symbol:
        where.append("trade_symbol = ?"); params.append(trade_symbol)
    if start:
        where.append("computed_bucket >= ?"); params.append(start)
    if end:
        where.append("computed_bucket <= ?"); params.append(end)
    if where:
        q += " WHERE " + " AND ".join(where)
    q += " ORDER BY computed_bucket ASC, trade_symbol ASC LIMIT ?"
    params.append(limit)
    async with db.execute(q, params) as cur:
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) async for r in cur]
    return rows


async def broadcast(text: str):
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)


