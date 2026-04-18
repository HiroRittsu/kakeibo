import dayjs from 'dayjs'
import { getRangeBounds } from './date'
import type { HolidayAdjustment } from '../../app/types'
import type { RecurringRule } from '../../types'

export const normalizeHolidayAdjustment = (value?: string | null): HolidayAdjustment => {
  if (value === 'previous' || value === 'next') return value
  return 'none'
}

const adjustForWeekend = (date: dayjs.Dayjs, adjustment: HolidayAdjustment) => {
  const day = date.day()
  if (adjustment === 'none' || (day !== 0 && day !== 6)) return date
  if (adjustment === 'previous') {
    return day === 0 ? date.subtract(2, 'day') : date.subtract(1, 'day')
  }
  return day === 0 ? date.add(1, 'day') : date.add(2, 'day')
}

const getDueDay = (target: dayjs.Dayjs, ruleDay: number | null, fallback: dayjs.Dayjs) => {
  const candidate = ruleDay ?? fallback.date()
  return Math.min(candidate, target.daysInMonth())
}

export type RecurringOccurrence = {
  rule: RecurringRule
  date: dayjs.Dayjs
  isFuture: boolean
}

export const buildRecurringOccurrences = (
  rules: RecurringRule[],
  range: 'week' | 'month' | 'year',
  baseDate: dayjs.Dayjs
) => {
  const { start, end } = getRangeBounds(range, baseDate)
  const rangeStart = start.startOf('day')
  const rangeEnd = end.endOf('day')
  const occurrences: RecurringOccurrence[] = []
  const seen = new Set<string>()
  const today = dayjs()

  rules.forEach((rule) => {
    if (!rule.is_active) return
    const ruleStart = dayjs(rule.start_at)
    const ruleEnd = rule.end_at ? dayjs(rule.end_at) : null
    const adjustment = normalizeHolidayAdjustment(rule.holiday_adjustment)
    const frequency = rule.frequency ?? 'monthly'

    const addOccurrence = (base: dayjs.Dayjs) => {
      if (base.isBefore(ruleStart, 'day')) return
      if (ruleEnd && base.isAfter(ruleEnd, 'day')) return
      const adjusted = adjustForWeekend(base, adjustment)
      if (adjusted.isBefore(rangeStart, 'day') || adjusted.isAfter(rangeEnd, 'day')) return
      const key = `${rule.id}:${adjusted.format('YYYY-MM-DD')}`
      if (seen.has(key)) return
      seen.add(key)
      occurrences.push({ rule, date: adjusted, isFuture: adjusted.isAfter(today, 'day') })
    }

    if (frequency === 'weekly') {
      const weekday =
        rule.day_of_month !== null && rule.day_of_month >= 0 && rule.day_of_month <= 6
          ? rule.day_of_month
          : ruleStart.day()
      const scanStart = rangeStart.subtract(2, 'day')
      const scanEnd = rangeEnd.add(2, 'day')
      for (
        let cursor = scanStart;
        cursor.isBefore(scanEnd) || cursor.isSame(scanEnd, 'day');
        cursor = cursor.add(1, 'day')
      ) {
        if (cursor.day() !== weekday) continue
        addOccurrence(cursor)
      }
      return
    }

    const monthStart = rangeStart.startOf('month').subtract(1, 'month')
    const monthEnd = rangeEnd.startOf('month').add(1, 'month')
    for (
      let cursor = monthStart;
      cursor.isBefore(monthEnd) || cursor.isSame(monthEnd, 'month');
      cursor = cursor.add(1, 'month')
    ) {
      if (frequency === 'bimonthly') {
        const diff = cursor.startOf('month').diff(ruleStart.startOf('month'), 'month')
        if (diff < 0 || diff % 2 !== 0) continue
      }
      if (frequency === 'yearly' && cursor.month() !== ruleStart.month()) {
        continue
      }
      const dueDay = getDueDay(cursor, rule.day_of_month, ruleStart)
      addOccurrence(cursor.date(dueDay))
    }
  })

  return occurrences.sort((a, b) => a.date.valueOf() - b.date.valueOf())
}

export const estimateMonthlyAmount = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  if (frequency === 'weekly') return rule.amount * 4
  if (frequency === 'biweekly') return rule.amount * 2
  if (frequency === 'bimonthly') return Math.round(rule.amount / 2)
  if (frequency === 'yearly') return Math.round(rule.amount / 12)
  return rule.amount
}

export const groupByFrequency = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  if (frequency === 'weekly') return '毎週'
  if (frequency === 'bimonthly') return '隔月/任意の月'
  if (frequency === 'yearly') return '年次'
  return '毎月'
}

export const formatRecurringScheduleLabel = (rule: RecurringRule) => {
  const frequency = rule.frequency || 'monthly'
  const start = dayjs(rule.start_at)
  if (frequency === 'weekly') {
    const weekday =
      rule.day_of_month !== null && rule.day_of_month >= 0 && rule.day_of_month <= 6
        ? rule.day_of_month
        : start.day()
    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土']
    return `毎週${weekdayLabels[weekday]}`
  }
  const dayValue = rule.day_of_month ?? start.date()
  if (frequency === 'bimonthly') return `隔月${dayValue}日`
  if (frequency === 'yearly') return `${start.month() + 1}月${dayValue}日`
  return `毎月${dayValue}日`
}
