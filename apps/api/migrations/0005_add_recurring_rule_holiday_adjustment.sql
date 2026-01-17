ALTER TABLE recurring_rules
  ADD COLUMN holiday_adjustment TEXT NOT NULL DEFAULT 'none';

UPDATE recurring_rules
  SET holiday_adjustment = 'none'
  WHERE holiday_adjustment IS NULL;
