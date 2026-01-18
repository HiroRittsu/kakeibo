import dayjs from 'dayjs'
import { apiFetch, getFamilyId } from './api'
import { db } from '../db'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule, OutboxItem } from '../types'

const LAST_SYNC_KEY = 'last_sync'
const SYNC_CURSOR_KEY = 'sync_cursor'

const getLastSync = () => localStorage.getItem(LAST_SYNC_KEY)
const setLastSync = (value: string) => localStorage.setItem(LAST_SYNC_KEY, value)
const getSyncCursor = () => Number(localStorage.getItem(SYNC_CURSOR_KEY) ?? '0')
const setSyncCursor = (value: number) => localStorage.setItem(SYNC_CURSOR_KEY, String(value))

type SyncStage = 'outbox' | 'pull'

export type SyncFailure = {
  stage: SyncStage
  status?: number
}

export type SyncResult = { ok: true } | { ok: false; failure: SyncFailure }

class SyncError extends Error {
  stage: SyncStage
  status?: number

  constructor(stage: SyncStage, status?: number, message?: string) {
    super(message ?? 'Sync failed')
    this.stage = stage
    this.status = status
  }
}

const buildFailure = (error: unknown, stage: SyncStage): SyncFailure => {
  if (error instanceof SyncError) {
    return { stage: error.stage, status: error.status }
  }
  return { stage }
}

type SyncChange = {
  id: number
  entity_type: string
  entity_id: string
  action: 'upsert' | 'delete'
  payload: Record<string, unknown> | null
  created_at: string
}

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

const buildMonthlyBalanceId = (familyId: string, ym: string) => `${familyId}:${ym}`

const applyMonthlyBalance = async (row: { ym?: string; balance?: number; is_closed?: number; updated_at?: string }) => {
  if (typeof row.ym !== 'string' || typeof row.balance !== 'number') return
  const familyId = getFamilyId()
  await db.monthlyBalances.put({
    id: buildMonthlyBalanceId(familyId, row.ym),
    family_id: familyId,
    ym: row.ym,
    balance: row.balance,
    is_closed: row.is_closed ?? 0,
    updated_at: row.updated_at ?? new Date().toISOString(),
  })
}

const pullMonthlyBalances = async () => {
  const familyId = getFamilyId()
  const toYm = dayjs().format('YYYY-MM')
  const fromYm = dayjs().subtract(12, 'month').format('YYYY-MM')
  const response = await apiFetch(`/monthly-balances?from=${fromYm}&to=${toYm}`)
  if (!response.ok) return false
  const data = (await response.json()) as {
    monthly_balances?: { ym?: string; balance?: number; is_closed?: number; updated_at?: string }[]
  }
  const rows = data.monthly_balances ?? []
  const records = rows.filter((row) => typeof row.ym === 'string' && typeof row.balance === 'number')
  if (records.length) {
    await db.monthlyBalances.bulkPut(
      records.map((row) => ({
        id: buildMonthlyBalanceId(familyId, row.ym as string),
        family_id: familyId,
        ym: row.ym as string,
        balance: row.balance as number,
        is_closed: row.is_closed ?? 0,
        updated_at: row.updated_at ?? new Date().toISOString(),
      }))
    )
  }
  return true
}

