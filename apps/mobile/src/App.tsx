import { type FormEvent, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import './App.css'
import { db } from './db'
import { enqueueOutbox, syncOutbox } from './lib/sync'
import { getFamilyId } from './lib/api'
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
        <button className="icon-button" onClick={() => setMenuOpen(true)}>
          ☰
        </button>
        <div className="title-group">
          <h1>kakeibo</h1>
          <span className="subtitle">スマホ版</span>
        </div>
        <button className="primary" onClick={handleSync} disabled={syncing}>
          {syncing ? '同期中...' : `更新${outboxCount ? ` (${outboxCount})` : ''}`}
        </button>
      </header>

      <main className="content">
        {activeTab === 'home' && (
          <HomeTab
            categories={categoryOptions}
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

      <nav className="tab-bar">
        <button
          className={activeTab === 'home' ? 'active' : ''}
          onClick={() => setActiveTab('home')}
        >
          入力
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          履歴
        </button>
        <button
          className={activeTab === 'reports' ? 'active' : ''}
          onClick={() => setActiveTab('reports')}
        >
          集計
        </button>
      </nav>

      <div className={`side-menu ${menuOpen ? 'open' : ''}`}>
        <div className="menu-header">
          <h2>設定</h2>
          <button className="icon-button" onClick={() => setMenuOpen(false)}>
            ✕
          </button>
        </div>
        <div className="menu-section">
          <CategorySettings categories={entryCategories ?? []} onAdd={handleAddCategory} onDelete={handleDeleteCategory} />
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
  categories: SelectOption[]
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

const HomeTab = ({ categories, paymentMethods, onSubmit }: HomeTabProps) => {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [memo, setMemo] = useState('')
  const [occurredAt, setOccurredAt] = useState(dayjs().format('YYYY-MM-DD'))

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
      <h2>入力</h2>
      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label>収支</label>
          <div className="segmented">
            <button
              type="button"
              className={entryType === 'expense' ? 'active' : ''}
              onClick={() => setEntryType('expense')}
            >
              支出
            </button>
            <button
              type="button"
              className={entryType === 'income' ? 'active' : ''}
              onClick={() => setEntryType('income')}
            >
              収入
            </button>
          </div>
        </div>
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
          <label>カテゴリ</label>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">未設定</option>
            {categories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
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
  if (!entries.length) {
    return (
      <section className="card empty">
        <p>履歴がありません</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>履歴</h2>
      <ul className="list">
        {entries.map((entry) => {
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
          )
        })}
      </ul>
    </section>
  )
}

type ReportsTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
}

const ReportsTab = ({ entries, categories }: ReportsTabProps) => {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month')

  const { summary, categoryTotals } = useMemo(() => {
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

    const filtered = entries.filter((entry) => {
      const date = dayjs(entry.occurred_at)
      return date.isAfter(start.subtract(1, 'millisecond')) && date.isBefore(end.add(1, 'millisecond'))
    })

    const summaryTotals = {
      income: 0,
      expense: 0,
    }

    const categoryMap = new Map<string, number>()

    filtered.forEach((entry) => {
      summaryTotals[entry.entry_type] += entry.amount
      if (entry.entry_type === 'expense') {
        const key = entry.entry_category_id ?? 'uncategorized'
        categoryMap.set(key, (categoryMap.get(key) ?? 0) + entry.amount)
      }
    })

    const categoryTotalsArray = Array.from(categoryMap.entries())
      .map(([id, total]) => ({
        id,
        total,
        name: categories.find((category) => category.id === id)?.name ?? '未分類',
      }))
      .sort((a, b) => b.total - a.total)

    return { summary: summaryTotals, categoryTotals: categoryTotalsArray }
  }, [entries, range, categories])

  const expenseTotal = summary.expense

  return (
    <section className="card">
      <h2>集計</h2>
      <div className="segmented">
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

      <div className="report-summary">
        <div>
          <span>収入</span>
          <strong>{formatAmount(summary.income)}</strong>
        </div>
        <div>
          <span>支出</span>
          <strong>{formatAmount(summary.expense)}</strong>
        </div>
        <div>
          <span>差額</span>
          <strong>{formatAmount(summary.income - summary.expense)}</strong>
        </div>
      </div>

      <div className="report-section">
        <h3>カテゴリ別（支出）</h3>
        <ul className="list compact">
          {categoryTotals.length === 0 && <li>データがありません</li>}
          {categoryTotals.map((item) => {
            const percent = expenseTotal ? Math.round((item.total / expenseTotal) * 100) : 0
            return (
              <li key={item.id}>
                <div className="entry-main">
                  <strong>{item.name}</strong>
                  <span>{formatAmount(item.total)}</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${percent}%` }} />
                </div>
              </li>
            )
          })}
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
