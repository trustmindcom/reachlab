-- Migration 012: Chat-based revision messages
CREATE TABLE IF NOT EXISTS generation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  draft_snapshot TEXT,
  quality_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generation_messages_gen ON generation_messages(generation_id);
