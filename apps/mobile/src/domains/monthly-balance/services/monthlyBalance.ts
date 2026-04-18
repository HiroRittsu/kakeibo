import dayjs from 'dayjs'
import { db } from '../../../infra/db'
import type { Entry, MonthlyBalance } from '../../../types'
import { addMonthsToYm, formatYmFromIndex, getEntryDateKey, getYmFromDate, ymToIndex } from '../../../shared/utils/date'

export const buildMonthlyBalanceId = (familyId: string, ym: string) => `${familyId}:${ym}`

export const recalcLocalMonthlyBalances = async (entries: Entry[], familyId: string, startYm: string) => {
  const currentYm = dayjs().format('YYYY-MM')
  const startIndex = ymToIndex(startYm)
  const endIndex = ymToIndex(currentYm)
  if (startIndex > endIndex) return

  const prevYm = addMonthsToYm(startYm, -1)
  const prevRecord = await db.monthlyBalances.get(buildMonthlyBalanceId(familyId, prevYm))
  let previousBalance =
    typeof prevRecord?.balance === 'number'
      ? prevRecord.balance
      : entries.reduce((sum, entry) => {
          const ym = getYmFromDate(getEntryDateKey(entry))
          if (ymToIndex(ym) <= ymToIndex(prevYm)) {
            return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount)
          }
          return sum
        }, 0)

  const monthTotals = new Map<string, { income: number; expense: number }>()
  entries.forEach((entry) => {
    const ym = getYmFromDate(getEntryDateKey(entry))
    const index = ymToIndex(ym)
    if (index < startIndex || index > endIndex) return
    const current = monthTotals.get(ym) ?? { income: 0, expense: 0 }
    if (entry.entry_type === 'income') {
      current.income += entry.amount
    } else {
      current.expense += entry.amount
    }
    monthTotals.set(ym, current)
  })

  const months: string[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    months.push(formatYmFromIndex(index))
  }

  const existingBalances = months.length ? await db.monthlyBalances.where('ym').anyOf(months).toArray() : []
  const isClosedMap = new Map(existingBalances.map((row) => [row.ym, row.is_closed ?? 0]))

  const updatedAt = new Date().toISOString()
  const records: MonthlyBalance[] = []
  months.forEach((ym) => {
    const totals = monthTotals.get(ym) ?? { income: 0, expense: 0 }
    previousBalance += totals.income - totals.expense
    records.push({
      id: buildMonthlyBalanceId(familyId, ym),
      family_id: familyId,
      ym,
      balance: Math.round(previousBalance),
      is_closed: isClosedMap.get(ym) ?? 0,
      updated_at: updatedAt,
    })
  })

  if (records.length) {
    await db.monthlyBalances.bulkPut(records)
  }
}
