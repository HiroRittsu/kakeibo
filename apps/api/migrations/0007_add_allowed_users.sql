CREATE TABLE IF NOT EXISTS allowed_users (
  email TEXT PRIMARY KEY,
  family_id TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_allowed_users_family ON allowed_users (family_id);
