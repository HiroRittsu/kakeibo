import dayjs from 'dayjs'
import type { Entry, MonthlyBalance } from '../../../types'

export type CurrentMonthSummary = {
  income: number
  expense: number
  balance: number
}

export const computeCurrentMonthSummary = (
  entries: Entry[],
  monthlyBalanceMap: Map<string, MonthlyBalance>,
  baseDate = dayjs()
): CurrentMonthSummary => {
  const currentMonthKey = baseDate.format('YYYY-MM')
  const balanceYm = dayjs(currentMonthKey).subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? 0
  const start = baseDate.startOf('month')
  const end = baseDate.endOf('month')

  let income = 0
  let expense = 0

  entries.forEach((entry) => {
    const date = dayjs(entry.occurred_at)
    if (date.isBefore(start) || date.isAfter(end)) return
    if (entry.entry_type === 'income') {
      income += entry.amount
    } else {
      expense += entry.amount
    }
  })

  return {
    income,
    expense,
    balance: carryoverBalance + income - expense,
  }
}
