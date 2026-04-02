ALTER TABLE generation_messages ADD COLUMN tool_blocks_json TEXT;
ALTER TABLE generation_rules ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
