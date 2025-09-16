-- Creates a tiny positions table with an automatic updated_at timestamp.
-- Also seeds three ships with starting positions.

PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS fleet_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_symbol TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  t INTEGER NOT NULL,            -- unix seconds
  updated_at INTEGER NOT NULL    -- unix seconds, for change detection
);

-- Latest position per ship convenience view (not strictly required)
CREATE VIEW IF NOT EXISTS v_latest_positions AS
SELECT fp.*
FROM fleet_positions fp
JOIN (
  SELECT ship_symbol, MAX(t) AS mt
  FROM fleet_positions
  GROUP BY ship_symbol
) last ON last.ship_symbol = fp.ship_symbol AND last.mt = fp.t;

-- Seed only if table is empty
INSERT INTO fleet_positions (ship_symbol, x, y, t, updated_at)
SELECT 'TROOTS-1', 50, 50, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM fleet_positions);

INSERT INTO fleet_positions (ship_symbol, x, y, t, updated_at)
SELECT 'TROOTS-2', 120, 80, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM fleet_positions WHERE ship_symbol='TROOTS-2');

INSERT INTO fleet_positions (ship_symbol, x, y, t, updated_at)
SELECT 'TROOTS-3', 200, 160, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM fleet_positions WHERE ship_symbol='TROOTS-3');
