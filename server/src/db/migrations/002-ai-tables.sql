-- AI taxonomy for post topic classification
CREATE TABLE IF NOT EXISTS ai_taxonomy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  version INTEGER DEFAULT 1
);

-- Many-to-many: posts <-> taxonomy topics
CREATE TABLE IF NOT EXISTS ai_post_topics (
  post_id TEXT NOT NULL REFERENCES posts(id),
  taxonomy_id INTEGER NOT NULL REFERENCES ai_taxonomy(id),
  PRIMARY KEY (post_id, taxonomy_id)
);

-- AI-generated tags per post (one row per post)
CREATE TABLE IF NOT EXISTS ai_tags (
  post_id TEXT PRIMARY KEY REFERENCES posts(id),
  hook_type TEXT,
  tone TEXT,
  format_style TEXT,
  tagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT
);

-- Tracks each AI analysis run
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  post_count INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cost_cents REAL,
  error TEXT
);

-- Stable insights discovered across runs
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  category TEXT,
  stable_key TEXT,
  claim TEXT,
  evidence TEXT,
  confidence REAL,
  direction TEXT,
  first_seen_run_id INTEGER,
  consecutive_appearances INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tracks how insights evolve across runs
CREATE TABLE IF NOT EXISTS insight_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER NOT NULL REFERENCES insights(id),
  predecessor_id INTEGER NOT NULL REFERENCES insights(id),
  relationship TEXT
);

-- Actionable recommendations from AI runs
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  type TEXT,
  priority INTEGER,
  confidence REAL,
  headline TEXT,
  detail TEXT,
  action TEXT,
  evidence_json TEXT,
  feedback TEXT,
  feedback_at DATETIME,
  acted_on INTEGER NOT NULL DEFAULT 0,
  acted_on_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- High-level AI overview per run
CREATE TABLE IF NOT EXISTS ai_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  summary_text TEXT,
  top_performer_post_id TEXT REFERENCES posts(id),
  top_performer_reason TEXT,
  quick_insights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Detailed LLM call logs for debugging / cost tracking
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  step TEXT,
  model TEXT,
  input_messages TEXT,
  output_text TEXT,
  tool_calls TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  thinking_tokens INTEGER,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_tags_post_id ON ai_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_insights_run_id ON insights(run_id);
CREATE INDEX IF NOT EXISTS idx_insights_stable_key ON insights(stable_key);
CREATE INDEX IF NOT EXISTS idx_recommendations_run_id ON recommendations(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_run_id ON ai_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_post_topics_post_id ON ai_post_topics(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_post_topics_taxonomy_id ON ai_post_topics(taxonomy_id);
