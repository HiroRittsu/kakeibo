ALTER TABLE entries ADD COLUMN occurred_on TEXT;

UPDATE entries
SET occurred_on = date(occurred_at, '+9 hours')
WHERE occurred_on IS NULL AND occurred_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entries_family_occurred_on
  ON entries (family_id, occurred_on);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_recurring_unique
  ON entries (family_id, recurring_rule_id, occurred_on);
