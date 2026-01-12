import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
}

type HonoEnv = {
  Bindings: Bindings
}

const app = new Hono<HonoEnv>()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Family-Id', 'X-User-Id'],
  })
)

const jsonError = (message: string, status = 400) => {
  return { message, status }
}

const requireFamilyId = (c: Context<HonoEnv>) => {
  const familyId = c.req.header('X-Family-Id')?.trim()
  if (!familyId) {
    return null
  }
  return familyId
}

const getActorUserId = (c: Context<HonoEnv>) => {
  return c.req.header('X-User-Id')?.trim() ?? 'unknown'
}

const nowIso = () => new Date().toISOString()

const isEntryType = (value: unknown): value is 'income' | 'expense' => {
  return value === 'income' || value === 'expense'
}

const readJson = async <T>(c: Context<HonoEnv>) => {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}

const recordAudit = async (
  db: D1Database,
  familyId: string,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  summary?: string
) => {
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  await db
    .prepare(
      'INSERT INTO audit_logs (id, family_id, actor_user_id, action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, familyId, actorUserId, action, targetType, targetId, summary ?? null, createdAt)
    .run()
}

app.get('/health', (c) => c.json({ ok: true }))

app.get('/entries', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const since = c.req.query('since')
  const db = c.env.DB

  const query = since
    ? db
        .prepare(
          'SELECT * FROM entries WHERE family_id = ? AND updated_at > ? ORDER BY occurred_at DESC, updated_at DESC'
        )
        .bind(familyId, since)
    : db
        .prepare('SELECT * FROM entries WHERE family_id = ? ORDER BY occurred_at DESC, updated_at DESC')
        .bind(familyId)

  const { results } = await query.all()
  return c.json({ entries: results ?? [] })
})

app.post('/entries', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const entryType = payload.entry_type
  const amount = payload.amount
  if (!isEntryType(entryType) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return c.json(jsonError('entry_type and amount are required'), 400)
  }

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const memo = typeof payload.memo === 'string' ? payload.memo : null
  const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : nowIso()
  const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
  const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
  const recurringRuleId = typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : null
  const clientUpdatedAt = typeof payload.client_updated_at === 'string' ? payload.client_updated_at : null
  const createdAt = nowIso()
  const updatedAt = nowIso()

  const db = c.env.DB
  const existing = await db
    .prepare('SELECT updated_at FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  const conflict = !!(existing?.updated_at && clientUpdatedAt && existing.updated_at !== clientUpdatedAt)

  await db
    .prepare(
      'INSERT INTO entries (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, occurred_at, recurring_rule_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, occurred_at = excluded.occurred_at, recurring_rule_id = excluded.recurring_rule_id, updated_at = excluded.updated_at'
    )
    .bind(
      id,
      familyId,
      entryType,
      Math.round(amount),
      entryCategoryId,
      paymentMethodId,
      memo,
      occurredAt,
      recurringRuleId,
      createdAt,
      updatedAt
    )
    .run()

  await recordAudit(
    db,
    familyId,
    getActorUserId(c),
    existing ? 'update' : 'create',
    'entries',
    id,
    `entry ${entryType} ${amount}`
  )

  const entry = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  return c.json({ entry, conflict })
})

