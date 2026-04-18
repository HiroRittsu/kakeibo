import { db } from '../../../infra/db'
import { enqueueOutbox } from '../../../infra/sync'
import { getFamilyId, getUserId } from '../../../infra/api'
import { recalcLocalMonthlyBalances } from '../../monthly-balance/services/monthlyBalance'
import { getEntryDateKey, getYmFromDate, toTokyoDateString } from '../../../shared/utils/date'
import { buildEntryCreatePayload, buildEntryUpdatePayload } from './entryPayload'
import type { EntryInputSeed } from '../../../app/types'
import type { AuthSession } from '../../../app/types'
import type { Entry } from '../../../types'

export const saveEntry = async (params: {
  payload: EntryInputSeed
  entries: Entry[]
  currentUser: AuthSession['user'] | null
}) => {
  const { payload, entries, currentUser } = params
  const now = new Date().toISOString()
  const existing = payload.id ? entries.find((entry) => entry.id === payload.id) : null
  const occurredOn = toTokyoDateString(payload.occurredAt)
  const entry: Entry = {
    id: existing?.id ?? crypto.randomUUID(),
    family_id: existing?.family_id ?? getFamilyId(),
    entry_type: payload.entryType,
    amount: payload.amount,
    entry_category_id: payload.entryCategoryId,
    payment_method_id: payload.paymentMethodId,
    memo: payload.memo,
    occurred_at: payload.occurredAt,
    occurred_on: occurredOn,
    recurring_rule_id: existing?.recurring_rule_id ?? payload.recurringRuleId ?? null,
    created_by_user_id: existing?.created_by_user_id ?? payload.createdByUserId ?? currentUser?.id ?? getUserId(),
    created_by_user_name: existing?.created_by_user_name ?? payload.createdByUserName ?? currentUser?.name ?? null,
    created_by_avatar_url:
      existing?.created_by_avatar_url ?? payload.createdByAvatarUrl ?? currentUser?.avatar_url ?? null,
    created_at: existing?.created_at ?? payload.createdAt ?? now,
    updated_at: now,
  }

  await db.entries.put(entry)
  const entriesSnapshot = await db.entries.toArray()
  await recalcLocalMonthlyBalances(entriesSnapshot, entry.family_id, getYmFromDate(occurredOn))

  if (existing) {
    await enqueueOutbox({
      method: 'PATCH',
      endpoint: `/entries/${entry.id}`,
      payload: buildEntryUpdatePayload(entry, existing.updated_at ?? payload.updatedAt ?? null),
      created_at: now,
      entity_type: 'entries',
      entity_id: entry.id,
      operation: 'upsert',
      base_updated_at: existing.updated_at ?? payload.updatedAt ?? null,
    })
  } else {
    await enqueueOutbox({
      method: 'POST',
      endpoint: '/entries',
      payload: buildEntryCreatePayload(entry),
      created_at: now,
      entity_type: 'entries',
      entity_id: entry.id,
      operation: 'upsert',
      base_updated_at: null,
    })
  }
}

export const deleteEntry = async (params: { entryId: string; entries: Entry[] }) => {
  const { entryId, entries } = params
  const existing = entries.find((entry) => entry.id === entryId) ?? (await db.entries.get(entryId))
  await db.entries.delete(entryId)
  if (existing) {
    const entriesSnapshot = await db.entries.toArray()
    await recalcLocalMonthlyBalances(entriesSnapshot, existing.family_id, getYmFromDate(getEntryDateKey(existing)))
  }
  await enqueueOutbox({
    method: 'DELETE',
    endpoint: `/entries/${entryId}`,
    payload: null,
    created_at: new Date().toISOString(),
    entity_type: 'entries',
    entity_id: entryId,
    operation: 'delete',
    base_updated_at: existing?.updated_at ?? null,
  })
}
