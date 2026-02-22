ALTER TABLE payment_methods ADD COLUMN card_closing_day INTEGER;
ALTER TABLE payment_methods ADD COLUMN card_payment_day INTEGER;
ALTER TABLE payment_methods ADD COLUMN linked_bank_payment_method_id TEXT;
