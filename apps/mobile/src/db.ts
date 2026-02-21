import Dexie, { type Table } from 'dexie'
import type {
  Entry,
  EntryCategory,
  PaymentMethod,
  RecurringRule,
  MonthlyBalance,
  OutboxDeadLetter,
  OutboxItem,
} from './types'

const toTokyoDateString = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return tokyo.toISOString().slice(0, 10)
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

const normalizeQueueOrder = (createdAt: string, fallbackOrder: number) => {
  const parsed = Date.parse(createdAt)
  if (Number.isFinite(parsed)) return parsed + fallbackOrder
  return Date.now() + fallbackOrder
}

export class KakeiboDB extends Dexie {
  entries!: Table<Entry, string>
  entryCategories!: Table<EntryCategory, string>
  paymentMethods!: Table<PaymentMethod, string>
  recurringRules!: Table<RecurringRule, string>
  monthlyBalances!: Table<MonthlyBalance, string>
  outbox!: Table<OutboxItem, string>
  outboxDeadLetters!: Table<OutboxDeadLetter, string>

  constructor() {
    super('kakeibo-mobile')
    this.version(1).stores({
      entries: 'id, entry_type, occurred_at, updated_at',
      entryCategories: 'id, sort_order, name',
      paymentMethods: 'id, sort_order, name',
      recurringRules: 'id, created_at',
      outbox: 'id, created_at',
    })
    this.version(2)
      .stores({
        entries: 'id, entry_type, occurred_at, occurred_on, updated_at',
        entryCategories: 'id, sort_order, name',
        paymentMethods: 'id, sort_order, name',
        recurringRules: 'id, created_at',
        outbox: 'id, created_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('entries')
          .toCollection()
          .modify((entry) => {
            if (!entry.occurred_on && entry.occurred_at) {
              entry.occurred_on = toTokyoDateString(entry.occurred_at)
            }
          })
      })
    this.version(3)
      .stores({
        entries: 'id, entry_type, occurred_at, occurred_on, updated_at',
        entryCategories: 'id, sort_order, name',
        paymentMethods: 'id, sort_order, name',
        recurringRules: 'id, created_at',
        outbox: 'id, created_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('recurringRules')
          .toCollection()
          .modify((rule) => {
            if (!rule.holiday_adjustment) {
              rule.holiday_adjustment = 'none'
            }
          })
      })
    this.version(4).stores({
      entries: 'id, entry_type, occurred_at, occurred_on, updated_at',
      entryCategories: 'id, sort_order, name',
      paymentMethods: 'id, sort_order, name',
      recurringRules: 'id, created_at',
      monthlyBalances: 'id, ym, updated_at',
      outbox: 'id, created_at',
    })
    this.version(5)
      .stores({
        entries: 'id, entry_type, occurred_at, occurred_on, updated_at',
        entryCategories: 'id, sort_order, name',
        paymentMethods: 'id, sort_order, name',
        recurringRules: 'id, created_at',
        monthlyBalances: 'id, ym, updated_at',
        outbox:
          'id, created_at, queue_order, [entity_type+entity_id], entity_type, entity_id, operation, attempt_count, next_retry_at',
        outboxDeadLetters: 'id, failed_at, status, error_code, [entity_type+entity_id]',
      })
      .upgrade(async (tx) => {
        let offset = 0
        await tx
          .table('outbox')
          .toCollection()
          .modify((item: Record<string, unknown>) => {
            const endpoint = typeof item.endpoint === 'string' ? item.endpoint : ''
            const payload =
              item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
                ? (item.payload as Record<string, unknown>)
                : null
            const parsed = parseOutboxEndpoint(endpoint)
            const createdAt = typeof item.created_at === 'string' ? item.created_at : new Date().toISOString()
            const method =
              item.method === 'POST' || item.method === 'PATCH' || item.method === 'PUT' || item.method === 'DELETE'
                ? item.method
                : 'POST'
            const fallbackId = typeof item.id === 'string' ? item.id : crypto.randomUUID()

            item.id = fallbackId
            item.method = method
            item.endpoint = endpoint
            item.created_at = createdAt
            item.payload = payload
            item.queue_order =
              typeof item.queue_order === 'number' && Number.isFinite(item.queue_order)
                ? item.queue_order
                : normalizeQueueOrder(createdAt, offset)
            item.entity_type =
              typeof item.entity_type === 'string' && item.entity_type
                ? item.entity_type
                : parsed.entityType ?? 'entries'
            item.entity_id =
              typeof item.entity_id === 'string' && item.entity_id
                ? item.entity_id
                : parsed.entityId ?? extractPayloadId(payload) ?? fallbackId
            item.operation = item.operation === 'delete' || method === 'DELETE' ? 'delete' : 'upsert'
            item.base_updated_at =
              typeof item.base_updated_at === 'string' ? item.base_updated_at : extractBaseUpdatedAt(payload)
            item.attempt_count =
              typeof item.attempt_count === 'number' && Number.isFinite(item.attempt_count)
                ? Math.max(0, Math.trunc(item.attempt_count))
                : 0
            item.next_retry_at = typeof item.next_retry_at === 'string' ? item.next_retry_at : null
            item.last_error_code = typeof item.last_error_code === 'string' ? item.last_error_code : null
            item.last_error_detail = typeof item.last_error_detail === 'string' ? item.last_error_detail : null
            offset += 1
          })
      })
  }
}

export const db = new KakeiboDB()
