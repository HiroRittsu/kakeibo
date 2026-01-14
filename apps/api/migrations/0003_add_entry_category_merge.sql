ALTER TABLE entry_categories ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entry_categories ADD COLUMN merged_to_id TEXT;
