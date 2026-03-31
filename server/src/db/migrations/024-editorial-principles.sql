CREATE TABLE editorial_principles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  principle_text TEXT NOT NULL,
  source_post_type TEXT,
  source_context TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  last_confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editorial_principles_persona ON editorial_principles(persona_id);
