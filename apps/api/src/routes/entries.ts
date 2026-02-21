import type { Hono } from 'hono'
import type { AppContext, HonoEnv, MutationReceiptRow } from '../types'
import {
  formatOccurredOn,
  getActorUserId,
  getMutationRequestId,
  isEntryType,
  isSameValue,
  jsonError,
  loadMutationReceipt,
  minYmFromDates,
  nowIso,
  parseMutationReceiptBody,
  readJson,
  recalcMonthlyBalances,
  recordAudit,
  recordChange,
  requireFamilyId,
  storeMutationReceipt,
  ymFromOccurredOn,
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

type EntryRow = Record<string, unknown> & {
  updated_at?: string
  created_at?: string
  occurred_on?: string
  amount?: number
  created_by_user_id?: string | null
  created_by_user_name?: string | null
  created_by_avatar_url?: string | null
}

type ActorProfile = {
  id: string
  name: string | null
  avatar_url: string | null
}

const loadActorProfile = async (db: D1Database, actorUserId: string): Promise<ActorProfile> => {
  const row = await db
    .prepare('SELECT id, name, avatar_url FROM users WHERE id = ?')
    .bind(actorUserId)
    .first<{ id: string; name: string | null; avatar_url: string | null }>()

  return {
    id: row?.id ?? actorUserId,
    name: row?.name ?? null,
    avatar_url: row?.avatar_url ?? null,
  }
}

const recordEntryAmountChange = async (
  db: D1Database,
  params: {
    familyId: string
    entryId: string
    previousAmount: number
    nextAmount: number
    actor: ActorProfile
  }
) => {
  if (params.previousAmount === params.nextAmount) return
  const changedAt = nowIso()

  await db
    .prepare(
      'INSERT INTO entry_amount_change_logs (id, family_id, entry_id, previous_amount, next_amount, changed_by_user_id, changed_by_user_name, changed_by_avatar_url, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      crypto.randomUUID(),
      params.familyId,
      params.entryId,
      params.previousAmount,
      params.nextAmount,
      params.actor.id,
      params.actor.name,
      params.actor.avatar_url,
      changedAt
    )
    .run()
}

export const registerEntryRoutes = (app: Hono<HonoEnv>) => {
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

    const endpoint = '/entries'
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
              entityType: 'entries',
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

    const entryType = payload.entry_type
    const amount = payload.amount
    if (!isEntryType(entryType) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return c.json(jsonError('entry_type and amount are required'), 400)
    }

    const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
    const memo = typeof payload.memo === 'string' ? payload.memo : null
    const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : nowIso()
    const occurredOn = formatOccurredOn(occurredAt)
    const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
    const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
    const recurringRuleId = typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : null
    const baseUpdatedAt =
      typeof payload.base_updated_at === 'string'
        ? payload.base_updated_at
        : typeof payload.client_updated_at === 'string'
          ? payload.client_updated_at
          : null
    const normalizedAmount = Math.round(amount)

    const db = c.env.DB
    const actorUserId = getActorUserId(c)
    const actorProfile = await loadActorProfile(db, actorUserId)
    const existing = await db
      .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<EntryRow>()
    const createdByUserId =
      typeof existing?.created_by_user_id === 'string' && existing.created_by_user_id
        ? existing.created_by_user_id
        : actorProfile.id
    const createdByUserName =
      typeof existing?.created_by_user_name === 'string' ? existing.created_by_user_name : actorProfile.name
    const createdByAvatarUrl =
      typeof existing?.created_by_avatar_url === 'string'
        ? existing.created_by_avatar_url
        : actorProfile.avatar_url

    if (entryCategoryId) {
      const category = await db
        .prepare('SELECT id, family_id, is_archived, merged_to_id, updated_at FROM entry_categories WHERE id = ? AND family_id = ?')
        .bind(entryCategoryId, familyId)
        .first<{ id: string; family_id: string; is_archived?: number; merged_to_id?: string | null; updated_at?: string }>()
      if (!category) {
        return c.json(
          fatalConflict({
            code: 'ENTRY_CATEGORY_INVALID',
            message: 'entry category not found',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: null,
            resolutionHint: 'sync latest categories and choose a valid one',
          }),
          409
        )
      }
      if ((category.is_archived ?? 0) === 1) {
        return c.json(
          fatalConflict({
            code: 'CATEGORY_ARCHIVED',
            message: 'entry category is archived',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: category as unknown as Record<string, unknown>,
            resolutionHint: 'choose an active category',
          }),
          409
        )
      }
      if (category.merged_to_id) {
        return c.json(
          fatalConflict({
            code: 'CATEGORY_MERGED',
            message: 'entry category is merged',
            entityType: 'entry_categories',
            entityId: entryCategoryId,
            serverSnapshot: category as unknown as Record<string, unknown>,
            resolutionHint: 'use merged_to_id',
          }),
          409
        )
      }
    }

    if (paymentMethodId) {
      const paymentMethod = await db
        .prepare('SELECT id, family_id, updated_at FROM payment_methods WHERE id = ? AND family_id = ?')
        .bind(paymentMethodId, familyId)
        .first<{ id: string; family_id: string; updated_at?: string }>()
      if (!paymentMethod) {
        return c.json(
          fatalConflict({
            code: 'PAYMENT_METHOD_INVALID',
            message: 'payment method not found',
            entityType: 'payment_methods',
            entityId: paymentMethodId,
            serverSnapshot: null,
            resolutionHint: 'sync latest payment methods and choose a valid one',
          }),
          409
        )
      }
    }

    if (recurringRuleId) {
      const recurringRule = await db
        .prepare('SELECT id, family_id, is_active, updated_at FROM recurring_rules WHERE id = ? AND family_id = ?')
        .bind(recurringRuleId, familyId)
        .first<{ id: string; family_id: string; is_active?: number; updated_at?: string }>()
      if (!recurringRule) {
        return c.json(
          fatalConflict({
            code: 'RECURRING_RULE_INVALID',
            message: 'recurring rule not found',
            entityType: 'recurring_rules',
            entityId: recurringRuleId,
            serverSnapshot: null,
            resolutionHint: 'sync latest recurring rules and choose a valid one',
          }),
          409
        )
      }
      if ((recurringRule.is_active ?? 1) !== 1) {
        return c.json(
          fatalConflict({
            code: 'RECURRING_RULE_INVALID',
            message: 'recurring rule is inactive',
            entityType: 'recurring_rules',
            entityId: recurringRuleId,
            serverSnapshot: recurringRule as unknown as Record<string, unknown>,
            resolutionHint: 'remove recurring_rule_id or use active rule',
          }),
          409
        )
      }
    }

    const matchesExisting =
      !!existing &&
      existing.entry_type === entryType &&
      existing.amount === normalizedAmount &&
      isSameValue(existing.entry_category_id, entryCategoryId) &&
      isSameValue(existing.payment_method_id, paymentMethodId) &&
      isSameValue(existing.memo, memo) &&
      existing.occurred_at === occurredAt &&
      existing.occurred_on === occurredOn &&
      isSameValue(existing.recurring_rule_id, recurringRuleId)

    if (matchesExisting) {
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        body: { entry: existing, conflict: false, idempotent: true },
      })
    }

    const softConflict = !!(existing?.updated_at && baseUpdatedAt && existing.updated_at !== baseUpdatedAt)

    const createdAt = typeof existing?.created_at === 'string' ? existing.created_at : nowIso()
    const updatedAt = nowIso()

    await db
      .prepare(
        'INSERT INTO entries (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, occurred_at, occurred_on, recurring_rule_id, created_by_user_id, created_by_user_name, created_by_avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, occurred_at = excluded.occurred_at, occurred_on = excluded.occurred_on, recurring_rule_id = excluded.recurring_rule_id, created_by_user_id = COALESCE(entries.created_by_user_id, excluded.created_by_user_id), created_by_user_name = COALESCE(entries.created_by_user_name, excluded.created_by_user_name), created_by_avatar_url = COALESCE(entries.created_by_avatar_url, excluded.created_by_avatar_url), updated_at = excluded.updated_at'
      )
      .bind(
        id,
        familyId,
        entryType,
        normalizedAmount,
        entryCategoryId,
        paymentMethodId,
        memo,
        occurredAt,
        occurredOn,
        recurringRuleId,
        createdByUserId,
        createdByUserName,
        createdByAvatarUrl,
        createdAt,
        updatedAt
      )
      .run()

    const previousAmount = typeof existing?.amount === 'number' ? existing.amount : null
    if (typeof previousAmount === 'number') {
      await recordEntryAmountChange(db, {
        familyId,
        entryId: id,
        previousAmount,
        nextAmount: normalizedAmount,
        actor: actorProfile,
      })
    }

    await recordAudit(
      db,
      familyId,
      actorUserId,
      existing ? 'update' : 'create',
      'entries',
      id,
      `entry ${entryType} ${amount}`
    )

    const startYm = existing?.occurred_on
      ? minYmFromDates(existing.occurred_on, occurredOn)
      : ymFromOccurredOn(occurredOn)
    await recalcMonthlyBalances(db, familyId, startYm)

    const entry = await db
      .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown>>()

    if (entry) {
      await recordChange(db, familyId, 'entries', id, 'upsert', { entry })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: {
        entry,
        conflict: softConflict,
        ...(softConflict ? { conflict_class: 'soft' } : {}),
      },
    })
  })

  app.patch('/entries/:id', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const id = c.req.param('id')
    const endpoint = `/entries/${id}`
    const method = 'PATCH'
    const requestId = getMutationRequestId(c)
    if (requestId) {
      const receipt = await loadMutationReceipt(c.env.DB, requestId)
      if (receipt) {
        if (hasReceiptMismatch(receipt, familyId, method, endpoint)) {
          return c.json(
            fatalConflict({
              code: 'RESOURCE_STATE_INVALID',
              message: 'receipt mismatch',
              entityType: 'entries',
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

    const payload = await readJson<Record<string, unknown>>(c)
    if (!payload) return c.json(jsonError('Invalid JSON'), 400)

    const db = c.env.DB
    const actorUserId = getActorUserId(c)
    const actorProfile = await loadActorProfile(db, actorUserId)
    const existing = await db
      .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<EntryRow>()

    if (!existing) {
      const body = fatalConflict({
        code: 'ENTRY_TARGET_MISSING',
        message: 'entry does not exist',
        entityType: 'entries',
        entityId: id,
        serverSnapshot: null,
        resolutionHint: 'sync latest entries before editing',
      })
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        status: 409,
        body,
      })
    }

    const entryType = isEntryType(payload.entry_type) ? payload.entry_type : existing.entry_type
    const amount =
      typeof payload.amount === 'number' && Number.isFinite(payload.amount) && payload.amount > 0
        ? Math.round(payload.amount)
        : (existing.amount as number)
    const memo = typeof payload.memo === 'string' ? payload.memo : (existing.memo as string | null)
    const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : (existing.occurred_at as string)
    const occurredOn = formatOccurredOn(occurredAt)
    const entryCategoryId =
      typeof payload.entry_category_id === 'string' ? payload.entry_category_id : (existing.entry_category_id as string | null)
    const paymentMethodId =
      typeof payload.payment_method_id === 'string' ? payload.payment_method_id : (existing.payment_method_id as string | null)
    const recurringRuleId =
      typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : (existing.recurring_rule_id as string | null)
    const baseUpdatedAt =
      typeof payload.base_updated_at === 'string'
        ? payload.base_updated_at
        : typeof payload.client_updated_at === 'string'
          ? payload.client_updated_at
          : null
    const updatedAt = nowIso()

    if (entryCategoryId) {
      const category = await db
        .prepare('SELECT id, family_id, is_archived, merged_to_id, updated_at FROM entry_categories WHERE id = ? AND family_id = ?')
        .bind(entryCategoryId, familyId)
        .first<{ id: string; family_id: string; is_archived?: number; merged_to_id?: string | null; updated_at?: string }>()
      if (!category) {
        const body = fatalConflict({
          code: 'ENTRY_CATEGORY_INVALID',
          message: 'entry category not found',
          entityType: 'entry_categories',
          entityId: entryCategoryId,
          serverSnapshot: null,
          resolutionHint: 'sync latest categories and choose a valid one',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
      if ((category.is_archived ?? 0) === 1) {
        const body = fatalConflict({
          code: 'CATEGORY_ARCHIVED',
          message: 'entry category is archived',
          entityType: 'entry_categories',
          entityId: entryCategoryId,
          serverSnapshot: category as unknown as Record<string, unknown>,
          resolutionHint: 'choose an active category',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
      if (category.merged_to_id) {
        const body = fatalConflict({
          code: 'CATEGORY_MERGED',
          message: 'entry category is merged',
          entityType: 'entry_categories',
          entityId: entryCategoryId,
          serverSnapshot: category as unknown as Record<string, unknown>,
          resolutionHint: 'use merged_to_id',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
    }

    if (paymentMethodId) {
      const paymentMethod = await db
        .prepare('SELECT id, family_id, updated_at FROM payment_methods WHERE id = ? AND family_id = ?')
        .bind(paymentMethodId, familyId)
        .first<{ id: string; family_id: string; updated_at?: string }>()
      if (!paymentMethod) {
        const body = fatalConflict({
          code: 'PAYMENT_METHOD_INVALID',
          message: 'payment method not found',
          entityType: 'payment_methods',
          entityId: paymentMethodId,
          serverSnapshot: null,
          resolutionHint: 'sync latest payment methods and choose a valid one',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
    }

    if (recurringRuleId) {
      const recurringRule = await db
        .prepare('SELECT id, family_id, is_active, updated_at FROM recurring_rules WHERE id = ? AND family_id = ?')
        .bind(recurringRuleId, familyId)
        .first<{ id: string; family_id: string; is_active?: number; updated_at?: string }>()
      if (!recurringRule) {
        const body = fatalConflict({
          code: 'RECURRING_RULE_INVALID',
          message: 'recurring rule not found',
          entityType: 'recurring_rules',
          entityId: recurringRuleId,
          serverSnapshot: null,
          resolutionHint: 'sync latest recurring rules and choose a valid one',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
      if ((recurringRule.is_active ?? 1) !== 1) {
        const body = fatalConflict({
          code: 'RECURRING_RULE_INVALID',
          message: 'recurring rule is inactive',
          entityType: 'recurring_rules',
          entityId: recurringRuleId,
          serverSnapshot: recurringRule as unknown as Record<string, unknown>,
          resolutionHint: 'remove recurring_rule_id or use active rule',
        })
        return withReceiptResponse(c, {
          requestId,
          familyId,
          endpoint,
          method,
          status: 409,
          body,
        })
      }
    }

    const matchesExisting =
      existing.entry_type === entryType &&
      existing.amount === amount &&
      isSameValue(existing.entry_category_id, entryCategoryId) &&
      isSameValue(existing.payment_method_id, paymentMethodId) &&
      isSameValue(existing.memo, memo) &&
      existing.occurred_at === occurredAt &&
      existing.occurred_on === occurredOn &&
      isSameValue(existing.recurring_rule_id, recurringRuleId)

    if (matchesExisting) {
      return withReceiptResponse(c, {
        requestId,
        familyId,
        endpoint,
        method,
        body: { entry: existing, conflict: false, idempotent: true },
      })
    }

    const softConflict = !!(existing.updated_at && baseUpdatedAt && existing.updated_at !== baseUpdatedAt)

    await db
      .prepare(
        'UPDATE entries SET entry_type = ?, amount = ?, entry_category_id = ?, payment_method_id = ?, memo = ?, occurred_at = ?, occurred_on = ?, recurring_rule_id = ?, updated_at = ? WHERE id = ? AND family_id = ?'
      )
      .bind(
        entryType,
        amount,
        entryCategoryId,
        paymentMethodId,
        memo,
        occurredAt,
        occurredOn,
        recurringRuleId,
        updatedAt,
        id,
        familyId
      )
      .run()

    const previousAmount = typeof existing.amount === 'number' ? existing.amount : amount
    await recordEntryAmountChange(db, {
      familyId,
      entryId: id,
      previousAmount,
      nextAmount: amount,
      actor: actorProfile,
    })

    await recordAudit(db, familyId, actorUserId, 'update', 'entries', id, `entry ${entryType} ${amount}`)

    const startYm = minYmFromDates(existing.occurred_on as string, occurredOn)
    await recalcMonthlyBalances(db, familyId, startYm)

    const entry = await db
      .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<Record<string, unknown>>()

    if (entry) {
      await recordChange(db, familyId, 'entries', id, 'upsert', { entry })
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: {
        entry,
        conflict: softConflict,
        ...(softConflict ? { conflict_class: 'soft' } : {}),
      },
    })
  })

  app.delete('/entries/:id', async (c) => {
    const familyId = requireFamilyId(c)
    if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

    const id = c.req.param('id')
    const endpoint = `/entries/${id}`
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
              entityType: 'entries',
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

    const db = c.env.DB

    const existing = await db
      .prepare('SELECT occurred_on FROM entries WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .first<{ occurred_on?: string }>()

    await db.prepare('DELETE FROM entries WHERE id = ? AND family_id = ?').bind(id, familyId).run()
    await recordAudit(db, familyId, getActorUserId(c), 'delete', 'entries', id)
    await recordChange(db, familyId, 'entries', id, 'delete', { id })

    if (existing?.occurred_on) {
      const startYm = ymFromOccurredOn(existing.occurred_on)
      await recalcMonthlyBalances(db, familyId, startYm)
    }

    return withReceiptResponse(c, {
      requestId,
      familyId,
      endpoint,
      method,
      body: { ok: true, conflict: false },
    })
  })
}
