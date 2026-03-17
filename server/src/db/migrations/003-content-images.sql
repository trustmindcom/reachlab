-- Add content and image columns to posts
ALTER TABLE posts ADD COLUMN full_text TEXT;
ALTER TABLE posts ADD COLUMN hook_text TEXT;
ALTER TABLE posts ADD COLUMN image_urls TEXT;
ALTER TABLE posts ADD COLUMN image_local_paths TEXT;

-- Image classification tags
CREATE TABLE IF NOT EXISTS ai_image_tags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  image_index INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,
  people TEXT NOT NULL,
  setting TEXT NOT NULL,
  text_density TEXT NOT NULL,
  energy TEXT NOT NULL,
  tagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  PRIMARY KEY (post_id, image_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_image_tags_post_id ON ai_image_tags(post_id);
