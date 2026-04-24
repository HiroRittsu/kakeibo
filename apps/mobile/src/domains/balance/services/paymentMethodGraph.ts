import type { PaymentMethod } from '../../../types'
import { isBankAccountMethod, isDebtMethod } from './paymentMethodModel'

export type FundingResolution =
  | { chain: PaymentMethod[]; status: 'bank'; bankId: string }
  | { chain: PaymentMethod[]; status: 'no-parent' | 'missing-parent' | 'cycle' }

export const getMethodFundingSourceId = (method: PaymentMethod) => {
  return method.funding_source_payment_method_id ?? method.linked_bank_payment_method_id ?? null
}

export const buildChildrenByParent = (paymentMethods: PaymentMethod[], paymentMap: Map<string, PaymentMethod>) => {
  const childrenByParent = new Map<string, PaymentMethod[]>()
  paymentMethods.forEach((method) => {
    const parentId = getMethodFundingSourceId(method)
    if (!parentId || !paymentMap.has(parentId)) return
    const current = childrenByParent.get(parentId) ?? []
    current.push(method)
    childrenByParent.set(parentId, current)
  })
  return childrenByParent
}

export const buildFundingChain = (methodId: string, paymentMap: Map<string, PaymentMethod>): FundingResolution => {
  const chain: PaymentMethod[] = []
  const visited = new Set<string>()
  let currentId: string | null | undefined = methodId

  while (currentId) {
    if (visited.has(currentId)) return { chain, status: 'cycle' }
    visited.add(currentId)
    const method = paymentMap.get(currentId)
    if (!method) return { chain, status: 'missing-parent' }
    chain.push(method)
    currentId = getMethodFundingSourceId(method)
  }

  const last = chain.at(-1) ?? null
  if (last && isBankAccountMethod(last)) {
    return { chain, status: 'bank', bankId: last.id }
  }
  return { chain, status: 'no-parent' }
}

export const buildFundingReason = (methodId: string, paymentMap: Map<string, PaymentMethod>) => {
  const resolution = buildFundingChain(methodId, paymentMap)
  if (resolution.status === 'bank') return null
  if (resolution.status === 'cycle') return '循環参照'
  if (resolution.status === 'missing-parent') return '親ID不正'
  return '親未設定'
}

export const findUnlinkedRootId = (methodId: string, paymentMap: Map<string, PaymentMethod>) => {
  const visited: string[] = []
  let currentId: string | null | undefined = methodId

  while (currentId) {
    if (visited.includes(currentId)) {
      return [...visited.slice(visited.indexOf(currentId)), currentId].sort()[0] ?? methodId
    }
    visited.push(currentId)
    const method = paymentMap.get(currentId)
    if (!method) return methodId
    const parentId = getMethodFundingSourceId(method)
    if (!parentId) return method.id
    const parent = paymentMap.get(parentId)
    if (!parent) return method.id
    if (isBankAccountMethod(parent)) return null
    currentId = parent.id
  }

  return methodId
}

export const hasDeferredAncestor = (
  methodId: string | null | undefined,
  paymentMap: Map<string, PaymentMethod>,
  visited = new Set<string>()
): boolean => {
  if (!methodId || visited.has(methodId)) return false
  visited.add(methodId)
  const method = paymentMap.get(methodId)
  if (!method) return false
  if (isDebtMethod(method)) return true
  return hasDeferredAncestor(getMethodFundingSourceId(method), paymentMap, visited)
}

export const collectTreeMethodIds = (rootId: string, childrenByParent: Map<string, PaymentMethod[]>) => {
  const ids = new Set<string>()
  const walk = (methodId: string) => {
    if (ids.has(methodId)) return
    ids.add(methodId)
    ;(childrenByParent.get(methodId) ?? []).forEach((child) => walk(child.id))
  }
  walk(rootId)
  return ids
}
