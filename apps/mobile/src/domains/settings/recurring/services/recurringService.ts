import { db } from '../../../../infra/db'
import { enqueueOutbox } from '../../../../infra/sync'
import { getFamilyId } from '../../../../infra/api'
import type { HolidayAdjustment } from '../../../../app/types'
import type { EntryType, RecurringRule } from '../../../../types'

export const saveRecurringRule = async (recurringRule: RecurringRule) => {
  const existing = await db.recurringRules.get(recurringRule.id)
  const baseUpdatedAt = existing?.updated_at ?? null
  await db.recurringRules.put(recurringRule)
  await enqueueOutbox({
    method: 'POST',
    endpoint: '/recurring-rules',
    payload: {
      id: recurringRule.id,
      entry_type: recurringRule.entry_type,
      amount: recurringRule.amount,
      entry_category_id: recurringRule.entry_category_id,
      payment_method_id: recurringRule.payment_method_id,
      memo: recurringRule.memo,
      frequency: recurringRule.frequency,
      day_of_month: recurringRule.day_of_month,
      start_at: recurringRule.start_at,
      end_at: recurringRule.end_at,
      is_active: recurringRule.is_active,
      holiday_adjustment: recurringRule.holiday_adjustment ?? 'none',
      base_updated_at: baseUpdatedAt,
    },
    created_at: new Date().toISOString(),
    entity_type: 'recurring_rules',
    entity_id: recurringRule.id,
    operation: 'upsert',
    base_updated_at: baseUpdatedAt,
  })
}

export const deleteRecurringRule = async (rule: RecurringRule) => {
  await db.recurringRules.delete(rule.id)
  await enqueueOutbox({
    method: 'DELETE',
    endpoint: `/recurring-rules/${rule.id}`,
    payload: null,
    created_at: new Date().toISOString(),
    entity_type: 'recurring_rules',
    entity_id: rule.id,
    operation: 'delete',
    base_updated_at: rule.updated_at ?? null,
  })
}

export const addRecurringRule = async (rule: {
  entryType: EntryType
  amount: number
  entryCategoryId: string | null
  paymentMethodId: string | null
  memo: string | null
  frequency: string
  dayOfMonth: number | null
  holidayAdjustment: HolidayAdjustment
  startAt: string
}) => {
  const now = new Date().toISOString()
  const recurringRule: RecurringRule = {
    id: crypto.randomUUID(),
    family_id: getFamilyId(),
    entry_type: rule.entryType,
    amount: rule.amount,
    entry_category_id: rule.entryCategoryId,
    payment_method_id: rule.paymentMethodId,
    memo: rule.memo,
    frequency: rule.frequency,
    day_of_month: rule.dayOfMonth,
    holiday_adjustment: rule.holidayAdjustment,
    start_at: rule.startAt,
    end_at: null,
    is_active: true,
    created_at: now,
    updated_at: now,
  }

  await saveRecurringRule(recurringRule)
}
