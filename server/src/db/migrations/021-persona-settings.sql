-- Create persona_settings table
CREATE TABLE persona_settings (
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (persona_id, key)
);

-- Copy persona-scoped keys from settings into persona_settings for persona 1 only.
-- Persona 1 is the only persona that has historical data. New personas created later
-- will get their settings forked via createPersona.

-- writing_prompt
INSERT INTO persona_settings (persona_id, key, value)
SELECT 1, 'writing_prompt', s.value
FROM settings s
WHERE s.key = 'writing_prompt' AND s.value IS NOT NULL;

-- auto_interpret_schedule
INSERT INTO persona_settings (persona_id, key, value)
SELECT 1, 'auto_interpret_schedule', s.value
FROM settings s
WHERE s.key = 'auto_interpret_schedule' AND s.value IS NOT NULL;

-- auto_interpret_post_threshold
INSERT INTO persona_settings (persona_id, key, value)
SELECT 1, 'auto_interpret_post_threshold', s.value
FROM settings s
WHERE s.key = 'auto_interpret_post_threshold' AND s.value IS NOT NULL;

-- last_discovery_labels — copy for persona 1 only (they have analysis history).
-- New personas init as [] since they have no discovery history.
INSERT INTO persona_settings (persona_id, key, value)
SELECT 1, 'last_discovery_labels', COALESCE(s.value, '[]')
FROM settings s
WHERE s.key = 'last_discovery_labels'
UNION ALL
SELECT 1, 'last_discovery_labels', '[]'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'last_discovery_labels');

-- NOTE: Old keys are intentionally left in settings as a safety net.
-- They will be removed by migration 022 (Task 11) after all code is updated.
