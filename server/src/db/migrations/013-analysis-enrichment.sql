-- Add new_followers to post_metrics
ALTER TABLE post_metrics ADD COLUMN new_followers INTEGER;

-- Create post_comment_stats table
CREATE TABLE IF NOT EXISTS post_comment_stats (
  post_id TEXT PRIMARY KEY REFERENCES posts(id),
  author_replies INTEGER NOT NULL DEFAULT 0,
  has_threads INTEGER NOT NULL DEFAULT 0,
  scraped_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Clear stale analysis gaps (phantom gaps from before enrichment)
DELETE FROM ai_analysis_gaps;
