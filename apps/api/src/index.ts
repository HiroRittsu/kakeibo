import { createApp } from './app'
import type { Bindings } from './types'
import { cleanupMutationReceipts, generateRecurringEntries, runMonthStartBalanceUpdate } from './shared'

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled: (event: { scheduledTime?: number }, env: Bindings, ctx: ExecutionContext) => {
    const scheduledTime = typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now()
    const scheduledDate = new Date(scheduledTime)
    ctx.waitUntil(generateRecurringEntries(env.DB, scheduledDate))
    ctx.waitUntil(runMonthStartBalanceUpdate(env.DB, scheduledDate))
    ctx.waitUntil(cleanupMutationReceipts(env.DB))
  },
}
