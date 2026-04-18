import type dayjs from 'dayjs'
import type { Entry, EntryType } from '../types'

export type TabKey = 'home' | 'history' | 'reports'

export type PageKey =
  | 'main'
  | 'balance'
  | 'entry-input'
  | 'category-settings'
  | 'recurring-settings'
  | 'payment-settings'
  | 'report-category-entities'
  | 'payment-method-entities'

export type PaymentType = 'cash' | 'bank' | 'emoney' | 'card'
export type HolidayAdjustment = 'none' | 'previous' | 'next'

export type SelectOption = {
  value: string
  label: string
}

export type EntryInputSeed = {
  id?: string
  entryType: EntryType
  amount: number
  entryCategoryId: string | null
  paymentMethodId: string | null
  memo: string | null
  occurredAt: string
  createdAt?: string
  updatedAt?: string
  recurringRuleId?: string | null
  createdByUserId?: string | null
  createdByUserName?: string | null
  createdByAvatarUrl?: string | null
}

export type ReportCategoryEntitySeed = {
  categoryId: string
  categoryName: string
  categoryColor?: string | null
  iconKey?: string | null
  rangeLabel: string
  entryType: EntryType
  fromDate: string
  toDateExclusive: string
}

export type PaymentMethodEntitySeed = {
  methodId: string
  methodName: string
}

export type AuthSession = {
  status: 'ready'
  family_id: string | null
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

export type CachedAuthIdentity = {
  family_id: string
  user_id: string
  verified_at: string
}

export type DayTotals = {
  income: number
  expense: number
}

export type DayCell = {
  date: dayjs.Dayjs
  inMonth: boolean
  totals: DayTotals
}

export type HistoryItem = Entry & {
  is_planned?: boolean
  is_carryover?: boolean
}

export type CarryoverDay = {
  entry_type: EntryType
  amount: number
}

export type ReportSummary = {
  income: number
  expense: number
}

export type ReportEntry = Pick<Entry, 'entry_type' | 'amount' | 'entry_category_id' | 'occurred_at'>

export type CategoryTotal = {
  id: string
  name: string
  total: number
  icon_key?: string | null
  color?: string | null
}

export type ReportData = {
  summary: ReportSummary
  categoryTotalsByType: Record<EntryType, CategoryTotal[]>
}

export type ToastState = { message: string; type: 'error' | 'info' } | null
