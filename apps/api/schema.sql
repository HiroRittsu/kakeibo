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
