import { apiFetch, getFamilyId } from './api'
import { db } from '../db'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule, OutboxDeadLetter, OutboxItem } from '../types'

const LAST_SYNC_KEY = 'last_sync'
const SYNC_CURSOR_KEY = 'sync_cursor'
const SYNC_EVENT_KEY = 'sync_event_buffer'

const MAX_ERROR_DETAIL_LENGTH = 4000
const SYNC_EVENT_LIMIT = 80
const PULL_PAGE_SIZE = 200
const BASE_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 5 * 60_000

const RETRYABLE_STATUS = new Set([408, 425, 429])
const AUTH_STATUS = new Set([401, 403])

const getLastSync = () => localStorage.getItem(LAST_SYNC_KEY)
const setLastSync = (value: string) => localStorage.setItem(LAST_SYNC_KEY, value)
const getSyncCursor = () => Number(localStorage.getItem(SYNC_CURSOR_KEY) ?? '0')
const setSyncCursor = (value: number) => localStorage.setItem(SYNC_CURSOR_KEY, String(value))

type SyncStage = 'outbox' | 'pull'

type SyncEvent = {
  occurred_at: string
  level: 'info' | 'warn' | 'error'
  stage: SyncStage | 'engine'
  message: string
  status?: number
  endpoint?: string
  method?: string
  error_code?: string | null
}

export type SyncFailure = {
  stage: SyncStage
  occurred_at: string
  status?: number
  message?: string
  detail?: string
  endpoint?: string
  method?: string
  error_code?: string
  retryable?: boolean
  auth_required?: boolean
}

export type SyncResult =
  | { ok: true; dead_letters: number }
  | { ok: false; failure: SyncFailure; dead_letters: number }

export type EnqueueOutboxInput = {
  id?: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  endpoint: string
  payload: Record<string, unknown> | null
  created_at?: string
  entity_type?: OutboxItem['entity_type']
  entity_id?: string
  operation?: OutboxItem['operation']
  base_updated_at?: string | null
}

class SyncError extends Error {
  stage: SyncStage
  occurredAt: string
  status?: number
  detail?: string
  endpoint?: string
  method?: string
  errorCode?: string
  retryable?: boolean
  authRequired?: boolean

  constructor(
    stage: SyncStage,
    options: {
      status?: number
      message?: string
      detail?: string
      endpoint?: string
      method?: string
      errorCode?: string
      retryable?: boolean
      authRequired?: boolean
    } = {}
  ) {
    super(options.message ?? 'Sync failed')
    this.stage = stage
    this.occurredAt = new Date().toISOString()
    this.status = options.status
    this.detail = options.detail
    this.endpoint = options.endpoint
    this.method = options.method
    this.errorCode = options.errorCode
    this.retryable = options.retryable
    this.authRequired = options.authRequired
  }
}

let inFlightSync: Promise<SyncResult> | null = null
let rerunRequested = false
let queueOrderSeed = 0