app.patch('/entries/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const id = c.req.param('id')
  const db = c.env.DB
  const existing = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (!existing) return c.json(jsonError('Entry not found', 404), 404)

  const entryType = isEntryType(payload.entry_type) ? payload.entry_type : existing.entry_type
  const amount =
    typeof payload.amount === 'number' && Number.isFinite(payload.amount) && payload.amount > 0
      ? Math.round(payload.amount)
      : existing.amount
  const memo = typeof payload.memo === 'string' ? payload.memo : existing.memo
  const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : existing.occurred_at
  const entryCategoryId =
    typeof payload.entry_category_id === 'string' ? payload.entry_category_id : existing.entry_category_id
  const paymentMethodId =
    typeof payload.payment_method_id === 'string' ? payload.payment_method_id : existing.payment_method_id
  const recurringRuleId =
    typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : existing.recurring_rule_id
  const clientUpdatedAt = typeof payload.client_updated_at === 'string' ? payload.client_updated_at : null
  const updatedAt = nowIso()

  const conflict = !!(existing.updated_at && clientUpdatedAt && existing.updated_at !== clientUpdatedAt)

  await db
    .prepare(
      'UPDATE entries SET entry_type = ?, amount = ?, entry_category_id = ?, payment_method_id = ?, memo = ?, occurred_at = ?, recurring_rule_id = ?, updated_at = ? WHERE id = ? AND family_id = ?'
    )
    .bind(
      entryType,
      amount,
      entryCategoryId,
      paymentMethodId,
      memo,
      occurredAt,
      recurringRuleId,
      updatedAt,
      id,
      familyId
    )
    .run()

  await recordAudit(db, familyId, getActorUserId(c), 'update', 'entries', id, `entry ${entryType} ${amount}`)

  const entry = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  return c.json({ entry, conflict })
})

app.delete('/entries/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  const db = c.env.DB

  await db.prepare('DELETE FROM entries WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(db, familyId, getActorUserId(c), 'delete', 'entries', id)

  return c.json({ ok: true })
})

app.get('/entry-categories', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM entry_categories WHERE family_id = ? ORDER BY sort_order, name')
    .bind(familyId)
    .all()
  return c.json({ entry_categories: results ?? [] })
})

app.post('/entry-categories', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
  const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : null
  if (!name || !type) return c.json(jsonError('name and type are required'), 400)

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO entry_categories (id, family_id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
    )
    .bind(id, familyId, name, type, sortOrder, createdAt, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'entry_categories', id, name)

  const entryCategory = await c.env.DB
    .prepare('SELECT * FROM entry_categories WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  return c.json({ entry_category: entryCategory })
})

app.delete('/entry-categories/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM entry_categories WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'entry_categories', id)
  return c.json({ ok: true })
})

app.get('/payment-methods', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM payment_methods WHERE family_id = ? ORDER BY sort_order, name')
    .bind(familyId)
    .all()
  return c.json({ payment_methods: results ?? [] })
})

app.post('/payment-methods', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
  const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : null
  if (!name || !type) return c.json(jsonError('name and type are required'), 400)

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO payment_methods (id, family_id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
    )
    .bind(id, familyId, name, type, sortOrder, createdAt, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'payment_methods', id, name)

  const paymentMethod = await c.env.DB
    .prepare('SELECT * FROM payment_methods WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  return c.json({ payment_method: paymentMethod })
})

app.delete('/payment-methods/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM payment_methods WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'payment_methods', id)
  return c.json({ ok: true })
})

app.get('/recurring-rules', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM recurring_rules WHERE family_id = ? ORDER BY created_at DESC')
    .bind(familyId)
    .all()
  return c.json({ recurring_rules: results ?? [] })
})

app.post('/recurring-rules', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  if (!isEntryType(payload.entry_type) || typeof payload.amount !== 'number' || payload.amount <= 0) {
    return c.json(jsonError('entry_type and amount are required'), 400)
  }

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
  const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
  const memo = typeof payload.memo === 'string' ? payload.memo : null
  const frequency = typeof payload.frequency === 'string' ? payload.frequency : 'monthly'
  const dayOfMonth = typeof payload.day_of_month === 'number' ? Math.round(payload.day_of_month) : null
  const startAt = typeof payload.start_at === 'string' ? payload.start_at : nowIso()
  const endAt = typeof payload.end_at === 'string' ? payload.end_at : null
  const isActive = typeof payload.is_active === 'boolean' ? payload.is_active : true
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO recurring_rules (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, frequency, day_of_month, start_at, end_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, frequency = excluded.frequency, day_of_month = excluded.day_of_month, start_at = excluded.start_at, end_at = excluded.end_at, is_active = excluded.is_active, updated_at = excluded.updated_at'
    )
    .bind(
      id,
      familyId,
      payload.entry_type,
      Math.round(payload.amount),
      entryCategoryId,
      paymentMethodId,
      memo,
      frequency,
      dayOfMonth,
      startAt,
      endAt,
      isActive ? 1 : 0,
      createdAt,
      updatedAt
    )
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'recurring_rules', id, memo ?? '')

  const recurringRule = await c.env.DB
    .prepare('SELECT * FROM recurring_rules WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  return c.json({ recurring_rule: recurringRule })
})

