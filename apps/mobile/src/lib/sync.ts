import { apiFetch } from './api'
import { db } from '../db'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule, OutboxItem } from '../types'

const LAST_SYNC_KEY = 'last_sync'

const getLastSync = () => localStorage.getItem(LAST_SYNC_KEY)
const setLastSync = (value: string) => localStorage.setItem(LAST_SYNC_KEY, value)

const toTokyoDateString = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return tokyo.toISOString().slice(0, 10)
}

const normalizeEntry = (entry: Entry): Entry => {
  if (entry.occurred_on) return entry
  return {
    ...entry,
    occurred_on: toTokyoDateString(entry.occurred_at),
  }
}

const applyEntry = async (entry: Entry | null) => {
  if (!entry) return
  await db.entries.put(normalizeEntry(entry))
}

const applyEntryCategory = async (entryCategory: EntryCategory | null) => {
  if (!entryCategory) return
  await db.entryCategories.put(entryCategory)
}

const applyPaymentMethod = async (paymentMethod: PaymentMethod | null) => {
  if (!paymentMethod) return
  await db.paymentMethods.put(paymentMethod)
}

const applyRecurringRule = async (recurringRule: RecurringRule | null) => {
  if (!recurringRule) return
  await db.recurringRules.put(recurringRule)
}

const syncItem = async (item: OutboxItem) => {
  const response = await apiFetch(item.endpoint, {
    method: item.method,
    body: item.payload ? JSON.stringify(item.payload) : undefined,
  })

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`)
  }

  const data = (await response.json()) as Record<string, unknown>

  if (item.endpoint.startsWith('/entries')) {
    await applyEntry((data.entry as Entry | undefined) ?? null)
  } else if (item.endpoint.startsWith('/entry-categories')) {
    await applyEntryCategory((data.entry_category as EntryCategory | undefined) ?? null)
  } else if (item.endpoint.startsWith('/payment-methods')) {
    await applyPaymentMethod((data.payment_method as PaymentMethod | undefined) ?? null)
  } else if (item.endpoint.startsWith('/recurring-rules')) {
    await applyRecurringRule((data.recurring_rule as RecurringRule | undefined) ?? null)
  }
}

const pullEntries = async () => {
  const since = getLastSync()
  const response = await apiFetch(`/entries${since ? `?since=${encodeURIComponent(since)}` : ''}`)
  if (!response.ok) throw new Error('Failed to fetch entries')
  const data = (await response.json()) as { entries: Entry[] }
  if (data.entries?.length) {
    await db.entries.bulkPut(data.entries.map((entry) => normalizeEntry(entry)))
  }
}

const pullEntryCategories = async () => {
  const response = await apiFetch('/entry-categories')
  if (!response.ok) return
  const data = (await response.json()) as { entry_categories: EntryCategory[] }
  if (data.entry_categories?.length) {
    await db.entryCategories.bulkPut(data.entry_categories)
  }
}

const pullPaymentMethods = async () => {
  const response = await apiFetch('/payment-methods')
  if (!response.ok) return
  const data = (await response.json()) as { payment_methods: PaymentMethod[] }
  if (data.payment_methods?.length) {
    await db.paymentMethods.bulkPut(data.payment_methods)
  }
}

const pullRecurringRules = async () => {
  const response = await apiFetch('/recurring-rules')
  if (!response.ok) return
  const data = (await response.json()) as { recurring_rules: RecurringRule[] }
  if (data.recurring_rules?.length) {
    await db.recurringRules.bulkPut(data.recurring_rules)
  }
}

export const syncOutbox = async () => {
  const items = await db.outbox.orderBy('created_at').toArray()

  for (const item of items) {
    try {
      await syncItem(item)
      await db.outbox.delete(item.id)
    } catch {
      break
    }
  }

  let entriesSynced = false
  try {
    await pullEntries()
    entriesSynced = true
  } catch {}

  await Promise.allSettled([pullEntryCategories(), pullPaymentMethods(), pullRecurringRules()])

  if (entriesSynced) {
    setLastSync(new Date().toISOString())
  }
}

export const enqueueOutbox = async (item: OutboxItem) => {
  await db.outbox.put(item)
}
