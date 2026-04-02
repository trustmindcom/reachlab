CREATE TABLE coach_chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coach_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES coach_chat_sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_blocks_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
