import Dexie, { type Table } from 'dexie'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule, OutboxItem } from './types'

const toTokyoDateString = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return tokyo.toISOString().slice(0, 10)
}

export class KakeiboDB extends Dexie {
  entries!: Table<Entry, string>
  entryCategories!: Table<EntryCategory, string>
  paymentMethods!: Table<PaymentMethod, string>
  recurringRules!: Table<RecurringRule, string>
  outbox!: Table<OutboxItem, string>

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
  }
}

export const db = new KakeiboDB()
