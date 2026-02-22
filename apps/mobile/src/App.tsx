import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import './App.css'
import { db } from './db'
import { EntryButtonsList, type EntryListItem } from './components/EntryButtonsList'
import { apiFetch, getApiBaseUrl, getFamilyId, getUserId, setIdentity } from './lib/api'
import { enqueueOutbox, getRecentSyncEvents, syncOutbox, type SyncFailure } from './lib/sync'
import type {
  Entry,
  EntryCategory,
  EntryType,
  MonthlyBalance,
  OutboxDeadLetter,
  PaymentMethod,
  RecurringRule,
} from './types'

type TabKey = 'home' | 'history' | 'reports'

type PageKey =
  | 'main'
  | 'balance'
  | 'entry-input'
  | 'category-settings'
  | 'recurring-settings'
  | 'payment-settings'
  | 'report-category-entities'
  | 'payment-method-entities'

type PaymentType = 'cash' | 'bank' | 'emoney' | 'card'
type HolidayAdjustment = 'none' | 'previous' | 'next'

type SelectOption = {
  value: string
  label: string
}

type EntryInputSeed = {
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

type ReportCategoryEntitySeed = {
  categoryId: string
  categoryName: string
  categoryColor?: string | null
  iconKey?: string | null
  rangeLabel: string
  entryType: EntryType
  fromDate: string
  toDateExclusive: string
}

type PaymentMethodEntitySeed = {
  methodId: string
  methodName: string
}

type AuthSession = {
  status: 'ready'
  family_id: string | null
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

type CachedAuthIdentity = {
  family_id: string
  user_id: string
  verified_at: string
}

type DayTotals = {
  income: number
  expense: number
}

type DayCell = {
  date: dayjs.Dayjs
  inMonth: boolean
  totals: DayTotals
}

type HistoryItem = Entry & {
  is_planned?: boolean
  is_carryover?: boolean
}

type CarryoverDay = {
  entry_type: EntryType
  amount: number
}

type ReportSummary = {
  income: number
  expense: number
}

type ReportEntry = Pick<Entry, 'entry_type' | 'amount' | 'entry_category_id' | 'occurred_at'>

type CategoryTotal = {
  id: string
  name: string
  total: number
  icon_key?: string | null
  color?: string | null
}

type ReportData = {
  summary: ReportSummary
  categoryTotalsByType: Record<EntryType, CategoryTotal[]>
}

const CARRYOVER_CATEGORY_ID = 'carryover'
const SESSION_CHECK_TIMEOUT_MS = 7000
const BACKGROUND_SESSION_CHECK_TIMEOUT_MS = 2500
const AUTH_CACHE_KEY = 'auth_session_cache'
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'dev'
const buildMonthlyBalanceId = (familyId: string, ym: string) => `${familyId}:${ym}`

const loadCachedAuthIdentity = (): CachedAuthIdentity | null => {
  const raw = localStorage.getItem(AUTH_CACHE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CachedAuthIdentity>
    if (typeof parsed.family_id !== 'string' || typeof parsed.user_id !== 'string') return null
    return {
      family_id: parsed.family_id,
      user_id: parsed.user_id,
      verified_at: typeof parsed.verified_at === 'string' ? parsed.verified_at : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

const saveCachedAuthIdentity = (familyId: string, userId: string) => {
  const payload: CachedAuthIdentity = {
    family_id: familyId,
    user_id: userId,
    verified_at: new Date().toISOString(),
  }
  localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(payload))
}

const clearCachedAuthIdentity = () => {
  localStorage.removeItem(AUTH_CACHE_KEY)
}

const getYmFromDate = (value: string) => value.slice(0, 7)

const ymToIndex = (ym: string) => {
  const [yearRaw, monthRaw] = ym.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0
  return year * 12 + (month - 1)
}

const formatYmFromIndex = (index: number) => {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${`${month}`.padStart(2, '0')}`
}

const addMonthsToYm = (ym: string, diff: number) => {
  const nextIndex = ymToIndex(ym) + diff
  return formatYmFromIndex(nextIndex)
}

const recalcLocalMonthlyBalances = async (entries: Entry[], familyId: string, startYm: string) => {
  const currentYm = dayjs().format('YYYY-MM')
  const startIndex = ymToIndex(startYm)
  const endIndex = ymToIndex(currentYm)
  if (startIndex > endIndex) return

  const prevYm = addMonthsToYm(startYm, -1)
  const prevRecord = await db.monthlyBalances.get(buildMonthlyBalanceId(familyId, prevYm))
  let previousBalance =
    typeof prevRecord?.balance === 'number'
      ? prevRecord.balance
      : entries.reduce((sum, entry) => {
          const ym = getYmFromDate(getEntryDateKey(entry))
          if (ymToIndex(ym) <= ymToIndex(prevYm)) {
            return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount)
          }
          return sum
        }, 0)

  const monthTotals = new Map<string, { income: number; expense: number }>()
  entries.forEach((entry) => {
    const ym = getYmFromDate(getEntryDateKey(entry))
    const index = ymToIndex(ym)
    if (index < startIndex || index > endIndex) return
    const current = monthTotals.get(ym) ?? { income: 0, expense: 0 }
    if (entry.entry_type === 'income') {
      current.income += entry.amount
    } else {
      current.expense += entry.amount
    }
    monthTotals.set(ym, current)
  })

  const months: string[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    months.push(formatYmFromIndex(index))
  }

  const existingBalances = months.length ? await db.monthlyBalances.where('ym').anyOf(months).toArray() : []
  const isClosedMap = new Map(existingBalances.map((row) => [row.ym, row.is_closed ?? 0]))

  const updatedAt = new Date().toISOString()
  const records: MonthlyBalance[] = []
  months.forEach((ym) => {
    const totals = monthTotals.get(ym) ?? { income: 0, expense: 0 }
    previousBalance += totals.income - totals.expense
    records.push({
      id: buildMonthlyBalanceId(familyId, ym),
      family_id: familyId,
      ym,
      balance: Math.round(previousBalance),
      is_closed: isClosedMap.get(ym) ?? 0,
      updated_at: updatedAt,
    })
  })

  if (records.length) {
    await db.monthlyBalances.bulkPut(records)
  }
}

const getReportCategoryMeta = (id: string, categories: EntryCategory[]) => {
  if (id === CARRYOVER_CATEGORY_ID) {
    return { name: '繰越し', icon_key: 'redo', color: '#8f9499' }
  }
  const category = categories.find((item) => item.id === id)
  return {
    name: category?.name ?? '未分類',
    icon_key: category?.icon_key ?? null,
    color: category?.color ?? null,
  }
}


const TAB_LABELS: Record<TabKey, string> = {
  home: '入力',
  history: '履歴',
  reports: '集計',
}

const PAGE_TITLES: Record<PageKey, string> = {
  main: '入力',
  balance: '残高',
  'entry-input': '入力',
  'category-settings': 'カテゴリ設定',
  'recurring-settings': '定期的な収入/支出',
  'payment-settings': '支払い設定',
  'report-category-entities': 'カテゴリ明細',
  'payment-method-entities': '支払い明細',
}

const CATEGORY_COLORS = [
  '#d9554c',
  '#8bc34a',
  '#e91e63',
  '#2196f3',
  '#607d8b',
  '#5c6bc0',
  '#00bcd4',
  '#f44336',
  '#795548',
  '#ff9800',
  '#757575',
  '#ff1744',
]
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const formatAmount = (amount: number) => {
  return new Intl.NumberFormat('ja-JP').format(amount)
}

const normalizeDayOfMonth = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  if (normalized < 1 || normalized > 31) return null
  return normalized
}

const dayToInputValue = (value: number | null | undefined) => (typeof value === 'number' ? String(value) : '')
const formatDayLabel = (value: number | null | undefined) => (typeof value === 'number' ? `${value}日` : '未設定')

const parseMonthYm = (ym: string) => {
  const parsed = dayjs(`${ym}-01`)
  if (!parsed.isValid()) return dayjs().startOf('month')
  return parsed.startOf('month')
}

const getDefaultSelectedDateForMonth = (month: dayjs.Dayjs) => {
  const today = dayjs()
  if (today.isSame(month, 'month')) return today.format('YYYY-MM-DD')
  return month.startOf('month').format('YYYY-MM-DD')
}

const toTokyoDateString = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return tokyo.toISOString().slice(0, 10)
}

const getEntryDateKey = (entry: Entry | HistoryItem) => entry.occurred_on ?? toTokyoDateString(entry.occurred_at)

const buildEntryCreatePayload = (entry: Entry) => ({
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

const buildEntryUpdatePayload = (entry: Entry, baseUpdatedAt: string | null) => ({
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

const IconBase = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

const IconPencil = () => (
  <IconBase>
    <path d="M3 17.5V21h3.5L18.7 8.8 15.2 5.3 3 17.5z" />
    <path d="M14.8 6.2l3 3" />
  </IconBase>
)

const IconCalendar = () => (
  <IconBase>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 9h18" />
  </IconBase>
)

const IconChart = () => (
  <IconBase>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 12V3" />
    <path d="M12 12l6.5 3.5" />
  </IconBase>
)

const IconCard = () => (
  <IconBase>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
  </IconBase>
)

const IconSettings = () => (
  <IconBase>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V21a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H3a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V3a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H21a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
  </IconBase>
)

const IconHome = () => (
  <IconBase>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </IconBase>
)

const IconFolder = () => (
  <IconBase>
    <path d="M4 6h6l2 2h8v10H4z" />
  </IconBase>
)

const CATEGORY_ICON_CHOICES = [
  'restaurant',
  'local_cafe',
  'lunch_dining',
  'local_bar',
  'local_grocery_store',
  'cleaning_services',
  'checkroom',
  'face',
  'spa',
  'sports_tennis',
  'fitness_center',
  'train',
  'directions_bus',
  'directions_car',
  'local_gas_station',
  'flight',
  'menu_book',
  'school',
  'subscriptions',
  'payments',
  'account_balance',
  'medical_services',
  'local_hospital',
  'healing',
  'home',
  'apartment',
  'garage',
  'savings',
  'child_care',
  'pets',
  'local_florist',
  'movie',
  'music_note',
  'travel',
  'festival',
  'shopping_bag',
  'redeem',
  'volunteer_activism',
  'category',
  'content_cut',
  'settings',
]

const PAYMENT_ICON_CHOICES = [
  'payments',
  'account_balance_wallet',
  'account_balance',
  'credit_card',
  'paid',
  'savings',
  'point_of_sale',
  'receipt_long',
  'price_check',
  'qr_code',
  'currency_yen',
  'sell',
]

const PAYMENT_DEFAULT_COLORS: Record<PaymentType, string> = {
  cash: '#8a6b55',
  bank: '#2f6db4',
  emoney: '#2f8f9d',
  card: '#3a4bb8',
}

const renderMaterialIcon = (name: string, className?: string) => (
  <span className={['material-symbols-outlined', className].filter(Boolean).join(' ')}>{name}</span>
)

const getCategoryIcon = (iconKey?: string | null) => {
  if (!iconKey) return null
  return renderMaterialIcon(iconKey)
}

const getPaymentType = (type: string): PaymentType => {
  if (type === 'bank' || type === 'emoney' || type === 'card' || type === 'cash') return type
  return 'cash'
}

const getPaymentFallbackIconKey = (type: string) => {
  if (type === 'bank') return 'account_balance'
  if (type === 'emoney') return 'account_balance_wallet'
  if (type === 'card') return 'credit_card'
  return 'payments'
}

const getPaymentIconFromConfig = (type: string, iconKey?: string | null) => {
  const normalizedIconKey = typeof iconKey === 'string' && iconKey.trim() ? iconKey.trim() : null
  return renderMaterialIcon(normalizedIconKey ?? getPaymentFallbackIconKey(type))
}

const getPaymentColor = (method?: PaymentMethod | null) => {
  if (!method) return PAYMENT_DEFAULT_COLORS.cash
  return method.color ?? PAYMENT_DEFAULT_COLORS[getPaymentType(method.type)]
}

const getPaymentIcon = (method?: PaymentMethod | null) => {
  return getPaymentIconFromConfig(method?.type ?? 'cash', method?.icon_key ?? null)
}

const sortPaymentMethods = (methods: PaymentMethod[]) => {
  return methods.slice().sort((a, b) => {
    const sortDiff = a.sort_order - b.sort_order
    if (sortDiff !== 0) return sortDiff
    const createdDiff = a.created_at.localeCompare(b.created_at)
    if (createdDiff !== 0) return createdDiff
    return a.name.localeCompare(b.name, 'ja')
  })
}

const buildCalendar = (month: dayjs.Dayjs, totals: Map<string, DayTotals>) => {
  const start = month.startOf('month')
  const end = month.endOf('month')
  const startWeekday = start.day()
  const days: DayCell[] = []

  for (let i = 0; i < startWeekday; i += 1) {
    const date = start.subtract(startWeekday - i, 'day')
    days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } })
  }

  for (let day = 0; day < end.date(); day += 1) {
    const date = start.add(day, 'day')
    const key = date.format('YYYY-MM-DD')
    days.push({ date, inMonth: true, totals: totals.get(key) ?? { income: 0, expense: 0 } })
  }

  while (days.length % 7 !== 0) {
    const date = end.add(days.length % 7, 'day')
    days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } })
  }

  return days
}

const normalizeHolidayAdjustment = (value?: string | null): HolidayAdjustment => {
  if (value === 'previous' || value === 'next') return value
  return 'none'
}

const adjustForWeekend = (date: dayjs.Dayjs, adjustment: HolidayAdjustment) => {
  const day = date.day()
  if (adjustment === 'none' || (day !== 0 && day !== 6)) return date
  if (adjustment === 'previous') {
    return day === 0 ? date.subtract(2, 'day') : date.subtract(1, 'day')
  }
  return day === 0 ? date.add(1, 'day') : date.add(2, 'day')
}

const getDueDay = (target: dayjs.Dayjs, ruleDay: number | null, fallback: dayjs.Dayjs) => {
  const candidate = ruleDay ?? fallback.date()
  return Math.min(candidate, target.daysInMonth())
}

type RecurringOccurrence = {
  rule: RecurringRule
  date: dayjs.Dayjs
  isFuture: boolean
}

const buildRecurringOccurrences = (
  rules: RecurringRule[],
  range: 'week' | 'month' | 'year',
  baseDate: dayjs.Dayjs
) => {
  const { start, end } = getRangeBounds(range, baseDate)
  const rangeStart = start.startOf('day')
  const rangeEnd = end.endOf('day')
  const occurrences: RecurringOccurrence[] = []
  const seen = new Set<string>()
  const today = dayjs()

  rules.forEach((rule) => {
    if (!rule.is_active) return
    const ruleStart = dayjs(rule.start_at)
    const ruleEnd = rule.end_at ? dayjs(rule.end_at) : null
    const adjustment = normalizeHolidayAdjustment(rule.holiday_adjustment)
    const frequency = rule.frequency ?? 'monthly'

    const addOccurrence = (base: dayjs.Dayjs) => {
      if (base.isBefore(ruleStart, 'day')) return
      if (ruleEnd && base.isAfter(ruleEnd, 'day')) return
      const adjusted = adjustForWeekend(base, adjustment)
      if (adjusted.isBefore(rangeStart, 'day') || adjusted.isAfter(rangeEnd, 'day')) return
      const key = `${rule.id}:${adjusted.format('YYYY-MM-DD')}`
      if (seen.has(key)) return
      seen.add(key)
      occurrences.push({ rule, date: adjusted, isFuture: adjusted.isAfter(today, 'day') })
    }

    if (frequency === 'weekly') {
      const weekday =
        rule.day_of_month !== null && rule.day_of_month >= 0 && rule.day_of_month <= 6
          ? rule.day_of_month
          : ruleStart.day()
      const scanStart = rangeStart.subtract(2, 'day')
      const scanEnd = rangeEnd.add(2, 'day')
      for (let cursor = scanStart; cursor.isBefore(scanEnd) || cursor.isSame(scanEnd, 'day'); cursor = cursor.add(1, 'day')) {
        if (cursor.day() !== weekday) continue
        addOccurrence(cursor)
      }
      return
    }

    const monthStart = rangeStart.startOf('month').subtract(1, 'month')
    const monthEnd = rangeEnd.startOf('month').add(1, 'month')
    for (
      let cursor = monthStart;
      cursor.isBefore(monthEnd) || cursor.isSame(monthEnd, 'month');
      cursor = cursor.add(1, 'month')
    ) {
      if (frequency === 'bimonthly') {
        const diff = cursor.startOf('month').diff(ruleStart.startOf('month'), 'month')
        if (diff < 0 || diff % 2 !== 0) continue
      }
      if (frequency === 'yearly' && cursor.month() !== ruleStart.month()) {
        continue
      }
      const dueDay = getDueDay(cursor, rule.day_of_month, ruleStart)
      addOccurrence(cursor.date(dueDay))
    }
  })

  return occurrences.sort((a, b) => a.date.valueOf() - b.date.valueOf())
}

const getRangeBounds = (range: 'week' | 'month' | 'year', base = dayjs()) => {
  let start = base.startOf('month')
  let end = base.endOf('month')

  if (range === 'week') {
    const day = (base.day() + 6) % 7
    start = base.subtract(day, 'day').startOf('day')
    end = start.add(6, 'day').endOf('day')
  } else if (range === 'year') {
    start = base.startOf('year')
    end = base.endOf('year')
  }

  return { start, end }
}

const computeReport = (
  entries: ReportEntry[],
  categories: EntryCategory[],
  range: 'week' | 'month' | 'year',
  baseDate = dayjs()
) => {
  const { start, end } = getRangeBounds(range, baseDate)

  const summaryTotals: ReportSummary = { income: 0, expense: 0 }
  const categoryMaps: Record<EntryType, Map<string, number>> = {
    income: new Map<string, number>(),
    expense: new Map<string, number>(),
  }

  entries.forEach((entry) => {
    const date = dayjs(entry.occurred_at)
    if (date.isBefore(start) || date.isAfter(end)) return

    summaryTotals[entry.entry_type] += entry.amount
    const key = entry.entry_category_id ?? 'uncategorized'
    const map = categoryMaps[entry.entry_type]
    map.set(key, (map.get(key) ?? 0) + entry.amount)
  })

  const categoryTotalsByType: Record<EntryType, CategoryTotal[]> = {
    income: Array.from(categoryMaps.income.entries())
      .map(([id, total]) => {
        const category = getReportCategoryMeta(id, categories)
        return {
          id,
          total,
          name: category.name,
          icon_key: category.icon_key,
          color: category.color,
        }
      })
      .sort((a, b) => b.total - a.total),
    expense: Array.from(categoryMaps.expense.entries())
      .map(([id, total]) => {
        const category = getReportCategoryMeta(id, categories)
        return {
          id,
          total,
          name: category.name,
          icon_key: category.icon_key,
          color: category.color,
        }
      })
      .sort((a, b) => b.total - a.total),
  }

  return { summary: summaryTotals, categoryTotalsByType }
}

const estimateMonthlyAmount = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  if (frequency === 'weekly') return rule.amount * 4
  if (frequency === 'biweekly') return rule.amount * 2
  if (frequency === 'bimonthly') return Math.round(rule.amount / 2)
  if (frequency === 'yearly') return Math.round(rule.amount / 12)
  return rule.amount
}

const groupByFrequency = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  if (frequency === 'weekly') return '毎週'
  if (frequency === 'bimonthly') return '隔月/任意の月'
  if (frequency === 'yearly') return '年次'
  return '毎月'
}

const formatRecurringScheduleLabel = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  const start = dayjs(rule.start_at)
  if (frequency === 'weekly') {
    const weekday =
      rule.day_of_month !== null && rule.day_of_month >= 0 && rule.day_of_month <= 6
        ? rule.day_of_month
        : start.day()
    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
    return `毎週${weekdayLabels[weekday]}`
  }
  const dayValue = rule.day_of_month ?? start.date()
  if (frequency === 'bimonthly') return `隔月${dayValue}日`
  if (frequency === 'yearly') return `${start.month() + 1}月${dayValue}日`
  return `毎月${dayValue}日`
}

const paymentMethodLabel = (methods: PaymentMethod[], id: string | null) => {
  if (!id) return '未設定'
  return methods.find((method) => method.id === id)?.name ?? '未設定'
}

const paymentTypeLabel = (type: string) => {
  if (type === 'cash') return '現金'
  if (type === 'bank') return '銀行'
  if (type === 'emoney') return '電子マネー'
  if (type === 'card') return 'クレジット'
  return '支払い'
}

const splitMemo = (value: string | null) => {
  if (!value) return { place: '', memo: '' }
  const parts = value.split(' / ')
  if (parts.length >= 2) {
    const [place, ...rest] = parts
    return { place: place ?? '', memo: rest.join(' / ') }
  }
  return { place: '', memo: value }
}

const combineMemo = (place: string, memo: string) => {
  const trimmedPlace = place.trim()
  const trimmedMemo = memo.trim()
  if (trimmedPlace && trimmedMemo) return `${trimmedPlace} / ${trimmedMemo}`
  if (trimmedPlace) return trimmedPlace
  if (trimmedMemo) return trimmedMemo
  return null
}

const formatSyncFailureMessage = (failure: SyncFailure) => {
  const status = failure.status
  const actionLabel = failure.stage === 'outbox' ? '送信' : '同期'
  if (status === 401 || status === 403) {
    return 'ログインが必要です'
  }
  if (status === 409) {
    return '要対応の同期競合があります'
  }
  if (status && status >= 500) {
    return `${actionLabel}に失敗しました（サーバーエラー）`
  }
  if (status) {
    return `${actionLabel}に失敗しました`
  }
  return '通信に失敗しました。ネットワークを確認してください'
}

const buildSyncFailureLog = (failure: SyncFailure) => {
  const lines = [
    '[kakeibo sync error]',
    `occurred_at: ${failure.occurred_at}`,
    `stage: ${failure.stage}`,
    failure.status ? `status: ${failure.status}` : null,
    failure.error_code ? `error_code: ${failure.error_code}` : null,
    failure.method ? `method: ${failure.method}` : null,
    failure.endpoint ? `endpoint: ${failure.endpoint}` : null,
    failure.message ? `message: ${failure.message}` : null,
    failure.detail ? `detail: ${failure.detail}` : null,
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

const buildDeadLetterLog = (deadLetters: OutboxDeadLetter[]) => {
  if (!deadLetters.length) return ''

  const lines = ['[kakeibo fatal conflicts]']
  deadLetters.forEach((item, index) => {
    lines.push(`--- item_${index + 1} ---`)
    lines.push(`failed_at: ${item.failed_at}`)
    if (typeof item.status === 'number') lines.push(`status: ${item.status}`)
    lines.push(`method: ${item.method}`)
    lines.push(`endpoint: ${item.endpoint}`)
    lines.push(`entity_type: ${item.entity_type}`)
    lines.push(`entity_id: ${item.entity_id}`)
    if (item.error_code) lines.push(`error_code: ${item.error_code}`)
    if (item.error_detail) lines.push(`error_detail: ${item.error_detail}`)
    if (item.server_snapshot) lines.push(`server_snapshot: ${JSON.stringify(item.server_snapshot)}`)
    if (item.request_payload) lines.push(`request_payload: ${JSON.stringify(item.request_payload)}`)
  })

  return lines.join('\n')
}

const buildSyncDiagnosticsLog = (failure: SyncFailure | null, deadLetters: OutboxDeadLetter[]) => {
  if (!failure && deadLetters.length === 0) return ''

  const lines = ['[kakeibo sync diagnostics]', `generated_at: ${new Date().toISOString()}`]
  if (failure) {
    lines.push('', buildSyncFailureLog(failure))
  }

  if (deadLetters.length) {
    lines.push('', buildDeadLetterLog(deadLetters))
  }

  const events = getRecentSyncEvents(25)
  if (events.length) {
    lines.push('', '[kakeibo sync events]')
    events.forEach((event) => {
      lines.push(
        `${event.occurred_at} level=${event.level} stage=${event.stage} message=${event.message}` +
          `${event.status ? ` status=${event.status}` : ''}` +
          `${event.error_code ? ` error_code=${event.error_code}` : ''}` +
          `${event.method ? ` method=${event.method}` : ''}` +
          `${event.endpoint ? ` endpoint=${event.endpoint}` : ''}`
      )
    })
  }

  return lines.join('\n')
}

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

type AuthScreenProps = {
  status: 'loading' | 'logged-out'
  onLogin: () => void
  error: string | null
}

const AuthScreen = ({ status, onLogin, error }: AuthScreenProps) => {
  const isLoading = status === 'loading'
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Kakeibo</h1>
        <p className="muted">
          {isLoading
            ? 'セッションを確認しています。時間がかかる場合はそのままログインできます。'
            : 'Googleアカウントでログインします。'}
        </p>
        {error && <p className="auth-error">{error}</p>}
        <div className="auth-actions">
          <button className="primary full" onClick={onLogin}>
            Googleでログイン
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home')
  const [page, setPage] = useState<PageKey>('main')
  const [returnPage, setReturnPage] = useState<PageKey>('main')
  const [paymentReturnPage, setPaymentReturnPage] = useState<PageKey>('main')
  const [returnTab, setReturnTab] = useState<TabKey>('home')
  const [entrySeed, setEntrySeed] = useState<EntryInputSeed | null>(null)
  const [preferredEntryType, setPreferredEntryType] = useState<EntryType>('expense')
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'info' } | null>(null)
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(null)
  const [authStatus, setAuthStatus] = useState<'loading' | 'logged-out' | 'ready'>('loading')
  const [authError, setAuthError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<AuthSession['user'] | null>(null)
  const [isOfflineAuthMode, setIsOfflineAuthMode] = useState(false)
  const [isSessionVerified, setIsSessionVerified] = useState(false)
  const [historyMonthYm, setHistoryMonthYm] = useState(() => dayjs().format('YYYY-MM'))
  const [reportCategorySeed, setReportCategorySeed] = useState<ReportCategoryEntitySeed | null>(null)
  const [paymentMethodSeed, setPaymentMethodSeed] = useState<PaymentMethodEntitySeed | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const sessionCheckInFlightRef = useRef<Promise<boolean> | null>(null)

  const entries = useLiveQuery(() => db.entries.orderBy('occurred_at').reverse().toArray(), [])
  const entryCategories = useLiveQuery(() => db.entryCategories.orderBy('sort_order').toArray(), [])
  const paymentMethods = useLiveQuery(() => db.paymentMethods.orderBy('sort_order').toArray(), [])
  const recurringRules = useLiveQuery(() => db.recurringRules.orderBy('created_at').reverse().toArray(), [])
  const monthlyBalances = useLiveQuery(() => db.monthlyBalances.orderBy('ym').toArray(), [])
  const outboxCount = useLiveQuery(() => db.outbox.count(), [])
  const outboxDeadLetters = useLiveQuery(() => db.outboxDeadLetters.orderBy('failed_at').reverse().limit(10).toArray(), [])
  const deadLetterCount = useLiveQuery(() => db.outboxDeadLetters.count(), []) ?? 0
  const syncFailureLog = useMemo(
    () => buildSyncDiagnosticsLog(syncFailure, outboxDeadLetters ?? []),
    [syncFailure, outboxDeadLetters]
  )
  const orderedPaymentMethods = useMemo(() => sortPaymentMethods(paymentMethods ?? []), [paymentMethods])

  const paymentOptions = useMemo<SelectOption[]>(() => {
    return orderedPaymentMethods.map((method) => ({
      value: method.id,
      label: method.name,
    }))
  }, [orderedPaymentMethods])

  const categoryMap = useMemo(() => {
    return new Map((entryCategories ?? []).map((category) => [category.id, category]))
  }, [entryCategories])

  const paymentMap = useMemo(() => {
    return new Map(orderedPaymentMethods.map((method) => [method.id, method]))
  }, [orderedPaymentMethods])

  const monthlyBalanceMap = useMemo(() => {
    return new Map((monthlyBalances ?? []).map((row) => [row.ym, row]))
  }, [monthlyBalances])

  const showToast = useCallback((message: string, type: 'error' | 'info' = 'error') => {
    setToast({ message, type })
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
    }, 3000)
  }, [])

  const applyCachedAuthMode = useCallback((options: { showOfflineToast?: boolean } = {}) => {
    const cached = loadCachedAuthIdentity()
    if (!cached) return false
    setIdentity(cached.family_id, cached.user_id)
    setIsOfflineAuthMode(true)
    setIsSessionVerified(false)
    setAuthError(null)
    setAuthStatus('ready')
    if (options.showOfflineToast) {
      showToast('オフラインのため、前回ログイン情報で起動しました', 'info')
    }
    return true
  }, [showToast])

  const loadSession = useCallback(async (
    options: {
      timeoutMs?: number
      allowCachedFallback?: boolean
      notifyOfflineFallback?: boolean
      unauthenticatedError?: string | null
    } = {}
  ): Promise<boolean> => {
    if (sessionCheckInFlightRef.current) {
      return await sessionCheckInFlightRef.current
    }

    const request = (async () => {
      const {
        timeoutMs = SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback = false,
        notifyOfflineFallback = false,
        unauthenticatedError = null,
      } = options
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => {
        controller.abort()
      }, timeoutMs)

      try {
        const response = await apiFetch('/auth/session', { signal: controller.signal })
        if (!response.ok) {
          if (unauthenticatedError) {
            setAuthError(unauthenticatedError)
          }
          clearCachedAuthIdentity()
          setCurrentUser(null)
          setIsSessionVerified(false)
          setIsOfflineAuthMode(false)
          setAuthStatus('logged-out')
          return false
        }

        const data = (await response.json()) as { session: AuthSession | null }
        if (!data.session || !data.session.family_id) {
          if (unauthenticatedError) {
            setAuthError(unauthenticatedError)
          }
          clearCachedAuthIdentity()
          setCurrentUser(null)
          setIsSessionVerified(false)
          setIsOfflineAuthMode(false)
          setAuthStatus('logged-out')
          return false
        }

        setIdentity(data.session.family_id, data.session.user.id)
        setCurrentUser(data.session.user)
        saveCachedAuthIdentity(data.session.family_id, data.session.user.id)
        setIsSessionVerified(true)
        setIsOfflineAuthMode(false)
        setAuthError(null)
        setAuthStatus('ready')
        return true
      } catch (error) {
        const isAbortError = error instanceof DOMException && error.name === 'AbortError'
        const isNetworkError = error instanceof TypeError
        if (
          (!navigator.onLine || isAbortError || isNetworkError) &&
          allowCachedFallback &&
          applyCachedAuthMode({ showOfflineToast: notifyOfflineFallback })
        ) {
          return false
        }
        if (isAbortError) {
          setAuthError((current) => current ?? 'セッション確認がタイムアウトしました。ログインして続行してください。')
        } else if (!navigator.onLine) {
          setAuthError('オフラインです。オンラインで一度ログインしてください。')
        }
        setCurrentUser(null)
        setIsSessionVerified(false)
        setIsOfflineAuthMode(false)
        setAuthStatus('logged-out')
        return false
      } finally {
        window.clearTimeout(timeoutId)
      }
    })()

    sessionCheckInFlightRef.current = request.finally(() => {
      sessionCheckInFlightRef.current = null
    })
    return await sessionCheckInFlightRef.current
  }, [applyCachedAuthMode])

  const runSync = useCallback(async (options: { silentIfOffline?: boolean } = {}) => {
    if (!navigator.onLine) {
      if (!options.silentIfOffline) {
        showToast('オフライン中のため同期はスキップしました', 'info')
      }
      return
    }

    if (!isSessionVerified) {
      const verified = await loadSession({
        timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback: true,
        notifyOfflineFallback: false,
        unauthenticatedError: 'セッションが切れました。再ログインしてください。',
      })
      if (!verified) return
    }

    const result = await syncOutbox()
    if (!result.ok) {
      setSyncFailure(result.failure)
      showToast(formatSyncFailureMessage(result.failure))
      if (result.failure.auth_required) {
        clearCachedAuthIdentity()
        setCurrentUser(null)
        setIsSessionVerified(false)
        setAuthError('セッションが切れました。再ログインしてください。')
        setIsOfflineAuthMode(false)
        setAuthStatus('logged-out')
      }
      return
    }
    if (isOfflineAuthMode) {
      setIsOfflineAuthMode(false)
    }
    if (result.dead_letters > 0) {
      showToast('要対応の同期エラーがあります。詳細をコピーしてください。')
    }
    const currentDeadLetterCount = await db.outboxDeadLetters.count()
    if (currentDeadLetterCount === 0) {
      setSyncFailure(null)
    }
  }, [isOfflineAuthMode, isSessionVerified, loadSession, showToast])

  const handleCopySyncFailureLog = async () => {
    if (!syncFailureLog) return
    try {
      await copyText(syncFailureLog)
      showToast('同期エラー詳細をコピーしました', 'info')
    } catch {
      showToast('同期エラー詳細のコピーに失敗しました')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('auth_error')
    if (error) {
      const message =
        error === 'email_unverified'
          ? 'Googleアカウントのメール認証が必要です'
          : 'このアカウントは許可されていません'
      setAuthError(message)
      params.delete('auth_error')
      const next = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
    }
    if (applyCachedAuthMode()) {
      void loadSession({
        timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback: true,
        notifyOfflineFallback: false,
        unauthenticatedError: 'セッションが切れました。再ログインしてください。',
      })
      return
    }
    void loadSession({
      timeoutMs: SESSION_CHECK_TIMEOUT_MS,
      allowCachedFallback: false,
      notifyOfflineFallback: false,
      unauthenticatedError: null,
    })
  }, [applyCachedAuthMode, loadSession])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ready' || isSessionVerified) return
    const onOnline = () => {
      void loadSession({
        timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback: true,
        notifyOfflineFallback: false,
        unauthenticatedError: 'セッションが切れました。再ログインしてください。',
      })
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [authStatus, isSessionVerified, loadSession])

  useEffect(() => {
    if (authStatus !== 'ready' || !isSessionVerified) return
    void runSync({ silentIfOffline: true })
  }, [authStatus, isSessionVerified, runSync])

  const handleSync = async () => {
    if (authStatus !== 'ready') return
    setSyncing(true)
    try {
      await runSync()
    } finally {
      setSyncing(false)
    }
  }

  const handleLogin = () => {
    setAuthError(null)
    const apiBase = getApiBaseUrl()
    if (!apiBase) {
      setAuthError('APIのURLが設定されていません')
      return
    }
    const params = new URLSearchParams({
      next: window.location.pathname,
      origin: window.location.origin,
    })
    window.location.href = `${apiBase}/auth/google/start?${params.toString()}`
  }

  const clearLocalData = async () => {
    await db.transaction(
      'rw',
      [
        db.entries,
        db.entryCategories,
        db.paymentMethods,
        db.recurringRules,
        db.monthlyBalances,
        db.outbox,
        db.outboxDeadLetters,
      ],
      async () => {
        await Promise.all([
          db.entries.clear(),
          db.entryCategories.clear(),
          db.paymentMethods.clear(),
          db.recurringRules.clear(),
          db.monthlyBalances.clear(),
          db.outbox.clear(),
          db.outboxDeadLetters.clear(),
        ])
      }
    )
    localStorage.removeItem('family_id')
    localStorage.removeItem('user_id')
    localStorage.removeItem('last_sync')
    localStorage.removeItem('sync_cursor')
    localStorage.removeItem('sync_event_buffer')
    clearCachedAuthIdentity()
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    const confirmed = window.confirm('ログアウトしてこの端末のデータを削除します。よろしいですか？')
    if (!confirmed) return

    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ローカルデータ削除を優先するため、サーバーログアウト失敗時も続行する。
    }

    try {
      await clearLocalData()
    } catch {
      showToast('端末データの削除に失敗しました')
      return
    }

    setActiveTab('home')
    setPage('main')
    setReturnPage('main')
    setPaymentReturnPage('main')
    setReturnTab('home')
    setEntrySeed(null)
    setReportCategorySeed(null)
    setPaymentMethodSeed(null)
    setPreferredEntryType('expense')
    setHistoryMonthYm(dayjs().format('YYYY-MM'))
    setCurrentUser(null)
    setIsOfflineAuthMode(false)
    setIsSessionVerified(false)
    setAuthError(null)
    setAuthStatus('logged-out')
  }

  const handleSaveEntry = async (payload: EntryInputSeed) => {
    const now = new Date().toISOString()
    const existing = payload.id ? (entries ?? []).find((entry) => entry.id === payload.id) : null
    const occurredOn = toTokyoDateString(payload.occurredAt)
    const entry: Entry = {
      id: existing?.id ?? crypto.randomUUID(),
      family_id: existing?.family_id ?? getFamilyId(),
      entry_type: payload.entryType,
      amount: payload.amount,
      entry_category_id: payload.entryCategoryId,
      payment_method_id: payload.paymentMethodId,
      memo: payload.memo,
      occurred_at: payload.occurredAt,
      occurred_on: occurredOn,
      recurring_rule_id: existing?.recurring_rule_id ?? payload.recurringRuleId ?? null,
      created_by_user_id:
        existing?.created_by_user_id ?? payload.createdByUserId ?? currentUser?.id ?? getUserId(),
      created_by_user_name:
        existing?.created_by_user_name ?? payload.createdByUserName ?? currentUser?.name ?? null,
      created_by_avatar_url:
        existing?.created_by_avatar_url ?? payload.createdByAvatarUrl ?? currentUser?.avatar_url ?? null,
      created_at: existing?.created_at ?? payload.createdAt ?? now,
      updated_at: now,
    }

    await db.entries.put(entry)
    const entriesSnapshot = await db.entries.toArray()
    await recalcLocalMonthlyBalances(entriesSnapshot, entry.family_id, getYmFromDate(occurredOn))
    setPreferredEntryType(payload.entryType)

    if (existing) {
      await enqueueOutbox({
        method: 'PATCH',
        endpoint: `/entries/${entry.id}`,
        payload: buildEntryUpdatePayload(entry, existing.updated_at ?? payload.updatedAt ?? null),
        created_at: now,
        entity_type: 'entries',
        entity_id: entry.id,
        operation: 'upsert',
        base_updated_at: existing.updated_at ?? payload.updatedAt ?? null,
      })
    } else {
      await enqueueOutbox({
        method: 'POST',
        endpoint: '/entries',
        payload: buildEntryCreatePayload(entry),
        created_at: now,
        entity_type: 'entries',
        entity_id: entry.id,
        operation: 'upsert',
        base_updated_at: null,
      })
    }

    void runSync()
  }

  const handleDeleteEntry = async (entryId: string) => {
    const existing = (entries ?? []).find((entry) => entry.id === entryId) ?? (await db.entries.get(entryId))
    await db.entries.delete(entryId)
    if (existing) {
      const entriesSnapshot = await db.entries.toArray()
      await recalcLocalMonthlyBalances(
        entriesSnapshot,
        existing.family_id,
        getYmFromDate(getEntryDateKey(existing))
      )
    }
    await enqueueOutbox({
      method: 'DELETE',
      endpoint: `/entries/${entryId}`,
      payload: null,
      created_at: new Date().toISOString(),
      entity_type: 'entries',
      entity_id: entryId,
      operation: 'delete',
      base_updated_at: existing?.updated_at ?? null,
    })
    void runSync()
  }

  const handleSaveCategory = async (category: EntryCategory) => {
    const existing = await db.entryCategories.get(category.id)
    const baseUpdatedAt = existing?.updated_at ?? null
    await db.entryCategories.put(category)
    await enqueueOutbox({
      method: 'POST',
      endpoint: '/entry-categories',
      payload: {
        id: category.id,
        name: category.name,
        type: category.type,
        icon_key: category.icon_key ?? null,
        color: category.color ?? null,
        sort_order: category.sort_order,
        base_updated_at: baseUpdatedAt,
      },
      created_at: new Date().toISOString(),
      entity_type: 'entry_categories',
      entity_id: category.id,
      operation: 'upsert',
      base_updated_at: baseUpdatedAt,
    })
    void runSync()
  }

  const handleAddCategory = async (name: string, type: string) => {
    const now = new Date().toISOString()
    const category: EntryCategory = {
      id: crypto.randomUUID(),
      family_id: getFamilyId(),
      name,
      type,
      icon_key: null,
      color: CATEGORY_COLORS[(entryCategories?.length ?? 0) % CATEGORY_COLORS.length],
      sort_order: (entryCategories?.length ?? 0) + 1,
      created_at: now,
      updated_at: now,
    }

    await handleSaveCategory(category)
  }

  const handleDeleteCategory = async (category: EntryCategory) => {
    await db.entryCategories.delete(category.id)
    await enqueueOutbox({
      method: 'DELETE',
      endpoint: `/entry-categories/${category.id}`,
      payload: null,
      created_at: new Date().toISOString(),
      entity_type: 'entry_categories',
      entity_id: category.id,
      operation: 'delete',
      base_updated_at: category.updated_at ?? null,
    })

    void runSync()
  }

  const handleSavePaymentMethod = async (method: PaymentMethod) => {
    const existing = await db.paymentMethods.get(method.id)
    const baseUpdatedAt = existing?.updated_at ?? null
    await db.paymentMethods.put(method)
    await enqueueOutbox({
      method: 'POST',
      endpoint: '/payment-methods',
      payload: {
        id: method.id,
        name: method.name,
        type: method.type,
        icon_key: method.icon_key ?? null,
        color: method.color ?? null,
        card_closing_day: normalizeDayOfMonth(method.card_closing_day),
        card_payment_day: normalizeDayOfMonth(method.card_payment_day),
        linked_bank_payment_method_id: method.linked_bank_payment_method_id ?? null,
        sort_order: method.sort_order,
        base_updated_at: baseUpdatedAt,
      },
      created_at: new Date().toISOString(),
      entity_type: 'payment_methods',
      entity_id: method.id,
      operation: 'upsert',
      base_updated_at: baseUpdatedAt,
    })

    void runSync()
  }

  const handleAddPaymentMethod = async (params: {
    name: string
    type: string
    cardClosingDay: number | null
    cardPaymentDay: number | null
    linkedBankPaymentMethodId: string | null
  }) => {
    const now = new Date().toISOString()
    const normalizedType = getPaymentType(params.type)
    const maxSortOrder = orderedPaymentMethods.reduce((max, item) => Math.max(max, item.sort_order), 0)
    const method: PaymentMethod = {
      id: crypto.randomUUID(),
      family_id: getFamilyId(),
      name: params.name,
      type: normalizedType,
      icon_key: getPaymentFallbackIconKey(normalizedType),
      color: PAYMENT_DEFAULT_COLORS[normalizedType],
      card_closing_day: normalizedType === 'card' ? params.cardClosingDay : null,
      card_payment_day: normalizedType === 'card' ? params.cardPaymentDay : null,
      linked_bank_payment_method_id: normalizedType === 'card' ? params.linkedBankPaymentMethodId : null,
      sort_order: maxSortOrder + 1,
      created_at: now,
      updated_at: now,
    }

    await handleSavePaymentMethod(method)
  }

  const handleDeletePaymentMethod = async (method: PaymentMethod) => {
    await db.paymentMethods.delete(method.id)
    await enqueueOutbox({
      method: 'DELETE',
      endpoint: `/payment-methods/${method.id}`,
      payload: null,
      created_at: new Date().toISOString(),
      entity_type: 'payment_methods',
      entity_id: method.id,
      operation: 'delete',
      base_updated_at: method.updated_at ?? null,
    })

    void runSync()
  }

  const handleSaveRecurringRule = async (recurringRule: RecurringRule) => {
    const existing = await db.recurringRules.get(recurringRule.id)
    const baseUpdatedAt = existing?.updated_at ?? null
    await db.recurringRules.put(recurringRule)
    await enqueueOutbox({
      method: 'POST',
      endpoint: '/recurring-rules',
      payload: {
        id: recurringRule.id,
        entry_type: recurringRule.entry_type,
        amount: recurringRule.amount,
        entry_category_id: recurringRule.entry_category_id,
        payment_method_id: recurringRule.payment_method_id,
        memo: recurringRule.memo,
        frequency: recurringRule.frequency,
        day_of_month: recurringRule.day_of_month,
        start_at: recurringRule.start_at,
        end_at: recurringRule.end_at,
        is_active: recurringRule.is_active,
        holiday_adjustment: recurringRule.holiday_adjustment ?? 'none',
        base_updated_at: baseUpdatedAt,
      },
      created_at: new Date().toISOString(),
      entity_type: 'recurring_rules',
      entity_id: recurringRule.id,
      operation: 'upsert',
      base_updated_at: baseUpdatedAt,
    })

    void runSync()
  }

  const handleDeleteRecurringRule = async (rule: RecurringRule) => {
    await db.recurringRules.delete(rule.id)
    await enqueueOutbox({
      method: 'DELETE',
      endpoint: `/recurring-rules/${rule.id}`,
      payload: null,
      created_at: new Date().toISOString(),
      entity_type: 'recurring_rules',
      entity_id: rule.id,
      operation: 'delete',
      base_updated_at: rule.updated_at ?? null,
    })

    void runSync()
  }

  const handleAddRecurringRule = async (rule: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    frequency: string
    dayOfMonth: number | null
    holidayAdjustment: HolidayAdjustment
    startAt: string
  }) => {
    const now = new Date().toISOString()
    const recurringRule: RecurringRule = {
      id: crypto.randomUUID(),
      family_id: getFamilyId(),
      entry_type: rule.entryType,
      amount: rule.amount,
      entry_category_id: rule.entryCategoryId,
      payment_method_id: rule.paymentMethodId,
      memo: rule.memo,
      frequency: rule.frequency,
      day_of_month: rule.dayOfMonth,
      holiday_adjustment: rule.holidayAdjustment,
      start_at: rule.startAt,
      end_at: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    }

    await handleSaveRecurringRule(recurringRule)
  }

  const handleOpenPage = (next: PageKey) => {
    setReturnPage(page === 'main' || page === 'balance' ? page : 'main')
    if (next === 'payment-settings') {
      setPaymentReturnPage(page === 'balance' ? 'balance' : 'main')
    }
    setPage(next)
    setMenuOpen(false)
  }

  const handleOpenPayment = (type: PaymentType) => {
    setPaymentType(type)
    setPaymentReturnPage(page === 'balance' ? 'balance' : 'main')
    setPage('payment-settings')
    setMenuOpen(false)
  }

  const handleOpenEntryInput = (seed: EntryInputSeed, tab: TabKey = activeTab) => {
    setReturnPage(page === 'main' || page === 'balance' ? page : 'main')
    setReturnTab(tab)
    setPreferredEntryType(seed.entryType)
    setEntrySeed(seed)
    setPage('entry-input')
    setMenuOpen(false)
  }

  const handleOpenReportCategoryEntities = (seed: ReportCategoryEntitySeed) => {
    setReturnPage('main')
    setReportCategorySeed(seed)
    setPage('report-category-entities')
    setMenuOpen(false)
  }

  const handleOpenPaymentMethodEntities = (seed: PaymentMethodEntitySeed) => {
    setReturnPage('balance')
    setPaymentMethodSeed(seed)
    setPage('payment-method-entities')
    setMenuOpen(false)
  }

  const handleBack = () => {
    if (page === 'payment-settings') {
      setPage(paymentReturnPage)
      return
    }
    if (page === 'report-category-entities') {
      setReportCategorySeed(null)
      setPage(returnPage)
      return
    }
    if (page === 'payment-method-entities') {
      setPaymentMethodSeed(null)
      setPage(returnPage)
      return
    }
    if (page === 'entry-input') {
      setEntrySeed(null)
      setPage(returnPage)
      if (returnPage === 'main') {
        setActiveTab(returnTab)
      }
      return
    }

    setPage(returnPage)
  }

  const showIconBar = page === 'main' || page === 'balance'
  const iconActive = page === 'balance' ? 'balance' : activeTab
  const entryInputTitle = entrySeed?.entryType === 'income' ? '収入の入力' : '支出の入力'
  const headerTitle =
    page === 'entry-input'
      ? entryInputTitle
      : page === 'payment-settings'
        ? PAGE_TITLES['payment-settings']
        : page === 'report-category-entities'
          ? reportCategorySeed?.categoryName ?? PAGE_TITLES[page]
          : page === 'payment-method-entities'
            ? paymentMethodSeed?.methodName ?? PAGE_TITLES[page]
        : page === 'main'
          ? TAB_LABELS[activeTab]
          : PAGE_TITLES[page]
  const showSync = page === 'main' || page === 'balance'

  if (authStatus !== 'ready') {
    return (
      <AuthScreen
        status={authStatus}
        onLogin={handleLogin}
        error={authError}
      />
    )
  }

  return (
    <div className="app">
      <header className="top-bar">
        {page === 'main' || page === 'balance' ? (
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="menu">
            ☰
          </button>
        ) : (
          <button className="icon-button" onClick={handleBack} aria-label="back">
            ←
          </button>
        )}
        <div className="title-group">
          <h1>{headerTitle}</h1>
        </div>
        {showSync ? (
          <button className="ghost" onClick={handleSync} disabled={syncing}>
            {syncing
              ? '同期中'
              : deadLetterCount > 0
                ? `要対応 (${deadLetterCount})`
                : `更新${outboxCount ? ` (${outboxCount})` : ''}`}
          </button>
        ) : (
          <div />
        )}
      </header>

      {showIconBar && (
        <nav className="icon-bar">
          <button
            className={iconActive === 'home' ? 'active' : ''}
            onClick={() => {
              setPage('main')
              setActiveTab('home')
            }}
            aria-label="入力"
          >
            <IconPencil />
          </button>
          <button
            className={iconActive === 'history' ? 'active' : ''}
            onClick={() => {
              setPage('main')
              setActiveTab('history')
            }}
            aria-label="履歴"
          >
            <IconCalendar />
          </button>
          <button
            className={iconActive === 'reports' ? 'active' : ''}
            onClick={() => {
              setPage('main')
              setActiveTab('reports')
            }}
            aria-label="集計"
          >
            <IconChart />
          </button>
          <button
            className={iconActive === 'balance' ? 'active' : ''}
            onClick={() => setPage('balance')}
            aria-label="残高"
          >
            <IconCard />
          </button>
        </nav>
      )}

      <main className="content">
        {page === 'main' && activeTab === 'home' && (
          <HomeTab
            entries={entries ?? []}
            categories={entryCategories ?? []}
            paymentMethods={paymentOptions}
            monthlyBalanceMap={monthlyBalanceMap}
            entryType={preferredEntryType}
            onEntryTypeChange={setPreferredEntryType}
            onOpenCategorySettings={() => handleOpenPage('category-settings')}
            onOpenEntryInput={handleOpenEntryInput}
          />
        )}
        {page === 'main' && activeTab === 'history' && (
          <HistoryTab
            entries={entries ?? []}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            monthlyBalanceMap={monthlyBalanceMap}
            recurringRules={recurringRules ?? []}
            currentMonthYm={historyMonthYm}
            onChangeMonthYm={setHistoryMonthYm}
            defaultEntryType={preferredEntryType}
            defaultPaymentMethodId={orderedPaymentMethods[0]?.id ?? null}
            onOpenEntryInput={handleOpenEntryInput}
            onEdit={(entry) =>
              handleOpenEntryInput(
                {
                  id: entry.id,
                  entryType: entry.entry_type,
                  amount: entry.amount,
                  entryCategoryId: entry.entry_category_id,
                  paymentMethodId: entry.payment_method_id,
                  memo: entry.memo,
                  occurredAt: entry.occurred_at,
                  createdAt: entry.created_at,
                  updatedAt: entry.updated_at,
                  recurringRuleId: entry.recurring_rule_id,
                  createdByUserId: entry.created_by_user_id ?? null,
                  createdByUserName: entry.created_by_user_name ?? null,
                  createdByAvatarUrl: entry.created_by_avatar_url ?? null,
                },
                'history'
              )
            }
          />
        )}
        {page === 'main' && activeTab === 'reports' && (
          <ReportsTab
            entries={entries ?? []}
            categories={entryCategories ?? []}
            monthlyBalanceMap={monthlyBalanceMap}
            onOpenCategoryEntities={handleOpenReportCategoryEntities}
          />
        )}
        {page === 'balance' && (
          <BalancePage
            entries={entries ?? []}
            monthlyBalanceMap={monthlyBalanceMap}
            paymentMethods={orderedPaymentMethods}
            onOpenPayment={handleOpenPayment}
            onOpenPaymentMethodEntities={handleOpenPaymentMethodEntities}
          />
        )}
        {page === 'entry-input' && entrySeed && (
          <EntryInputPage
            key={`${entrySeed.id ?? 'new'}-${entrySeed.occurredAt}`}
            seed={entrySeed}
            categories={entryCategories ?? []}
            paymentMethods={orderedPaymentMethods}
            onSave={(payload) => {
              void handleSaveEntry(payload)
              handleBack()
            }}
            onDelete={(entryId) => {
              void handleDeleteEntry(entryId)
              handleBack()
            }}
            onEntryTypeChange={(nextType) => {
              setEntrySeed((prev) => (prev ? { ...prev, entryType: nextType } : prev))
            }}
          />
        )}
        {page === 'category-settings' && (
          <CategorySettingsPage
            categories={entryCategories ?? []}
            onAdd={handleAddCategory}
            onSave={handleSaveCategory}
            onDelete={handleDeleteCategory}
          />
        )}
        {page === 'recurring-settings' && (
          <RecurringSettingsPage
            rules={recurringRules ?? []}
            categories={entryCategories ?? []}
            paymentMethods={orderedPaymentMethods}
            onAdd={handleAddRecurringRule}
            onSave={handleSaveRecurringRule}
            onDelete={handleDeleteRecurringRule}
          />
        )}
        {page === 'payment-settings' && (
          <PaymentSettingsPage
            defaultType={paymentType}
            paymentMethods={orderedPaymentMethods}
            onAdd={handleAddPaymentMethod}
            onSave={handleSavePaymentMethod}
            onDelete={handleDeletePaymentMethod}
          />
        )}
        {page === 'report-category-entities' && reportCategorySeed && (
          <ReportCategoryEntitiesPage
            seed={reportCategorySeed}
            entries={entries ?? []}
            categoryMap={categoryMap}
            paymentMethods={orderedPaymentMethods}
          />
        )}
        {page === 'payment-method-entities' && paymentMethodSeed && (
          <PaymentMethodEntitiesPage
            seed={paymentMethodSeed}
            entries={entries ?? []}
            categoryMap={categoryMap}
            paymentMethods={orderedPaymentMethods}
          />
        )}
      </main>

      <div className={`side-menu ${menuOpen ? 'open' : ''}`}>
        <div className="menu-brand">
          <div className="menu-brand-row">
            <strong>Kakeibo</strong>
            <span className="menu-version">v{APP_VERSION}</span>
          </div>
        </div>
        <div className="menu-list">
          <MenuItem icon={<IconFolder />} label="カテゴリ設定" onClick={() => handleOpenPage('category-settings')} />
          <MenuItem
            icon={renderMaterialIcon('autorenew')}
            label="定期的な収入/支出"
            onClick={() => handleOpenPage('recurring-settings')}
          />
          <MenuItem icon={<IconSettings />} label="支払い設定" onClick={() => handleOpenPage('payment-settings')} />
          <MenuItem icon={renderMaterialIcon('logout')} label="ログアウト（データ削除）" onClick={handleLogout} variant="danger" />
        </div>
      </div>

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}

      {toast && (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}
      {syncFailureLog && (
        <div className="sync-error-copy-wrap">
          <button className="sync-error-copy-button" onClick={handleCopySyncFailureLog}>
            {deadLetterCount > 0 ? `同期エラー詳細をコピー (${deadLetterCount})` : '同期ログをコピー'}
          </button>
        </div>
      )}
    </div>
  )
}

type MenuItemProps = {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}

const MenuItem = ({ icon, label, onClick, disabled, variant = 'default' }: MenuItemProps) => (
  <button className={`menu-item ${disabled ? 'disabled' : ''} ${variant}`} onClick={onClick} disabled={disabled}>
    <span className="menu-icon">{icon}</span>
    <span>{label}</span>
  </button>
)

type HomeTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
  paymentMethods: SelectOption[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  entryType: EntryType
  onEntryTypeChange: (entryType: EntryType) => void
  onOpenCategorySettings: () => void
  onOpenEntryInput: (seed: EntryInputSeed, tab?: TabKey) => void
}

const HomeTab = ({
  entries,
  categories,
  paymentMethods,
  monthlyBalanceMap,
  entryType,
  onEntryTypeChange,
  onOpenCategorySettings,
  onOpenEntryInput,
}: HomeTabProps) => {
  const currentMonthKey = dayjs().format('YYYY-MM')
  const balanceYm = dayjs(currentMonthKey).subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const visibleCategories = useMemo(() => {
    return categories.filter((category) => category.type === entryType)
  }, [categories, entryType])

  const monthSummary = useMemo(() => {
    const current = dayjs()
    const start = current.startOf('month')
    const end = current.endOf('month')

    let income = 0
    let expense = 0

    entries.forEach((entry) => {
      const date = dayjs(entry.occurred_at)
      if (date.isBefore(start) || date.isAfter(end)) return
      if (entry.entry_type === 'income') {
        income += entry.amount
      } else {
        expense += entry.amount
      }
    })

    const carryover = carryoverBalance ?? 0
    return { income, expense, balance: carryover + income - expense }
  }, [entries, carryoverBalance])

  const totalForRatio = monthSummary.income + monthSummary.expense
  const ratio = totalForRatio > 0 ? monthSummary.expense / totalForRatio : 0
  const isNegative = monthSummary.balance < 0

  return (
    <section className="card">
      <div className="summary-panel">
        <span>収支</span>
        <strong>¥{formatAmount(monthSummary.balance)}</strong>
      </div>
      <div className={`summary-progress ${isNegative ? 'negative' : ''}`}>
        <span style={{ width: `${isNegative ? 100 : Math.min(100, ratio * 100)}%` }} />
      </div>

      <div className="pill-toggle">
        <button
          type="button"
          className={entryType === 'income' ? 'active' : ''}
          onClick={() => onEntryTypeChange('income')}
        >
          収入
        </button>
        <button
          type="button"
          className={entryType === 'expense' ? 'active' : ''}
          onClick={() => onEntryTypeChange('expense')}
        >
          支出
        </button>
      </div>

      <div className="category-grid">
        {visibleCategories.length === 0 && <p className="muted">カテゴリがありません</p>}
        {visibleCategories.map((category, index) => {
          const color = category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
          const icon = getCategoryIcon(category.icon_key)
          return (
            <button
              type="button"
              key={category.id}
              className="category-card"
              onClick={() =>
                onOpenEntryInput(
                  {
                    entryType,
                    amount: 0,
                    entryCategoryId: category.id,
                    paymentMethodId: paymentMethods[0]?.value ?? null,
                    memo: null,
                    occurredAt: new Date().toISOString(),
                  },
                  'home'
                )
              }
            >
              <span className="category-icon" style={{ background: color }}>
                {icon ?? <span className="category-fallback">{category.name.slice(0, 1)}</span>}
              </span>
              <span className="category-label">{category.name}</span>
            </button>
          )
        })}
        <button type="button" className="category-card settings" onClick={onOpenCategorySettings}>
          <span className="category-icon">{renderMaterialIcon('folder')}</span>
          <span className="category-label">カテゴリ設定</span>
        </button>
      </div>
    </section>
  )
}

type CalcOperator = '+' | '-' | '*' | '/'

const applyOperator = (left: number, right: number, operator: CalcOperator) => {
  if (operator === '+') return left + right
  if (operator === '-') return left - right
  if (operator === '*') return left * right
  if (operator === '/') return right === 0 ? left : left / right
  return right
}

type EntryInputPageProps = {
  seed: EntryInputSeed
  categories: EntryCategory[]
  paymentMethods: PaymentMethod[]
  onSave: (payload: EntryInputSeed) => void
  onDelete?: (entryId: string) => void
  onEntryTypeChange?: (entryType: EntryType) => void
}

const EntryInputPage = ({
  seed,
  categories,
  paymentMethods,
  onSave,
  onDelete,
  onEntryTypeChange,
}: EntryInputPageProps) => {
  const initialMemo = splitMemo(seed.memo)
  const [entryType, setEntryType] = useState<EntryType>(seed.entryType)
  const [entryCategoryId, setEntryCategoryId] = useState(seed.entryCategoryId ?? '')
  const [paymentMethodId, setPaymentMethodId] = useState(seed.paymentMethodId ?? '')
  const [place, setPlace] = useState(initialMemo.place)
  const [memo, setMemo] = useState(initialMemo.memo)
  const [dateValue, setDateValue] = useState(dayjs(seed.occurredAt).format('YYYY-MM-DD'))
  const [timeValue, setTimeValue] = useState(dayjs(seed.occurredAt).format('HH:mm'))
  const [displayValue, setDisplayValue] = useState(seed.amount ? String(seed.amount) : '0')
  const [accumulator, setAccumulator] = useState<number | null>(null)
  const [pendingOperator, setPendingOperator] = useState<CalcOperator | null>(null)
  const [freshInput, setFreshInput] = useState(!seed.amount)
  const [operationUsed, setOperationUsed] = useState(false)
  const [awaitingSubmit, setAwaitingSubmit] = useState(false)
  const [showCategorySheet, setShowCategorySheet] = useState(false)
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [categorySheetType, setCategorySheetType] = useState<EntryType>(seed.entryType)

  const categoriesByType = useMemo(
    () => ({
      income: categories.filter((category) => category.type === 'income'),
      expense: categories.filter((category) => category.type === 'expense'),
    }),
    [categories]
  )
  const visibleCategories = categoriesByType[entryType]
  const resolvedEntryCategoryId = visibleCategories.some((category) => category.id === entryCategoryId)
    ? entryCategoryId
    : ''
  const selectedCategory = visibleCategories.find((category) => category.id === resolvedEntryCategoryId)
  const isEditing = Boolean(seed.id)

  const dateTime = useMemo(() => {
    return dayjs(`${dateValue}T${timeValue}`)
  }, [dateValue, timeValue])

  const handleAppend = (value: string) => {
    if (awaitingSubmit) {
      setAwaitingSubmit(false)
      setOperationUsed(false)
      setAccumulator(null)
      setPendingOperator(null)
      setFreshInput(true)
    }
    setDisplayValue((prev) => {
      if (value === '.') {
        if (prev.includes('.')) return prev
        if (freshInput || prev === '0') return '0.'
        return `${prev}.`
      }
      if (freshInput || prev === '0') {
        if (value === '00') return '0'
        return value
      }
      return prev + value
    })
    setFreshInput(false)
  }

  const handleOperator = (operator: CalcOperator) => {
    setOperationUsed(true)
    setAwaitingSubmit(false)
    const current = Number(displayValue)
    if (accumulator === null) {
      setAccumulator(current)
      setPendingOperator(operator)
      setFreshInput(true)
      return
    }
    if (pendingOperator) {
      const result = applyOperator(accumulator, current, pendingOperator)
      setAccumulator(result)
      setDisplayValue(String(Math.round(result)))
      setPendingOperator(operator)
      setFreshInput(true)
      return
    }
    setPendingOperator(operator)
    setFreshInput(true)
  }

  const handleClear = () => {
    setDisplayValue('0')
    setAccumulator(null)
    setPendingOperator(null)
    setFreshInput(true)
    setOperationUsed(false)
    setAwaitingSubmit(false)
  }

  const handleBackspace = () => {
    if (freshInput) {
      setFreshInput(false)
    }
    setDisplayValue((prev) => {
      if (prev.length <= 1) return '0'
      return prev.slice(0, -1)
    })
  }

  const handleEquals = () => {
    const result = computeResult()
    if (!Number.isFinite(result)) return
    setDisplayValue(String(Math.round(result)))
    setAccumulator(null)
    setPendingOperator(null)
    setFreshInput(true)
    setOperationUsed(false)
    setAwaitingSubmit(true)
  }

  const computeResult = () => {
    const current = Number(displayValue)
    if (accumulator !== null && pendingOperator) {
      return applyOperator(accumulator, current, pendingOperator)
    }
    return current
  }

  const handleSubmit = () => {
    const result = computeResult()
    if (!Number.isFinite(result) || result <= 0) return
    const payloadMemo = combineMemo(place, memo)
    onSave({
      id: seed.id,
      entryType,
      amount: Math.round(result),
      entryCategoryId: resolvedEntryCategoryId || null,
      paymentMethodId: paymentMethodId || null,
      memo: payloadMemo,
      occurredAt: dateTime.toISOString(),
      createdAt: seed.createdAt,
      updatedAt: seed.updatedAt,
      recurringRuleId: seed.recurringRuleId ?? null,
      createdByUserId: seed.createdByUserId ?? null,
      createdByUserName: seed.createdByUserName ?? null,
      createdByAvatarUrl: seed.createdByAvatarUrl ?? null,
    })
  }

  const baseLabel = isEditing ? '編集' : '入力'
  const primaryLabel = operationUsed && !awaitingSubmit ? '=' : baseLabel

  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethodId) ?? null
  const paymentLabel = selectedPaymentMethod?.name ?? '支払い方法を選択'

  const handleApplyEntryType = (nextType: EntryType) => {
    setEntryType(nextType)
    const nextCategories = categoriesByType[nextType]
    setEntryCategoryId((current) => {
      if (!current) return ''
      return nextCategories.some((category) => category.id === current) ? current : ''
    })
    onEntryTypeChange?.(nextType)
  }

  const handleOpenCategorySheet = () => {
    setCategorySheetType(entryType)
    setShowCategorySheet(true)
  }

  const handlePickCategory = (nextType: EntryType, nextCategoryId: string | null) => {
    handleApplyEntryType(nextType)
    setEntryCategoryId(nextCategoryId ?? '')
    setCategorySheetType(nextType)
    setShowCategorySheet(false)
  }

  const handlePickPaymentMethod = (nextPaymentMethodId: string | null) => {
    setPaymentMethodId(nextPaymentMethodId ?? '')
    setShowPaymentSheet(false)
  }

  return (
    <section className="card entry-input">
      <div className="entry-meta">
        <label className="entry-meta-field entry-meta-field-date">
          <span className="entry-meta-label">日付</span>
          <input
            type="date"
            className="entry-meta-input entry-meta-input-date"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
          />
        </label>
        <label className="entry-meta-field entry-meta-field-time">
          <span className="entry-meta-label">時間</span>
          <input
            type="time"
            className="entry-meta-input entry-meta-input-time"
            value={timeValue}
            onChange={(event) => setTimeValue(event.target.value)}
          />
        </label>
      </div>

      <div className="entry-row">
        <span
          className="category-icon entry-row-icon"
          style={{ background: selectedCategory?.color ?? '#d9554c' }}
        >
          {selectedCategory ? getCategoryIcon(selectedCategory.icon_key) ?? selectedCategory.name.slice(0, 1) : '?'}
        </span>
        <div className="entry-row-controls">
          <button type="button" className="entry-category-trigger" onClick={handleOpenCategorySheet}>
            <span className="entry-inline-label">カテゴリ</span>
            <span className="entry-category-name">{selectedCategory?.name ?? 'カテゴリを選択'}</span>
            <span className="entry-category-arrow">{renderMaterialIcon('expand_more')}</span>
          </button>
        </div>
      </div>

      <div className="entry-fields">
        <input
          type="text"
          placeholder="お店/場所"
          value={place}
          onChange={(event) => setPlace(event.target.value)}
        />
        <input type="text" placeholder="メモ" value={memo} onChange={(event) => setMemo(event.target.value)} />
      </div>

      <div className="calc-display">
        <button type="button" className="calc-action" onClick={handleClear}>
          C
        </button>
        <span className="calc-value">¥{formatAmount(Number(displayValue) || 0)}</span>
        <button type="button" className="calc-action" onClick={handleBackspace}>
          ←
        </button>
      </div>

      <div className="calc-keypad">
        {['7', '8', '9'].map((value) => (
          <button key={value} type="button" className="calc-key" onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className="calc-key operator" onClick={() => handleOperator('/')}>
          ÷
        </button>
        {['4', '5', '6'].map((value) => (
          <button key={value} type="button" className="calc-key" onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className="calc-key operator" onClick={() => handleOperator('*')}>
          ×
        </button>
        {['1', '2', '3'].map((value) => (
          <button key={value} type="button" className="calc-key" onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className="calc-key operator" onClick={() => handleOperator('-')}>
          -
        </button>
        <button type="button" className="calc-key" onClick={() => handleAppend('00')}>
          00
        </button>
        <button type="button" className="calc-key" onClick={() => handleAppend('0')}>
          0
        </button>
        <button type="button" className="calc-key" onClick={() => handleAppend('.')}>
          .
        </button>
        <button type="button" className="calc-key operator" onClick={() => handleOperator('+')}>
          +
        </button>
      </div>

      <div className={`entry-actions ${isEditing ? 'editing' : ''}`}>
        <button type="button" className="entry-method" onClick={() => setShowPaymentSheet(true)}>
          {paymentLabel}
        </button>
        {isEditing && (
          <button
            type="button"
            className="entry-delete"
            aria-label="削除"
            onClick={() => {
              if (seed.id) onDelete?.(seed.id)
            }}
          >
            {renderMaterialIcon('delete')}
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={primaryLabel === '=' ? handleEquals : handleSubmit}
        >
          {primaryLabel}
        </button>
      </div>

      {showCategorySheet && (
        <div
          className="sheet"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowCategorySheet(false)
            }
          }}
        >
          <div className="sheet-card entry-category-sheet" role="dialog" aria-modal="true" aria-label="カテゴリ選択">
            <h3>カテゴリ選択</h3>
            <div className="pill-toggle entry-type-toggle">
              <button
                type="button"
                className={categorySheetType === 'expense' ? 'active' : ''}
                onClick={() => setCategorySheetType('expense')}
              >
                支出
              </button>
              <button
                type="button"
                className={categorySheetType === 'income' ? 'active' : ''}
                onClick={() => setCategorySheetType('income')}
              >
                収入
              </button>
            </div>
            <ul className="entry-category-options">
              <li>
                <button
                  type="button"
                  className={`entry-category-option ${
                    categorySheetType === entryType && !resolvedEntryCategoryId ? 'active' : ''
                  }`}
                  onClick={() => handlePickCategory(categorySheetType, null)}
                >
                  <span className="category-icon entry-category-option-icon" style={{ background: '#8f9499' }}>
                    {renderMaterialIcon('category')}
                  </span>
                  <span className="entry-category-option-name">未分類</span>
                  <span className="entry-category-option-check">
                    {categorySheetType === entryType && !resolvedEntryCategoryId ? renderMaterialIcon('check') : null}
                  </span>
                </button>
              </li>
              {categoriesByType[categorySheetType].map((category, index) => {
                const color = category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                const isActive = categorySheetType === entryType && category.id === resolvedEntryCategoryId
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      className={`entry-category-option ${isActive ? 'active' : ''}`}
                      onClick={() => handlePickCategory(categorySheetType, category.id)}
                    >
                      <span className="category-icon entry-category-option-icon" style={{ background: color }}>
                        {getCategoryIcon(category.icon_key) ?? (
                          <span className="category-fallback">{category.name.slice(0, 1)}</span>
                        )}
                      </span>
                      <span className="entry-category-option-name">{category.name}</span>
                      <span className="entry-category-option-check">{isActive ? renderMaterialIcon('check') : null}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setShowCategorySheet(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentSheet && (
        <div
          className="sheet"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowPaymentSheet(false)
            }
          }}
        >
          <div className="sheet-card entry-payment-sheet" role="dialog" aria-modal="true" aria-label="支払い方法選択">
            <h3>支払い方法選択</h3>
            <ul className="entry-payment-options">
              <li>
                <button
                  type="button"
                  className={`entry-payment-option ${!paymentMethodId ? 'active' : ''}`}
                  onClick={() => handlePickPaymentMethod(null)}
                >
                  <span
                    className="entry-payment-option-icon"
                    style={{ background: PAYMENT_DEFAULT_COLORS.cash, color: '#fff' }}
                  >
                    {renderMaterialIcon('payments')}
                  </span>
                  <span className="entry-payment-option-text">
                    <strong>未設定</strong>
                    <span>支払い方法を設定しない</span>
                  </span>
                  <span className="entry-payment-option-check">{!paymentMethodId ? renderMaterialIcon('check') : null}</span>
                </button>
              </li>
              {paymentMethods.map((method) => {
                const isActive = method.id === paymentMethodId
                return (
                  <li key={method.id}>
                    <button
                      type="button"
                      className={`entry-payment-option ${isActive ? 'active' : ''}`}
                      onClick={() => handlePickPaymentMethod(method.id)}
                    >
                      <span
                        className="entry-payment-option-icon"
                        style={{ background: getPaymentColor(method), color: '#fff' }}
                      >
                        {getPaymentIcon(method)}
                      </span>
                      <span className="entry-payment-option-text">
                        <strong>{method.name}</strong>
                        <span>{paymentTypeLabel(method.type)}</span>
                      </span>
                      <span className="entry-payment-option-check">{isActive ? renderMaterialIcon('check') : null}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setShowPaymentSheet(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type HistoryTabProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  monthlyBalanceMap: Map<string, MonthlyBalance>
  recurringRules: RecurringRule[]
  currentMonthYm: string
  onChangeMonthYm: (ym: string) => void
  onEdit: (entry: Entry) => void
  onOpenEntryInput: (seed: EntryInputSeed, tab?: TabKey) => void
  defaultEntryType: EntryType
  defaultPaymentMethodId: string | null
}

const HistoryTab = ({
  entries,
  categoryMap,
  paymentMap,
  monthlyBalanceMap,
  recurringRules,
  currentMonthYm,
  onChangeMonthYm,
  onEdit,
  onOpenEntryInput,
  defaultEntryType,
  defaultPaymentMethodId,
}: HistoryTabProps) => {
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const currentMonth = useMemo(() => parseMonthYm(currentMonthYm), [currentMonthYm])
  const [selectedDate, setSelectedDate] = useState(() => getDefaultSelectedDateForMonth(parseMonthYm(currentMonthYm)))
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
  const displayYm = currentMonth.format('YYYY-MM')
  const balanceYm = currentMonth.subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const monthEntries = useMemo(() => {
    return entries.filter((entry) => dayjs(getEntryDateKey(entry)).isSame(currentMonth, 'month'))
  }, [entries, currentMonth])

  const plannedItems = useMemo<HistoryItem[]>(() => {
    if (!recurringRules.length) return []
    const { start, end } = getRangeBounds('month', currentMonth)
    const existingKeys = new Set(
      entries
        .filter((entry) => entry.recurring_rule_id)
        .map((entry) => `${entry.recurring_rule_id}:${entry.occurred_on ?? toTokyoDateString(entry.occurred_at)}`)
    )
    return buildRecurringOccurrences(recurringRules, 'month', currentMonth)
      .filter((occurrence) => {
        if (occurrence.date.isBefore(start) || occurrence.date.isAfter(end)) return false
        const key = `${occurrence.rule.id}:${occurrence.date.format('YYYY-MM-DD')}`
        return !existingKeys.has(key)
      })
      .map((occurrence) => ({
        id: `planned-${occurrence.rule.id}-${occurrence.date.format('YYYY-MM-DD')}`,
        family_id: occurrence.rule.family_id,
        entry_type: occurrence.rule.entry_type,
        amount: occurrence.rule.amount,
        entry_category_id: occurrence.rule.entry_category_id,
        payment_method_id: occurrence.rule.payment_method_id,
        memo: occurrence.rule.memo,
        occurred_at: occurrence.date.toISOString(),
        occurred_on: occurrence.date.format('YYYY-MM-DD'),
        recurring_rule_id: occurrence.rule.id,
        created_at: occurrence.date.toISOString(),
        updated_at: occurrence.date.toISOString(),
        is_planned: true,
      }))
  }, [recurringRules, currentMonth, entries])

  const carryoverEntry = useMemo<HistoryItem | null>(() => {
    if (carryoverBalance === null) return null
    const date = `${displayYm}-01`
    const baseDate = dayjs(date).startOf('day').toISOString()
    const entryType: EntryType = carryoverBalance >= 0 ? 'income' : 'expense'
    return {
      id: `carryover-${displayYm}`,
      family_id: getFamilyId(),
      entry_type: entryType,
      amount: Math.abs(carryoverBalance),
      entry_category_id: null,
      payment_method_id: null,
      memo: '繰越し',
      occurred_at: baseDate,
      occurred_on: date,
      recurring_rule_id: null,
      created_at: baseDate,
      updated_at: baseDate,
      is_carryover: true,
    }
  }, [carryoverBalance, displayYm])

  const handleChangeMonth = (delta: number) => {
    const next = currentMonth.add(delta, 'month').startOf('month')
    onChangeMonthYm(next.format('YYYY-MM'))
    setSelectedDate(getDefaultSelectedDateForMonth(next))
  }

  const monthTotals = useMemo(() => {
    const byDay = new Map<string, DayTotals>()
    let income = 0
    let expense = 0

    monthEntries.forEach((entry) => {
      const dateKey = getEntryDateKey(entry)
      const current = byDay.get(dateKey) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
        income += entry.amount
      } else {
        current.expense += entry.amount
        expense += entry.amount
      }
      byDay.set(dateKey, current)
    })

    return { income, expense, byDay }
  }, [monthEntries])

  const calendarDays = useMemo(
    () => buildCalendar(currentMonth, monthTotals.byDay),
    [currentMonth, monthTotals]
  )

  const groupedEntries = useMemo(() => {
    const map = new Map<
      string,
      {
        date: dayjs.Dayjs
        entries: HistoryItem[]
        planned: HistoryItem[]
        carryover: HistoryItem[]
        totals: { income: number; expense: number }
      }
    >()
    monthEntries.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(entry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.entries.push(entry)
      if (entry.entry_type === 'income') {
        current.totals.income += entry.amount
      } else {
        current.totals.expense += entry.amount
      }
      map.set(key, current)
    })
    plannedItems.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(entry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.planned.push(entry)
      map.set(key, current)
    })
    if (carryoverEntry) {
      const key = getEntryDateKey(carryoverEntry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(carryoverEntry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.carryover.push(carryoverEntry)
      if (carryoverEntry.entry_type === 'income') {
        current.totals.income += carryoverEntry.amount
      } else {
        current.totals.expense += carryoverEntry.amount
      }
      map.set(key, current)
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort(
          (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
        ),
        planned: group.planned.sort(
          (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
        ),
      }))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())
  }, [monthEntries, plannedItems, carryoverEntry])

  const selectedEntries = useMemo<HistoryItem[]>(() => {
    const actual = monthEntries
      .filter((entry) => getEntryDateKey(entry) === selectedDate)
      .map((entry) => ({ ...entry, is_planned: false }))
    const planned = plannedItems.filter(
      (entry) => getEntryDateKey(entry) === selectedDate
    )
    const carryover = carryoverEntry && getEntryDateKey(carryoverEntry) === selectedDate ? [carryoverEntry] : []
    return [...carryover, ...actual, ...planned].sort(
      (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
    )
  }, [monthEntries, plannedItems, carryoverEntry, selectedDate])

  const plannedTotals = useMemo(() => {
    const map = new Map<string, DayTotals>()
    plannedItems.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
      } else {
        current.expense += entry.amount
      }
      map.set(key, current)
    })
    return map
  }, [plannedItems])

  const carryoverTotals = useMemo(() => {
    const map = new Map<string, CarryoverDay>()
    if (!carryoverEntry) return map
    map.set(getEntryDateKey(carryoverEntry), {
      entry_type: carryoverEntry.entry_type,
      amount: carryoverEntry.amount,
    })
    return map
  }, [carryoverEntry])

  const selectedTotals = useMemo(() => {
    return selectedEntries.reduce(
      (sum, entry) => {
        if (entry.is_planned) return sum
        if (entry.entry_type === 'income') {
          sum.income += entry.amount
        } else {
          sum.expense += entry.amount
        }
        return sum
      },
      { income: 0, expense: 0 }
    )
  }, [selectedEntries])

  const totalForRatio = monthTotals.income + monthTotals.expense
  const ratio = totalForRatio > 0 ? monthTotals.expense / totalForRatio : 0

  const handleAddFromCalendar = () => {
    const now = dayjs()
    const occurredAt = dayjs(`${selectedDate}T${now.format('HH:mm')}`).toISOString()
    onOpenEntryInput(
      {
        entryType: defaultEntryType,
        amount: 0,
        entryCategoryId: null,
        paymentMethodId: defaultPaymentMethodId,
        memo: null,
        occurredAt,
      },
      'history'
    )
  }

  return (
    <section className="card">
      <div className="month-header">
        <button className="icon-button" onClick={() => handleChangeMonth(-1)}>
          ‹
        </button>
        <h2>{currentMonth.format('YYYY年 M月')}</h2>
        <button className="icon-button" onClick={() => handleChangeMonth(1)}>
          ›
        </button>
      </div>
      <div className="pill-toggle">
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          リスト
        </button>
        <button
          type="button"
          className={view === 'calendar' ? 'active' : ''}
          onClick={() => setView('calendar')}
        >
          カレンダ
        </button>
      </div>

      <div className="summary-panel">
        <span>支出</span>
        <strong>¥{formatAmount(monthTotals.expense)}</strong>
      </div>
      <div className="summary-progress">
        <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>

      {view === 'list' && (
        <ul className="list">
          {groupedEntries.length === 0 && <li className="muted">履歴がありません</li>}
          {groupedEntries.map((group) => (
            <li key={group.date.format('YYYY-MM-DD')} className="entry-group">
              <div className="entry-group-header">
                <strong className="entry-group-date">{`${group.date.format('M/D')} (${weekdayLabels[group.date.day()]})`}</strong>
                <div className="entry-group-totals">
                  <span className="badge income">収入 ¥{formatAmount(group.totals.income)}</span>
                  <span className="badge expense">支出 ¥{formatAmount(group.totals.expense)}</span>
                </div>
              </div>
              <EntryButtonsList
                entries={[...group.carryover, ...group.entries, ...group.planned] as EntryListItem[]}
                categoryMap={categoryMap}
                paymentMap={paymentMap}
                formatAmount={formatAmount}
                getCategoryIcon={getCategoryIcon}
                getPaymentIcon={getPaymentIcon}
                getPaymentColor={getPaymentColor}
                onEdit={onEdit}
                showCreatorBadge
              />
            </li>
          ))}
        </ul>
      )}

      {view === 'calendar' && (
        <div className="calendar">
          <div className="calendar-week">
            {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((cell) => {
              const day = cell.date.day()
              const weekendClass = day === 0 ? 'sunday' : day === 6 ? 'saturday' : ''
              const cellKey = cell.date.format('YYYY-MM-DD')
              const isSelected = cellKey === selectedDate
              const planned = plannedTotals.get(cellKey) ?? { income: 0, expense: 0 }
              const carryover = carryoverTotals.get(cellKey)
              return (
                <button
                  key={cell.date.toISOString()}
                  type="button"
                  className={`calendar-cell ${cell.inMonth ? '' : 'muted'} ${weekendClass} ${
                    isSelected ? 'selected' : ''
                  }`}
                  disabled={!cell.inMonth}
                  onClick={() => {
                    if (cell.inMonth) setSelectedDate(cellKey)
                  }}
                >
                  <span className="calendar-date">{cell.date.date()}</span>
                  {cell.totals.expense > 0 && (
                    <span className="calendar-amount expense">{formatAmount(cell.totals.expense)}</span>
                  )}
                  {cell.totals.income > 0 && (
                    <span className="calendar-amount income">{formatAmount(cell.totals.income)}</span>
                  )}
                  {planned.expense > 0 && (
                    <span className="calendar-amount expense planned">-{formatAmount(planned.expense)}</span>
                  )}
                  {planned.income > 0 && (
                    <span className="calendar-amount income planned">+{formatAmount(planned.income)}</span>
                  )}
                  {carryover && (
                    <span className={`calendar-amount carryover ${carryover.entry_type}`}>
                      {formatAmount(carryover.amount)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {view === 'calendar' && (
        <div className="calendar-detail">
          <div className="entry-group-header">
            <strong className="entry-group-date">{`${dayjs(selectedDate).format('M/D')} (${weekdayLabels[dayjs(selectedDate).day()]})`}</strong>
            <div className="entry-group-totals">
              <span className="badge income">収入 ¥{formatAmount(selectedTotals.income)}</span>
              <span className="badge expense">支出 ¥{formatAmount(selectedTotals.expense)}</span>
            </div>
          </div>
          <EntryButtonsList
            entries={selectedEntries as EntryListItem[]}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            formatAmount={formatAmount}
            getCategoryIcon={getCategoryIcon}
            getPaymentIcon={getPaymentIcon}
            getPaymentColor={getPaymentColor}
            onEdit={onEdit}
            showCreatorBadge
            emptyMessage="この日の明細はありません"
          />
          <button type="button" className="floating-button" onClick={handleAddFromCalendar}>
            +
          </button>
        </div>
      )}
    </section>
  )
}

type ReportsTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  onOpenCategoryEntities: (seed: ReportCategoryEntitySeed) => void
}

const ReportsTab = ({ entries, categories, monthlyBalanceMap, onOpenCategoryEntities }: ReportsTabProps) => {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month')
  const [reportType, setReportType] = useState<EntryType>('expense')
  const [reportOffset, setReportOffset] = useState(0)

  const rangeUnit = range === 'week' ? 'week' : range === 'year' ? 'year' : 'month'
  const baseDate = useMemo(() => dayjs().add(reportOffset, rangeUnit), [reportOffset, rangeUnit])
  const handleRangeChange = (nextRange: 'week' | 'month' | 'year') => {
    setRange(nextRange)
    setReportOffset(0)
  }

  const rangeMonths = useMemo(() => {
    const { start, end } = getRangeBounds(range, baseDate)
    const startMonth = start.startOf('month')
    const endMonth = end.startOf('month')
    const months: dayjs.Dayjs[] = []
    for (
      let cursor = startMonth;
      cursor.isBefore(endMonth) || cursor.isSame(endMonth, 'month');
      cursor = cursor.add(1, 'month')
    ) {
      months.push(cursor)
    }
    return months
  }, [range, baseDate])

  const carryoverEntries = useMemo<ReportEntry[]>(() => {
    return rangeMonths
      .map<ReportEntry | null>((month) => {
        const balanceYm = month.subtract(1, 'month').format('YYYY-MM')
        const balance = monthlyBalanceMap.get(balanceYm)?.balance
        if (typeof balance !== 'number' || balance === 0) return null
        const entryType: EntryType = balance >= 0 ? 'income' : 'expense'
        const amount = Math.abs(balance)
        const occurredAt = `${month.format('YYYY-MM-01')}T00:00:00+09:00`
        return {
          entry_type: entryType,
          amount,
          entry_category_id: CARRYOVER_CATEGORY_ID,
          occurred_at: occurredAt,
        }
      })
      .filter((item): item is ReportEntry => item !== null)
  }, [monthlyBalanceMap, rangeMonths])

  const reportEntries = useMemo<ReportEntry[]>(() => [...entries, ...carryoverEntries], [entries, carryoverEntries])
  const localReport = useMemo<ReportData>(
    () => computeReport(reportEntries, categories, range, baseDate),
    [reportEntries, categories, range, baseDate]
  )
  const report = localReport

  const rangeInfo = useMemo(() => {
    const { start, end } = getRangeBounds(range, baseDate)
    const label =
      range === 'week'
        ? `${start.format('YYYY/M/D')} - ${end.format('M/D')}`
        : range === 'month'
          ? start.format('YYYY年 M月')
          : start.format('YYYY年')
    const detail = `${start.format('YYYY/M/D')} 〜 ${end.format('YYYY/M/D')}`
    const apiFrom = start.format('YYYY-MM-DD')
    const apiTo = end.add(1, 'day').format('YYYY-MM-DD')
    return { label, detail, apiFrom, apiTo }
  }, [range, baseDate])

  const activeTotal = report.summary[reportType]
  const categoryTotals = report.categoryTotalsByType[reportType]
  const donutSegments = categoryTotals.filter((item) => item.total > 0)

  const donutGradient = useMemo(() => {
    if (!donutSegments.length) return 'conic-gradient(#e0e0e0 0 100%)'

    let start = 0
    const stops = donutSegments.map((item, index) => {
      const percent = activeTotal ? (item.total / activeTotal) * 100 : 0
      const end = start + percent
      const color = item.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
      const stop = `${color} ${start}% ${end}%`
      start = end
      return stop
    })

    return `conic-gradient(${stops.join(', ')})`
  }, [donutSegments, activeTotal])

  return (
    <section className="card">
      <div className="month-header">
        <button className="icon-button" onClick={() => setReportOffset((prev) => prev - 1)}>
          ‹
        </button>
        <h2>{rangeInfo.label}</h2>
        <button className="icon-button" onClick={() => setReportOffset((prev) => prev + 1)}>
          ›
        </button>
      </div>
      <div className="report-range">{rangeInfo.detail}</div>
      <div className="pill-toggle small">
        <button className={range === 'week' ? 'active' : ''} onClick={() => handleRangeChange('week')}>
          週
        </button>
        <button className={range === 'month' ? 'active' : ''} onClick={() => handleRangeChange('month')}>
          月
        </button>
        <button className={range === 'year' ? 'active' : ''} onClick={() => handleRangeChange('year')}>
          年
        </button>
      </div>

      <div className="report-toggle">
        <button type="button" className="report-type" onClick={() => setReportType(reportType === 'expense' ? 'income' : 'expense')}>
          {reportType === 'expense' ? '支出' : '収入'}
        </button>
      </div>

      <div className="donut" style={{ background: donutGradient }}>
        <div className="donut-center">
          <span>{reportType === 'expense' ? '支出' : '収入'}</span>
          <strong>¥{formatAmount(activeTotal)}</strong>
        </div>
      </div>

      <div className="summary-strip">
        <div>
          <span>収入</span>
          <strong>¥{formatAmount(report.summary.income)}</strong>
        </div>
        <div>
          <span>支出</span>
          <strong>¥{formatAmount(report.summary.expense)}</strong>
        </div>
        <div>
          <span>収支</span>
          <strong>¥{formatAmount(report.summary.income - report.summary.expense)}</strong>
        </div>
      </div>

      <div className="report-section">
        <div className="report-header">
          <span>カテゴリ</span>
          <span>{reportType === 'expense' ? '支出' : '収入'}/総計</span>
        </div>
        <ul className="list compact">
          {categoryTotals.length === 0 && <li>データがありません</li>}
          {categoryTotals.map((item, index) => {
            const percent = activeTotal ? Math.round((item.total / activeTotal) * 100) : 0
            const color = item.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
            return (
              <li key={item.id} className="report-category-item">
                <button
                  type="button"
                  className="report-category-row"
                  aria-label={`${item.name}の明細`}
                  onClick={() =>
                    onOpenCategoryEntities({
                      categoryId: item.id,
                      categoryName: item.name,
                      categoryColor: item.color ?? color,
                      iconKey: item.icon_key ?? null,
                      rangeLabel: rangeInfo.label,
                      entryType: reportType,
                      fromDate: rangeInfo.apiFrom,
                      toDateExclusive: rangeInfo.apiTo,
                    })
                  }
                >
                  <div className="report-category-main">
                    <div className="entry-main">
                      <span className="mini-icon" style={{ background: color }}>
                        {getCategoryIcon(item.icon_key) ?? item.name.slice(0, 1)}
                      </span>
                      <strong>{item.name}</strong>
                    </div>
                    <span className="report-category-arrow" aria-hidden="true">
                      ›
                    </span>
                  </div>
                  <div className="progress-row report-category-progress">
                    <span>¥{formatAmount(item.total)} ({percent}%)</span>
                    <div className="progress">
                      <span style={{ width: `${percent}%`, background: color }} />
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

    </section>
  )
}

type BalancePageProps = {
  entries: Entry[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  paymentMethods: PaymentMethod[]
  onOpenPayment: (type: PaymentType) => void
  onOpenPaymentMethodEntities: (seed: PaymentMethodEntitySeed) => void
}

const BalancePage = ({
  entries,
  monthlyBalanceMap,
  paymentMethods,
  onOpenPayment,
  onOpenPaymentMethodEntities,
}: BalancePageProps) => {
  const currentMonthKey = dayjs().format('YYYY-MM')
  const balanceYm = dayjs(currentMonthKey).subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const monthNet = useMemo(() => {
    const current = dayjs()
    const start = current.startOf('month')
    const end = current.endOf('month')
    let net = 0
    entries.forEach((entry) => {
      const date = dayjs(entry.occurred_at)
      if (date.isBefore(start) || date.isAfter(end)) return
      net += entry.entry_type === 'income' ? entry.amount : -entry.amount
    })
    return net
  }, [entries])

  const totalsByMethod = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>()
    entries.forEach((entry) => {
      if (!entry.payment_method_id) return
      const current = map.get(entry.payment_method_id) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
      } else {
        current.expense += entry.amount
      }
      map.set(entry.payment_method_id, current)
    })
    return map
  }, [entries])

  const totalBalance = useMemo(() => {
    if (carryoverBalance !== null) {
      return carryoverBalance + monthNet
    }
    return entries.reduce((sum, entry) => {
      return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount)
    }, 0)
  }, [entries, carryoverBalance, monthNet])
  const paymentNameMap = useMemo(() => {
    return new Map(paymentMethods.map((method) => [method.id, method.name]))
  }, [paymentMethods])

  const groupedMethods = useMemo(() => {
    const groups: Record<PaymentType, PaymentMethod[]> = {
      cash: [],
      bank: [],
      emoney: [],
      card: [],
    }
    paymentMethods.forEach((method) => {
      const type = getPaymentType(method.type)
      groups[type].push(method)
    })
    return groups
  }, [paymentMethods])

  const buildItems = (methods: PaymentMethod[], mode: 'balance' | 'card') => {
    return methods.map((method) => {
      const totals = totalsByMethod.get(method.id) ?? { income: 0, expense: 0 }
      const amount = mode === 'card' ? totals.expense : totals.income - totals.expense
      const schedule =
        mode === 'card'
          ? `${formatDayLabel(normalizeDayOfMonth(method.card_closing_day))}締め / ${formatDayLabel(
              normalizeDayOfMonth(method.card_payment_day)
            )}払い`
          : null
      const linkedBankName = method.linked_bank_payment_method_id
        ? paymentNameMap.get(method.linked_bank_payment_method_id) ?? null
        : null
      return {
        id: method.id,
        name: method.name,
        type: method.type,
        icon_key: method.icon_key ?? null,
        color: method.color ?? null,
        amount,
        caption: mode === 'card' ? '総支払予定' : '残高',
        schedule: schedule && linkedBankName ? `${schedule} / 引落: ${linkedBankName}` : schedule,
      }
    })
  }

  const cashItems = buildItems(groupedMethods.cash, 'balance')
  const bankItems = buildItems(groupedMethods.bank, 'balance')
  const emoneyItems = buildItems(groupedMethods.emoney, 'balance')
  const cardItems = buildItems(groupedMethods.card, 'card')

  return (
    <section className="card balance-card">
      <div className="balance-total-row">
        <span>合計</span>
        <strong>¥{formatAmount(totalBalance)}</strong>
      </div>

      <BalanceSection
        title="現金"
        items={cashItems}
        onEmpty={() => onOpenPayment('cash')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="銀行口座"
        items={bankItems}
        onEmpty={() => onOpenPayment('bank')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="電子マネー"
        items={emoneyItems}
        onEmpty={() => onOpenPayment('emoney')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="クレジット"
        items={cardItems}
        onEmpty={() => onOpenPayment('card')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
    </section>
  )
}

type BalanceSectionProps = {
  title: string
  items: {
    id: string
    name: string
    type: string
    icon_key?: string | null
    color?: string | null
    amount: number
    caption: string
    schedule?: string | null
  }[]
  onEmpty: () => void
  onOpenItem: (item: {
    id: string
    name: string
    type: string
    icon_key?: string | null
    color?: string | null
    amount: number
    caption: string
    schedule?: string | null
  }) => void
}

const BalanceSection = ({ title, items, onEmpty, onOpenItem }: BalanceSectionProps) => {
  const sectionTotal = items.reduce((sum, item) => sum + item.amount, 0)

  return (
    <div className="balance-section">
      <div className="balance-header">
        <span>{title}</span>
        {items.length === 0 ? (
          <button className="link-button" onClick={onEmpty}>
            設定する
          </button>
        ) : (
          <strong className="balance-header-total">合計 ¥{formatAmount(sectionTotal)}</strong>
        )}
      </div>
      {items.length > 0 && (
        <ul className="balance-list">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="balance-item-button" onClick={() => onOpenItem(item)}>
                <div className="balance-info">
                  <span
                    className="payment-method-icon"
                    style={{
                      background: item.color ?? PAYMENT_DEFAULT_COLORS[getPaymentType(item.type)],
                      color: '#fff',
                    }}
                  >
                    {getPaymentIconFromConfig(item.type, item.icon_key ?? null)}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.caption}</span>
                    {item.schedule && <span className="balance-card-meta">{item.schedule}</span>}
                  </div>
                </div>
                <div className="balance-amount">
                  <strong>¥{formatAmount(item.amount)}</strong>
                  <span>›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type HistoryStyleGroup = {
  dateKey: string
  date: dayjs.Dayjs
  entries: EntryListItem[]
  totals: { income: number; expense: number }
}

const buildHistoryStyleGroups = (entries: Entry[]): HistoryStyleGroup[] => {
  const grouped = new Map<string, HistoryStyleGroup>()
  entries.forEach((entry) => {
    const dateKey = getEntryDateKey(entry)
    const current = grouped.get(dateKey) ?? {
      dateKey,
      date: dayjs(dateKey),
      entries: [],
      totals: { income: 0, expense: 0 },
    }
    current.entries.push(entry)
    if (entry.entry_type === 'income') {
      current.totals.income += entry.amount
    } else {
      current.totals.expense += entry.amount
    }
    grouped.set(dateKey, current)
  })

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()),
    }))
    .sort((a, b) => b.date.valueOf() - a.date.valueOf())
}

type HistoryStyleGroupedEntriesProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  emptyMessage: string
}

const HistoryStyleGroupedEntries = ({
  entries,
  categoryMap,
  paymentMap,
  emptyMessage,
}: HistoryStyleGroupedEntriesProps) => {
  const groups = useMemo(() => buildHistoryStyleGroups(entries), [entries])

  return (
    <ul className="list">
      {groups.length === 0 && <li className="muted">{emptyMessage}</li>}
      {groups.map((group) => (
        <li key={group.dateKey} className="entry-group">
          <div className="entry-group-header">
            <strong className="entry-group-date">{`${group.date.format('M/D')} (${WEEKDAY_LABELS[group.date.day()]})`}</strong>
            <div className="entry-group-totals">
              <span className="badge income">収入 ¥{formatAmount(group.totals.income)}</span>
              <span className="badge expense">支出 ¥{formatAmount(group.totals.expense)}</span>
            </div>
          </div>
          <EntryButtonsList
            entries={group.entries}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            formatAmount={formatAmount}
            getCategoryIcon={getCategoryIcon}
            getPaymentIcon={getPaymentIcon}
            getPaymentColor={getPaymentColor}
            readOnly
            showCreatorBadge
          />
        </li>
      ))}
    </ul>
  )
}

type ReportCategoryEntitiesPageProps = {
  seed: ReportCategoryEntitySeed
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMethods: PaymentMethod[]
}

const ReportCategoryEntitiesPage = ({ seed, entries, categoryMap, paymentMethods }: ReportCategoryEntitiesPageProps) => {
  const filteredEntries = useMemo(() => {
    if (seed.categoryId === CARRYOVER_CATEGORY_ID) return [] as Entry[]
    return entries
      .filter((entry) => entry.entry_type === seed.entryType && entry.entry_category_id === seed.categoryId)
      .filter((entry) => {
        const dateKey = getEntryDateKey(entry)
        return dateKey >= seed.fromDate && dateKey < seed.toDateExclusive
      })
      .sort((a, b) => dayjs(b.occurred_at).valueOf() - dayjs(a.occurred_at).valueOf())
  }, [entries, seed])
  const paymentMap = useMemo(() => new Map(paymentMethods.map((item) => [item.id, item])), [paymentMethods])

  const totalAmount = useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + entry.amount, 0),
    [filteredEntries]
  )

  return (
    <section className="card">
      <div className="entity-page-header">
        <span>{seed.rangeLabel}</span>
        <strong>{seed.entryType === 'expense' ? '支出' : '収入'}明細</strong>
      </div>
      <div className="summary-strip entity-summary-strip">
        <div>
          <span>件数</span>
          <strong>{filteredEntries.length}</strong>
        </div>
        <div>
          <span>合計</span>
          <strong>¥{formatAmount(totalAmount)}</strong>
        </div>
        <div>
          <span>カテゴリ</span>
          <strong>{seed.categoryName}</strong>
        </div>
      </div>
      <HistoryStyleGroupedEntries
        entries={filteredEntries}
        categoryMap={categoryMap}
        paymentMap={paymentMap}
        emptyMessage="このカテゴリに紐づく明細はありません"
      />
    </section>
  )
}

type PaymentMethodEntitiesPageProps = {
  seed: PaymentMethodEntitySeed
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMethods: PaymentMethod[]
}

const PaymentMethodEntitiesPage = ({ seed, entries, categoryMap, paymentMethods }: PaymentMethodEntitiesPageProps) => {
  const filteredEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.payment_method_id === seed.methodId)
      .sort((a, b) => dayjs(b.occurred_at).valueOf() - dayjs(a.occurred_at).valueOf())
  }, [entries, seed])
  const paymentMap = useMemo(() => new Map(paymentMethods.map((item) => [item.id, item])), [paymentMethods])
  const method = paymentMethods.find((item) => item.id === seed.methodId) ?? null

  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (sum, entry) => {
        if (entry.entry_type === 'income') {
          sum.income += entry.amount
        } else {
          sum.expense += entry.amount
        }
        return sum
      },
      { income: 0, expense: 0 }
    )
  }, [filteredEntries])
  const displayTotal = method && getPaymentType(method.type) === 'card' ? totals.expense : totals.income - totals.expense
  const linkedBankName =
    method?.linked_bank_payment_method_id ? paymentMap.get(method.linked_bank_payment_method_id)?.name ?? null : null
  const cardScheduleLabel =
    method && getPaymentType(method.type) === 'card'
      ? `${formatDayLabel(normalizeDayOfMonth(method.card_closing_day))}締め / ${formatDayLabel(
          normalizeDayOfMonth(method.card_payment_day)
        )}払い${linkedBankName ? ` / 引落: ${linkedBankName}` : ''}`
      : null

  return (
    <section className="card">
      <div className="entity-total-header">
        <span>合計</span>
        <strong>¥{formatAmount(displayTotal)}</strong>
      </div>
      {cardScheduleLabel && <div className="entity-total-meta">{cardScheduleLabel}</div>}
      <HistoryStyleGroupedEntries
        entries={filteredEntries}
        categoryMap={categoryMap}
        paymentMap={paymentMap}
        emptyMessage="この支払い方法に紐づく明細はありません"
      />
    </section>
  )
}

type CategorySettingsPageProps = {
  categories: EntryCategory[]
  onAdd: (name: string, type: string) => void
  onSave: (category: EntryCategory) => void
  onDelete: (category: EntryCategory) => void
}

const CategorySettingsPage = ({ categories, onAdd, onSave, onDelete }: CategorySettingsPageProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [editingCategory, setEditingCategory] = useState<EntryCategory | null>(null)
  const [editName, setEditName] = useState('')
  const [editIconKey, setEditIconKey] = useState<string | null>(null)
  const [editColor, setEditColor] = useState(CATEGORY_COLORS[0])

  const filtered = useMemo(() => {
    return categories
      .filter((category) => category.type === entryType)
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [categories, entryType])

  const handleMove = (category: EntryCategory, direction: 'up' | 'down') => {
    const index = filtered.findIndex((item) => item.id === category.id)
    const target = direction === 'up' ? filtered[index - 1] : filtered[index + 1]
    if (!target) return

    const updatedCurrent = { ...category, sort_order: target.sort_order }
    const updatedTarget = { ...target, sort_order: category.sort_order }
    void onSave(updatedCurrent)
    void onSave(updatedTarget)
  }

  const openEdit = (category: EntryCategory) => {
    setEditingCategory(category)
    setEditName(category.name)
    setEditIconKey(category.icon_key ?? null)
    setEditColor(category.color ?? CATEGORY_COLORS[0])
  }

  const handleUpdate = (event: FormEvent) => {
    event.preventDefault()
    if (!editingCategory || !editName.trim()) return
    const updated: EntryCategory = {
      ...editingCategory,
      name: editName.trim(),
      icon_key: editIconKey,
      color: editColor,
      updated_at: editingCategory.updated_at,
    }
    onSave(updated)
    setEditingCategory(null)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), entryType)
    setName('')
    setShowForm(false)
  }

  return (
    <div className="page">
      <div className="pill-toggle">
        <button
          type="button"
          className={entryType === 'income' ? 'active' : ''}
          onClick={() => setEntryType('income')}
        >
          収入
        </button>
        <button
          type="button"
          className={entryType === 'expense' ? 'active' : ''}
          onClick={() => setEntryType('expense')}
        >
          支出
        </button>
      </div>

      <ul className="category-list scrollable">
        {filtered.map((category, index) => (
          <li key={category.id} className="category-row">
            <span
              className="category-icon"
              style={{ background: category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
            >
              {getCategoryIcon(category.icon_key) ?? (
                <span className="category-fallback">{category.name.slice(0, 1)}</span>
              )}
            </span>
            <strong className="category-title">{category.name}</strong>
            <div className="category-actions">
              <div className="category-action-buttons">
                <button
                  type="button"
                  className="icon-button-small"
                  aria-label="編集"
                  onClick={() => openEdit(category)}
                >
                  {renderMaterialIcon('edit')}
                </button>
                <button
                  type="button"
                  className="icon-button-small danger"
                  aria-label="削除"
                  onClick={() => onDelete(category)}
                >
                  {renderMaterialIcon('delete')}
                </button>
              </div>
              <div className="reorder-buttons">
                <button
                  type="button"
                  className="icon-button-small"
                  aria-label="上へ"
                  onClick={() => handleMove(category, 'up')}
                  disabled={index === 0}
                >
                  {renderMaterialIcon('arrow_upward')}
                </button>
                <button
                  type="button"
                  className="icon-button-small"
                  aria-label="下へ"
                  onClick={() => handleMove(category, 'down')}
                  disabled={index === filtered.length - 1}
                >
                  {renderMaterialIcon('arrow_downward')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {showForm && (
        <div className="sheet">
          <form className="sheet-card" onSubmit={handleSubmit}>
            <h3>カテゴリ追加</h3>
            <input
              type="text"
              placeholder="カテゴリ名"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setShowForm(false)}>
                キャンセル
              </button>
              <button type="submit" className="primary">
                追加
              </button>
            </div>
          </form>
        </div>
      )}

      {editingCategory && (
        <div className="sheet">
          <form className="sheet-card scrollable" onSubmit={handleUpdate}>
            <h3>カテゴリ編集</h3>
            <input
              type="text"
              placeholder="カテゴリ名"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
            <div className="icon-picker">
              {CATEGORY_ICON_CHOICES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  className={`icon-choice ${editIconKey === iconName ? 'active' : ''}`}
                  aria-label={iconName}
                  onClick={() => setEditIconKey(iconName)}
                >
                  <span className="icon-preview">{renderMaterialIcon(iconName)}</span>
                </button>
              ))}
            </div>
            <div className="color-picker">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${editColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setEditColor(color)}
                />
              ))}
            </div>
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setEditingCategory(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary">
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      <button className="floating-button" onClick={() => setShowForm(true)}>
        +
      </button>
    </div>
  )
}

type RecurringSettingsPageProps = {
  rules: RecurringRule[]
  categories: EntryCategory[]
  paymentMethods: PaymentMethod[]
  onAdd: (payload: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    frequency: string
    dayOfMonth: number | null
    holidayAdjustment: HolidayAdjustment
    startAt: string
  }) => void
  onSave: (rule: RecurringRule) => void
  onDelete: (rule: RecurringRule) => void
}

const RecurringSettingsPage = ({ rules, categories, paymentMethods, onAdd, onSave, onDelete }: RecurringSettingsPageProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
  const [amount, setAmount] = useState('')
  const [entryCategoryId, setEntryCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [memo, setMemo] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('8')
  const [yearlyMonth, setYearlyMonth] = useState(String(dayjs().month() + 1))
  const [holidayAdjustment, setHolidayAdjustment] = useState<HolidayAdjustment>('none')

  const filteredRules = useMemo(() => rules.filter((rule) => rule.entry_type === entryType), [rules, entryType])
  const formCategories = useMemo(
    () => categories.filter((category) => category.type === entryType),
    [categories, entryType]
  )

  const totals = useMemo(() => {
    const monthly = filteredRules.reduce((sum, rule) => sum + estimateMonthlyAmount(rule), 0)
    const yearly = monthly * 12
    return { yearly, monthly }
  }, [filteredRules])

  const grouped = useMemo(() => {
    const map = new Map<string, RecurringRule[]>()
    filteredRules.forEach((rule) => {
      const label = groupByFrequency(rule)
      map.set(label, [...(map.get(label) ?? []), rule])
    })
    return Array.from(map.entries())
  }, [filteredRules])

  const resetForm = () => {
    setEditingRule(null)
    setAmount('')
    setEntryCategoryId('')
    setPaymentMethodId('')
    setMemo('')
    setFrequency('monthly')
    setDayOfMonth('8')
    setYearlyMonth(String(dayjs().month() + 1))
    setHolidayAdjustment('none')
    setShowForm(false)
  }

  const openCreate = () => {
    setEditingRule(null)
    setAmount('')
    setEntryCategoryId('')
    setPaymentMethodId('')
    setMemo('')
    setFrequency('monthly')
    setDayOfMonth('8')
    setYearlyMonth(String(dayjs().month() + 1))
    setHolidayAdjustment('none')
    setShowForm(true)
  }

  const openEdit = (rule: RecurringRule) => {
    const ruleStart = dayjs(rule.start_at)
    setEditingRule(rule)
    setEntryType(rule.entry_type)
    setAmount(String(rule.amount))
    setEntryCategoryId(rule.entry_category_id ?? '')
    setPaymentMethodId(rule.payment_method_id ?? '')
    setMemo(rule.memo ?? '')
    setFrequency(rule.frequency ?? 'monthly')
    setYearlyMonth(String(ruleStart.month() + 1))
    if ((rule.frequency ?? 'monthly') === 'weekly') {
      const weekday = rule.day_of_month ?? ruleStart.day()
      setDayOfMonth(String(weekday))
    } else {
      const dateValue = rule.day_of_month ?? ruleStart.date()
      setDayOfMonth(String(dateValue))
    }
    setHolidayAdjustment(normalizeHolidayAdjustment(rule.holiday_adjustment))
    setShowForm(true)
  }

  const normalizeDayOfMonth = (value: string, nextFrequency: string) => {
    if (nextFrequency === 'weekly') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 6) {
        return String(dayjs().day())
      }
      return String(Math.trunc(numeric))
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 31) {
      return '1'
    }
    return String(Math.trunc(numeric))
  }

  const handleFrequencyChange = (value: string) => {
    const nextFrequency = value || 'monthly'
    setFrequency(nextFrequency)
    setDayOfMonth(normalizeDayOfMonth(dayOfMonth, nextFrequency))
  }

  const handleDayOfMonthChange = (value: string) => {
    setDayOfMonth(normalizeDayOfMonth(value, frequency))
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return
    const parsedDayOfMonth = dayOfMonth === '' ? null : Number(dayOfMonth)
    const baseStart = dayjs(editingRule?.start_at ?? new Date().toISOString())
    const parsedMonth = Number(yearlyMonth)
    const monthIndex =
      Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth - 1 : baseStart.month()
    const yearlyBase = baseStart.month(monthIndex).date(1)
    const startAt =
      frequency === 'yearly'
        ? yearlyBase
            .date(Math.min(parsedDayOfMonth ?? baseStart.date(), yearlyBase.daysInMonth()))
            .toISOString()
        : editingRule?.start_at ?? baseStart.toISOString()

    if (editingRule) {
      const updated: RecurringRule = {
        ...editingRule,
        entry_type: entryType,
        amount: Math.round(value),
        entry_category_id: entryCategoryId || null,
        payment_method_id: paymentMethodId || null,
        memo: memo.trim() ? memo.trim() : null,
        frequency,
        day_of_month: parsedDayOfMonth,
        holiday_adjustment: holidayAdjustment,
        start_at: startAt,
        updated_at: editingRule.updated_at,
      }
      onSave(updated)
    } else {
      onAdd({
        entryType,
        amount: Math.round(value),
        entryCategoryId: entryCategoryId || null,
        paymentMethodId: paymentMethodId || null,
        memo: memo.trim() ? memo.trim() : null,
        frequency,
        dayOfMonth: parsedDayOfMonth,
        holidayAdjustment,
        startAt,
      })
    }
    resetForm()
  }

  const handleDelete = () => {
    if (!editingRule) return
    onDelete(editingRule)
    resetForm()
  }

  return (
    <div className="page">
      <div className="report-summary">
        <div>
          <span>年間合計</span>
          <strong>¥{formatAmount(totals.yearly)}</strong>
        </div>
        <div>
          <span>月間平均</span>
          <strong>¥{formatAmount(totals.monthly)}</strong>
        </div>
      </div>

      <div className="pill-toggle">
        <button
          type="button"
          className={entryType === 'income' ? 'active' : ''}
          onClick={() => setEntryType('income')}
        >
          収入
        </button>
        <button
          type="button"
          className={entryType === 'expense' ? 'active' : ''}
          onClick={() => setEntryType('expense')}
        >
          支出
        </button>
      </div>

      {grouped.length === 0 && <p className="muted">定期ルールがありません</p>}

      {grouped.map(([label, items]) => (
        <div key={label} className="rule-group">
          <h3>{label}</h3>
          <div className="rule-list">
            {items.map((rule) => {
              const category = categories.find((item) => item.id === rule.entry_category_id)
              const icon = category ? getCategoryIcon(category.icon_key) : null
              return (
                <button key={rule.id} type="button" className="rule-card" onClick={() => openEdit(rule)}>
                  <span className="rule-icon">{icon ?? <IconHome />}</span>
                  <div>
                    <strong>{rule.memo ?? category?.name ?? '未設定'}</strong>
                    <span className="rule-meta">
                      {formatRecurringScheduleLabel(rule)} / {paymentMethodLabel(paymentMethods, rule.payment_method_id)}
                    </span>
                  </div>
                  <strong>¥{formatAmount(rule.amount)}</strong>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {showForm && (
        <div className="sheet">
          <form className="sheet-card" onSubmit={handleSubmit}>
            <h3>{editingRule ? '定期ルール編集' : '定期ルール追加'}</h3>
            <select value={entryType} onChange={(event) => setEntryType(event.target.value as EntryType)}>
              <option value="" disabled>
                種別
              </option>
              <option value="expense">支出</option>
              <option value="income">収入</option>
            </select>
            <input
              type="number"
              placeholder="金額"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <select value={entryCategoryId} onChange={(event) => setEntryCategoryId(event.target.value)}>
              <option value="" disabled>
                カテゴリ
              </option>
              {formCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
              <option value="" disabled>
                {entryType === 'income' ? '入金方法' : '支払い方法'}
              </option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="メモ"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
            <div className={`row ${frequency === 'yearly' ? 'row-3' : ''}`}>
              <select value={frequency} onChange={(event) => handleFrequencyChange(event.target.value)}>
                <option value="" disabled>
                  頻度
                </option>
                <option value="monthly">月次</option>
                <option value="bimonthly">隔月</option>
                <option value="weekly">毎週</option>
                <option value="yearly">年次</option>
              </select>
              {frequency === 'weekly' ? (
                <select value={dayOfMonth} onChange={(event) => handleDayOfMonthChange(event.target.value)}>
                  <option value="" disabled>
                    曜日
                  </option>
                  {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : frequency === 'yearly' ? (
                <select value={yearlyMonth} onChange={(event) => setYearlyMonth(event.target.value)}>
                  <option value="" disabled>
                    月
                  </option>
                  {Array.from({ length: 12 }).map((_, index) => (
                    <option key={String(index + 1)} value={String(index + 1)}>
                      {index + 1}月
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(event) => handleDayOfMonthChange(event.target.value)}
                  placeholder="日"
                />
              )}
              {frequency === 'yearly' && (
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(event) => handleDayOfMonthChange(event.target.value)}
                  placeholder="日"
                />
              )}
            </div>
            <select value={holidayAdjustment} onChange={(event) => setHolidayAdjustment(event.target.value as HolidayAdjustment)}>
              <option value="" disabled>
                休日調整
              </option>
              <option value="none">休日調整なし</option>
              <option value="previous">前営業日に移動</option>
              <option value="next">次営業日に移動</option>
            </select>
            <div className={`sheet-actions ${editingRule ? 'spread' : ''}`}>
              {editingRule && (
                <button type="button" className="icon-button-small danger" aria-label="削除" onClick={handleDelete}>
                  {renderMaterialIcon('delete')}
                </button>
              )}
              <div className="sheet-action-buttons">
                <button type="button" className="ghost" onClick={resetForm}>
                  キャンセル
                </button>
                <button type="submit" className="primary">
                  {editingRule ? '保存' : '追加'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <button className="floating-button" onClick={openCreate}>
        +
      </button>
    </div>
  )
}

type PaymentSettingsPageProps = {
  defaultType: PaymentType
  paymentMethods: PaymentMethod[]
  onAdd: (params: {
    name: string
    type: string
    cardClosingDay: number | null
    cardPaymentDay: number | null
    linkedBankPaymentMethodId: string | null
  }) => void
  onSave: (method: PaymentMethod) => void
  onDelete: (method: PaymentMethod) => void
}

const PaymentSettingsPage = ({ defaultType, paymentMethods, onAdd, onSave, onDelete }: PaymentSettingsPageProps) => {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<PaymentType>(defaultType)
  const [cardClosingDay, setCardClosingDay] = useState('')
  const [cardPaymentDay, setCardPaymentDay] = useState('')
  const [linkedBankPaymentMethodId, setLinkedBankPaymentMethodId] = useState('')
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<PaymentType>(defaultType)
  const [editCardClosingDay, setEditCardClosingDay] = useState('')
  const [editCardPaymentDay, setEditCardPaymentDay] = useState('')
  const [editLinkedBankPaymentMethodId, setEditLinkedBankPaymentMethodId] = useState('')
  const [editIconKey, setEditIconKey] = useState<string | null>(null)
  const [editColor, setEditColor] = useState(CATEGORY_COLORS[0])

  useEffect(() => {
    setType(defaultType)
    setEditType(defaultType)
  }, [defaultType])

  const sortedMethods = useMemo(() => {
    return sortPaymentMethods(paymentMethods)
  }, [paymentMethods])
  const bankMethodOptions = useMemo(
    () => sortedMethods.filter((method) => getPaymentType(method.type) === 'bank'),
    [sortedMethods]
  )
  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, index) => index + 1), [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onAdd({
      name: name.trim(),
      type,
      cardClosingDay: type === 'card' ? normalizeDayOfMonth(cardClosingDay) : null,
      cardPaymentDay: type === 'card' ? normalizeDayOfMonth(cardPaymentDay) : null,
      linkedBankPaymentMethodId: type === 'card' ? (linkedBankPaymentMethodId || null) : null,
    })
    setName('')
    setType(defaultType)
    setCardClosingDay('')
    setCardPaymentDay('')
    setLinkedBankPaymentMethodId('')
    setShowForm(false)
  }

  const openEdit = (method: PaymentMethod) => {
    const normalizedType = getPaymentType(method.type)
    setEditingMethod(method)
    setEditName(method.name)
    setEditType(normalizedType)
    setEditCardClosingDay(dayToInputValue(normalizeDayOfMonth(method.card_closing_day)))
    setEditCardPaymentDay(dayToInputValue(normalizeDayOfMonth(method.card_payment_day)))
    setEditLinkedBankPaymentMethodId(method.linked_bank_payment_method_id ?? '')
    setEditIconKey(method.icon_key ?? getPaymentFallbackIconKey(method.type))
    setEditColor(method.color ?? PAYMENT_DEFAULT_COLORS[normalizedType])
  }

  const handleUpdate = (event: FormEvent) => {
    event.preventDefault()
    if (!editingMethod || !editName.trim()) return
    void onSave({
      ...editingMethod,
      name: editName.trim(),
      type: editType,
      card_closing_day: editType === 'card' ? normalizeDayOfMonth(editCardClosingDay) : null,
      card_payment_day: editType === 'card' ? normalizeDayOfMonth(editCardPaymentDay) : null,
      linked_bank_payment_method_id: editType === 'card' ? editLinkedBankPaymentMethodId || null : null,
      icon_key: editIconKey ?? getPaymentFallbackIconKey(editType),
      color: editColor,
      updated_at: editingMethod.updated_at,
    })
    setEditingMethod(null)
  }

  const handleMove = (method: PaymentMethod, direction: 'up' | 'down') => {
    const index = sortedMethods.findIndex((item) => item.id === method.id)
    if (index < 0) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= sortedMethods.length) return

    const reordered = sortedMethods.slice()
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(targetIndex, 0, moved)

    reordered.forEach((item, orderIndex) => {
      const nextOrder = orderIndex + 1
      if (item.sort_order !== nextOrder) {
        void onSave({ ...item, sort_order: nextOrder, updated_at: item.updated_at })
      }
    })
  }

  const paymentTypeOptions: Array<{ value: PaymentType; label: string }> = [
    { value: 'cash', label: '現金' },
    { value: 'bank', label: '銀行口座' },
    { value: 'emoney', label: '電子マネー' },
    { value: 'card', label: 'クレジットカード' },
  ]
  const formatCardMeta = (method: PaymentMethod) => {
    if (getPaymentType(method.type) !== 'card') return null
    const linkedBank = bankMethodOptions.find((item) => item.id === method.linked_bank_payment_method_id)?.name ?? '未設定'
    return `${formatDayLabel(normalizeDayOfMonth(method.card_closing_day))}締め / ${formatDayLabel(
      normalizeDayOfMonth(method.card_payment_day)
    )}払い / 引落: ${linkedBank}`
  }

  return (
    <div className="page">
      <ul className="category-list">
        {sortedMethods.map((method, index) => {
          const cardMeta = formatCardMeta(method)
          return (
            <li key={method.id} className="category-row payment-method-row">
              <span className="payment-method-icon" style={{ background: getPaymentColor(method), color: '#fff' }}>
                {getPaymentIcon(method)}
              </span>
              <div className="payment-method-title-wrap">
                <strong className="category-title">{method.name}</strong>
                <span className="pill">{paymentTypeLabel(method.type)}</span>
                {cardMeta && <span className="payment-method-meta">{cardMeta}</span>}
              </div>
              <div className="category-actions">
                <div className="category-action-buttons">
                  <button
                    type="button"
                    className="icon-button-small"
                    aria-label="編集"
                    onClick={() => openEdit(method)}
                  >
                    {renderMaterialIcon('edit')}
                  </button>
                  <button
                    type="button"
                    className="icon-button-small danger"
                    aria-label="削除"
                    onClick={() => onDelete(method)}
                  >
                    {renderMaterialIcon('delete')}
                  </button>
                </div>
                <div className="reorder-buttons">
                  <button
                    type="button"
                    className="icon-button-small"
                    aria-label="上へ"
                    onClick={() => handleMove(method, 'up')}
                    disabled={index === 0}
                  >
                    {renderMaterialIcon('arrow_upward')}
                  </button>
                  <button
                    type="button"
                    className="icon-button-small"
                    aria-label="下へ"
                    onClick={() => handleMove(method, 'down')}
                    disabled={index === sortedMethods.length - 1}
                  >
                    {renderMaterialIcon('arrow_downward')}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {showForm && (
        <div className="sheet">
          <form className="sheet-card payment-settings-sheet" onSubmit={handleSubmit}>
            <h3>支払い方法追加</h3>
            <input
              type="text"
              placeholder="名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label className="sheet-field-label" htmlFor="payment-type-add">
              支払いカテゴリ
            </label>
            <select
              id="payment-type-add"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as PaymentType
                setType(nextType)
                if (nextType !== 'card') {
                  setCardClosingDay('')
                  setCardPaymentDay('')
                  setLinkedBankPaymentMethodId('')
                }
              }}
            >
              {paymentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {type === 'card' && (
              <div className="card-setting-grid">
                <label className="sheet-field-label" htmlFor="payment-closing-day-add">
                  締め日
                </label>
                <select
                  id="payment-closing-day-add"
                  value={cardClosingDay}
                  onChange={(event) => setCardClosingDay(event.target.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={String(day)}>
                      {day}日
                    </option>
                  ))}
                </select>
                <label className="sheet-field-label" htmlFor="payment-day-add">
                  支払い日
                </label>
                <select
                  id="payment-day-add"
                  value={cardPaymentDay}
                  onChange={(event) => setCardPaymentDay(event.target.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={String(day)}>
                      {day}日
                    </option>
                  ))}
                </select>
                <label className="sheet-field-label" htmlFor="payment-linked-bank-add">
                  引落口座
                </label>
                <select
                  id="payment-linked-bank-add"
                  value={linkedBankPaymentMethodId}
                  onChange={(event) => setLinkedBankPaymentMethodId(event.target.value)}
                >
                  <option value="">未設定</option>
                  {bankMethodOptions.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setShowForm(false)}>
                閉じる
              </button>
              <button type="submit" className="primary">
                追加
              </button>
            </div>
          </form>
        </div>
      )}

      {editingMethod && (
        <div className="sheet">
          <form className="sheet-card scrollable payment-settings-sheet" onSubmit={handleUpdate}>
            <h3>支払い方法編集</h3>
            <input
              type="text"
              placeholder="名称"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
            <label className="sheet-field-label" htmlFor="payment-type-edit">
              支払いカテゴリ
            </label>
            <select
              id="payment-type-edit"
              value={editType}
              onChange={(event) => {
                const nextType = event.target.value as PaymentType
                setEditType(nextType)
                if (nextType !== 'card') {
                  setEditCardClosingDay('')
                  setEditCardPaymentDay('')
                  setEditLinkedBankPaymentMethodId('')
                }
              }}
            >
              {paymentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {editType === 'card' && (
              <div className="card-setting-grid">
                <label className="sheet-field-label" htmlFor="payment-closing-day-edit">
                  締め日
                </label>
                <select
                  id="payment-closing-day-edit"
                  value={editCardClosingDay}
                  onChange={(event) => setEditCardClosingDay(event.target.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={String(day)}>
                      {day}日
                    </option>
                  ))}
                </select>
                <label className="sheet-field-label" htmlFor="payment-day-edit">
                  支払い日
                </label>
                <select
                  id="payment-day-edit"
                  value={editCardPaymentDay}
                  onChange={(event) => setEditCardPaymentDay(event.target.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={String(day)}>
                      {day}日
                    </option>
                  ))}
                </select>
                <label className="sheet-field-label" htmlFor="payment-linked-bank-edit">
                  引落口座
                </label>
                <select
                  id="payment-linked-bank-edit"
                  value={editLinkedBankPaymentMethodId}
                  onChange={(event) => setEditLinkedBankPaymentMethodId(event.target.value)}
                >
                  <option value="">未設定</option>
                  {bankMethodOptions.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="icon-picker">
              {PAYMENT_ICON_CHOICES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  className={`icon-choice ${editIconKey === iconName ? 'active' : ''}`}
                  aria-label={iconName}
                  onClick={() => setEditIconKey(iconName)}
                >
                  <span className="icon-preview">{renderMaterialIcon(iconName)}</span>
                </button>
              ))}
            </div>
            <div className="color-picker">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${editColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setEditColor(color)}
                />
              ))}
            </div>
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setEditingMethod(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary">
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && !editingMethod && (
        <button className="floating-button" onClick={() => setShowForm(true)}>
          +
        </button>
      )}
    </div>
  )
}

export default App
