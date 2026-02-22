export type EntryType = 'income' | 'expense'

export type Entry = {
  id: string
  family_id: string
  entry_type: EntryType
  amount: number
  entry_category_id: string | null
  payment_method_id: string | null
  memo: string | null
  occurred_at: string
  occurred_on: string
  recurring_rule_id: string | null
  created_by_user_id?: string | null
  created_by_user_name?: string | null
  created_by_avatar_url?: string | null
  created_at: string
  updated_at: string
}

export type EntryCategory = {
  id: string
  family_id: string
  name: string
  type: string
  icon_key?: string | null
  color?: string | null
  is_archived?: number | null
  merged_to_id?: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type PaymentMethod = {
  id: string
  family_id: string
  name: string
  type: string
  icon_key?: string | null
  color?: string | null
  card_closing_day?: number | null
  card_payment_day?: number | null
  linked_bank_payment_method_id?: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type RecurringRule = {
  id: string
  family_id: string
  entry_type: EntryType
  amount: number
  entry_category_id: string | null
  payment_method_id: string | null
  memo: string | null
  frequency: string
  day_of_month: number | null
  holiday_adjustment: 'none' | 'previous' | 'next' | null
  start_at: string
  end_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MonthlyBalance = {
  id: string
  family_id: string
  ym: string
  balance: number
  is_closed: number
  updated_at: string
}

export type OutboxItem = {
  id: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  endpoint: string
  payload: Record<string, unknown> | null
  created_at: string
  queue_order: number
  entity_type: 'entries' | 'entry_categories' | 'payment_methods' | 'recurring_rules' | 'monthly_balance'
  entity_id: string
  operation: 'upsert' | 'delete'
  base_updated_at: string | null
  attempt_count: number
  next_retry_at: string | null
  last_error_code: string | null
  last_error_detail: string | null
}

export type OutboxDeadLetter = {
  id: string
  failed_at: string
  status: number | null
  error_code: string | null
  error_detail: string | null
  server_snapshot: Record<string, unknown> | null
  request_payload: Record<string, unknown> | null
  endpoint: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  entity_type: 'entries' | 'entry_categories' | 'payment_methods' | 'recurring_rules' | 'monthly_balance'
  entity_id: string
}
