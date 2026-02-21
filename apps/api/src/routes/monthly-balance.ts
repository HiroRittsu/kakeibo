import type { Hono } from 'hono'
import type { AppContext, HonoEnv, MutationReceiptRow } from '../types'
import {
  getActorUserId,
  getMutationRequestId,
  jsonError,
  loadMutationReceipt,
  nowIso,
  parseMutationReceiptBody,
  readJson,
  recordAudit,
  recordChange,
  requireFamilyId,
  storeMutationReceipt,
} from '../shared'

const fatalConflict = (params: {
  code: string
  message: string
  entityType: string
  entityId: string
  serverSnapshot: Record<string, unknown> | null
  resolutionHint: string
}) => ({
  error: {
    kind: 'fatal_conflict' as const,
    code: params.code,
    message: params.message,
    entity_type: params.entityType,
    entity_id: params.entityId,
    server_snapshot: params.serverSnapshot,
    resolution_hint: params.resolutionHint,
    retryable: false as const,
  },
})

const hasReceiptMismatch = (
  receipt: MutationReceiptRow,
  familyId: string,
  method: string,
  endpoint: string
) => {
  return receipt.family_id !== familyId || receipt.method !== method || receipt.endpoint !== endpoint
}

const withReceiptResponse = async (
  c: AppContext,
  params: {
    requestId: string | null
    familyId: string
    endpoint: string
    method: string
    status?: number
    body: Record<string, unknown>
  }
) => {
  const status = params.status ?? 200
  if (params.requestId) {
    await storeMutationReceipt(c.env.DB, {
      requestId: params.requestId,
      familyId: params.familyId,
      endpoint: params.endpoint,
      method: params.method,
      status,
      responseBody: params.body,
    })
  }
  return c.json(params.body, status)
}

export const registerMonthlyBalanceRoutes = (app: Hono<HonoEnv>) => {
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

  app.get('/monthly-balances', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)
    const from = c.req.query('from')
    const to = c.req.query('to')
    if (!from || !to) return c.json(jsonError('from/to is required'), 400)
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      return c.json(jsonError('from/to must be YYYY-MM'), 400)
    }

    const balances = await c.env.DB
      .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym >= ? AND ym <= ? ORDER BY ym')
      .bind(familyId, from, to)
      .all()

    return c.json({ monthly_balances: balances.results ?? [] })
  })

  app.put('/monthly-balance/:ym', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const ym = c.req.param('ym')
    const endpoint = `/monthly-balance/${ym}`
    const method = 'PUT'
    const requestId = getMutationRequestId(c)
    if (requestId) {
      const receipt = await loadMutationReceipt(c.env.DB, requestId)
      if (receipt) {
        if (hasReceiptMismatch(receipt, familyId, method, endpoint)) {
          return c.json(
            fatalConflict({
              code: 'RESOURCE_STATE_INVALID',
              message: 'receipt mismatch',
              entityType: 'monthly_balance',
              entityId: ym,
              serverSnapshot: {
                family_id: receipt.family_id,
                endpoint: receipt.endpoint,
                method: receipt.method,
              },
              resolutionHint: 'use new X-Outbox-Id per mutation',
            }),
            409
          )
        }
        return c.json(parseMutationReceiptBody(receipt), receipt.status)
      }
    }

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
      .first<Record<string, unknown>>()

    if (monthlyBalance) {
      await recordChange(c.env.DB, familyId, 'monthly_balance', ym, 'upsert', {
        monthly_balance: monthlyBalance,
      })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: { monthly_balance: monthlyBalance, conflict: false },
    })
  })
}
