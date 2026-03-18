-- Add post_category column to ai_tags for LLM-based classification
ALTER TABLE ai_tags ADD COLUMN post_category TEXT;
