import dayjs from 'dayjs'
import { CARRYOVER_CATEGORY_ID } from '../constants'
import { getRangeBounds } from './date'
import type { CategoryTotal, ReportData, ReportEntry, ReportSummary } from '../../app/types'
import type { EntryCategory, EntryType } from '../../types'

export const getReportCategoryMeta = (id: string, categories: EntryCategory[]) => {
  if (id === CARRYOVER_CATEGORY_ID) {
    return { name: '繰越し', icon_key: 'redo', color: '#8f9499' }
  }
  const category = categories.find((item) => item.id === id)
  return {
    name: category?.name ?? '未分類',
    icon_key: category?.icon_key ?? null,
    color: category?.color ?? null,
  }
}

export const computeReport = (
  entries: ReportEntry[],
  categories: EntryCategory[],
  range: 'week' | 'month' | 'year',
  baseDate = dayjs()
): ReportData => {
  const { start, end } = getRangeBounds(range, baseDate)

  const summaryTotals: ReportSummary = { income: 0, expense: 0 }
  const categoryMaps: Record<EntryType, Map<string, number>> = {
    income: new Map<string, number>(),
    expense: new Map<string, number>(),
  }

  entries.forEach((entry) => {
    const date = dayjs(entry.occurred_at)
    if (date.isBefore(start) || date.isAfter(end)) return

    summaryTotals[entry.entry_type] += entry.amount
    const key = entry.entry_category_id ?? 'uncategorized'
    const map = categoryMaps[entry.entry_type]
    map.set(key, (map.get(key) ?? 0) + entry.amount)
  })

  const categoryTotalsByType: Record<EntryType, CategoryTotal[]> = {
    income: Array.from(categoryMaps.income.entries())
      .map(([id, total]) => {
        const category = getReportCategoryMeta(id, categories)
        return {
          id,
          total,
          name: category.name,
          icon_key: category.icon_key,
          color: category.color,
        }
      })
      .sort((a, b) => b.total - a.total),
    expense: Array.from(categoryMaps.expense.entries())
      .map(([id, total]) => {
        const category = getReportCategoryMeta(id, categories)
        return {
          id,
          total,
          name: category.name,
          icon_key: category.icon_key,
          color: category.color,
        }
      })
      .sort((a, b) => b.total - a.total),
  }

  return { summary: summaryTotals, categoryTotalsByType }
}
