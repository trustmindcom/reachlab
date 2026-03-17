PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  content_preview TEXT,
  content_type TEXT NOT NULL,
  published_at DATETIME,
  url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  impressions INTEGER,
  members_reached INTEGER,
  reactions INTEGER,
  comments INTEGER,
  reposts INTEGER,
  saves INTEGER,
  sends INTEGER,
  video_views INTEGER,
  watch_time_seconds INTEGER,
  avg_watch_time_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_post_metrics_post_id ON post_metrics(post_id);
CREATE INDEX IF NOT EXISTS idx_post_metrics_scraped_at ON post_metrics(scraped_at);

CREATE TABLE IF NOT EXISTS follower_snapshots (
  date DATE PRIMARY KEY,
  total_followers INTEGER
);

CREATE TABLE IF NOT EXISTS profile_snapshots (
  date DATE PRIMARY KEY,
  profile_views INTEGER,
  search_appearances INTEGER,
  all_appearances INTEGER
);

CREATE TABLE IF NOT EXISTS scrape_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  posts_status TEXT DEFAULT 'pending',
  followers_status TEXT DEFAULT 'pending',
  profile_status TEXT DEFAULT 'pending',
  posts_count INTEGER DEFAULT 0,
  error_details TEXT
);
