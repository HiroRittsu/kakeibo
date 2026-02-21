import type { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { addRange, formatTokyoDate, jsonError, rangeFrom, requireFamilyId } from '../shared'

export const registerReportRoutes = (app: Hono<HonoEnv>) => {
  app.get('/reports', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const range = c.req.query('range') ?? 'month'
    const fromQuery = c.req.query('from')
    const toQuery = c.req.query('to')
    const recurringOnly = c.req.query('recurring') === '1'

    let from = fromQuery
    let to = toQuery

    if (!from || !to) {
      const start = rangeFrom(range)
      const end = addRange(start, range)
      from = formatTokyoDate(start)
      to = formatTokyoDate(end)
    }

    const db = c.env.DB
    const recurringFilter = recurringOnly ? ' AND recurring_rule_id IS NOT NULL' : ''
    const totals = await db
      .prepare(
        `SELECT entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ?${recurringFilter} GROUP BY entry_type`
      )
      .bind(familyId, from, to)
      .all()

    const categories = await db
      .prepare(
        `SELECT entry_category_id, entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ?${recurringFilter} GROUP BY entry_category_id, entry_type`
      )
      .bind(familyId, from, to)
      .all()

    return c.json({
      range,
      from,
      to,
      totals: totals.results ?? [],
      categories: categories.results ?? [],
    })
  })
}
