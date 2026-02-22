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

const parseCardDay = (value: unknown): number | null | 'invalid' => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return 'invalid'
  const normalized = Math.trunc(parsed)
  if (normalized < 1 || normalized > 31) return 'invalid'
  return normalized
}

export const registerPaymentMethodRoutes = (app: Hono<HonoEnv>) => {
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

    const endpoint = '/payment-methods'
    const method = 'POST'
    const requestId = getMutationRequestId(c)
    if (requestId) {
      const receipt = await loadMutationReceipt(c.env.DB, requestId)
      if (receipt) {
        if (hasReceiptMismatch(receipt, familyId, method, endpoint)) {
          return c.json(
            fatalConflict({
              code: 'RESOURCE_STATE_INVALID',
              message: 'receipt mismatch',
              entityType: 'payment_methods',
              entityId: requestId,
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

    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
    const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : null
    const iconKey =
      typeof payload.icon_key === 'string' && payload.icon_key.trim() ? payload.icon_key.trim() : null
    const color = typeof payload.color === 'string' && payload.color.trim() ? payload.color.trim() : null
    const parsedCardClosingDay = parseCardDay(payload.card_closing_day)
    if (parsedCardClosingDay === 'invalid') {
      return c.json(jsonError('card_closing_day must be between 1 and 31'), 400)
    }
    const parsedCardPaymentDay = parseCardDay(payload.card_payment_day)
    if (parsedCardPaymentDay === 'invalid') {
      return c.json(jsonError('card_payment_day must be between 1 and 31'), 400)
    }
    const linkedBankPaymentMethodIdRaw =
      typeof payload.linked_bank_payment_method_id === 'string' && payload.linked_bank_payment_method_id.trim()
        ? payload.linked_bank_payment_method_id.trim()
        : null
    if (!name || !type) return c.json(jsonError('name and type are required'), 400)

    const cardClosingDay = type === 'card' ? parsedCardClosingDay : null
    const cardPaymentDay = type === 'card' ? parsedCardPaymentDay : null
    const linkedBankPaymentMethodId = type === 'card' ? linkedBankPaymentMethodIdRaw : null

    if (type === 'card' && linkedBankPaymentMethodId) {
      const linkedBank = await c.env.DB
        .prepare('SELECT id FROM payment_methods WHERE id = ? AND family_id = ? AND type = ?')
        .bind(linkedBankPaymentMethodId, familyId, 'bank')
        .first<{ id: string }>()
      if (!linkedBank?.id) {
        return c.json(jsonError('linked_bank_payment_method_id must be a bank account'), 400)
      }
    }

    const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
    const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
    const baseUpdatedAt =
      typeof payload.base_updated_at === 'string'
        ? payload.base_updated_at
        : typeof payload.client_updated_at === 'string'
          ? payload.client_updated_at
          : null
    const existing = await c.env.DB
      .prepare('SELECT * FROM payment_methods WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown> & { updated_at?: string; created_at?: string }>()

    const matchesExisting =
      !!existing &&
      existing.name === name &&
      existing.type === type &&
      existing.icon_key === iconKey &&
      existing.color === color &&
      existing.card_closing_day === cardClosingDay &&
      existing.card_payment_day === cardPaymentDay &&
      existing.linked_bank_payment_method_id === linkedBankPaymentMethodId &&
      existing.sort_order === sortOrder

    if (matchesExisting) {
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        body: { payment_method: existing, conflict: false, idempotent: true },
      })
    }

    const softConflict = !!(existing?.updated_at && baseUpdatedAt && existing.updated_at !== baseUpdatedAt)

    const createdAt = typeof existing?.created_at === 'string' ? existing.created_at : nowIso()
    const updatedAt = nowIso()

    await c.env.DB
      .prepare(
        'INSERT INTO payment_methods (id, family_id, name, type, icon_key, color, card_closing_day, card_payment_day, linked_bank_payment_method_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, icon_key = excluded.icon_key, color = excluded.color, card_closing_day = excluded.card_closing_day, card_payment_day = excluded.card_payment_day, linked_bank_payment_method_id = excluded.linked_bank_payment_method_id, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
      )
      .bind(
        id,
        familyId,
        name,
        type,
        iconKey,
        color,
        cardClosingDay,
        cardPaymentDay,
        linkedBankPaymentMethodId,
        sortOrder,
        createdAt,
        updatedAt
      )
      .run()

    await recordAudit(
      c.env.DB,
      familyId,
      getActorUserId(c),
      existing ? 'update' : 'create',
      'payment_methods',
      id,
      name
    )

    const paymentMethod = await c.env.DB
      .prepare('SELECT * FROM payment_methods WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown>>()

    if (paymentMethod) {
      await recordChange(c.env.DB, familyId, 'payment_methods', id, 'upsert', { payment_method: paymentMethod })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: {
        payment_method: paymentMethod,
        conflict: softConflict,
        ...(softConflict ? { conflict_class: 'soft' } : {}),
      },
    })
  })

  app.delete('/payment-methods/:id', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const id = c.req.param('id')
    const endpoint = `/payment-methods/${id}`
    const method = 'DELETE'
    const requestId = getMutationRequestId(c)
    if (requestId) {
      const receipt = await loadMutationReceipt(c.env.DB, requestId)
      if (receipt) {
        if (hasReceiptMismatch(receipt, familyId, method, endpoint)) {
          return c.json(
            fatalConflict({
              code: 'RESOURCE_STATE_INVALID',
              message: 'receipt mismatch',
              entityType: 'payment_methods',
              entityId: id,
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

    await c.env.DB.prepare('DELETE FROM payment_methods WHERE id = ? AND family_id = ?').bind(id, familyId).run()
    await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'payment_methods', id)
    await recordChange(c.env.DB, familyId, 'payment_methods', id, 'delete', { id })

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: { ok: true, conflict: false },
    })
  })
}
