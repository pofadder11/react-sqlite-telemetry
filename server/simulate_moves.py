"""
A tiny simulator that appends new positions every ~300–600 ms to show animation.

Usage:
  python simulate_moves.py
Stop with Ctrl+C.
"""
import os, time, random, sqlite3
import os
from dotenv import load_dotenv

# ---- config ----
load_dotenv()

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "spacetraders.db"))

def ensure_db():
    with open(os.path.join(os.path.dirname(__file__), "schema.sql"), "r", encoding="utf-8") as f:
        schema = f.read()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()

def step(conn, symbol, jitter=8.0):
    c = conn.cursor()
    # read latest
    c.execute("""
      SELECT x, y, t FROM fleet_positions
      WHERE ship_symbol = ?
      ORDER BY t DESC LIMIT 1
    """, (symbol,))
    row = c.fetchone()
    if not row:
        x, y = random.uniform(20, 200), random.uniform(20, 200)
    else:
        x, y = row[0], row[1]
    # move randomly
    x += random.uniform(-jitter, jitter)
    y += random.uniform(-jitter, jitter)
    now = int(time.time())
    c.execute("""
      INSERT INTO fleet_positions (ship_symbol, x, y, t, updated_at)
      VALUES (?, ?, ?, ?, ?)
    """, (symbol, x, y, now, now))
    conn.commit()

def main():
    ensure_db()
    conn = sqlite3.connect(DB_PATH)
    try:
        ships = ["TROOTS-1", "TROOTS-2", "TROOTS-3"]
        while True:
            sym = random.choice(ships)
            step(conn, sym)
            time.sleep(random.uniform(0.3, 0.6))
    except KeyboardInterrupt:
        pass
    finally:
        conn.close()

if __name__ == "__main__":
    main()
