import dayjs from 'dayjs'
import { normalizeDayOfMonth } from '../../../shared/utils/format'
import { buildRecurringOccurrences } from '../../../shared/utils/recurring'
import type { Entry, PaymentMethod, RecurringRule } from '../../../types'

export type DeferredCharge = {
  id: string
  methodId: string
  amount: number
  paymentDate: string
  categoryId: string | null
  memo: string | null
  isPlanned: boolean
}

const buildRuleOccurrenceIndex = (entries: Entry[]) => {
  return new Set(
    entries
      .filter((entry) => entry.recurring_rule_id)
      .map((entry) => `${entry.recurring_rule_id}:${entry.occurred_on}`)
  )
}

export const buildRecurringOccurrencesForMonth = (rules: RecurringRule[], entries: Entry[], month = dayjs()) => {
  const existingRuleOccurrences = buildRuleOccurrenceIndex(entries)
  return buildRecurringOccurrences(rules, 'month', month)
    .filter((occurrence) => !existingRuleOccurrences.has(`${occurrence.rule.id}:${occurrence.date.format('YYYY-MM-DD')}`))
    .map(({ rule, date }) => ({ rule, date: date.startOf('day') }))
}

export const resolveDeferredPaymentDate = (occurredAt: string, method: PaymentMethod) => {
  const closingDay = normalizeDayOfMonth(method.card_closing_day)
  const paymentDay = normalizeDayOfMonth(method.card_payment_day)
  if (!closingDay || !paymentDay) return null

  const occurred = dayjs(occurredAt)
  const closingBaseMonth =
    occurred.date() <= closingDay ? occurred.startOf('month') : occurred.add(1, 'month').startOf('month')
  const paymentBaseMonth = closingBaseMonth.add(1, 'month')
  const targetDay = Math.min(paymentDay, paymentBaseMonth.daysInMonth())
  return paymentBaseMonth.date(targetDay).startOf('day')
}

export const collectDeferredChargesForMonth = (
  methods: PaymentMethod[],
  entries: Entry[],
  recurringRules: RecurringRule[],
  month = dayjs()
) => {
  const selectedMonth = month.startOf('month')
  const methodMap = new Map(methods.map((method) => [method.id, method]))
  const charges: DeferredCharge[] = []

  entries.forEach((entry) => {
    if (!entry.payment_method_id) return
    const method = methodMap.get(entry.payment_method_id)
    if (!method) return
    const paymentDate = resolveDeferredPaymentDate(entry.occurred_at, method)
    if (!paymentDate || !paymentDate.isSame(selectedMonth, 'month')) return
    charges.push({
      id: `deferred-entry:${entry.id}:${paymentDate.format('YYYY-MM-DD')}`,
      methodId: method.id,
      amount: entry.entry_type === 'expense' ? entry.amount : -entry.amount,
      paymentDate: paymentDate.toISOString(),
      categoryId: entry.entry_category_id,
      memo: entry.memo,
      isPlanned: true,
    })
  })

  const methodRules = recurringRules.filter((rule) => !!rule.payment_method_id && methodMap.has(rule.payment_method_id))
  const occurrenceMonths = [
    selectedMonth.subtract(2, 'month'),
    selectedMonth.subtract(1, 'month'),
    selectedMonth,
  ]
  occurrenceMonths.forEach((targetMonth) => {
    buildRecurringOccurrencesForMonth(methodRules, entries, targetMonth).forEach(({ rule, date }) => {
      if (!rule.payment_method_id) return
      const method = methodMap.get(rule.payment_method_id)
      if (!method) return
      const paymentDate = resolveDeferredPaymentDate(date.toISOString(), method)
      if (!paymentDate || !paymentDate.isSame(selectedMonth, 'month')) return
      charges.push({
        id: `deferred-rule:${rule.id}:${paymentDate.format('YYYY-MM-DD')}`,
        methodId: method.id,
        amount: rule.entry_type === 'expense' ? rule.amount : -rule.amount,
        paymentDate: paymentDate.toISOString(),
        categoryId: rule.entry_category_id,
        memo: rule.memo,
        isPlanned: true,
      })
    })
  })

  const aggregated = new Map<string, DeferredCharge>()
  charges.forEach((charge) => {
    const key = `${charge.methodId}:${charge.paymentDate}`
    const current = aggregated.get(key)
    if (!current) {
      aggregated.set(key, { ...charge })
      return
    }
    current.amount += charge.amount
    aggregated.set(key, current)
  })

  return Array.from(aggregated.values())
}
