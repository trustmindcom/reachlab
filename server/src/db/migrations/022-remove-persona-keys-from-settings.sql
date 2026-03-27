-- Remove persona-scoped keys from global settings.
-- All code now reads from persona_settings instead.
DELETE FROM settings WHERE key IN (
  'writing_prompt',
  'auto_interpret_schedule',
  'auto_interpret_post_threshold',
  'last_discovery_labels'
);
