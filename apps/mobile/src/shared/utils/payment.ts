import { PAYMENT_DEFAULT_COLORS } from '../constants'
import type { PaymentType } from '../../app/types'
import type { PaymentMethod } from '../../types'
import { renderMaterialIcon } from '../icons/materialIcon'
export { sortPaymentMethods } from './paymentOrder'

export const getPaymentType = (type: string): PaymentType => {
  if (type === 'bank' || type === 'emoney' || type === 'card' || type === 'cash' || type === 'postpaid') return type
  return 'cash'
}

export const getPaymentFallbackIconKey = (type: string) => {
  if (type === 'bank') return 'account_balance'
  if (type === 'emoney') return 'account_balance_wallet'
  if (type === 'card') return 'credit_card'
  if (type === 'postpaid') return 'receipt_long'
  return 'payments'
}

export const getPaymentIconFromConfig = (type: string, iconKey?: string | null) => {
  const normalizedIconKey = typeof iconKey === 'string' && iconKey.trim() ? iconKey.trim() : null
  return renderMaterialIcon(normalizedIconKey ?? getPaymentFallbackIconKey(type))
}

export const getPaymentColor = (method?: PaymentMethod | null) => {
  if (!method) return PAYMENT_DEFAULT_COLORS.cash
  return method.color ?? PAYMENT_DEFAULT_COLORS[getPaymentType(method.type)]
}

export const getPaymentColorByType = (type: string, color?: string | null) => {
  return color ?? PAYMENT_DEFAULT_COLORS[getPaymentType(type)]
}

export const getPaymentIcon = (method?: PaymentMethod | null) => {
  return getPaymentIconFromConfig(method?.type ?? 'cash', method?.icon_key ?? null)
}

export const paymentMethodLabel = (methods: PaymentMethod[], id: string | null) => {
  if (!id) return '未設定'
  return methods.find((method) => method.id === id)?.name ?? '未設定'
}

export const paymentTypeLabel = (type: string) => {
  if (type === 'cash') return '現金'
  if (type === 'bank') return '銀行'
  if (type === 'emoney') return '電子マネー'
  if (type === 'card') return 'クレジット'
  if (type === 'postpaid') return '後払い'
  return '支払い'
}