const trimErrorDetail = (value: string) => {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH)}...`
}

const stringifyDetail = (value: unknown) => {
  if (typeof value === 'string') return trimErrorDetail(value)
  try {
    return trimErrorDetail(JSON.stringify(value))
  } catch {
    return undefined
  }
}

const readEventBuffer = (): SyncEvent[] => {
  const raw = localStorage.getItem(SYNC_EVENT_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SyncEvent[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((event) => typeof event === 'object' && event !== null)
  } catch {
    return []
  }
}

const appendSyncEvent = (event: Omit<SyncEvent, 'occurred_at'> & { occurred_at?: string }) => {
  const current = readEventBuffer()
  const next: SyncEvent = {
    occurred_at: event.occurred_at ?? new Date().toISOString(),
    level: event.level,
    stage: event.stage,
    message: event.message,
    ...(typeof event.status === 'number' ? { status: event.status } : {}),
    ...(event.endpoint ? { endpoint: event.endpoint } : {}),
    ...(event.method ? { method: event.method } : {}),
    ...(typeof event.error_code === 'string' ? { error_code: event.error_code } : {}),
  }
  const merged = [...current, next]
  if (merged.length > SYNC_EVENT_LIMIT) {
    merged.splice(0, merged.length - SYNC_EVENT_LIMIT)
  }
  localStorage.setItem(SYNC_EVENT_KEY, JSON.stringify(merged))
}

export const getRecentSyncEvents = (limit = 30) => {
  const all = readEventBuffer()
  return all.slice(Math.max(0, all.length - limit))
}

type SyncChange = {
  id: number
  entity_type: string
  entity_id: string
  action: 'upsert' | 'delete'
  payload: Record<string, unknown> | null
  created_at: string
}

type FatalConflictError = {
  kind: 'fatal_conflict'
  code: string
  message: string
  entity_type: string
  entity_id: string
  server_snapshot: Record<string, unknown> | null
  resolution_hint: string
  retryable: false
}

const parseOutboxEndpoint = (endpoint: string) => {
  const match = endpoint.match(/^\/([^/?#]+)(?:\/([^/?#]+))?/)
  if (!match) return { entityType: null, entityId: null }
  const resource = match[1]
  const entityId = match[2] ? decodeURIComponent(match[2]) : null
  if (resource === 'entries') return { entityType: 'entries' as const, entityId }
  if (resource === 'entry-categories') return { entityType: 'entry_categories' as const, entityId }
  if (resource === 'payment-methods') return { entityType: 'payment_methods' as const, entityId }
  if (resource === 'recurring-rules') return { entityType: 'recurring_rules' as const, entityId }
  if (resource === 'monthly-balance') return { entityType: 'monthly_balance' as const, entityId }
  return { entityType: null, entityId }
}

const extractPayloadId = (payload: Record<string, unknown> | null) => {
  if (!payload || typeof payload !== 'object') return null
  return typeof payload.id === 'string' ? payload.id : null
}

const extractBaseUpdatedAt = (payload: Record<string, unknown> | null) => {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.base_updated_at === 'string') return payload.base_updated_at
  if (typeof payload.client_updated_at === 'string') return payload.client_updated_at
  return null
}

const withBaseUpdatedAt = (payload: Record<string, unknown> | null, baseUpdatedAt: string | null) => {
  if (!payload) return null
  const next = { ...payload }
  delete next.client_updated_at
  if (baseUpdatedAt) {
    next.base_updated_at = baseUpdatedAt
  } else {
    delete next.base_updated_at
  }
  return next
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

const applyMutationResponse = async (item: OutboxItem, data: Record<string, unknown> | null) => {
  if (!data) return
  if (item.endpoint.startsWith('/entries')) {
    await applyEntry((data.entry as Entry | undefined) ?? null)
    return
  }
  if (item.endpoint.startsWith('/entry-categories')) {
    await applyEntryCategory((data.entry_category as EntryCategory | undefined) ?? null)
    return
  }
  if (item.endpoint.startsWith('/payment-methods')) {
    await applyPaymentMethod((data.payment_method as PaymentMethod | undefined) ?? null)
    return
  }
  if (item.endpoint.startsWith('/recurring-rules')) {
    await applyRecurringRule((data.recurring_rule as RecurringRule | undefined) ?? null)
    return
  }
  if (item.endpoint.startsWith('/monthly-balance')) {
    const row = data.monthly_balance as { ym?: string; balance?: number; is_closed?: number; updated_at?: string } | undefined
    if (row) {
      await applyMonthlyBalance(row)
    }
  }
}

const parseFatalConflict = (payload: unknown): FatalConflictError | null => {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null

  const kind = (error as { kind?: unknown }).kind
  if (kind !== 'fatal_conflict') return null

  const code = (error as { code?: unknown }).code
  const message = (error as { message?: unknown }).message
  const entityType = (error as { entity_type?: unknown }).entity_type
  const entityId = (error as { entity_id?: unknown }).entity_id
  const serverSnapshot = (error as { server_snapshot?: unknown }).server_snapshot
  const resolutionHint = (error as { resolution_hint?: unknown }).resolution_hint

  if (
    typeof code !== 'string' ||
    typeof message !== 'string' ||
    typeof entityType !== 'string' ||
    typeof entityId !== 'string' ||
    typeof resolutionHint !== 'string'
  ) {
    return null
  }

  return {
    kind: 'fatal_conflict',
    code,
    message,
    entity_type: entityType,
    entity_id: entityId,
    server_snapshot:
      serverSnapshot && typeof serverSnapshot === 'object' && !Array.isArray(serverSnapshot)
        ? (serverSnapshot as Record<string, unknown>)
        : null,
    resolution_hint: resolutionHint,
    retryable: false,
  }
}

const readResponsePayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      return await response.json()
    }
    return await response.text()
  } catch {
    return null
  }
}

const parseServerErrorCode = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return undefined
  const error = (payload as { error?: unknown }).error
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return undefined
}

const parseServerMessage = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return undefined
  const error = (payload as { error?: unknown }).error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  const message = (payload as { message?: unknown }).message
  if (typeof message === 'string' && message) return message
  return undefined
}

const buildFailure = (error: unknown, stage: SyncStage): SyncFailure => {
  if (error instanceof SyncError) {
    return {
      stage: error.stage,
      occurred_at: error.occurredAt,
      status: error.status,
      message: error.message,
      detail: error.detail,
      endpoint: error.endpoint,
      method: error.method,
      error_code: error.errorCode,
      retryable: error.retryable,
      auth_required: error.authRequired,
    }
  }
  if (error instanceof Error) {
    return {
      stage,
      occurred_at: new Date().toISOString(),
      message: error.message,
      detail: trimErrorDetail(error.stack ?? error.message),
      retryable: true,
    }
  }
  return { stage, occurred_at: new Date().toISOString(), message: 'Unknown sync failure' }
}

const isRetryableStatus = (status: number) => {
  if (RETRYABLE_STATUS.has(status)) return true
  return status >= 500
}

const computeBackoffMs = (attemptCount: number) => {
  const cappedAttempt = Math.max(1, attemptCount)
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (cappedAttempt - 1))
  const jitter = Math.round(exponential * (Math.random() * 0.2))
  return exponential + jitter
}

const markRetryForItem = async (
  item: OutboxItem,
  options: {
    status?: number
    detail?: string
    errorCode?: string
  }
) => {
  const nextAttemptCount = (item.attempt_count ?? 0) + 1
  const nextRetryAt = new Date(Date.now() + computeBackoffMs(nextAttemptCount)).toISOString()
  await db.outbox.update(item.id, {
    attempt_count: nextAttemptCount,
    next_retry_at: nextRetryAt,
    last_error_code: options.errorCode ?? item.last_error_code ?? null,
    last_error_detail: options.detail ?? item.last_error_detail ?? null,
  })
  appendSyncEvent({
    level: 'warn',
    stage: 'outbox',
    message: 'retry scheduled',
    status: options.status,
    method: item.method,
    endpoint: item.endpoint,
    error_code: options.errorCode ?? null,
  })
}

const moveToDeadLetter = async (
  item: OutboxItem,
  options: {
    status: number | null
    errorCode: string
    errorDetail?: string
    serverSnapshot?: Record<string, unknown> | null
  }
) => {
  const deadLetter: OutboxDeadLetter = {
    id: item.id,
    failed_at: new Date().toISOString(),
    status: options.status,
    error_code: options.errorCode,
    error_detail: options.errorDetail ?? null,
    server_snapshot: options.serverSnapshot ?? null,
    request_payload: item.payload,
    endpoint: item.endpoint,
    method: item.method,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
  }

  await db.transaction('rw', [db.outbox, db.outboxDeadLetters], async () => {
    await db.outbox.delete(item.id)
    await db.outboxDeadLetters.put(deadLetter)
  })

  appendSyncEvent({
    level: 'error',
    stage: 'outbox',
    message: 'moved to dead-letter',
    status: options.status ?? undefined,
    method: item.method,
    endpoint: item.endpoint,
    error_code: options.errorCode,
  })
}

const syncItem = async (item: OutboxItem): Promise<'success' | 'dead-letter'> => {
  try {
    const response = await apiFetch(item.endpoint, {
      method: item.method,
      headers: {
        'X-Outbox-Id': item.id,
      },
      body: item.payload ? JSON.stringify(item.payload) : undefined,
    })

    if (!response.ok) {
      const responsePayload = await readResponsePayload(response)
      const detail =
        parseServerMessage(responsePayload) ??
        (typeof responsePayload === 'string' ? trimErrorDetail(responsePayload) : stringifyDetail(responsePayload))
      const errorCode = parseServerErrorCode(responsePayload)
      const fatalConflict = parseFatalConflict(responsePayload)

      if (fatalConflict) {
        await moveToDeadLetter(item, {
          status: response.status,
          errorCode: fatalConflict.code,
          errorDetail: trimErrorDetail(
            `${fatalConflict.message} (hint: ${fatalConflict.resolution_hint})`
          ),
          serverSnapshot: fatalConflict.server_snapshot,
        })
        return 'dead-letter'
      }

      if (AUTH_STATUS.has(response.status)) {
        throw new SyncError('outbox', {
          status: response.status,
          message: 'Auth required during sync',
          detail,
          endpoint: item.endpoint,
          method: item.method,
          errorCode: errorCode ?? 'AUTH_REQUIRED',
          authRequired: true,
          retryable: false,
        })
      }

      if (isRetryableStatus(response.status)) {
        await markRetryForItem(item, {
          status: response.status,
          detail,
          errorCode: errorCode ?? `HTTP_${response.status}`,
        })
        throw new SyncError('outbox', {
          status: response.status,
          message: `Sync failed: ${response.status}`,
          detail,
          endpoint: item.endpoint,
          method: item.method,
          errorCode: errorCode ?? `HTTP_${response.status}`,
          retryable: true,
        })
      }

      await moveToDeadLetter(item, {
        status: response.status,
        errorCode: errorCode ?? (response.status === 409 ? 'RESOURCE_STATE_INVALID' : `HTTP_${response.status}`),
        errorDetail: detail,
        serverSnapshot: null,
      })
      return 'dead-letter'
    }

    const payload = await readResponsePayload(response)
    const responseData =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null

    if (responseData?.conflict === true) {
      appendSyncEvent({
        level: 'info',
        stage: 'outbox',
        message: 'soft conflict resolved',
        method: item.method,
        endpoint: item.endpoint,
      })
    }

    await applyMutationResponse(item, responseData)
    await db.outbox.delete(item.id)
    return 'success'
  } catch (error) {
    if (error instanceof SyncError) {
      throw error
    }

    const detail = error instanceof Error ? trimErrorDetail(error.message) : undefined
    await markRetryForItem(item, {
      detail,
      errorCode: 'NETWORK_ERROR',
    })

    throw new SyncError('outbox', {
      message: 'Network error during sync',
      detail,
      endpoint: item.endpoint,
      method: item.method,
      errorCode: 'NETWORK_ERROR',
      retryable: true,
    })
  }
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

const fetchChanges = async (cursor: number, limit = PULL_PAGE_SIZE) => {
  const endpoint = `/sync?cursor=${cursor}&limit=${limit}`
  const response = await apiFetch(endpoint)
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    const detail = parseServerMessage(payload) ?? stringifyDetail(payload)
    const code = parseServerErrorCode(payload) ?? `HTTP_${response.status}`
    throw new SyncError('pull', {
      status: response.status,
      message: `Failed to sync changes: ${response.status}`,
      detail,
      endpoint,
      method: 'GET',
      errorCode: code,
      retryable: isRetryableStatus(response.status),
      authRequired: AUTH_STATUS.has(response.status),
    })
  }

  return payload as { changes: SyncChange[]; next_cursor: number; server_time: string }
}

const fetchBootstrap = async () => {
  const endpoint = '/bootstrap'
  const response = await apiFetch(endpoint)
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    const detail = parseServerMessage(payload) ?? stringifyDetail(payload)
    const code = parseServerErrorCode(payload) ?? `HTTP_${response.status}`
    throw new SyncError('pull', {
      status: response.status,
      message: `Failed to bootstrap: ${response.status}`,
      detail,
      endpoint,
      method: 'GET',
      errorCode: code,
      retryable: isRetryableStatus(response.status),
      authRequired: AUTH_STATUS.has(response.status),
    })
  }

  return payload as {
    entries: Entry[]
    entry_categories: EntryCategory[]
    payment_methods: PaymentMethod[]
    recurring_rules: RecurringRule[]
    monthly_balances: { ym?: string; balance?: number; is_closed?: number; updated_at?: string }[]
    next_cursor: number
    server_time: string
  }
}

const syncFromServer = async () => {
  const cursor = getSyncCursor()

  if (!cursor) {
    const bootstrap = await fetchBootstrap()
    const familyId = getFamilyId()
    const balanceRecords = (bootstrap.monthly_balances ?? []).filter(
      (row) => typeof row.ym === 'string' && typeof row.balance === 'number'
    )
    await db.transaction(
      'rw',
      [db.entries, db.entryCategories, db.paymentMethods, db.recurringRules, db.monthlyBalances],
      async () => {
        if (bootstrap.entries?.length) {
          await db.entries.bulkPut(bootstrap.entries.map((entry) => normalizeEntry(entry)))
        }
        if (bootstrap.entry_categories?.length) {
          await db.entryCategories.bulkPut(bootstrap.entry_categories)
        }
        if (bootstrap.payment_methods?.length) {
          await db.paymentMethods.bulkPut(bootstrap.payment_methods)
        }
        if (bootstrap.recurring_rules?.length) {
          await db.recurringRules.bulkPut(bootstrap.recurring_rules)
        }
        if (balanceRecords.length) {
          await db.monthlyBalances.bulkPut(
            balanceRecords.map((row) => ({
              id: buildMonthlyBalanceId(familyId, row.ym as string),
              family_id: familyId,
              ym: row.ym as string,
              balance: row.balance as number,
              is_closed: row.is_closed ?? 0,
              updated_at: row.updated_at ?? new Date().toISOString(),
            }))
          )
        }
      }
    )
    setSyncCursor(bootstrap.next_cursor)
    return bootstrap.server_time
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
    if (changes.length < PULL_PAGE_SIZE) {
      break
    }
  }
  setSyncCursor(nextCursor)
  return serverTime
}

const runOutbox = async (): Promise<SyncResult> => {
  const now = Date.now()
  const items = await db.outbox.orderBy('queue_order').toArray()
  let deadLetters = 0

  for (const item of items) {
    if (item.next_retry_at) {
      const dueAt = Date.parse(item.next_retry_at)
      if (Number.isFinite(dueAt) && dueAt > now) {
        continue
      }
    }

    try {
      const result = await syncItem(item)
      if (result === 'dead-letter') {
        deadLetters += 1
      }
    } catch (error) {
      return { ok: false, failure: buildFailure(error, 'outbox'), dead_letters: deadLetters }
    }
  }

  return { ok: true, dead_letters: deadLetters }
}

const runSyncCycle = async (): Promise<SyncResult> => {
  const outboxResult = await runOutbox()
  if (!outboxResult.ok) {
    appendSyncEvent({
      level: 'error',
      stage: 'outbox',
      message: outboxResult.failure.message ?? 'outbox sync failed',
      status: outboxResult.failure.status,
      endpoint: outboxResult.failure.endpoint,
      method: outboxResult.failure.method,
      error_code: outboxResult.failure.error_code,
    })
    return outboxResult
  }

  try {
    const serverTime = await syncFromServer()
    if (serverTime) {
      setLastSync(serverTime)
    }
    appendSyncEvent({
      level: 'info',
      stage: 'pull',
      message: 'sync completed',
    })
    return { ok: true, dead_letters: outboxResult.dead_letters }
  } catch (error) {
    const failure = buildFailure(error, 'pull')
    appendSyncEvent({
      level: 'error',
      stage: 'pull',
      message: failure.message ?? 'pull failed',
      status: failure.status,
      endpoint: failure.endpoint,
      method: failure.method,
      error_code: failure.error_code,
    })
    return {
      ok: false,
      failure,
      dead_letters: outboxResult.dead_letters,
    }
  }
}

const mergeSyncResult = (first: SyncResult, second: SyncResult): SyncResult => {
  const deadLetters = first.dead_letters + second.dead_letters
  if (!second.ok) {
    return {
      ok: false,
      failure: second.failure,
      dead_letters: deadLetters,
    }
  }
  if (!first.ok) {
    return {
      ok: false,
      failure: first.failure,
      dead_letters: deadLetters,
    }
  }
  return { ok: true, dead_letters: deadLetters }
}

export const syncOutbox = async (): Promise<SyncResult> => {
  if (inFlightSync) {
    rerunRequested = true
    return inFlightSync
  }

  inFlightSync = (async () => {
    let result = await runSyncCycle()

    // 同期中に新規enqueueされた場合は完了後に1回だけ再実行する。
    if (rerunRequested && result.ok) {
      rerunRequested = false
      const rerunResult = await runSyncCycle()
      result = mergeSyncResult(result, rerunResult)
    }

    return result
  })()

  try {
    return await inFlightSync
  } finally {
    inFlightSync = null
    rerunRequested = false
  }
}

const buildQueueOrder = (createdAt: string) => {
  const parsed = Date.parse(createdAt)
  const base = Number.isFinite(parsed) ? parsed : Date.now()
  queueOrderSeed += 1
  return base * 1000 + (queueOrderSeed % 1000)
}

const normalizeOutboxItem = (input: EnqueueOutboxInput): OutboxItem => {
  const createdAt = input.created_at ?? new Date().toISOString()
  const parsedEndpoint = parseOutboxEndpoint(input.endpoint)
  const payload = input.payload && typeof input.payload === 'object' ? { ...input.payload } : null
  const resolvedBaseUpdatedAt = input.base_updated_at ?? extractBaseUpdatedAt(payload)
  const resolvedEntityType = input.entity_type ?? parsedEndpoint.entityType ?? 'entries'
  const resolvedEntityId = input.entity_id ?? parsedEndpoint.entityId ?? extractPayloadId(payload) ?? input.id ?? crypto.randomUUID()
  const operation = input.operation ?? (input.method === 'DELETE' ? 'delete' : 'upsert')

  return {
    id: input.id ?? crypto.randomUUID(),
    method: input.method,
    endpoint: input.endpoint,
    payload: withBaseUpdatedAt(payload, resolvedBaseUpdatedAt),
    created_at: createdAt,
    queue_order: buildQueueOrder(createdAt),
    entity_type: resolvedEntityType,
    entity_id: resolvedEntityId,
    operation,
    base_updated_at: resolvedBaseUpdatedAt ?? null,
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    last_error_detail: null,
  }
}

export const enqueueOutbox = async (input: EnqueueOutboxInput) => {
  const candidate = normalizeOutboxItem(input)

  await db.transaction('rw', db.outbox, async () => {
    const unsent = await db.outbox
      .where('[entity_type+entity_id]')
      .equals([candidate.entity_type, candidate.entity_id])
      .and((item) => item.attempt_count === 0)
      .toArray()

    if (!unsent.length) {
      await db.outbox.put(candidate)
      return
    }

    const sorted = unsent.sort((left, right) => left.queue_order - right.queue_order)
    const head = sorted[0]
    const keptBaseUpdatedAt =
      sorted.find((item) => typeof item.base_updated_at === 'string' && item.base_updated_at.length > 0)?.base_updated_at ??
      candidate.base_updated_at

    const merged: OutboxItem = {
      ...candidate,
      id: head.id,
      created_at: head.created_at,
      queue_order: Math.min(head.queue_order, candidate.queue_order),
      base_updated_at: keptBaseUpdatedAt ?? null,
      payload: withBaseUpdatedAt(candidate.payload, keptBaseUpdatedAt ?? null),
    }

    await db.outbox.bulkDelete(sorted.map((item) => item.id))
    await db.outbox.put(merged)
  })

  appendSyncEvent({
    level: 'info',
    stage: 'engine',
    message: 'enqueue outbox',
    endpoint: candidate.endpoint,
    method: candidate.method,
  })
}
