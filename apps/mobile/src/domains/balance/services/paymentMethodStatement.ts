import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { Entry, EntryType, PaymentMethod, RecurringRule } from '../../../types'
import type { EntryListItem } from '../../entries/types'
import { buildRecurringOccurrencesForMonth, collectDeferredChargesForMonth } from './paymentMethodEffects'
import { buildChildrenByParent } from './paymentMethodGraph'
import { getPaymentMethodValueMode, isBankAccountMethod, isDebtMethod } from './paymentMethodModel'

export type MonthlyStatement = {
  methodId: string
  activityEntries: EntryListItem[]
  entries: EntryListItem[]
}

const getSignedAmount = (
  method: PaymentMethod,
  entry: Pick<Entry, 'entry_type' | 'amount'> | Pick<RecurringRule, 'entry_type' | 'amount'>
) => {
  if (getPaymentMethodValueMode(method) === 'debt') {
    return entry.entry_type === 'expense' ? entry.amount : -entry.amount
  }
  return entry.entry_type === 'income' ? entry.amount : -entry.amount
}

const buildMethodActivityEntriesForMonth = (
  method: PaymentMethod,
  entries: Entry[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  const selectedMonth = month.startOf('month')

  const actualEntries: EntryListItem[] = entries
    .filter((entry) => entry.payment_method_id === method.id)
    .filter((entry) => dayjs(entry.occurred_at).isSame(selectedMonth, 'month'))
    .map((entry) => ({
      ...entry,
      is_planned: dayjs(entry.occurred_at).isAfter(dayjs()),
    }))

  const plannedEntries: EntryListItem[] = recurringRules
    .filter((rule) => rule.payment_method_id === method.id)
    .flatMap((rule) =>
      buildRecurringOccurrencesForMonth([rule], entries, selectedMonth).map(({ date }) => ({
        id: `statement-rule:${rule.id}:${date.format('YYYY-MM-DD')}`,
        family_id: rule.family_id,
        entry_type: rule.entry_type,
        amount: rule.amount,
        entry_category_id: rule.entry_category_id,
        payment_method_id: method.id,
        memo: rule.memo,
        occurred_at: date.toISOString(),
        occurred_on: date.format('YYYY-MM-DD'),
        recurring_rule_id: rule.id,
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
        is_planned: true,
      }))
    )

  return [...actualEntries, ...plannedEntries].sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf())
}

export const buildMonthlyStatementMap = (
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  const selectedMonth = month.startOf('month')
  const statements = new Map<string, MonthlyStatement>()

  methods.forEach((method) => {
    const activityEntries = buildMethodActivityEntriesForMonth(method, entries, recurringRules, selectedMonth)
    statements.set(method.id, {
      methodId: method.id,
      activityEntries,
      entries: activityEntries,
    })
  })

  return statements
}

export const sumStatementEntries = (
  method: PaymentMethod,
  entries: Array<Pick<EntryListItem, 'entry_type' | 'amount'>>
) => {
  return entries.reduce((sum, entry) => sum + getSignedAmount(method, entry), 0)
}

export const buildMethodStatementForMonth = (
  methodId: string,
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  return buildMonthlyStatementMap(methods, entries, recurringRules, month).get(methodId) ?? null
}

const collectDescendantIds = (bankId: string, methods: PaymentMethod[]) => {
  const methodMap = new Map(methods.map((method) => [method.id, method]))
  const childrenByParent = buildChildrenByParent(methods, methodMap)
  const descendantIds = new Set<string>()
  const walk = (methodId: string) => {
    ;(childrenByParent.get(methodId) ?? []).forEach((child) => {
      descendantIds.add(child.id)
      walk(child.id)
    })
  }
  walk(bankId)
  return descendantIds
}

const buildSettlementEntriesForMonth = (
  bank: PaymentMethod,
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  descendantIds: Set<string>,
  month: Dayjs
) => {
  const methodMap = new Map(methods.map((method) => [method.id, method]))
  return collectDeferredChargesForMonth(
    methods.filter((method) => isDebtMethod(method) && descendantIds.has(method.id)),
    entries,
    recurringRules,
    month
  ).map((charge) => {
    const method = methodMap.get(charge.methodId)
    const entryType: EntryType = charge.amount >= 0 ? 'expense' : 'income'
    return {
      id: charge.id,
      family_id: bank.family_id,
      entry_type: entryType,
      amount: Math.abs(charge.amount),
      entry_category_id: null,
      payment_method_id: charge.methodId,
      memo: null,
      occurred_at: charge.paymentDate,
      occurred_on: dayjs(charge.paymentDate).format('YYYY-MM-DD'),
      recurring_rule_id: null,
      created_at: charge.paymentDate,
      updated_at: charge.paymentDate,
      is_planned: charge.isPlanned,
      display_name: `${method?.name ?? '後払い'}引落`,
      detail_label: '口座引落',
      use_payment_icon_as_primary: true,
    } satisfies EntryListItem
  })
}

