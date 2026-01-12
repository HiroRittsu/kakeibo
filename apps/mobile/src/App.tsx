import { type FormEvent, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import './App.css'
import { db } from './db'
import { apiFetch, getFamilyId } from './lib/api'
import { enqueueOutbox, syncOutbox } from './lib/sync'
import type {
  Entry,
  EntryCategory,
  EntryType,
  PaymentMethod,
  RecurringRule,
} from './types'

type TabKey = 'home' | 'history' | 'reports'

type SelectOption = {
  value: string
  label: string
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
}

type ReportData = {
  summary: ReportSummary
  categoryTotals: CategoryTotal[]
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

const buildEntryPayload = (entry: Entry) => ({
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

const IconBase = ({ children }: { children: React.ReactNode }) => (
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

const IconSettings = () => (
  <IconBase>
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <path d="M4 10h16" />
  </IconBase>
)

const IconFood = () => (
  <IconBase>
    <path d="M6 3v7M9 3v7M12 3v7M6 10h6" />
    <path d="M16 3v18" />
  </IconBase>
)

const IconBroom = () => (
  <IconBase>
    <path d="M4 20l6-6" />
    <path d="M10 14l7-7" />
    <path d="M13 4l7 7" />
  </IconBase>
)

const IconShirt = () => (
  <IconBase>
    <path d="M6 6l3-3 3 3 3-3 3 3-2 4v9H8V10L6 6z" />
  </IconBase>
)

const IconRacket = () => (
  <IconBase>
    <circle cx="9" cy="9" r="5" />
    <path d="M12.5 12.5l6 6" />
  </IconBase>
)

const IconTrain = () => (
  <IconBase>
    <rect x="5" y="3" width="14" height="14" rx="2" />
    <path d="M7 13h10" />
    <path d="M8 17l-3 3M16 17l3 3" />
    <circle cx="9" cy="9" r="1" />
    <circle cx="15" cy="9" r="1" />
  </IconBase>
)

const IconBook = () => (
  <IconBase>
    <path d="M4 4h7v16H4z" />
    <path d="M13 4h7v16h-7z" />
  </IconBase>
)

const IconCoins = () => (
  <IconBase>
    <ellipse cx="12" cy="6" rx="6" ry="2" />
    <path d="M6 6v6c0 1.1 2.7 2 6 2s6-.9 6-2V6" />
    <path d="M6 12v6c0 1.1 2.7 2 6 2s6-.9 6-2v-6" />
  </IconBase>
)

const IconCross = () => (
  <IconBase>
    <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />
  </IconBase>
)

const IconHome = () => (
  <IconBase>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </IconBase>
)

const IconMoneyBag = () => (
  <IconBase>
    <path d="M9 4h6l-2 3h-2z" />
    <path d="M7 7h10l2 3-2 11H7L5 10z" />
    <path d="M10 12h4" />
  </IconBase>
)

const IconBag = () => (
  <IconBase>
    <path d="M6 8h12l-1 12H7z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </IconBase>
)

const IconScissors = () => (
  <IconBase>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <path d="M8 8l10 10" />
    <path d="M8 16l10-10" />
  </IconBase>
)

const IconGift = () => (
  <IconBase>
    <rect x="4" y="10" width="16" height="10" />
    <path d="M12 10v10" />
    <path d="M4 10h16" />
    <path d="M7 6c0-1.5 1.5-2 3-1 1.5 1-1 3-3 1z" />
    <path d="M17 6c0-1.5-1.5-2-3-1-1.5 1 1 3 3 1z" />
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

const normalizeCategoryName = (name: string) => name.replace(/\s/g, '')

const CATEGORY_ICON_MAP: Record<string, React.ReactNode> = {
  食費: <IconFood />,
  日用品: <IconBroom />,
  '服・美容': <IconShirt />,
  趣味: <IconRacket />,
  交通: <IconTrain />,
  '本・雑誌': <IconBook />,
  キャッシュレス: <IconCoins />,
  医療: <IconCross />,
  住まい: <IconHome />,
  貯金: <IconMoneyBag />,
  その他: <IconBag />,
  差分: <IconScissors />,
  プレゼント: <IconGift />,
  ふるさと納税: <IconArrow />,
  カテゴリ設定: <IconFolder />,
}

const getCategoryIcon = (name: string) => {
  const key = normalizeCategoryName(name)
  return CATEGORY_ICON_MAP[key] ?? null
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

const computeReport = (entries: Entry[], categories: EntryCategory[], range: 'week' | 'month' | 'year') => {
  const now = dayjs()
  let start = now.startOf('month')
  let end = now.endOf('month')

  if (range === 'week') {
    const day = (now.day() + 6) % 7
    start = now.subtract(day, 'day').startOf('day')
    end = start.add(6, 'day').endOf('day')
  } else if (range === 'year') {
    start = now.startOf('year')
    end = now.endOf('year')
  }

  const summaryTotals: ReportSummary = { income: 0, expense: 0 }
  const categoryMap = new Map<string, number>()

  entries.forEach((entry) => {
    const date = dayjs(entry.occurred_at)
    if (date.isBefore(start) || date.isAfter(end)) return

    summaryTotals[entry.entry_type] += entry.amount
    if (entry.entry_type === 'expense') {
      const key = entry.entry_category_id ?? 'uncategorized'
      categoryMap.set(key, (categoryMap.get(key) ?? 0) + entry.amount)
    }
  })

  const categoryTotals = Array.from(categoryMap.entries())
    .map(([id, total]) => ({
      id,
      total,
      name: categories.find((category) => category.id === id)?.name ?? '未分類',
    }))
    .sort((a, b) => b.total - a.total)

  return { summary: summaryTotals, categoryTotals }
}

const buildReportFromApi = (data: ReportResponse, categories: EntryCategory[]): ReportData => {
  const summary: ReportSummary = { income: 0, expense: 0 }

  data.totals?.forEach((row) => {
    const total = Number(row.total) || 0
    if (row.entry_type === 'income') summary.income += total
    if (row.entry_type === 'expense') summary.expense += total
  })

  const byCategory = new Map<string, number>()
  data.categories?.forEach((row) => {
    if (row.entry_type !== 'expense') return
    const key = row.entry_category_id ?? 'uncategorized'
    byCategory.set(key, (byCategory.get(key) ?? 0) + (Number(row.total) || 0))
  })

  const categoryTotals = Array.from(byCategory.entries())
    .map(([id, total]) => ({
      id,
      total,
      name: categories.find((category) => category.id === id)?.name ?? '未分類',
    }))
    .sort((a, b) => b.total - a.total)

  return { summary, categoryTotals }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const entries = useLiveQuery(() => db.entries.orderBy('occurred_at').reverse().toArray(), [])
  const entryCategories = useLiveQuery(() => db.entryCategories.orderBy('sort_order').toArray(), [])
  const paymentMethods = useLiveQuery(() => db.paymentMethods.orderBy('sort_order').toArray(), [])
  const recurringRules = useLiveQuery(() => db.recurringRules.orderBy('created_at').reverse().toArray(), [])
  const outboxCount = useLiveQuery(() => db.outbox.count(), [])

  const categoryOptions = useMemo<SelectOption[]>(() => {
    return (entryCategories ?? []).map((category) => ({
      value: category.id,
      label: category.name,
    }))
  }, [entryCategories])

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

  const handleCreateEntry = async (payload: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    occurredAt: string
  }) => {
    const now = new Date().toISOString()
    const entry: Entry = {
      id: crypto.randomUUID(),
      family_id: getFamilyId(),
      entry_type: payload.entryType,
      amount: payload.amount,
      entry_category_id: payload.entryCategoryId,
      payment_method_id: payload.paymentMethodId,
      memo: payload.memo,
      occurred_at: payload.occurredAt,
      recurring_rule_id: null,
      created_at: now,
      updated_at: now,
    }

    await db.entries.put(entry)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'POST',
      endpoint: '/entries',
      payload: buildEntryPayload(entry),
      created_at: now,
    })

    void syncOutbox()
  }

  const handleDeleteEntry = async (entry: Entry) => {
    await db.entries.delete(entry.id)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/entries/${entry.id}`,
      payload: null,
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
      sort_order: (entryCategories?.length ?? 0) + 1,
      created_at: now,
      updated_at: now,
    }

    await db.entryCategories.put(category)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'POST',
      endpoint: '/entry-categories',
      payload: {
        id: category.id,
        name: category.name,
        type: category.type,
        sort_order: category.sort_order,
      },
      created_at: now,
    })

    void syncOutbox()
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

  const handleDeleteRecurringRule = async (rule: RecurringRule) => {
    await db.recurringRules.delete(rule.id)
    await enqueueOutbox({
      id: crypto.randomUUID(),
      method: 'DELETE',
      endpoint: `/recurring-rules/${rule.id}`,
      payload: null,
      created_at: new Date().toISOString(),
    })

    void syncOutbox()
  }

  return (
    <div className="app">
      <header className="top-bar">
        <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="menu">
          ☰
        </button>
        <div className="title-group">
          <h1>{TAB_LABELS[activeTab]}</h1>
        </div>
        <button className="ghost" onClick={handleSync} disabled={syncing}>
          {syncing ? '同期中' : `更新${outboxCount ? ` (${outboxCount})` : ''}`}
        </button>
      </header>

      <nav className="icon-bar">
        <button
          className={activeTab === 'home' ? 'active' : ''}
          onClick={() => setActiveTab('home')}
          aria-label="入力"
        >
          <IconPencil />
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
          aria-label="履歴"
        >
          <IconCalendar />
        </button>
        <button
          className={activeTab === 'reports' ? 'active' : ''}
          onClick={() => setActiveTab('reports')}
          aria-label="集計"
        >
          <IconChart />
        </button>
        <button onClick={() => setMenuOpen(true)} aria-label="設定">
          <IconSettings />
        </button>
      </nav>

      <main className="content">
        {activeTab === 'home' && (
          <HomeTab
            entries={entries ?? []}
            categories={entryCategories ?? []}
            paymentMethods={paymentOptions}
            onSubmit={handleCreateEntry}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            entries={entries ?? []}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            onDelete={handleDeleteEntry}
          />
        )}
        {activeTab === 'reports' && (
          <ReportsTab entries={entries ?? []} categories={entryCategories ?? []} />
        )}
      </main>

      <div className={`side-menu ${menuOpen ? 'open' : ''}`}>
        <div className="menu-header">
          <h2>設定</h2>
          <button className="icon-button" onClick={() => setMenuOpen(false)}>
            ✕
          </button>
        </div>
        <div className="menu-section">
          <CategorySettings
            categories={entryCategories ?? []}
            onAdd={handleAddCategory}
            onDelete={handleDeleteCategory}
          />
        </div>
        <div className="menu-section">
          <PaymentMethodSettings
            paymentMethods={paymentMethods ?? []}
            onAdd={handleAddPaymentMethod}
            onDelete={handleDeletePaymentMethod}
          />
        </div>
        <div className="menu-section">
          <RecurringRuleSettings
            rules={recurringRules ?? []}
            categories={categoryOptions}
            paymentMethods={paymentOptions}
            onAdd={handleAddRecurringRule}
            onDelete={handleDeleteRecurringRule}
          />
        </div>
      </div>

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
    </div>
  )
}

type HomeTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
  paymentMethods: SelectOption[]
  onSubmit: (payload: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    occurredAt: string
  }) => void
}

const HomeTab = ({ entries, categories, paymentMethods, onSubmit }: HomeTabProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [memo, setMemo] = useState('')
  const [occurredAt, setOccurredAt] = useState(dayjs().format('YYYY-MM-DD'))

  const visibleCategories = useMemo(() => {
    return categories.filter((category) => category.type === entryType)
  }, [categories, entryType])

  useEffect(() => {
    if (categoryId && !visibleCategories.some((category) => category.id === categoryId)) {
      setCategoryId('')
    }
  }, [categoryId, visibleCategories])

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

  const ratio = monthSummary.income > 0 ? monthSummary.expense / monthSummary.income : 0

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return

    onSubmit({
      entryType,
      amount: Math.round(value),
      entryCategoryId: categoryId || null,
      paymentMethodId: paymentMethodId || null,
      memo: memo.trim() ? memo.trim() : null,
      occurredAt: dayjs(occurredAt).startOf('day').toISOString(),
    })

    setAmount('')
    setMemo('')
  }

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

      <div className="category-grid">
        {visibleCategories.length === 0 && <p className="muted">カテゴリがありません</p>}
        {visibleCategories.map((category, index) => {
          const active = categoryId === category.id
          const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
          const icon = getCategoryIcon(category.name)
          return (
            <button
              type="button"
              key={category.id}
              className={`category-card ${active ? 'active' : ''}`}
              onClick={() => setCategoryId(category.id)}
            >
              <span className="category-icon" style={{ background: color }}>
                {icon ?? <span className="category-fallback">{category.name.slice(0, 1)}</span>}
              </span>
              <span className="category-label">{category.name}</span>
            </button>
          )}
        )}
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label>金額</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="field">
          <label>支払い方法</label>
          <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
            <option value="">未設定</option>
            {paymentMethods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>日付</label>
          <input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </div>
        <div className="field">
          <label>メモ</label>
          <input type="text" value={memo} onChange={(event) => setMemo(event.target.value)} />
        </div>
        <button type="submit" className="primary full">
          登録
        </button>
      </form>
    </section>
  )
}

type HistoryTabProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  onDelete: (entry: Entry) => void
}

const HistoryTab = ({ entries, categoryMap, paymentMap, onDelete }: HistoryTabProps) => {
  const [view, setView] = useState<'list' | 'calendar' | 'diary'>('list')
  const [currentMonth, setCurrentMonth] = useState(dayjs())

  const monthEntries = useMemo(() => {
    return entries.filter((entry) => dayjs(entry.occurred_at).isSame(currentMonth, 'month'))
  }, [entries, currentMonth])

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

  const ratio = monthTotals.income > 0 ? monthTotals.expense / monthTotals.income : 0

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
          {monthEntries.length === 0 && <li className="muted">履歴がありません</li>}
          {monthEntries.map((entry) => {
            const category = entry.entry_category_id ? categoryMap.get(entry.entry_category_id) : null
            const method = entry.payment_method_id ? paymentMap.get(entry.payment_method_id) : null
            return (
              <li key={entry.id}>
                <div>
                  <span className={`badge ${entry.entry_type}`}>{entry.entry_type === 'income' ? '収入' : '支出'}</span>
                  <div className="entry-main">
                    <strong>{formatAmount(entry.amount)}</strong>
                    <span>{dayjs(entry.occurred_at).format('YYYY/MM/DD')}</span>
                  </div>
                  <div className="entry-sub">
                    <span>{category?.name ?? '未分類'}</span>
                    <span>{method?.name ?? '未設定'}</span>
                    <span>{entry.memo ?? ''}</span>
                  </div>
                </div>
                <button className="text-button" onClick={() => onDelete(entry)}>
                  削除
                </button>
              </li>
            )}
          )}
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
              return (
                <div
                  key={cell.date.toISOString()}
                  className={`calendar-cell ${cell.inMonth ? '' : 'muted'} ${weekendClass}`}
                >
                  <span className="calendar-date">{cell.date.date()}</span>
                  {cell.totals.expense > 0 && (
                    <span className="calendar-amount expense">{formatAmount(cell.totals.expense)}</span>
                  )}
                  {cell.totals.income > 0 && (
                    <span className="calendar-amount income">{formatAmount(cell.totals.income)}</span>
                  )}
                </div>
              )
            })}
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

  const localReport = useMemo(() => computeReport(entries, categories, range), [entries, categories, range])
  const [report, setReport] = useState<ReportData>(localReport)

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

  const expenseTotal = report.summary.expense
  const donutSegments = report.categoryTotals.filter((item) => item.total > 0)

  const donutGradient = useMemo(() => {
    if (!donutSegments.length) return 'conic-gradient(#e0e0e0 0 100%)'

    let start = 0
    const stops = donutSegments.map((item, index) => {
      const percent = expenseTotal ? (item.total / expenseTotal) * 100 : 0
      const end = start + percent
      const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
      const stop = `${color} ${start}% ${end}%`
      start = end
      return stop
    })

    return `conic-gradient(${stops.join(', ')})`
  }, [donutSegments, expenseTotal])

  return (
    <section className="card">
      <div className="month-header">
        <h2>{dayjs().format('YYYY年 M月')}</h2>
      </div>
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

      <div className="donut" style={{ background: donutGradient }}>
        <div className="donut-center">
          <span>支出</span>
          <strong>¥{formatAmount(expenseTotal)}</strong>
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
        <h3>カテゴリ別（支出）</h3>
        <ul className="list compact">
          {report.categoryTotals.length === 0 && <li>データがありません</li>}
          {report.categoryTotals.map((item, index) => {
            const percent = expenseTotal ? Math.round((item.total / expenseTotal) * 100) : 0
            const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
            return (
              <li key={item.id}>
                <div className="entry-main">
                  <strong>{item.name}</strong>
                  <span>¥{formatAmount(item.total)}</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${percent}%`, background: color }} />
                </div>
              </li>
            )}
          )}
        </ul>
      </div>
    </section>
  )
}

