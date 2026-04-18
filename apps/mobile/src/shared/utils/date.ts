import dayjs from 'dayjs'
import type { DayCell, DayTotals, HistoryItem } from '../../app/types'
import type { Entry } from '../../types'

export const getYmFromDate = (value: string) => value.slice(0, 7)

export const ymToIndex = (ym: string) => {
  const [yearRaw, monthRaw] = ym.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0
  return year * 12 + (month - 1)
}

export const formatYmFromIndex = (index: number) => {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${`${month}`.padStart(2, '0')}`
}

export const addMonthsToYm = (ym: string, diff: number) => {
  const nextIndex = ymToIndex(ym) + diff
  return formatYmFromIndex(nextIndex)
}

export const parseMonthYm = (ym: string) => {
  const parsed = dayjs(`${ym}-01`)
  if (!parsed.isValid()) return dayjs().startOf('month')
  return parsed.startOf('month')
}

export const getDefaultSelectedDateForMonth = (month: dayjs.Dayjs) => {
  const today = dayjs()
  if (today.isSame(month, 'month')) return today.format('YYYY-MM-DD')
  return month.startOf('month').format('YYYY-MM-DD')
}

export const toTokyoDateString = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return tokyo.toISOString().slice(0, 10)
}

export const getEntryDateKey = (entry: Entry | HistoryItem) => entry.occurred_on ?? toTokyoDateString(entry.occurred_at)

export const buildCalendar = (month: dayjs.Dayjs, totals: Map<string, DayTotals>) => {
  const start = month.startOf('month')
  const end = month.endOf('month')
  const startWeekday = start.day()
  const days: DayCell[] = []

  for (let i = 0; i < startWeekday; i += 1) {
    const date = start.subtract(startWeekday - i, 'day')
    days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } })
  }

  for (let day = 0; day < end.date(); day += 1) {
    const date = start.add(day, 'day')
    const key = date.format('YYYY-MM-DD')
    days.push({ date, inMonth: true, totals: totals.get(key) ?? { income: 0, expense: 0 } })
  }

  while (days.length % 7 !== 0) {
    const date = end.add(days.length % 7, 'day')
    days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } })
  }

  return days
}

export const getRangeBounds = (range: 'week' | 'month' | 'year', base = dayjs()) => {
  let start = base.startOf('month')
  let end = base.endOf('month')

  if (range === 'week') {
    const day = (base.day() + 6) % 7
    start = base.subtract(day, 'day').startOf('day')
    end = start.add(6, 'day').endOf('day')
  } else if (range === 'year') {
    start = base.startOf('year')
    end = base.endOf('year')
  }

  return { start, end }
}