const buildBankActivityEntriesForMonth = (
  bank: PaymentMethod,
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  descendantIds: Set<string>,
  month: Dayjs
) => {
  const baseStatement = buildMethodStatementForMonth(bank.id, methods, entries, recurringRules, month)
  const settlementEntries = buildSettlementEntriesForMonth(bank, methods, entries, recurringRules, descendantIds, month)

  return [...(baseStatement?.activityEntries ?? []), ...settlementEntries].sort(
    (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
  )
}

const findEarliestActivityMonth = (
  bank: PaymentMethod,
  entries: Entry[],
  recurringRules: RecurringRule[],
  descendantIds: Set<string>
) => {
  const targetMethodIds = new Set([bank.id, ...descendantIds])
  const dates = [
    ...entries
      .filter((entry) => entry.payment_method_id && targetMethodIds.has(entry.payment_method_id))
      .map((entry) => entry.occurred_at),
    ...recurringRules
      .filter((rule) => rule.payment_method_id && targetMethodIds.has(rule.payment_method_id))
      .map((rule) => rule.start_at),
  ]
  const earliest = dates
    .map((date) => dayjs(date))
    .filter((date) => date.isValid())
    .sort((a, b) => a.valueOf() - b.valueOf())[0]

  return earliest?.startOf('month') ?? null
}

const calculateBankCarryoverAmount = (
  bank: PaymentMethod,
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  descendantIds: Set<string>,
  month: Dayjs
) => {
  const selectedMonth = month.startOf('month')
  const startMonth = findEarliestActivityMonth(bank, entries, recurringRules, descendantIds)
  if (!startMonth || !startMonth.isBefore(selectedMonth, 'month')) return 0

  let amount = 0
  let cursor = startMonth
  while (cursor.isBefore(selectedMonth, 'month')) {
    amount += sumStatementEntries(
      bank,
      buildBankActivityEntriesForMonth(bank, methods, entries, recurringRules, descendantIds, cursor)
    )
    cursor = cursor.add(1, 'month')
  }
  return amount
}

const buildCarryoverEntry = (bank: PaymentMethod, amount: number, month: Dayjs): EntryListItem | null => {
  if (amount === 0) return null
  const date = month.startOf('month')
  const entryType: EntryType = amount >= 0 ? 'income' : 'expense'
  return {
    id: `bank-carryover:${bank.id}:${date.format('YYYY-MM')}`,
    family_id: bank.family_id,
    entry_type: entryType,
    amount: Math.abs(amount),
    entry_category_id: null,
    payment_method_id: bank.id,
    memo: '前月末残高',
    occurred_at: date.toISOString(),
    occurred_on: date.format('YYYY-MM-DD'),
    recurring_rule_id: null,
    created_at: date.toISOString(),
    updated_at: date.toISOString(),
    is_carryover: true,
  }
}

export const buildBankStatementForMonth = (
  bankId: string,
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  const selectedMonth = month.startOf('month')
  const methodMap = new Map(methods.map((method) => [method.id, method]))
  const bank = methodMap.get(bankId)
  if (!bank || !isBankAccountMethod(bank)) return null

  const descendantIds = collectDescendantIds(bankId, methods)
  const activityEntries = buildBankActivityEntriesForMonth(
    bank,
    methods,
    entries,
    recurringRules,
    descendantIds,
    selectedMonth
  )
  const carryoverEntry = buildCarryoverEntry(
    bank,
    calculateBankCarryoverAmount(bank, methods, entries, recurringRules, descendantIds, selectedMonth),
    selectedMonth
  )

  const statementEntries = [carryoverEntry, ...activityEntries].filter((entry): entry is EntryListItem => Boolean(entry)).sort(
    (a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()
  )
  return {
    methodId: bank.id,
    activityEntries,
    entries: statementEntries,
  } satisfies MonthlyStatement
}
