import Dexie, { type Table } from 'dexie'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule, OutboxItem } from './types'

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
  }
}

export const db = new KakeiboDB()
