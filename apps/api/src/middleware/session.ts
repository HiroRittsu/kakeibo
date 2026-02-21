import type { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { jsonError, loadSession } from '../shared'

export const registerSessionMiddleware = (app: Hono<HonoEnv>) => {
  app.use('*', async (c, next) => {
    await loadSession(c)
    const path = c.req.path
    if (c.req.method === 'OPTIONS' || path === '/health' || path.startsWith('/auth/')) {
      return next()
    }
    const session = c.get('session')
    if (!session || !session.family_id) {
      return c.json(jsonError('Unauthorized', 401), 401)
    }
    return next()
  })
}
