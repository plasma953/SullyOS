CREATE TABLE IF NOT EXISTS heartbeats (
  endpoint TEXT PRIMARY KEY,
  char_id TEXT,
  last_heartbeat INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_last ON heartbeats (last_heartbeat);