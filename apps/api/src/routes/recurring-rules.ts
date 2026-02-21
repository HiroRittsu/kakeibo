import type { Hono } from 'hono'
import type { AppContext, HonoEnv, MutationReceiptRow } from '../types'
import {
  getActorUserId,
  getMutationRequestId,
  isEntryType,
  isSameValue,
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

export const registerRecurringRuleRoutes = (app: Hono<HonoEnv>) => {
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

    const endpoint = '/recurring-rules'
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
              entityType: 'recurring_rules',
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

    if (!isEntryType(payload.entry_type) || typeof payload.amount !== 'number' || payload.amount <= 0) {
      return c.json(jsonError('entry_type and amount are required'), 400)
    }

    const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
    const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
    const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
    const memo = typeof payload.memo === 'string' ? payload.memo : null
    const frequency = typeof payload.frequency === 'string' ? payload.frequency : 'monthly'
    const dayOfMonth = typeof payload.day_of_month === 'number' ? Math.round(payload.day_of_month) : null
    const holidayAdjustment =
      payload.holiday_adjustment === 'previous' || payload.holiday_adjustment === 'next'
        ? payload.holiday_adjustment
        : 'none'
    const startAt = typeof payload.start_at === 'string' ? payload.start_at : nowIso()
    const endAt = typeof payload.end_at === 'string' ? payload.end_at : null
    const isActive = typeof payload.is_active === 'boolean' ? payload.is_active : true
    const baseUpdatedAt =
      typeof payload.base_updated_at === 'string'
        ? payload.base_updated_at
        : typeof payload.client_updated_at === 'string'
          ? payload.client_updated_at
          : null

    if (entryCategoryId) {
      const category = await c.env.DB
        .prepare('SELECT id, family_id, is_archived, merged_to_id, updated_at FROM entry_categories WHERE id = ? AND family_id = ?')
        .bind(entryCategoryId, familyId)
        .first<{ id: string; family_id: string; is_archived?: number; merged_to_id?: string | null; updated_at?: string }>()
      if (!category) {
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body: fatalConflict({
            code: 'RECURRING_RULE_INVALID',
            message: 'category not found',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: null,
            resolutionHint: 'sync latest categories and choose a valid one',
          }),
        })
      }
      if ((category.is_archived ?? 0) === 1) {
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body: fatalConflict({
            code: 'CATEGORY_ARCHIVED',
            message: 'category is archived',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: category as unknown as Record<string, unknown>,
            resolutionHint: 'choose an active category',
          }),
        })
      }
      if (category.merged_to_id) {
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body: fatalConflict({
            code: 'CATEGORY_MERGED',
            message: 'category is merged',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: category as unknown as Record<string, unknown>,
            resolutionHint: 'use merged_to_id',
          }),
        })
      }
    }

    if (paymentMethodId) {
      const paymentMethod = await c.env.DB
        .prepare('SELECT id, family_id, updated_at FROM payment_methods WHERE id = ? AND family_id = ?')
        .bind(paymentMethodId, familyId)
        .first<{ id: string; family_id: string; updated_at?: string }>()
      if (!paymentMethod) {
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body: fatalConflict({
            code: 'PAYMENT_METHOD_INVALID',
            message: 'payment method not found',
            entityType: 'payment_methods',
            entityId: paymentMethodId,
            serverSnapshot: null,
            resolutionHint: 'sync latest payment methods and choose a valid one',
          }),
        })
      }
    }

    const existing = await c.env.DB
      .prepare('SELECT * FROM recurring_rules WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown> & { updated_at?: string; created_at?: string }>()

    const normalizedAmount = Math.round(payload.amount)
    const matchesExisting =
      !!existing &&
      existing.entry_type === payload.entry_type &&
      existing.amount === normalizedAmount &&
      isSameValue(existing.entry_category_id, entryCategoryId) &&
      isSameValue(existing.payment_method_id, paymentMethodId) &&
      isSameValue(existing.memo, memo) &&
      existing.frequency === frequency &&
      isSameValue(existing.day_of_month, dayOfMonth) &&
      existing.holiday_adjustment === holidayAdjustment &&
      existing.start_at === startAt &&
      isSameValue(existing.end_at, endAt) &&
      existing.is_active === (isActive ? 1 : 0)

    if (matchesExisting) {
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        body: { recurring_rule: existing, conflict: false, idempotent: true },
      })
    }

    const softConflict = !!(existing?.updated_at && baseUpdatedAt && existing.updated_at !== baseUpdatedAt)

    const createdAt = typeof existing?.created_at === 'string' ? existing.created_at : nowIso()
    const updatedAt = nowIso()

    await c.env.DB
      .prepare(
        'INSERT INTO recurring_rules (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, frequency, day_of_month, holiday_adjustment, start_at, end_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, frequency = excluded.frequency, day_of_month = excluded.day_of_month, holiday_adjustment = excluded.holiday_adjustment, start_at = excluded.start_at, end_at = excluded.end_at, is_active = excluded.is_active, updated_at = excluded.updated_at'
      )
      .bind(
        id,
        familyId,
        payload.entry_type,
        normalizedAmount,
        entryCategoryId,
        paymentMethodId,
        memo,
        frequency,
        dayOfMonth,
        holidayAdjustment,
        startAt,
        endAt,
        isActive ? 1 : 0,
        createdAt,
        updatedAt
      )
      .run()

    await recordAudit(
      c.env.DB,
      familyId,
      getActorUserId(c),
      existing ? 'update' : 'create',
      'recurring_rules',
      id,
      memo ?? ''
    )

    const recurringRule = await c.env.DB
      .prepare('SELECT * FROM recurring_rules WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown>>()

    if (recurringRule) {
      await recordChange(c.env.DB, familyId, 'recurring_rules', id, 'upsert', { recurring_rule: recurringRule })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: {
        recurring_rule: recurringRule,
        conflict: softConflict,
        ...(softConflict ? { conflict_class: 'soft' } : {}),
      },
    })
  })

  app.delete('/recurring-rules/:id', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const id = c.req.param('id')
    const endpoint = `/recurring-rules/${id}`
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
              entityType: 'recurring_rules',
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

    await c.env.DB.prepare('DELETE FROM recurring_rules WHERE id = ? AND family_id = ?').bind(id, familyId).run()
    await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'recurring_rules', id)
    await recordChange(c.env.DB, familyId, 'recurring_rules', id, 'delete', { id })

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: { ok: true, conflict: false },
    })
  })
}
