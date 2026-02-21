ALTER TABLE entries ADD COLUMN created_by_user_id TEXT;
ALTER TABLE entries ADD COLUMN created_by_user_name TEXT;
ALTER TABLE entries ADD COLUMN created_by_avatar_url TEXT;

CREATE TABLE IF NOT EXISTS entry_amount_change_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  previous_amount INTEGER NOT NULL,
  next_amount INTEGER NOT NULL,
  changed_by_user_id TEXT NOT NULL,
  changed_by_user_name TEXT,
  changed_by_avatar_url TEXT,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entry_amount_change_logs_family_entry_changed
  ON entry_amount_change_logs (family_id, entry_id, changed_at);