type CategorySettingsProps = {
  categories: EntryCategory[]
  onAdd: (name: string, type: string) => void
  onDelete: (category: EntryCategory) => void
}

const CategorySettings = ({ categories, onAdd, onDelete }: CategorySettingsProps) => {
  const [name, setName] = useState('')
  const [type, setType] = useState('expense')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), type)
    setName('')
  }

  return (
    <div>
      <h3>明細カテゴリ</h3>
      <form className="form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="カテゴリ名"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="expense">支出</option>
          <option value="income">収入</option>
        </select>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
      <ul className="list compact">
        {categories.map((category) => (
          <li key={category.id}>
            <span>{category.name}</span>
            <button className="text-button" onClick={() => onDelete(category)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type PaymentMethodSettingsProps = {
  paymentMethods: PaymentMethod[]
  onAdd: (name: string, type: string) => void
  onDelete: (method: PaymentMethod) => void
}

const PaymentMethodSettings = ({ paymentMethods, onAdd, onDelete }: PaymentMethodSettingsProps) => {
  const [name, setName] = useState('')
  const [type, setType] = useState('card')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), type)
    setName('')
  }

  return (
    <div>
      <h3>支払い方法</h3>
      <form className="form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="card">クレジットカード</option>
          <option value="bank">銀行口座</option>
          <option value="emoney">電子マネー</option>
        </select>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
      <ul className="list compact">
        {paymentMethods.map((method) => (
          <li key={method.id}>
            <span>{method.name}</span>
            <button className="text-button" onClick={() => onDelete(method)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type RecurringRuleSettingsProps = {
  rules: RecurringRule[]
  categories: SelectOption[]
  paymentMethods: SelectOption[]
  onAdd: (payload: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    frequency: string
    dayOfMonth: number | null
  }) => void
  onDelete: (rule: RecurringRule) => void
}

const RecurringRuleSettings = ({
  rules,
  categories,
  paymentMethods,
  onAdd,
  onDelete,
}: RecurringRuleSettingsProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [amount, setAmount] = useState('')
  const [entryCategoryId, setEntryCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [memo, setMemo] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('25')

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
  }

  return (
    <div>
      <h3>定期収入・支出</h3>
      <form className="form" onSubmit={handleSubmit}>
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
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
        <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
          <option value="">支払い方法</option>
          {paymentMethods.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
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
          </select>
          <input
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(event.target.value)}
          />
        </div>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
      <ul className="list compact">
        {rules.map((rule) => (
          <li key={rule.id}>
            <span>{`${rule.entry_type === 'income' ? '収入' : '支出'} ${formatAmount(rule.amount)}`}</span>
            <button className="text-button" onClick={() => onDelete(rule)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
