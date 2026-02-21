import type { Hono } from 'hono'
import type { AppContext, HonoEnv, MutationReceiptRow } from '../types'
import {
  getActorUserId,
  getMutationRequestId,
  isSameValue,
  jsonError,
  loadMutationReceipt,
  parseMutationReceiptBody,
  readJson,
  recordAudit,
  recordChange,
  requireFamilyId,
  storeMutationReceipt,
  nowIso,
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

export const registerEntryCategoryRoutes = (app: Hono<HonoEnv>) => {
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

    const endpoint = '/entry-categories'
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
              entityType: 'entry_categories',
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
    const iconKey = typeof payload.icon_key === 'string' ? payload.icon_key : null
    const color = typeof payload.color === 'string' ? payload.color : null
    if (!name || !type) return c.json(jsonError('name and type are required'), 400)

    const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
    const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
    const baseUpdatedAt =
      typeof payload.base_updated_at === 'string'
        ? payload.base_updated_at
        : typeof payload.client_updated_at === 'string'
          ? payload.client_updated_at
          : null
    const existing = await c.env.DB
      .prepare('SELECT * FROM entry_categories WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown> & { updated_at?: string; created_at?: string; merged_to_id?: string | null; is_archived?: number }>()

    if (existing && (existing.is_archived ?? 0) === 1) {
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
          entityId: id,
          serverSnapshot: existing as Record<string, unknown>,
          resolutionHint: 'create or select an active category',
        }),
      })
    }

    if (existing?.merged_to_id) {
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
          entityId: id,
          serverSnapshot: existing as Record<string, unknown>,
          resolutionHint: 'use merged_to_id',
        }),
      })
    }

    const matchesExisting =
      !!existing &&
      existing.name === name &&
      existing.type === type &&
      isSameValue(existing.icon_key, iconKey) &&
      isSameValue(existing.color, color) &&
      existing.sort_order === sortOrder

    if (matchesExisting) {
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        body: { entry_category: existing, conflict: false, idempotent: true },
      })
    }

    const softConflict = !!(existing?.updated_at && baseUpdatedAt && existing.updated_at !== baseUpdatedAt)

    const createdAt = typeof existing?.created_at === 'string' ? existing.created_at : nowIso()
    const updatedAt = nowIso()

    await c.env.DB
      .prepare(
        'INSERT INTO entry_categories (id, family_id, name, type, icon_key, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, icon_key = excluded.icon_key, color = excluded.color, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
      )
      .bind(id, familyId, name, type, iconKey, color, sortOrder, createdAt, updatedAt)
      .run()

    await recordAudit(
      c.env.DB,
      familyId,
      getActorUserId(c),
      existing ? 'update' : 'create',
      'entry_categories',
      id,
      name
    )

    const entryCategory = await c.env.DB
      .prepare('SELECT * FROM entry_categories WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown>>()

    if (entryCategory) {
      await recordChange(c.env.DB, familyId, 'entry_categories', id, 'upsert', { entry_category: entryCategory })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: {
        entry_category: entryCategory,
        conflict: softConflict,
        ...(softConflict ? { conflict_class: 'soft' } : {}),
      },
    })
  })

  app.delete('/entry-categories/:id', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const id = c.req.param('id')
    const endpoint = `/entry-categories/${id}`
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
              entityType: 'entry_categories',
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

    await c.env.DB.prepare('DELETE FROM entry_categories WHERE id = ? AND family_id = ?').bind(id, familyId).run()
    await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'entry_categories', id)
    await recordChange(c.env.DB, familyId, 'entry_categories', id, 'delete', { id })

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: { ok: true, conflict: false },
    })
  })
}
