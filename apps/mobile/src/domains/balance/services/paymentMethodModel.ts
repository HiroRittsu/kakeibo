import type { PaymentMethod } from '../../../types'

export type PaymentMethodValueMode = 'balance' | 'debt'

const getMethodType = (methodOrType: PaymentMethod | string) => {
  return typeof methodOrType === 'string' ? methodOrType : methodOrType.type
}

export const getPaymentMethodValueMode = (methodOrType: PaymentMethod | string): PaymentMethodValueMode => {
  const type = getMethodType(methodOrType)
  if (type === 'card' || type === 'postpaid') return 'debt'
  return 'balance'
}

export const isBankAccountMethod = (methodOrType: PaymentMethod | string) => {
  return getMethodType(methodOrType) === 'bank'
}

export const isDebtMethod = (methodOrType: PaymentMethod | string) => {
  return getPaymentMethodValueMode(methodOrType) === 'debt'
}

export const isBalanceChildMethod = (methodOrType: PaymentMethod | string) => {
  const type = getMethodType(methodOrType)
  return getPaymentMethodValueMode(type) === 'balance' && type !== 'bank' && type !== 'cash'
}

export const isVisibleBalanceMethod = (methodOrType: PaymentMethod | string) => {
  return isDebtMethod(methodOrType) || isBalanceChildMethod(methodOrType)
}

export const inheritsParentEffectiveDate = (methodOrType: PaymentMethod | string) => {
  return isBalanceChildMethod(methodOrType)
}
