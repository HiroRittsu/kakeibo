import type { PaymentMethod } from '../../types'

export const sortPaymentMethods = (methods: PaymentMethod[]) => {
  return methods.slice().sort((a, b) => {
    const sortDiff = a.sort_order - b.sort_order
    if (sortDiff !== 0) return sortDiff
    const createdDiff = a.created_at.localeCompare(b.created_at)
    if (createdDiff !== 0) return createdDiff
    return a.name.localeCompare(b.name, 'ja')
  })
}
