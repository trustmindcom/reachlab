-- Store the user's selected draft length so the combiner can enforce it
ALTER TABLE generations ADD COLUMN draft_length TEXT; -- 'short' | 'medium' | 'long'
