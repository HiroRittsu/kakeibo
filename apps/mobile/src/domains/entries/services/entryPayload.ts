import type { Entry } from '../../../types'

export const buildEntryCreatePayload = (entry: Entry) => ({
  id: entry.id,
  entry_type: entry.entry_type,
  amount: entry.amount,
  entry_category_id: entry.entry_category_id,
  payment_method_id: entry.payment_method_id,
  memo: entry.memo,
  occurred_at: entry.occurred_at,
  occurred_on: entry.occurred_on,
  recurring_rule_id: entry.recurring_rule_id,
  base_updated_at: null,
})

export const buildEntryUpdatePayload = (entry: Entry, baseUpdatedAt: string | null) => ({
  entry_type: entry.entry_type,
  amount: entry.amount,
  entry_category_id: entry.entry_category_id,
  payment_method_id: entry.payment_method_id,
  memo: entry.memo,
  occurred_at: entry.occurred_at,
  occurred_on: entry.occurred_on,
  recurring_rule_id: entry.recurring_rule_id,
  base_updated_at: baseUpdatedAt,
})
