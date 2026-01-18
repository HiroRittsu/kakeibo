import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import './App.css'
import { db } from './db'
import { apiFetch, getApiBaseUrl, getFamilyId, setIdentity } from './lib/api'
import { enqueueOutbox, syncOutbox, type SyncFailure } from './lib/sync'
import type { Entry, EntryCategory, EntryType, MonthlyBalance, PaymentMethod, RecurringRule } from './types'

type TabKey = 'home' | 'history' | 'reports'

type PageKey =
  | 'main'
  | 'balance'
  | 'entry-input'
  | 'category-settings'
  | 'recurring-settings'
  | 'other-settings'
  | 'payment-settings'

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
const buildMonthlyBalanceId = (familyId: string, ym: string) => `${familyId}:${ym}`

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
  'other-settings': '支払い設定',
  'payment-settings': '支払い方法',
}

const PAYMENT_TITLES: Record<PaymentType, string> = {
  cash: '現金(お財布)',
  bank: '銀行口座',
  emoney: '電子マネー',
  card: 'クレジットカード',
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

const formatAmount = (amount: number) => {
  return new Intl.NumberFormat('ja-JP').format(amount)
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
  client_updated_at: entry.updated_at,
})

const buildEntryUpdatePayload = (entry: Entry, clientUpdatedAt: string | null) => ({
  entry_type: entry.entry_type,
  amount: entry.amount,
  entry_category_id: entry.entry_category_id,
  payment_method_id: entry.payment_method_id,
  memo: entry.memo,
  occurred_at: entry.occurred_at,
  occurred_on: entry.occurred_on,
  recurring_rule_id: entry.recurring_rule_id,
  client_updated_at: clientUpdatedAt,
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

const IconBar = () => (
  <IconBase>
    <path d="M4 20h16" />
    <path d="M7 20V11" />
    <path d="M12 20V6" />
    <path d="M17 20V14" />
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

const IconWallet = () => (
  <IconBase>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
    <path d="M16 14h2" />
  </IconBase>
)

const IconBank = () => (
  <IconBase>
    <path d="M3 10h18" />
    <path d="M5 10V20M9 10V20M15 10V20M19 10V20" />
    <path d="M12 4l9 6H3z" />
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

const renderMaterialIcon = (name: string, className?: string) => (
  <span className={['material-symbols-outlined', className].filter(Boolean).join(' ')}>{name}</span>
)

const getCategoryIcon = (iconKey?: string | null) => {
  if (!iconKey) return null
  return renderMaterialIcon(iconKey)
}

const getPaymentIcon = (method?: PaymentMethod | null) => {
  if (!method) return renderMaterialIcon('payments')
  if (method.type === 'bank') return renderMaterialIcon('account_balance')
  if (method.type === 'emoney') return renderMaterialIcon('account_balance_wallet')
  if (method.type === 'card') return renderMaterialIcon('credit_card')
  return renderMaterialIcon('payments')
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

const buildReportSeries = (
  entries: ReportEntry[],
  range: 'week' | 'month' | 'year',
  entryType: EntryType,
  baseDate = dayjs()
) => {
  const now = baseDate
  const { start, end } = getRangeBounds(range, now)
  const unit = range === 'year' ? 'month' : 'day'
  const maxPoints = range === 'year' ? 12 : range === 'month' ? end.date() : 7
  const count = maxPoints
  const points = Array.from({ length: Math.max(1, count) }, (_, index) => {
    const date = start.add(index, unit)
    return {
      key: unit === 'month' ? date.format('YYYY-MM') : date.format('YYYY-MM-DD'),
      label: range === 'year' ? date.format('M月') : range === 'week' ? date.format('dd') : date.format('D'),
    }
  })
  const seriesEnd = start.add(Math.max(0, count - 1), unit).endOf(unit)

  const totals = new Map<string, number>()
  entries.forEach((entry) => {
    if (entry.entry_type !== entryType) return
    const date = dayjs(entry.occurred_at)
    if (date.isBefore(start) || date.isAfter(seriesEnd)) return
    const key = range === 'year' ? date.format('YYYY-MM') : date.format('YYYY-MM-DD')
    totals.set(key, (totals.get(key) ?? 0) + entry.amount)
  })

  return points.map((point) => ({
    key: point.key,
    label: point.label,
    total: totals.get(point.key) ?? 0,
  }))
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
    return '同期中に競合が発生しました'
  }
  if (status && status >= 500) {
    return `${actionLabel}に失敗しました（サーバーエラー）`
  }
  if (status) {
    return `${actionLabel}に失敗しました`
  }
  return '通信に失敗しました。ネットワークを確認してください'
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
          {isLoading ? 'セッションを確認しています。' : 'Googleアカウントでログインします。'}
        </p>
        {error && <p className="auth-error">{error}</p>}
        <div className="auth-actions">
          <button className="primary full" onClick={onLogin} disabled={isLoading}>
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
  const [authStatus, setAuthStatus] = useState<'loading' | 'logged-out' | 'ready'>('loading')
  const [authError, setAuthError] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const entries = useLiveQuery(() => db.entries.orderBy('occurred_at').reverse().toArray(), [])
  const entryCategories = useLiveQuery(() => db.entryCategories.orderBy('sort_order').toArray(), [])
  const paymentMethods = useLiveQuery(() => db.paymentMethods.orderBy('sort_order').toArray(), [])
  const recurringRules = useLiveQuery(() => db.recurringRules.orderBy('created_at').reverse().toArray(), [])
  const monthlyBalances = useLiveQuery(() => db.monthlyBalances.orderBy('ym').toArray(), [])
  const outboxCount = useLiveQuery(() => db.outbox.count(), [])

  const paymentOptions = useMemo<SelectOption[]>(() => {
    return (paymentMethods ?? []).map((method) => ({
      value: method.id,
      label: method.name,
    }))
  }, [paymentMethods])

  const categoryMap = useMemo(() => {
    return new Map((entryCategories ?? []).map((category) => [category.id, category]))
  }, [entryCategories])

  const paymentMap = useMemo(() => {
    return new Map((paymentMethods ?? []).map((method) => [method.id, method]))
  }, [paymentMethods])

  const monthlyBalanceMap = useMemo(() => {
    return new Map((monthlyBalances ?? []).map((row) => [row.ym, row]))
  }, [monthlyBalances])

  const loadSession = async () => {
    try {
      const response = await apiFetch('/auth/session')
      if (!response.ok) {
        setAuthStatus('logged-out')
        return
      }
      const data = (await response.json()) as { session: AuthSession | null }
      if (!data.session) {
        setAuthStatus('logged-out')
        return
      }
      if (!data.session.family_id) {
        setAuthStatus('logged-out')
        return
      }
      setIdentity(data.session.family_id, data.session.user.id)
      setAuthStatus('ready')
    } catch {
      setAuthStatus('logged-out')
    }
  }

  const showToast = (message: string, type: 'error' | 'info' = 'error') => {
    setToast({ message, type })
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
    }, 3000)
  }

  const runSync = async () => {
    const result = await syncOutbox()
    if (!result.ok) {
      showToast(formatSyncFailureMessage(result.failure))
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
    void loadSession()
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ready') return
    void runSync()
  }, [authStatus])

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
      created_at: existing?.created_at ?? payload.createdAt ?? now,
      updated_at: now,
    }

    await db.entries.put(entry)
    const entriesSnapshot = await db.entries.toArray()
    await recalcLocalMonthlyBalances(entriesSnapshot, entry.family_id, getYmFromDate(occurredOn))
    setPreferredEntryType(payload.entryType)

    if (existing) {
      await enqueueOutbox({
        id: crypto.randomUUID(),
        method: 'PATCH',
        endpoint: `/entries/${entry.id}`,
        payload: buildEntryUpdatePayload(entry, existing.updated_at ?? payload.updatedAt ?? null),
        created_at: now,
      })
    } else {
      await enqueueOutbox({
        id: crypto.randomUUID(),
        method: 'POST',
        endpoint: '/entries',
        payload: buildEntryCreatePayload(entry),
        created_at: now,
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
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/entries/${entryId}`,
      payload: null,
      created_at: new Date().toISOString(),
    })
    void runSync()
  }

  const handleSaveCategory = async (category: EntryCategory) => {
    await db.entryCategories.put(category)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'POST',
      endpoint: '/entry-categories',
      payload: {
        id: category.id,
        name: category.name,
        type: category.type,
        icon_key: category.icon_key ?? null,
        color: category.color ?? null,
        sort_order: category.sort_order,
      },
      created_at: new Date().toISOString(),
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
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/entry-categories/${category.id}`,
      payload: null,
      created_at: new Date().toISOString(),
    })

    void runSync()
  }

  const handleAddPaymentMethod = async (name: string, type: string) => {
    const now = new Date().toISOString()
    const method: PaymentMethod = {
      id: crypto.randomUUID(),
      family_id: getFamilyId(),
      name,
      type,
      sort_order: (paymentMethods?.length ?? 0) + 1,
      created_at: now,
      updated_at: now,
    }

    await db.paymentMethods.put(method)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'POST',
      endpoint: '/payment-methods',
      payload: {
        id: method.id,
        name: method.name,
        type: method.type,
        sort_order: method.sort_order,
      },
      created_at: now,
    })

    void runSync()
  }

  const handleDeletePaymentMethod = async (method: PaymentMethod) => {
    await db.paymentMethods.delete(method.id)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/payment-methods/${method.id}`,
      payload: null,
      created_at: new Date().toISOString(),
    })

    void runSync()
  }

  const handleSaveRecurringRule = async (recurringRule: RecurringRule) => {
    await db.recurringRules.put(recurringRule)
    await enqueueOutbox({
      id: crypto.randomUUID(),
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
      },
      created_at: new Date().toISOString(),
    })

    void runSync()
  }

  const handleDeleteRecurringRule = async (rule: RecurringRule) => {
    await db.recurringRules.delete(rule.id)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/recurring-rules/${rule.id}`,
      payload: null,
      created_at: new Date().toISOString(),
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
    setPage(next)
    setMenuOpen(false)
  }

  const handleOpenPayment = (type: PaymentType) => {
    setPaymentType(type)
    setPaymentReturnPage(page === 'other-settings' ? 'other-settings' : page === 'balance' ? 'balance' : 'main')
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

  const handleBack = () => {
    if (page === 'payment-settings') {
      setPage(paymentReturnPage)
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
        ? PAYMENT_TITLES[paymentType]
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
            {syncing ? '同期中' : `更新${outboxCount ? ` (${outboxCount})` : ''}`}
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
            defaultEntryType={preferredEntryType}
            defaultPaymentMethodId={paymentMethods?.[0]?.id ?? null}
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
          />
        )}
        {page === 'balance' && (
          <BalancePage
            entries={entries ?? []}
            monthlyBalanceMap={monthlyBalanceMap}
            paymentMethods={paymentMethods ?? []}
            onOpenPayment={handleOpenPayment}
          />
        )}
        {page === 'entry-input' && entrySeed && (
          <EntryInputPage
            key={`${entrySeed.id ?? 'new'}-${entrySeed.occurredAt}`}
            seed={entrySeed}
            categories={entryCategories ?? []}
            paymentMethods={paymentMethods ?? []}
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
            paymentMethods={paymentMethods ?? []}
            onAdd={handleAddRecurringRule}
            onSave={handleSaveRecurringRule}
            onDelete={handleDeleteRecurringRule}
          />
        )}
        {page === 'other-settings' && (
          <OtherSettingsPage onOpenPayment={handleOpenPayment} />
        )}
        {page === 'payment-settings' && (
          <PaymentSettingsPage
            paymentType={paymentType}
            paymentMethods={paymentMethods ?? []}
            onAdd={handleAddPaymentMethod}
            onDelete={handleDeletePaymentMethod}
          />
        )}
      </main>

      <div className={`side-menu ${menuOpen ? 'open' : ''}`}>
        <div className="menu-brand">
          <strong>Kakeibo</strong>
        </div>
        <div className="menu-list">
          <MenuItem icon={<IconFolder />} label="カテゴリ設定" onClick={() => handleOpenPage('category-settings')} />
          <MenuItem
            icon={renderMaterialIcon('autorenew')}
            label="定期的な収入/支出"
            onClick={() => handleOpenPage('recurring-settings')}
          />
          <MenuItem icon={<IconSettings />} label="支払い設定" onClick={() => handleOpenPage('other-settings')} />
        </div>
      </div>

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}

      {toast && (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          {toast.message}
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
}

const MenuItem = ({ icon, label, onClick, disabled }: MenuItemProps) => (
  <button className={`menu-item ${disabled ? 'disabled' : ''}`} onClick={onClick} disabled={disabled}>
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

  const visibleCategories = useMemo(() => {
    return categories.filter((category) => category.type === entryType)
  }, [categories, entryType])
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
    })
  }

  const baseLabel = isEditing ? '編集' : '入力'
  const primaryLabel = operationUsed && !awaitingSubmit ? '=' : baseLabel

  const handleCyclePaymentMethod = () => {
    if (!paymentMethods.length) return
    const currentIndex = paymentMethods.findIndex((method) => method.id === paymentMethodId)
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % paymentMethods.length : 0
    setPaymentMethodId(paymentMethods[nextIndex].id)
  }

  const paymentLabel =
    paymentMethods.find((method) => method.id === paymentMethodId)?.name ?? '支払い方法'

  const handleEntryTypeChange = (nextType: EntryType) => {
    setEntryType(nextType)
    const nextCategories = categories.filter((category) => category.type === nextType)
    setEntryCategoryId(nextCategories[0]?.id ?? '')
    onEntryTypeChange?.(nextType)
  }

  return (
    <section className="card entry-input">
      <div className="entry-meta">
        <div className="entry-date">
          <input
            type="date"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
          />
        </div>
        <input
          type="time"
          className="entry-time"
          value={timeValue}
          onChange={(event) => setTimeValue(event.target.value)}
        />
      </div>

      <div className="entry-row">
        <span
          className="category-icon"
          style={{ background: selectedCategory?.color ?? '#d9554c' }}
        >
          {selectedCategory ? getCategoryIcon(selectedCategory.icon_key) ?? selectedCategory.name.slice(0, 1) : '?'}
        </span>
        <div className="entry-row-controls">
          <select value={resolvedEntryCategoryId} onChange={(event) => setEntryCategoryId(event.target.value)}>
            <option value="">カテゴリ</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <div className="pill-toggle entry-type-toggle">
            <button
              type="button"
              className={entryType === 'income' ? 'active' : ''}
              onClick={() => handleEntryTypeChange('income')}
            >
              収入
            </button>
            <button
              type="button"
              className={entryType === 'expense' ? 'active' : ''}
              onClick={() => handleEntryTypeChange('expense')}
            >
              支出
            </button>
          </div>
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
        <button type="button" className="entry-method" onClick={handleCyclePaymentMethod}>
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
    </section>
  )
}

type HistoryTabProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  monthlyBalanceMap: Map<string, MonthlyBalance>
  recurringRules: RecurringRule[]
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
  onEdit,
  onOpenEntryInput,
  defaultEntryType,
  defaultPaymentMethodId,
}: HistoryTabProps) => {
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const [currentMonth, setCurrentMonth] = useState(dayjs())
  const [selectedDate, setSelectedDate] = useState(() => dayjs().format('YYYY-MM-DD'))
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
    const next = currentMonth.add(delta, 'month')
    setCurrentMonth(next)
    const base = dayjs().isSame(next, 'month') ? dayjs() : next.startOf('month')
    setSelectedDate(base.format('YYYY-MM-DD'))
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

  const renderEntryButton = (entry: HistoryItem) => {
    const isCarryover = Boolean(entry.is_carryover)
    const category = !isCarryover && entry.entry_category_id ? categoryMap.get(entry.entry_category_id) : null
    const method = !isCarryover && entry.payment_method_id ? paymentMap.get(entry.payment_method_id) : null
    const memoValue = !isCarryover ? entry.memo?.trim() : null
    const paymentClass = method?.type === 'card' ? 'credit-card' : method?.type ?? 'unknown'
    const categoryColor = isCarryover ? '#8f9499' : category?.color ?? '#d9554c'
    const categoryIcon = isCarryover ? renderMaterialIcon('redo') : getCategoryIcon(category?.icon_key)
    const categoryFallback = category?.name?.slice(0, 1) ?? '?'
    const categoryLabel = isCarryover ? '繰越し' : category?.name ?? '未分類'
    const isPlanned = Boolean(entry.is_planned)
    const isRecurring = Boolean(entry.recurring_rule_id)
    const amountPrefix = isPlanned ? (entry.entry_type === 'income' ? '+' : '-') : ''

    return (
      <button
        key={entry.id}
        type="button"
        className={`entry-button ${isPlanned ? 'planned' : ''} ${isCarryover ? 'carryover' : ''}`}
        onClick={isPlanned || isCarryover ? undefined : () => onEdit(entry)}
        disabled={isPlanned || isCarryover}
      >
        <div className="entry-row-main">
          <span className="entry-category-icon" style={{ background: categoryColor }}>
            {categoryIcon ?? <span className="category-fallback">{categoryFallback}</span>}
            {!isCarryover && (
              <span className={`entry-payment-overlay ${paymentClass}`}>{getPaymentIcon(method)}</span>
            )}
          </span>
          <div className="entry-info">
            <div className="entry-top-row">
              <strong className="entry-name">{categoryLabel}</strong>
              {memoValue && <span className="entry-memo">{memoValue}</span>}
              <div className="entry-badges">
                <span className={`badge ${entry.entry_type}`}>{entry.entry_type === 'income' ? '収入' : '支出'}</span>
                {isCarryover && <span className="badge carryover">繰越し</span>}
                {isRecurring && !isCarryover && <span className="badge recurring">定期</span>}
                {isPlanned && <span className="badge planned">予定</span>}
              </div>
            </div>
            <div className="entry-amount-row">
              <strong>{amountPrefix}¥{formatAmount(entry.amount)}</strong>
            </div>
          </div>
        </div>
      </button>
    )
  }

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
              <div className="entry-group-card">
                <div className="entry-group-list">
                  {group.carryover.map((entry) => renderEntryButton(entry))}
                  {group.entries.map((entry) => renderEntryButton(entry))}
                  {group.planned.map((entry) => renderEntryButton(entry))}
                </div>
              </div>
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
          <div className="entry-group-list">
            {selectedEntries.length === 0 && <p className="muted">この日の明細はありません</p>}
            {selectedEntries.map((entry) => renderEntryButton(entry))}
          </div>
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
}

