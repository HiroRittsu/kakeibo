import type { Context } from 'hono'

export type Bindings = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APP_ORIGIN?: string
  ALLOWED_ORIGINS?: string
}

export type SessionRow = {
  id: string
  user_id: string
  family_id: string | null
  is_pending: number | null
  expires_at: string
  created_at: string
  updated_at: string
}

export type UserRow = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
}

export type OAuthStateRow = {
  id: string
  next_path: string | null
  origin: string | null
  expires_at: string
}

export type AllowedUserRow = {
  email: string
  family_id: string | null
  role: string | null
  created_at: string
  updated_at: string
}

export type ChangeLogRow = {
  id: number
  entity_type: string
  entity_id: string
  action: string
  payload: string | null
  created_at: string
}

export type MutationReceiptRow = {
  request_id: string
  family_id: string
  endpoint: string
  method: string
  status: number
  response_body: string
  created_at: string
  expires_at: string
}

export type Variables = {
  session?: SessionRow | null
}

export type HonoEnv = {
  Bindings: Bindings
  Variables: Variables
}

export type AppContext = Context<HonoEnv>

export type RecurringRuleRow = {
  id: string
  family_id: string
  entry_type: 'income' | 'expense'
  amount: number
  entry_category_id: string | null
  payment_method_id: string | null
  memo: string | null
  frequency: string | null
  day_of_month: number | null
  holiday_adjustment: string | null
  start_at: string
  end_at: string | null
  is_active: number | null
}

export type EntryTotalRow = {
  entry_type: 'income' | 'expense'
  total: number
}

export type MonthlyBalanceRow = {
  balance?: number
  is_closed?: number
}

export type ConflictClass = 'soft' | 'fatal'

export type FatalConflictBody = {
  error: {
    kind: 'fatal_conflict'
    code: string
    message: string
    entity_type: string
    entity_id: string
    server_snapshot: Record<string, unknown> | null
    resolution_hint: string
    retryable: false
  }
}
