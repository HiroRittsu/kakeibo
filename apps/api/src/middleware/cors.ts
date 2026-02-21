import { cors } from 'hono/cors'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { resolveCorsOrigin } from '../shared'

export const registerCorsMiddleware = (app: Hono<HonoEnv>) => {
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    const allowedOrigin = resolveCorsOrigin(origin, c.env)
    return cors({
      origin: allowedOrigin,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Outbox-Id'],
      credentials: true,
    })(c, next)
  })
}