const syncItem = async (item: OutboxItem) => {
  const response = await apiFetch(item.endpoint, {
    method: item.method,
    body: item.payload ? JSON.stringify(item.payload) : undefined,
  })

  if (!response.ok) {
    throw new SyncError('outbox', response.status, `Sync failed: ${response.status}`)
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

const pullEntries = async (since?: string | null) => {
  const response = await apiFetch(`/entries${since ? `?since=${encodeURIComponent(since)}` : ''}`)
  if (!response.ok) return false
  const data = (await response.json()) as { entries: Entry[] }
  if (data.entries?.length) {
    await db.entries.bulkPut(data.entries.map((entry) => normalizeEntry(entry)))
  }
  return true
}

const pullEntryCategories = async () => {
  const response = await apiFetch('/entry-categories')
  if (!response.ok) return false
  const data = (await response.json()) as { entry_categories: EntryCategory[] }
  if (data.entry_categories?.length) {
    await db.entryCategories.bulkPut(data.entry_categories)
  }
  return true
}

const pullPaymentMethods = async () => {
  const response = await apiFetch('/payment-methods')
  if (!response.ok) return false
  const data = (await response.json()) as { payment_methods: PaymentMethod[] }
  if (data.payment_methods?.length) {
    await db.paymentMethods.bulkPut(data.payment_methods)
  }
  return true
}

const pullRecurringRules = async () => {
  const response = await apiFetch('/recurring-rules')
  if (!response.ok) return false
  const data = (await response.json()) as { recurring_rules: RecurringRule[] }
  if (data.recurring_rules?.length) {
    await db.recurringRules.bulkPut(data.recurring_rules)
  }
  return true
}

const applyChange = async (change: SyncChange) => {
  if (change.entity_type === 'entries') {
    if (change.action === 'delete') {
      await db.entries.delete(change.entity_id)
      return
    }
    const entry = (change.payload as { entry?: Entry } | null)?.entry
    await applyEntry(entry ?? null)
    return
  }
  if (change.entity_type === 'entry_categories') {
    if (change.action === 'delete') {
      await db.entryCategories.delete(change.entity_id)
      return
    }
    const entryCategory = (change.payload as { entry_category?: EntryCategory } | null)?.entry_category
    await applyEntryCategory(entryCategory ?? null)
    return
  }
  if (change.entity_type === 'payment_methods') {
    if (change.action === 'delete') {
      await db.paymentMethods.delete(change.entity_id)
      return
    }
    const paymentMethod = (change.payload as { payment_method?: PaymentMethod } | null)?.payment_method
    await applyPaymentMethod(paymentMethod ?? null)
    return
  }
  if (change.entity_type === 'recurring_rules') {
    if (change.action === 'delete') {
      await db.recurringRules.delete(change.entity_id)
      return
    }
    const recurringRule = (change.payload as { recurring_rule?: RecurringRule } | null)?.recurring_rule
    await applyRecurringRule(recurringRule ?? null)
    return
  }
  if (change.entity_type === 'monthly_balance') {
    if (change.action === 'delete') {
      const familyId = getFamilyId()
      await db.monthlyBalances.delete(buildMonthlyBalanceId(familyId, change.entity_id))
      return
    }
    const row = (change.payload as { monthly_balance?: { ym?: string; balance?: number; is_closed?: number; updated_at?: string } } | null)
      ?.monthly_balance
    if (row) {
      await applyMonthlyBalance(row)
    }
  }
}

const fetchChanges = async (cursor: number, limit = 200) => {
  const response = await apiFetch(`/sync?cursor=${cursor}&limit=${limit}`)
  if (!response.ok) throw new SyncError('pull', response.status, `Failed to sync changes: ${response.status}`)
  return (await response.json()) as { changes: SyncChange[]; next_cursor: number; server_time: string }
}

const fetchSyncHead = async () => {
  const response = await apiFetch('/sync?cursor=0&limit=0')
  if (!response.ok) throw new SyncError('pull', response.status, `Failed to sync head: ${response.status}`)
  return (await response.json()) as { changes: SyncChange[]; next_cursor: number; server_time: string }
}

const syncFromServer = async () => {
  const cursor = getSyncCursor()

  if (!cursor) {
    const entriesOk = await pullEntries(null)
    const [categoriesOk, paymentOk, rulesOk, balancesOk] = await Promise.all([
      pullEntryCategories(),
      pullPaymentMethods(),
      pullRecurringRules(),
      pullMonthlyBalances(),
    ])
    if (!entriesOk || !categoriesOk || !paymentOk || !rulesOk || !balancesOk) {
      throw new Error('Initial sync failed')
    }
    const head = await fetchSyncHead()
    setSyncCursor(head.next_cursor)
    return head.server_time
  }

  let nextCursor = cursor
  let serverTime = getLastSync() ?? new Date().toISOString()
  while (true) {
    const { changes, next_cursor, server_time } = await fetchChanges(nextCursor)
    serverTime = server_time
    for (const change of changes) {
      await applyChange(change)
    }
    nextCursor = next_cursor
    if (changes.length < 200) {
      break
    }
  }
  setSyncCursor(nextCursor)
  return serverTime
}

export const syncOutbox = async (): Promise<SyncResult> => {
  const items = await db.outbox.orderBy('created_at').toArray()

  for (const item of items) {
    try {
      await syncItem(item)
      await db.outbox.delete(item.id)
    } catch (error) {
      return { ok: false, failure: buildFailure(error, 'outbox') }
    }
  }

  try {
    const serverTime = await syncFromServer()
    if (serverTime) {
      setLastSync(serverTime)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, failure: buildFailure(error, 'pull') }
  }
}

export const enqueueOutbox = async (item: OutboxItem) => {
  await db.outbox.put(item)
}