const ReportsTab = ({ entries, categories, monthlyBalanceMap }: ReportsTabProps) => {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month')
  const [reportType, setReportType] = useState<EntryType>('expense')
  const [chartType, setChartType] = useState<'donut' | 'bar'>('donut')
  const [reportOffset, setReportOffset] = useState(0)
  const barScrollRef = useRef<HTMLDivElement | null>(null)

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
  const series = useMemo(
    () => buildReportSeries(reportEntries, range, reportType, baseDate),
    [reportEntries, range, reportType, baseDate]
  )
  useEffect(() => {
    if (chartType !== 'bar') return
    if (range === 'week') return
    const container = barScrollRef.current
    if (!container) return
    const focusKey = range === 'year' ? baseDate.format('YYYY-MM') : baseDate.format('YYYY-MM-DD')
    const target = container.querySelector(`[data-key="${focusKey}"]`) as HTMLElement | null
    if (!target) return
    const left = target.offsetLeft - container.clientWidth / 2 + target.clientWidth / 2
    container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [chartType, range, baseDate, series])

  const donutGradient = useMemo(() => {
    if (!donutSegments.length) return 'conic-gradient(#e0e0e0 0 100%)'

    let start = 0
    const stops = donutSegments.map((item, index) => {
      const percent = activeTotal ? (item.total / activeTotal) * 100 : 0
      const end = start + percent
      const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
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
        <div className="report-toggle-group">
          <button className={chartType === 'bar' ? 'active' : ''} onClick={() => setChartType('bar')}>
            <IconBar />
          </button>
          <button className={chartType === 'donut' ? 'active' : ''} onClick={() => setChartType('donut')}>
            <IconChart />
          </button>
        </div>
        <button type="button" className="report-type" onClick={() => setReportType(reportType === 'expense' ? 'income' : 'expense')}>
          {reportType === 'expense' ? '支出' : '収入'}
        </button>
      </div>

      {chartType === 'donut' ? (
        <div className="donut" style={{ background: donutGradient }}>
          <div className="donut-center">
            <span>{reportType === 'expense' ? '支出' : '収入'}</span>
            <strong>¥{formatAmount(activeTotal)}</strong>
          </div>
        </div>
      ) : (
        <div className="bar-scroll" ref={barScrollRef}>
          <div className={`bar-chart ${series.length <= 7 ? 'bar-chart-full' : ''}`}>
            {(() => {
              const maxValue = Math.max(...series.map((item) => item.total), 1)
              const maxBarHeight = 80
              return series.map((point) => {
                const height = Math.round((point.total / maxValue) * maxBarHeight)
                const barHeight = point.total > 0 ? Math.max(4, height) : 4
                return (
                  <div key={point.key} className="bar-item" data-key={point.key}>
                    <span className="bar-amount">¥{formatAmount(point.total)}</span>
                    <div className="bar-stack">
                      <div className="bar-value" style={{ height: `${barHeight}px` }} />
                      <span className="bar-label">{point.label}</span>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

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
            const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
            return (
              <li key={item.id}>
                <div className="entry-main">
                  <span className="mini-icon" style={{ background: color }}>
                    {getCategoryIcon(item.icon_key) ?? item.name.slice(0, 1)}
                  </span>
                  <strong>{item.name}</strong>
                </div>
                <div className="progress-row">
                  <span>¥{formatAmount(item.total)} ({percent}%)</span>
                  <div className="progress">
                    <span style={{ width: `${percent}%`, background: color }} />
                  </div>
                </div>
                <span className="chevron">›</span>
              </li>
            )}
          )}
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
}

const normalizeMethodType = (type: string) => {
  if (type === 'card' || type === 'bank' || type === 'emoney' || type === 'cash') return type
  return 'cash'
}

const BalancePage = ({ entries, monthlyBalanceMap, paymentMethods, onOpenPayment }: BalancePageProps) => {
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

  const totalIncome = useMemo(() => {
    return entries.reduce((sum, entry) => (entry.entry_type === 'income' ? sum + entry.amount : sum), 0)
  }, [entries])

  const balanceRatio = totalIncome > 0 ? Math.max(0, Math.min(1, totalBalance / totalIncome)) : 0

  const groupedMethods = useMemo(() => {
    const groups: Record<PaymentType, PaymentMethod[]> = {
      cash: [],
      bank: [],
      emoney: [],
      card: [],
    }
    paymentMethods.forEach((method) => {
      const type = normalizeMethodType(method.type) as PaymentType
      groups[type].push(method)
    })
    return groups
  }, [paymentMethods])

  const buildItems = (methods: PaymentMethod[], mode: 'balance' | 'card') => {
    return methods.map((method) => {
      const totals = totalsByMethod.get(method.id) ?? { income: 0, expense: 0 }
      const amount = mode === 'card' ? totals.expense : totals.income - totals.expense
      return {
        id: method.id,
        name: method.name,
        amount,
        caption: mode === 'card' ? '総支払予定' : '残高',
      }
    })
  }

  const cashItems = buildItems(groupedMethods.cash, 'balance')
  const bankItems = buildItems(groupedMethods.bank, 'balance')
  const emoneyItems = buildItems(groupedMethods.emoney, 'balance')
  const cardItems = buildItems(groupedMethods.card, 'card')

  return (
    <section className="card balance-card">
      <div className="summary-panel">
        <span>残高</span>
        <strong>¥{formatAmount(totalBalance)}</strong>
        <button className="icon-button subtle">⋮</button>
      </div>
      <div className="summary-progress">
        <span style={{ width: `${Math.round(balanceRatio * 100)}%` }} />
      </div>

      <BalanceSection title="現金" items={cashItems} onEmpty={() => onOpenPayment('cash')} />
      <BalanceSection title="銀行口座" items={bankItems} onEmpty={() => onOpenPayment('bank')} />
      <BalanceSection title="電子マネー" items={emoneyItems} onEmpty={() => onOpenPayment('emoney')} />
      <BalanceSection title="クレジット" items={cardItems} onEmpty={() => onOpenPayment('card')} mode="card" />
    </section>
  )
}

type BalanceSectionProps = {
  title: string
  items: { id: string; name: string; amount: number; caption: string }[]
  onEmpty: () => void
  mode?: 'card'
}

const BalanceSection = ({ title, items, onEmpty, mode }: BalanceSectionProps) => (
  <div className="balance-section">
    <div className="balance-header">
      <span>{title}</span>
      {items.length === 0 && (
        <button className="link-button" onClick={onEmpty}>
          設定する
        </button>
      )}
    </div>
    {items.length > 0 && (
      <ul className="balance-list">
        {items.map((item) => (
          <li key={item.id}>
            <div className="balance-info">
              <span className={`balance-icon ${mode === 'card' ? 'card' : ''}`}>
                {mode === 'card' ? <IconCard /> : <IconWallet />}
              </span>
              <div>
                <strong>{item.name}</strong>
                <span>{item.caption}</span>
              </div>
            </div>
            <div className="balance-amount">
              <strong>¥{formatAmount(item.amount)}</strong>
              <span>›</span>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
)

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
      updated_at: new Date().toISOString(),
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
        updated_at: new Date().toISOString(),
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
  paymentType: PaymentType
  paymentMethods: PaymentMethod[]
  onAdd: (name: string, type: string) => void
  onDelete: (method: PaymentMethod) => void
}

const PaymentSettingsPage = ({ paymentType, paymentMethods, onAdd, onDelete }: PaymentSettingsPageProps) => {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')

  const filtered = useMemo(() => {
    return paymentMethods.filter((method) => normalizeMethodType(method.type) === paymentType)
  }, [paymentMethods, paymentType])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), paymentType)
    setName('')
    setShowForm(false)
  }

  return (
    <div className="page">
      <ul className="category-list">
        {filtered.map((method) => (
          <li key={method.id} className="category-row">
            <span className="category-icon" style={{ background: 'var(--accent-dark)' }}>
              <IconCard />
            </span>
            <strong>{method.name}</strong>
            <div className="reorder-buttons">
              <button onClick={() => onDelete(method)}>×</button>
            </div>
          </li>
        ))}
      </ul>

      {showForm && (
        <div className="sheet">
          <form className="sheet-card" onSubmit={handleSubmit}>
            <h3>{PAYMENT_TITLES[paymentType]}</h3>
            <input
              type="text"
              placeholder="名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
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

      <button className="floating-button" onClick={() => setShowForm(true)}>
        +
      </button>
    </div>
  )
}

type OtherSettingsPageProps = {
  onOpenPayment: (type: PaymentType) => void
}

const OtherSettingsPage = ({ onOpenPayment }: OtherSettingsPageProps) => {
  const items = [
    { label: '現金(お財布)', icon: <IconWallet />, action: () => onOpenPayment('cash') },
    { label: '銀行口座', icon: <IconBank />, action: () => onOpenPayment('bank') },
    { label: '電子マネー', icon: <IconCard />, action: () => onOpenPayment('emoney') },
    { label: 'クレジットカード', icon: <IconCard />, action: () => onOpenPayment('card') },
  ]

  return (
    <div className="page">
      <div className="settings-grid">
        {items.map((item) => (
          <button key={item.label} className="settings-item" onClick={item.action}>
            <span className="settings-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default App
