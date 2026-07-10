ALTER TABLE generations ADD COLUMN author_intent TEXT
  CHECK (author_intent IS NULL OR length(trim(author_intent)) > 0);

ALTER TABLE generation_research ADD COLUMN search_scope TEXT
  CHECK (search_scope IS NULL OR search_scope IN ('recent', 'all_time', 'anchor'));
ALTER TABLE generation_research ADD COLUMN recent_cutoff TEXT;

ALTER TABLE ai_runs ADD COLUMN generation_id INTEGER
  REFERENCES generations(id) ON DELETE SET NULL;
CREATE INDEX idx_ai_runs_generation ON ai_runs(generation_id, id);
