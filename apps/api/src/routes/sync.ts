import type { Hono } from 'hono'
import type { ChangeLogRow, HonoEnv } from '../types'
import { jsonError, nowIso, requireFamilyId } from '../shared'

export const registerSyncRoutes = (app: Hono<HonoEnv>) => {
  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/sync', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('Unauthorized', 401), 401)

    const cursor = Math.max(0, Number(c.req.query('cursor') ?? 0))
    const limit = Math.max(0, Math.min(500, Number(c.req.query('limit') ?? 200)))
    const serverTime = nowIso()

    if (limit === 0) {
      const latest = await c.env.DB
        .prepare('SELECT MAX(id) as max_id FROM change_logs WHERE family_id = ?')
        .bind(familyId)
        .first<{ max_id?: number | null }>()
      const nextCursor = typeof latest?.max_id === 'number' ? latest.max_id : cursor
      return c.json({ changes: [], next_cursor: nextCursor, server_time: serverTime })
    }

    const { results } = await c.env.DB
      .prepare(
        'SELECT id, entity_type, entity_id, action, payload, created_at FROM change_logs WHERE family_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
      )
      .bind(familyId, cursor, limit)
      .all<ChangeLogRow>()

    const changes = (results ?? []).map((row) => ({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: row.action,
      payload: row.payload ? JSON.parse(row.payload) : null,
      created_at: row.created_at,
    }))
    const nextCursor = changes.length ? changes[changes.length - 1].id : cursor
    return c.json({ changes, next_cursor: nextCursor, server_time: serverTime })
  })

  app.get('/bootstrap', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('Unauthorized', 401), 401)

    const db = c.env.DB
    const serverTime = nowIso()

    const [entries, entryCategories, paymentMethods, recurringRules, monthlyBalances, latestChange] = await Promise.all([
      db.prepare('SELECT * FROM entries WHERE family_id = ? ORDER BY occurred_at DESC, updated_at DESC')
        .bind(familyId)
        .all(),
      db.prepare('SELECT * FROM entry_categories WHERE family_id = ? ORDER BY sort_order, name')
        .bind(familyId)
        .all(),
      db.prepare('SELECT * FROM payment_methods WHERE family_id = ? ORDER BY sort_order, name')
        .bind(familyId)
        .all(),
      db.prepare('SELECT * FROM recurring_rules WHERE family_id = ? ORDER BY created_at DESC')
        .bind(familyId)
        .all(),
      db.prepare('SELECT * FROM monthly_balance WHERE family_id = ? ORDER BY ym')
        .bind(familyId)
        .all(),
      db.prepare('SELECT MAX(id) as max_id FROM change_logs WHERE family_id = ?')
        .bind(familyId)
        .first<{ max_id?: number | null }>(),
    ])

    const nextCursor = typeof latestChange?.max_id === 'number' ? latestChange.max_id : 0

    return c.json({
      entries: entries.results ?? [],
      entry_categories: entryCategories.results ?? [],
      payment_methods: paymentMethods.results ?? [],
      recurring_rules: recurringRules.results ?? [],
      monthly_balances: monthlyBalances.results ?? [],
      next_cursor: nextCursor,
      server_time: serverTime,
    })
  })
}
