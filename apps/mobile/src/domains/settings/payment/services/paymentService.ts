import { db } from '../../../../infra/db'
import { enqueueOutbox } from '../../../../infra/sync'
import { getFamilyId } from '../../../../infra/api'
import { PAYMENT_DEFAULT_COLORS } from '../../../../shared/constants'
import { getPaymentFallbackIconKey, getPaymentType } from '../../../../shared/utils/payment'
import { normalizeDayOfMonth } from '../../../../shared/utils/format'
import type { PaymentMethod } from '../../../../types'

export const savePaymentMethod = async (method: PaymentMethod) => {
  const existing = await db.paymentMethods.get(method.id)
  const baseUpdatedAt = existing?.updated_at ?? null
  await db.paymentMethods.put(method)
  await enqueueOutbox({
    method: 'POST',
    endpoint: '/payment-methods',
    payload: {
      id: method.id,
      name: method.name,
      type: method.type,
      icon_key: method.icon_key ?? null,
      color: method.color ?? null,
      card_closing_day: normalizeDayOfMonth(method.card_closing_day),
      card_payment_day: normalizeDayOfMonth(method.card_payment_day),
      funding_source_payment_method_id: method.funding_source_payment_method_id ?? null,
      linked_bank_payment_method_id: method.linked_bank_payment_method_id ?? null,
      sort_order: method.sort_order,
      base_updated_at: baseUpdatedAt,
    },
    created_at: new Date().toISOString(),
    entity_type: 'payment_methods',
    entity_id: method.id,
    operation: 'upsert',
    base_updated_at: baseUpdatedAt,
  })
}

export const addPaymentMethod = async (params: {
  name: string
  type: string
  cardClosingDay: number | null
  cardPaymentDay: number | null
  fundingSourcePaymentMethodId: string | null
  orderedMethods: PaymentMethod[]
}) => {
  const now = new Date().toISOString()
  const normalizedType = getPaymentType(params.type)
  const maxSortOrder = params.orderedMethods.reduce((max, item) => Math.max(max, item.sort_order), 0)
  const method: PaymentMethod = {
    id: crypto.randomUUID(),
    family_id: getFamilyId(),
    name: params.name,
    type: normalizedType,
    icon_key: getPaymentFallbackIconKey(normalizedType),
    color: PAYMENT_DEFAULT_COLORS[normalizedType],
    card_closing_day: normalizedType === 'card' || normalizedType === 'postpaid' ? params.cardClosingDay : null,
    card_payment_day: normalizedType === 'card' || normalizedType === 'postpaid' ? params.cardPaymentDay : null,
    funding_source_payment_method_id:
      normalizedType === 'card' || normalizedType === 'postpaid' || normalizedType === 'emoney'
        ? params.fundingSourcePaymentMethodId
        : null,
    linked_bank_payment_method_id:
      normalizedType === 'card' || normalizedType === 'postpaid' ? params.fundingSourcePaymentMethodId : null,
    sort_order: maxSortOrder + 1,
    created_at: now,
    updated_at: now,
  }

  await savePaymentMethod(method)
}

export const deletePaymentMethod = async (method: PaymentMethod) => {
  await db.paymentMethods.delete(method.id)
  await enqueueOutbox({
    method: 'DELETE',
    endpoint: `/payment-methods/${method.id}`,
    payload: null,
    created_at: new Date().toISOString(),
    entity_type: 'payment_methods',
    entity_id: method.id,
    operation: 'delete',
    base_updated_at: method.updated_at ?? null,
  })
}
