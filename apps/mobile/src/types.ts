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
  recurring_rule_id: string | null
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
  sort_order: number
  created_at: string
  updated_at: string
}

export type PaymentMethod = {
  id: string
  family_id: string
  name: string
  type: string
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
  start_at: string
  end_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type OutboxItem = {
  id: string
  method: 'POST' | 'PATCH' | 'DELETE'
  endpoint: string
  payload: Record<string, unknown> | null
  created_at: string
}
