import { Hono } from 'hono'
import type { HonoEnv } from './types'
import { registerCorsMiddleware } from './middleware/cors'
import { registerSessionMiddleware } from './middleware/session'
import { registerAuthRoutes } from './routes/auth'
import { registerSyncRoutes } from './routes/sync'
import { registerEntryRoutes } from './routes/entries'
import { registerEntryCategoryRoutes } from './routes/entry-categories'
import { registerPaymentMethodRoutes } from './routes/payment-methods'
import { registerRecurringRuleRoutes } from './routes/recurring-rules'
import { registerMonthlyBalanceRoutes } from './routes/monthly-balance'
import { registerReportRoutes } from './routes/reports'
import { registerAuditLogRoutes } from './routes/audit-logs'

export const createApp = () => {
  const app = new Hono<HonoEnv>()

  registerCorsMiddleware(app)
  registerSessionMiddleware(app)

  registerAuthRoutes(app)
  registerSyncRoutes(app)
  registerEntryRoutes(app)
  registerEntryCategoryRoutes(app)
  registerPaymentMethodRoutes(app)
  registerRecurringRuleRoutes(app)
  registerMonthlyBalanceRoutes(app)
  registerReportRoutes(app)
  registerAuditLogRoutes(app)

  app.notFound((c) => c.json({ message: 'Not found' }, 404))

  return app
}
