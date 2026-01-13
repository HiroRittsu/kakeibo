PRAGMA foreign_keys = ON;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_category_id TEXT,
  payment_method_id TEXT,
  memo TEXT,
  occurred_at TEXT NOT NULL,
  recurring_rule_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_entries_family_updated
  ON entries (family_id, updated_at);

CREATE INDEX idx_entries_family_occurred
  ON entries (family_id, occurred_at);

CREATE TABLE monthly_balance (
  family_id TEXT NOT NULL,
  ym TEXT NOT NULL,
  balance INTEGER NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (family_id, ym)
);

CREATE TABLE recurring_rules (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_category_id TEXT,
  payment_method_id TEXT,
  memo TEXT,
  frequency TEXT NOT NULL,
  day_of_month INTEGER,
  start_at TEXT NOT NULL,
  end_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE entry_categories (
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

CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE members (
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, family_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_family_created
  ON audit_logs (family_id, created_at);
