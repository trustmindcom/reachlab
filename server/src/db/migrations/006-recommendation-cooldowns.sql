-- Recommendation lifecycle: cooldown tracking for resolved recommendations
ALTER TABLE recommendations ADD COLUMN resolved_at DATETIME;
ALTER TABLE recommendations ADD COLUMN resolved_type TEXT; -- 'accepted' or 'dismissed'
ALTER TABLE recommendations ADD COLUMN stable_key TEXT; -- for cross-run deduplication

CREATE INDEX IF NOT EXISTS idx_recommendations_stable_key ON recommendations(stable_key);
CREATE INDEX IF NOT EXISTS idx_recommendations_resolved ON recommendations(resolved_type, resolved_at);
