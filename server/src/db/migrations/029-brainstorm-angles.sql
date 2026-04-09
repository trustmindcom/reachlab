-- Support thought-leadership posts that don't anchor to a news story.
-- The brainstorm flow stores the user's topic and chosen angle directly
-- on the generation, bypassing the research → story → draft pipeline.
ALTER TABLE generations ADD COLUMN brainstorm_topic TEXT;
ALTER TABLE generations ADD COLUMN brainstorm_angle TEXT;
