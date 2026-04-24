import dayjs from 'dayjs'
import { sortPaymentMethods } from '../../../shared/utils/paymentOrder'
import type { Entry, PaymentMethod, RecurringRule } from '../../../types'
import type { EntryListItem } from '../../entries/types'
import { buildChildrenByParent, buildFundingReason, collectTreeMethodIds, findUnlinkedRootId } from './paymentMethodGraph'
import { isBankAccountMethod, isVisibleBalanceMethod } from './paymentMethodModel'
import {
  buildBankStatementForMonth,
  buildMethodStatementForMonth,
  buildMonthlyStatementMap,
  sumStatementEntries,
} from './paymentMethodStatement'

type MethodSummaryType = 'card' | 'postpaid' | 'emoney'

export type MethodTreeSummary = {
  methodId: string
  methodName: string
  type: MethodSummaryType
  iconKey?: string | null
  color?: string | null
  amount: number
  children: MethodTreeSummary[]
}

export type DeductionSegment = {
  methodId: string
  label: string
  color?: string | null
  amount: number
}

export type BankBalanceSummary = {
  bankMethodId: string
  bankName: string
  iconKey?: string | null
  color?: string | null
  detailTotal: number
  linkedTotal: number
  linkedMethods: MethodTreeSummary[]
  deductionSegments: DeductionSegment[]
  detailEntries: EntryListItem[]
}

export type BalanceOverview = {
  bankSummaries: BankBalanceSummary[]
  otherMethodRoots: MethodTreeSummary[]
  unlinkedReasonMap: Map<string, string>
}

const buildMethodTree = (
  method: PaymentMethod,
  childrenByParent: Map<string, PaymentMethod[]>,
  statementMap: ReturnType<typeof buildMonthlyStatementMap>
): MethodTreeSummary => {
  const children = (childrenByParent.get(method.id) ?? [])
    .filter((child) => isVisibleBalanceMethod(child))
    .map((child) => buildMethodTree(child, childrenByParent, statementMap))

  return {
    methodId: method.id,
    methodName: method.name,
    type: method.type as MethodSummaryType,
    iconKey: method.icon_key ?? null,
    color: method.color ?? null,
    amount: sumStatementEntries(method, statementMap.get(method.id)?.entries ?? []),
    children,
  }
}

const flattenSegments = (nodes: MethodTreeSummary[]): DeductionSegment[] => {
  return nodes.flatMap((node) => {
    const current: DeductionSegment[] =
      node.amount > 0
        ? [
            {
              methodId: node.methodId,
              label: node.methodName,
              color: node.color ?? null,
              amount: node.amount,
            },
          ]
        : []
    return [...current, ...flattenSegments(node.children)]
  })
}

const sumMethodTreeAmounts = (nodes: MethodTreeSummary[]): number => {
  return nodes.reduce((sum, node) => sum + node.amount + sumMethodTreeAmounts(node.children), 0)
}

export const buildBalanceOverview = (
  entries: Entry[],
  paymentMethods: PaymentMethod[],
  recurringRules: RecurringRule[],
  month = dayjs()
): BalanceOverview => {
  const selectedMonth = month.startOf('month')
  const methods = sortPaymentMethods(paymentMethods)
  const paymentMap = new Map(methods.map((method) => [method.id, method]))
  const childrenByParent = buildChildrenByParent(methods, paymentMap)
  const statementMap = buildMonthlyStatementMap(methods, entries, recurringRules, selectedMonth)

  const bankSummaries = methods
    .filter((method) => isBankAccountMethod(method))
    .map<BankBalanceSummary>((bank) => {
      const linkedMethods = (childrenByParent.get(bank.id) ?? [])
        .filter((method) => isVisibleBalanceMethod(method))
        .map((method) => buildMethodTree(method, childrenByParent, statementMap))
      const bankStatement = buildBankStatementForMonth(bank.id, methods, entries, recurringRules, selectedMonth)

      return {
        bankMethodId: bank.id,
        bankName: bank.name,
        iconKey: bank.icon_key ?? null,
        color: bank.color ?? null,
        detailTotal: sumStatementEntries(bank, bankStatement?.entries ?? statementMap.get(bank.id)?.entries ?? []),
        linkedTotal: sumMethodTreeAmounts(linkedMethods),
        linkedMethods,
        deductionSegments: flattenSegments(linkedMethods),
        detailEntries: bankStatement?.entries ?? [],
      }
    })

  const bankDescendantIds = new Set<string>()
  bankSummaries.forEach((bank) => {
    bank.linkedMethods.forEach((node) => {
      collectTreeMethodIds(node.methodId, childrenByParent).forEach((id) => bankDescendantIds.add(id))
    })
  })

  const unlinkedRootIds = new Set<string>()
  const unlinkedReasonMap = new Map<string, string>()
  methods
    .filter((method) => isVisibleBalanceMethod(method))
    .filter((method) => !bankDescendantIds.has(method.id))
    .forEach((method) => {
      const rootId = findUnlinkedRootId(method.id, paymentMap)
      if (!rootId) return
      unlinkedRootIds.add(rootId)
      const reason = buildFundingReason(rootId, paymentMap)
      if (reason) unlinkedReasonMap.set(rootId, reason)
    })

  const otherMethodRoots = Array.from(unlinkedRootIds)
    .sort()
    .map((methodId) => paymentMap.get(methodId))
    .filter((method): method is PaymentMethod => Boolean(method))
    .map((method) => buildMethodTree(method, childrenByParent, statementMap))

  return {
    bankSummaries,
    otherMethodRoots,
    unlinkedReasonMap,
  }
}

export const findBankSummary = (
  entries: Entry[],
  paymentMethods: PaymentMethod[],
  recurringRules: RecurringRule[],
  bankMethodId: string,
  month = dayjs()
) => {
  return buildBalanceOverview(entries, paymentMethods, recurringRules, month).bankSummaries.find(
    (summary) => summary.bankMethodId === bankMethodId
  )
}

export const buildMethodDetailEntriesForMonth = (
  methodId: string,
  entries: Entry[],
  paymentMethods: PaymentMethod[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  return buildMethodStatementForMonth(methodId, paymentMethods, entries, recurringRules, month)?.entries ?? []
}