app.delete('/recurring-rules/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM recurring_rules WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'recurring_rules', id)
  return c.json({ ok: true })
})

app.get('/monthly-balance', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)
  const ym = c.req.query('ym')
  if (!ym) return c.json(jsonError('ym is required'), 400)

  const balance = await c.env.DB
    .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym = ?')
    .bind(familyId, ym)
    .first()

  return c.json({ monthly_balance: balance })
})

app.put('/monthly-balance/:ym', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const ym = c.req.param('ym')
  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const balance = typeof payload.balance === 'number' ? Math.round(payload.balance) : null
  if (balance === null) return c.json(jsonError('balance is required'), 400)
  const isClosed = typeof payload.is_closed === 'boolean' ? payload.is_closed : false
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO monthly_balance (family_id, ym, balance, is_closed, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(family_id, ym) DO UPDATE SET balance = excluded.balance, is_closed = excluded.is_closed, updated_at = excluded.updated_at'
    )
    .bind(familyId, ym, balance, isClosed ? 1 : 0, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'monthly_balance', ym)

  const monthlyBalance = await c.env.DB
    .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym = ?')
    .bind(familyId, ym)
    .first()

  return c.json({ monthly_balance: monthlyBalance })
})

const toTokyoDate = (date = new Date()) => {
  const ms = date.getTime() + 9 * 60 * 60 * 1000
  return new Date(ms)
}

const formatTokyoDate = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const rangeFrom = (range: string) => {
  const tokyo = toTokyoDate()
  if (range === 'week') {
    const day = tokyo.getUTCDay()
    const offset = (day + 6) % 7
    tokyo.setUTCDate(tokyo.getUTCDate() - offset)
    tokyo.setUTCHours(0, 0, 0, 0)
  } else if (range === 'month') {
    tokyo.setUTCDate(1)
    tokyo.setUTCHours(0, 0, 0, 0)
  } else if (range === 'year') {
    tokyo.setUTCMonth(0, 1)
    tokyo.setUTCHours(0, 0, 0, 0)
  }
  return tokyo
}

const addRange = (start: Date, range: string) => {
  const next = new Date(start.getTime())
  if (range === 'week') {
    next.setUTCDate(next.getUTCDate() + 7)
  } else if (range === 'month') {
    next.setUTCMonth(next.getUTCMonth() + 1)
  } else if (range === 'year') {
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  }
  return next
}

app.get('/reports', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const range = c.req.query('range') ?? 'month'
  const fromQuery = c.req.query('from')
  const toQuery = c.req.query('to')

  let from = fromQuery
  let to = toQuery

  if (!from || !to) {
    const start = rangeFrom(range)
    const end = addRange(start, range)
    from = formatTokyoDate(start)
    to = formatTokyoDate(end)
  }

  const db = c.env.DB
  const totals = await db
    .prepare(
      'SELECT entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_at >= ? AND occurred_at < ? GROUP BY entry_type'
    )
    .bind(familyId, from, to)
    .all()

  const categories = await db
    .prepare(
      'SELECT entry_category_id, entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_at >= ? AND occurred_at < ? GROUP BY entry_category_id, entry_type'
    )
    .bind(familyId, from, to)
    .all()

  const series = await db
    .prepare(
      'SELECT date(occurred_at) as day, entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_at >= ? AND occurred_at < ? GROUP BY day, entry_type ORDER BY day'
    )
    .bind(familyId, from, to)
    .all()

  return c.json({
    range,
    from,
    to,
    totals: totals.results ?? [],
    categories: categories.results ?? [],
    series: series.results ?? [],
  })
})

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

app.notFound((c) => c.json({ message: 'Not found' }, 404))

export default app
