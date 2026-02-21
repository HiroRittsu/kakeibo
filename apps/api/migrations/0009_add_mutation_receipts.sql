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
