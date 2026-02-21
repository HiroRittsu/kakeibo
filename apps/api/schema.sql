PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_category_id TEXT,
  payment_method_id TEXT,
  memo TEXT,
  occurred_at TEXT NOT NULL,
  occurred_on TEXT,
  recurring_rule_id TEXT,
  created_by_user_id TEXT,
  created_by_user_name TEXT,
  created_by_avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_family_updated
  ON entries (family_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_entries_family_occurred
  ON entries (family_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_entries_family_occurred_on
  ON entries (family_id, occurred_on);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_recurring_unique
  ON entries (family_id, recurring_rule_id, occurred_on);

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

CREATE TABLE IF NOT EXISTS monthly_balance (
  family_id TEXT NOT NULL,
  ym TEXT NOT NULL,
  balance INTEGER NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (family_id, ym)
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_category_id TEXT,
  payment_method_id TEXT,
  memo TEXT,
  frequency TEXT NOT NULL,
  day_of_month INTEGER,
  holiday_adjustment TEXT NOT NULL DEFAULT 'none',
  start_at TEXT NOT NULL,
  end_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_categories (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  icon_key TEXT,
  color TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  merged_to_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  icon_key TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, family_id)
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allowed_users (
  email TEXT PRIMARY KEY,
  family_id TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT,
  is_pending INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  invite_code TEXT,
  next_path TEXT,
  origin TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_allowed_users_family ON allowed_users (family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_invites_family ON invites (family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_logs_family_id ON change_logs (family_id, id);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  request_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mutation_receipts_family_created
  ON mutation_receipts (family_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mutation_receipts_expires
  ON mutation_receipts (expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_family_created
  ON audit_logs (family_id, created_at);
