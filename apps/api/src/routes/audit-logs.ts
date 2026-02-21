import type { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { jsonError, requireFamilyId } from '../shared'

export const registerAuditLogRoutes = (app: Hono<HonoEnv>) => {
  app.get('/audit-logs', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const limit = Math.min(200, Number(c.req.query('limit') ?? 50))
    const { results } = await c.env.DB
      .prepare('SELECT * FROM audit_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(familyId, limit)
      .all()
    return c.json({ audit_logs: results ?? [] })
  })
}
