import { db } from '../../infra/db'
import { clearCachedAuthIdentity } from '../../domains/auth/authCache'

export const clearLocalData = async () => {
  await db.transaction(
    'rw',
    [
      db.entries,
      db.entryCategories,
      db.paymentMethods,
      db.recurringRules,
      db.monthlyBalances,
      db.outbox,
      db.outboxDeadLetters,
    ],
    async () => {
      await Promise.all([
        db.entries.clear(),
        db.entryCategories.clear(),
        db.paymentMethods.clear(),
        db.recurringRules.clear(),
        db.monthlyBalances.clear(),
        db.outbox.clear(),
        db.outboxDeadLetters.clear(),
      ])
    }
  )
  localStorage.removeItem('family_id')
  localStorage.removeItem('user_id')
  localStorage.removeItem('last_sync')
  localStorage.removeItem('sync_cursor')
  localStorage.removeItem('sync_event_buffer')
  localStorage.removeItem('bootstrapped_family_id')
  clearCachedAuthIdentity()
}
