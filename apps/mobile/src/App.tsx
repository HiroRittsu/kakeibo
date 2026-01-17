import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import './App.css'
import { db } from './db'
import { apiFetch, getFamilyId } from './lib/api'
import { enqueueOutbox, syncOutbox } from './lib/sync'
import type { Entry, EntryCategory, EntryType, PaymentMethod, RecurringRule } from './types'

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

type DayTotals = {
  income: number
  expense: number
}

type DayCell = {
  date: dayjs.Dayjs
  inMonth: boolean
  totals: DayTotals
}

type ReportSummary = {
  income: number
  expense: number
}

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

type ReportTotalRow = {
  entry_type: EntryType
  total: number
}

type ReportCategoryRow = {
  entry_category_id: string | null
  entry_type: EntryType
  total: number
}

type ReportResponse = {
  range: string
  from: string
  to: string
  totals: ReportTotalRow[]
  categories: ReportCategoryRow[]
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
  'other-settings': 'その他設定',
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

const buildEntryCreatePayload = (entry: Entry) => ({
  id: entry.id,
  entry_type: entry.entry_type,
  amount: entry.amount,
  entry_category_id: entry.entry_category_id,
  payment_method_id: entry.payment_method_id,
  memo: entry.memo,
  occurred_at: entry.occurred_at,
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

const IconCoins = () => (
  <IconBase>
    <ellipse cx="12" cy="6" rx="6" ry="2" />
    <path d="M6 6v6c0 1.1 2.7 2 6 2s6-.9 6-2V6" />
    <path d="M6 12v6c0 1.1 2.7 2 6 2s6-.9 6-2v-6" />
  </IconBase>
)

const IconHome = () => (
  <IconBase>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </IconBase>
)

const IconArrow = () => (
  <IconBase>
    <path d="M4 12h12" />
    <path d="M12 6l6 6-6 6" />
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

const computeReport = (entries: Entry[], categories: EntryCategory[], range: 'week' | 'month' | 'year') => {
  const { start, end } = getRangeBounds(range)

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
        const category = categories.find((item) => item.id === id)
        return {
          id,
          total,
          name: category?.name ?? '未分類',
          icon_key: category?.icon_key ?? null,
          color: category?.color ?? null,
        }
      })
      .sort((a, b) => b.total - a.total),
    expense: Array.from(categoryMaps.expense.entries())
      .map(([id, total]) => {
        const category = categories.find((item) => item.id === id)
        return {
          id,
          total,
          name: category?.name ?? '未分類',
          icon_key: category?.icon_key ?? null,
          color: category?.color ?? null,
        }
      })
      .sort((a, b) => b.total - a.total),
  }

  return { summary: summaryTotals, categoryTotalsByType }
}

const buildReportSeries = (entries: Entry[], range: 'week' | 'month' | 'year', entryType: EntryType) => {
  const now = dayjs()
  const { start, end } = getRangeBounds(range, now)
  const unit = range === 'year' ? 'month' : 'day'
  const maxPoints = range === 'year' ? 12 : range === 'month' ? end.date() : 7
  const elapsed = unit === 'month' ? now.diff(start, 'month') : now.diff(start, 'day')
  const count = Math.min(maxPoints + 1, elapsed + 2)
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

const buildReportFromApi = (data: ReportResponse, categories: EntryCategory[]): ReportData => {
  const summary: ReportSummary = { income: 0, expense: 0 }

  data.totals?.forEach((row) => {
    const total = Number(row.total) || 0
    if (row.entry_type === 'income') summary.income += total
    if (row.entry_type === 'expense') summary.expense += total
  })

  const byCategory: Record<EntryType, Map<string, number>> = {
    income: new Map<string, number>(),
    expense: new Map<string, number>(),
  }

  data.categories?.forEach((row) => {
    const key = row.entry_category_id ?? 'uncategorized'
    const map = byCategory[row.entry_type]
    map.set(key, (map.get(key) ?? 0) + (Number(row.total) || 0))
  })

  const categoryTotalsByType: Record<EntryType, CategoryTotal[]> = {
    income: Array.from(byCategory.income.entries())
      .map(([id, total]) => {
        const category = categories.find((item) => item.id === id)
        return {
          id,
          total,
          name: category?.name ?? '未分類',
          icon_key: category?.icon_key ?? null,
          color: category?.color ?? null,
        }
      })
      .sort((a, b) => b.total - a.total),
    expense: Array.from(byCategory.expense.entries())
      .map(([id, total]) => {
        const category = categories.find((item) => item.id === id)
        return {
          id,
          total,
          name: category?.name ?? '未分類',
          icon_key: category?.icon_key ?? null,
          color: category?.color ?? null,
        }
      })
      .sort((a, b) => b.total - a.total),
  }

  return { summary, categoryTotalsByType }
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

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home')
  const [page, setPage] = useState<PageKey>('main')
  const [returnPage, setReturnPage] = useState<PageKey>('main')
  const [returnTab, setReturnTab] = useState<TabKey>('home')
  const [entrySeed, setEntrySeed] = useState<EntryInputSeed | null>(null)
  const [preferredEntryType, setPreferredEntryType] = useState<EntryType>('expense')
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const entries = useLiveQuery(() => db.entries.orderBy('occurred_at').reverse().toArray(), [])
  const entryCategories = useLiveQuery(() => db.entryCategories.orderBy('sort_order').toArray(), [])
  const paymentMethods = useLiveQuery(() => db.paymentMethods.orderBy('sort_order').toArray(), [])
  const recurringRules = useLiveQuery(() => db.recurringRules.orderBy('created_at').reverse().toArray(), [])
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

  useEffect(() => {
    void syncOutbox()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncOutbox()
    } finally {
      setSyncing(false)
    }
  }

  const handleSaveEntry = async (payload: EntryInputSeed) => {
    const now = new Date().toISOString()
    const existing = payload.id ? (entries ?? []).find((entry) => entry.id === payload.id) : null
    const entry: Entry = {
      id: existing?.id ?? crypto.randomUUID(),
      family_id: existing?.family_id ?? getFamilyId(),
      entry_type: payload.entryType,
      amount: payload.amount,
      entry_category_id: payload.entryCategoryId,
      payment_method_id: payload.paymentMethodId,
      memo: payload.memo,
      occurred_at: payload.occurredAt,
      recurring_rule_id: existing?.recurring_rule_id ?? payload.recurringRuleId ?? null,
      created_at: existing?.created_at ?? payload.createdAt ?? now,
      updated_at: now,
    }

    await db.entries.put(entry)
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

    void syncOutbox()
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
    void syncOutbox()
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

    void syncOutbox()
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

    void syncOutbox()
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

    void syncOutbox()
  }

  const handleAddRecurringRule = async (rule: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    frequency: string
    dayOfMonth: number | null
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
      start_at: now,
      end_at: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    }

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
      },
      created_at: now,
    })

    void syncOutbox()
  }

  const handleOpenPage = (next: PageKey) => {
    setReturnPage(page === 'main' || page === 'balance' ? page : 'main')
    setPage(next)
    setMenuOpen(false)
  }

  const handleOpenPayment = (type: PaymentType) => {
    setPaymentType(type)
    setReturnPage(page === 'other-settings' ? 'other-settings' : page === 'balance' ? 'balance' : 'main')
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
          <ReportsTab entries={entries ?? []} categories={entryCategories ?? []} />
        )}
        {page === 'balance' && (
          <BalancePage
            entries={entries ?? []}
            paymentMethods={paymentMethods ?? []}
            onOpenPayment={handleOpenPayment}
          />
        )}
        {page === 'entry-input' && entrySeed && (
          <EntryInputPage
            seed={entrySeed}
            categories={entryCategories ?? []}
            paymentMethods={paymentMethods ?? []}
            onSave={(payload) => {
              void handleSaveEntry(payload)
              handleBack()
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
          <MenuItem icon={<IconCoins />} label="予算設定" disabled />
          <MenuItem icon={<IconArrow />} label="定期的な収入/支出" onClick={() => handleOpenPage('recurring-settings')} />
          <MenuItem icon={<IconSettings />} label="その他設定" onClick={() => handleOpenPage('other-settings')} />
        </div>
      </div>

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
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
  entryType: EntryType
  onEntryTypeChange: (entryType: EntryType) => void
  onOpenCategorySettings: () => void
  onOpenEntryInput: (seed: EntryInputSeed, tab?: TabKey) => void
}

const HomeTab = ({
  entries,
  categories,
  paymentMethods,
  entryType,
  onEntryTypeChange,
  onOpenCategorySettings,
  onOpenEntryInput,
}: HomeTabProps) => {

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

    return { income, expense, balance: income - expense }
  }, [entries])

  const totalForRatio = monthSummary.income + monthSummary.expense
  const ratio = totalForRatio > 0 ? monthSummary.expense / totalForRatio : 0

  return (
    <section className="card">
      <div className="summary-panel">
        <span>収支</span>
        <strong>¥{formatAmount(monthSummary.balance)}</strong>
      </div>
      <div className="summary-progress">
        <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
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
}

const EntryInputPage = ({ seed, categories, paymentMethods, onSave }: EntryInputPageProps) => {
  const [entryType, setEntryType] = useState<EntryType>(seed.entryType)
  const [entryCategoryId, setEntryCategoryId] = useState(seed.entryCategoryId ?? '')
  const [paymentMethodId, setPaymentMethodId] = useState(seed.paymentMethodId ?? '')
  const [place, setPlace] = useState('')
  const [memo, setMemo] = useState('')
  const [dateValue, setDateValue] = useState(dayjs(seed.occurredAt).format('YYYY-MM-DD'))
  const [timeValue, setTimeValue] = useState(dayjs(seed.occurredAt).format('HH:mm'))
  const [displayValue, setDisplayValue] = useState(seed.amount ? String(seed.amount) : '0')
  const [accumulator, setAccumulator] = useState<number | null>(null)
  const [pendingOperator, setPendingOperator] = useState<CalcOperator | null>(null)
  const [freshInput, setFreshInput] = useState(true)
  const [operationUsed, setOperationUsed] = useState(false)
  const [awaitingSubmit, setAwaitingSubmit] = useState(false)

  useEffect(() => {
    setEntryType(seed.entryType)
    setEntryCategoryId(seed.entryCategoryId ?? '')
    setPaymentMethodId(seed.paymentMethodId ?? '')
    const { place: seedPlace, memo: seedMemo } = splitMemo(seed.memo)
    setPlace(seedPlace)
    setMemo(seedMemo)
    setDateValue(dayjs(seed.occurredAt).format('YYYY-MM-DD'))
    setTimeValue(dayjs(seed.occurredAt).format('HH:mm'))
    setDisplayValue(seed.amount ? String(seed.amount) : '0')
    setAccumulator(null)
    setPendingOperator(null)
    setFreshInput(true)
    setOperationUsed(false)
    setAwaitingSubmit(false)
  }, [seed])

  const visibleCategories = useMemo(() => {
    return categories.filter((category) => category.type === entryType)
  }, [categories, entryType])

  useEffect(() => {
    if (entryCategoryId && !visibleCategories.some((category) => category.id === entryCategoryId)) {
      setEntryCategoryId('')
    }
  }, [entryCategoryId, visibleCategories])

  const selectedCategory = visibleCategories.find((category) => category.id === entryCategoryId)
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
    if (freshInput) return
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
      entryCategoryId: entryCategoryId || null,
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
        <select value={entryCategoryId} onChange={(event) => setEntryCategoryId(event.target.value)}>
          <option value="">カテゴリ</option>
          {visibleCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
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
          <button type="button" className="entry-clear" onClick={handleClear}>
            金額削除
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
  onEdit: (entry: Entry) => void
}

const HistoryTab = ({ entries, categoryMap, paymentMap, onEdit }: HistoryTabProps) => {
  const [view, setView] = useState<'list' | 'calendar' | 'diary'>('list')
  const [currentMonth, setCurrentMonth] = useState(dayjs())
  const [selectedDate, setSelectedDate] = useState(() => dayjs().format('YYYY-MM-DD'))
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']

  const monthEntries = useMemo(() => {
    return entries.filter((entry) => dayjs(entry.occurred_at).isSame(currentMonth, 'month'))
  }, [entries, currentMonth])

  useEffect(() => {
    const base = dayjs().isSame(currentMonth, 'month') ? dayjs() : currentMonth.startOf('month')
    setSelectedDate(base.format('YYYY-MM-DD'))
  }, [currentMonth])

  const monthTotals = useMemo(() => {
    const byDay = new Map<string, DayTotals>()
    let income = 0
    let expense = 0

    monthEntries.forEach((entry) => {
      const dateKey = dayjs(entry.occurred_at).format('YYYY-MM-DD')
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
      { date: dayjs.Dayjs; entries: Entry[]; totals: { income: number; expense: number } }
    >()
    monthEntries.forEach((entry) => {
      const key = dayjs(entry.occurred_at).format('YYYY-MM-DD')
      const current = map.get(key) ?? {
        date: dayjs(entry.occurred_at),
        entries: [],
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
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort(
          (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
        ),
      }))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())
  }, [monthEntries])

  const selectedEntries = useMemo(() => {
    return monthEntries
      .filter((entry) => dayjs(entry.occurred_at).format('YYYY-MM-DD') === selectedDate)
      .sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf())
  }, [monthEntries, selectedDate])

  const selectedTotals = useMemo(() => {
    return selectedEntries.reduce(
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
  }, [selectedEntries])

  const renderEntryButton = (entry: Entry) => {
    const category = entry.entry_category_id ? categoryMap.get(entry.entry_category_id) : null
    const method = entry.payment_method_id ? paymentMap.get(entry.payment_method_id) : null
    const memoValue = entry.memo?.trim()
    const paymentClass = method?.type ?? 'unknown'
    const categoryColor = category?.color ?? '#d9554c'
    const categoryIcon = getCategoryIcon(category?.icon_key)
    const categoryFallback = category?.name?.slice(0, 1) ?? '?'

    return (
      <button key={entry.id} type="button" className="entry-button" onClick={() => onEdit(entry)}>
        <div className="entry-row-main">
          <span className="entry-category-icon" style={{ background: categoryColor }}>
            {categoryIcon ?? <span className="category-fallback">{categoryFallback}</span>}
          </span>
          <div className="entry-info">
            <div className="entry-title-row">
              <span className={`badge ${entry.entry_type}`}>{entry.entry_type === 'income' ? '収入' : '支出'}</span>
              <strong>¥{formatAmount(entry.amount)}</strong>
            </div>
            <div className="entry-details">
              <span>{category?.name ?? '未分類'}</span>
              {memoValue && <span>{memoValue}</span>}
            </div>
          </div>
          <span className={`entry-payment-icon ${paymentClass}`}>{getPaymentIcon(method)}</span>
        </div>
      </button>
    )
  }

  const totalForRatio = monthTotals.income + monthTotals.expense
  const ratio = totalForRatio > 0 ? monthTotals.expense / totalForRatio : 0

  return (
    <section className="card">
      <div className="month-header">
        <button className="icon-button" onClick={() => setCurrentMonth((prev) => prev.subtract(1, 'month'))}>
          ‹
        </button>
        <h2>{currentMonth.format('YYYY年 M月')}</h2>
        <button className="icon-button" onClick={() => setCurrentMonth((prev) => prev.add(1, 'month'))}>
          ›
        </button>
      </div>
      <div className="pill-toggle small">
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
        <button type="button" className={view === 'diary' ? 'active' : ''} onClick={() => setView('diary')}>
          日記
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
              <div className="entry-group-list">
                {group.entries.map((entry) => renderEntryButton(entry))}
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
        </div>
      )}

      {view === 'diary' && <p className="muted">日記表示は準備中です。</p>}
    </section>
  )
}

type ReportsTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
}

const ReportsTab = ({ entries, categories }: ReportsTabProps) => {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month')
  const [reportType, setReportType] = useState<EntryType>('expense')
  const [chartType, setChartType] = useState<'donut' | 'bar'>('donut')

  const localReport = useMemo(() => computeReport(entries, categories, range), [entries, categories, range])
  const [report, setReport] = useState<ReportData>(localReport)

  const rangeInfo = useMemo(() => {
    const { start, end } = getRangeBounds(range)
    const label =
      range === 'week'
        ? `${start.format('YYYY/M/D')} - ${end.format('M/D')}`
        : range === 'month'
          ? start.format('YYYY年 M月')
          : start.format('YYYY年')
    const detail = `${start.format('YYYY/M/D')} 〜 ${end.format('YYYY/M/D')}`
    return { label, detail }
  }, [range])

  useEffect(() => {
    setReport(localReport)
  }, [localReport])

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const response = await apiFetch(`/reports?range=${range}`)
        if (!response.ok) return
        const data = (await response.json()) as ReportResponse
        if (!active) return
        setReport(buildReportFromApi(data, categories))
      } catch {
        // fallback to local report
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [range, categories])

  const activeTotal = report.summary[reportType]
  const categoryTotals = report.categoryTotalsByType[reportType]
  const donutSegments = categoryTotals.filter((item) => item.total > 0)
  const series = useMemo(() => buildReportSeries(entries, range, reportType), [entries, range, reportType])

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
        <h2>{rangeInfo.label}</h2>
      </div>
      <div className="report-range">{rangeInfo.detail}</div>
      <div className="pill-toggle small">
        <button className={range === 'week' ? 'active' : ''} onClick={() => setRange('week')}>
          週
        </button>
        <button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>
          月
        </button>
        <button className={range === 'year' ? 'active' : ''} onClick={() => setRange('year')}>
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
        <div className="bar-scroll">
          <div className="bar-chart">
            {(() => {
              const maxValue = Math.max(...series.map((item) => item.total), 1)
              return series.map((point) => {
                const height = Math.round((point.total / maxValue) * 100)
                return (
                  <div key={point.key} className="bar-item">
                    <div className="bar-value" style={{ height: `${height}%` }} />
                    <span className="bar-label">{point.label}</span>
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
  paymentMethods: PaymentMethod[]
  onOpenPayment: (type: PaymentType) => void
}

const normalizeMethodType = (type: string) => {
  if (type === 'card' || type === 'bank' || type === 'emoney' || type === 'cash') return type
  return 'cash'
}

const BalancePage = ({ entries, paymentMethods, onOpenPayment }: BalancePageProps) => {
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
    return entries.reduce((sum, entry) => {
      return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount)
    }, 0)
  }, [entries])

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

      <ul className="category-list">
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
          <form className="sheet-card" onSubmit={handleUpdate}>
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
  }) => void
}

const RecurringSettingsPage = ({ rules, categories, paymentMethods, onAdd }: RecurringSettingsPageProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [showForm, setShowForm] = useState(false)
  const [amount, setAmount] = useState('')
  const [entryCategoryId, setEntryCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [memo, setMemo] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('8')

  const filteredRules = useMemo(() => rules.filter((rule) => rule.entry_type === entryType), [rules, entryType])

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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return
    onAdd({
      entryType,
      amount: Math.round(value),
      entryCategoryId: entryCategoryId || null,
      paymentMethodId: paymentMethodId || null,
      memo: memo.trim() ? memo.trim() : null,
      frequency,
      dayOfMonth: dayOfMonth ? Number(dayOfMonth) : null,
    })
    setAmount('')
    setMemo('')
    setShowForm(false)
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
                <div key={rule.id} className="rule-card">
                  <span className="rule-icon">{icon ?? <IconHome />}</span>
                  <div>
                    <strong>{rule.memo ?? category?.name ?? '未設定'}</strong>
                    <span>
                      {rule.day_of_month ? `毎月${rule.day_of_month}日` : '毎月'} / {paymentMethodLabel(paymentMethods, rule.payment_method_id)}
                    </span>
                  </div>
                  <strong>¥{formatAmount(rule.amount)}</strong>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {showForm && (
        <div className="sheet">
          <form className="sheet-card" onSubmit={handleSubmit}>
            <h3>定期ルール追加</h3>
            <select value={entryType} onChange={(event) => setEntryType(event.target.value as EntryType)}>
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
              <option value="">カテゴリ</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
              <option value="">支払い方法</option>
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
            <div className="row">
              <select value={frequency} onChange={(event) => setFrequency(event.target.value)}>
                <option value="monthly">月次</option>
                <option value="bimonthly">隔月</option>
                <option value="weekly">毎週</option>
              </select>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
              />
            </div>
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
