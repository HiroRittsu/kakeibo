import { useMemo } from 'react'
import dayjs from 'dayjs'
import { useReportsState } from '../hooks/useReportsState'
import { CATEGORY_COLORS, CARRYOVER_CATEGORY_ID } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import { getRangeBounds } from '../../../shared/utils/date'
import { computeReport } from '../../../shared/utils/report'
import { getCategoryIcon } from '../../../shared/icons/materialIcon'
import type { ReportCategoryEntitySeed } from '../../../app/types'
import type { Entry, EntryCategory, EntryType, MonthlyBalance } from '../../../types'
import type { ReportData, ReportEntry } from '../../../app/types'

const scx = createStyleCx(styles)

type ReportsTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  onOpenCategoryEntities: (seed: ReportCategoryEntitySeed) => void
}

export const ReportsTab = ({ entries, categories, monthlyBalanceMap, onOpenCategoryEntities }: ReportsTabProps) => {
  const { state, dispatch } = useReportsState()

  const rangeUnit = state.range === 'week' ? 'week' : state.range === 'year' ? 'year' : 'month'
  const baseDate = useMemo(() => dayjs().add(state.reportOffset, rangeUnit), [state.reportOffset, rangeUnit])

  const rangeMonths = useMemo(() => {
    const { start, end } = getRangeBounds(state.range, baseDate)
    const startMonth = start.startOf('month')
    const endMonth = end.startOf('month')
    const months: dayjs.Dayjs[] = []
    for (
      let cursor = startMonth;
      cursor.isBefore(endMonth) || cursor.isSame(endMonth, 'month');
      cursor = cursor.add(1, 'month')
    ) {
      months.push(cursor)
    }
    return months
  }, [state.range, baseDate])

  const carryoverEntries = useMemo<ReportEntry[]>(() => {
    return rangeMonths
      .map<ReportEntry | null>((month) => {
        const balanceYm = month.subtract(1, 'month').format('YYYY-MM')
        const balance = monthlyBalanceMap.get(balanceYm)?.balance
        if (typeof balance !== 'number' || balance === 0) return null
        const entryType: EntryType = balance >= 0 ? 'income' : 'expense'
        const amount = Math.abs(balance)
        const occurredAt = `${month.format('YYYY-MM-01')}T00:00:00+09:00`
        return {
          entry_type: entryType,
          amount,
          entry_category_id: CARRYOVER_CATEGORY_ID,
          occurred_at: occurredAt,
        }
      })
      .filter((item): item is ReportEntry => item !== null)
  }, [monthlyBalanceMap, rangeMonths])

  const reportEntries = useMemo<ReportEntry[]>(() => [...entries, ...carryoverEntries], [entries, carryoverEntries])
  const report = useMemo<ReportData>(
    () => computeReport(reportEntries, categories, state.range, baseDate),
    [reportEntries, categories, state.range, baseDate]
  )

  const rangeInfo = useMemo(() => {
    const { start, end } = getRangeBounds(state.range, baseDate)
    const label =
      state.range === 'week'
        ? `${start.format('YYYY/M/D')} - ${end.format('M/D')}`
        : state.range === 'month'
          ? start.format('YYYY年 M月')
          : start.format('YYYY年')
    const detail = `${start.format('YYYY/M/D')} 〜 ${end.format('YYYY/M/D')}`
    const apiFrom = start.format('YYYY-MM-DD')
    const apiTo = end.add(1, 'day').format('YYYY-MM-DD')
    return { label, detail, apiFrom, apiTo }
  }, [state.range, baseDate])

  const activeTotal = report.summary[state.reportType]
  const categoryTotals = report.categoryTotalsByType[state.reportType]
  const donutSegments = categoryTotals.filter((item) => item.total > 0)

  const donutGradient = useMemo(() => {
    if (!donutSegments.length) return 'conic-gradient(#e0e0e0 0 100%)'

    let start = 0
    const stops = donutSegments.map((item, index) => {
      const percent = activeTotal ? (item.total / activeTotal) * 100 : 0
      const end = start + percent
      const color = item.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
      const stop = `${color} ${start}% ${end}%`
      start = end
      return stop
    })

    return `conic-gradient(${stops.join(', ')})`
  }, [donutSegments, activeTotal])

  return (
    <section className={scx('card')}>
      <div className={scx('month-header')}>
        <button className={scx('icon-button')} onClick={() => dispatch({ type: 'SHIFT_REPORT_OFFSET', payload: -1 })}>
          ‹
        </button>
        <h2>{rangeInfo.label}</h2>
        <button className={scx('icon-button')} onClick={() => dispatch({ type: 'SHIFT_REPORT_OFFSET', payload: 1 })}>
          ›
        </button>
      </div>
      <div className={scx('report-panel')}>
        <div className={scx('report-control-grid')}>
          <div className={scx('report-range')}>{rangeInfo.detail}</div>
          <div className={scx('pill-toggle small report-range-toggle')}>
            <button className={scx(state.range === 'week' && 'active')} onClick={() => dispatch({ type: 'SET_RANGE', payload: 'week' })}>
              週
            </button>
            <button className={scx(state.range === 'month' && 'active')} onClick={() => dispatch({ type: 'SET_RANGE', payload: 'month' })}>
              月
            </button>
            <button className={scx(state.range === 'year' && 'active')} onClick={() => dispatch({ type: 'SET_RANGE', payload: 'year' })}>
              年
            </button>
          </div>
          <div className={scx('pill-toggle report-type-toggle')}>
            <button
              type="button"
              className={scx(state.reportType === 'expense' && 'active')}
              onClick={() => dispatch({ type: 'SET_REPORT_TYPE', payload: 'expense' })}
            >
              支出
            </button>
            <button
              type="button"
              className={scx(state.reportType === 'income' && 'active')}
              onClick={() => dispatch({ type: 'SET_REPORT_TYPE', payload: 'income' })}
            >
              収入
            </button>
          </div>
        </div>

        <div className={scx('report-visual')}>
          <div className={scx('donut')} style={{ background: donutGradient }}>
            <div className={scx('donut-center')} />
          </div>
          <div className={scx('report-number-panel')}>
            <div className={scx('report-active-total', state.reportType)}>
              <span>{state.reportType === 'expense' ? '支出' : '収入'}</span>
              <strong>¥{formatAmount(activeTotal)}</strong>
            </div>
            <dl className={scx('report-number-list')}>
              <div>
                <dt>収入</dt>
                <dd>¥{formatAmount(report.summary.income)}</dd>
              </div>
              <div>
                <dt>支出</dt>
                <dd>¥{formatAmount(report.summary.expense)}</dd>
              </div>
              <div>
                <dt>収支</dt>
                <dd>¥{formatAmount(report.summary.income - report.summary.expense)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className={scx('report-section')}>
        <div className={scx('report-header')}>
          <span>カテゴリ別内訳</span>
          <span>{state.reportType === 'expense' ? '支出' : '収入'}/総計</span>
        </div>
        <ul className={scx('list compact')}>
          {categoryTotals.length === 0 && <li>データがありません</li>}
          {categoryTotals.map((item, index) => {
            const percent = activeTotal ? Math.round((item.total / activeTotal) * 100) : 0
            const color = item.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
            return (
              <li key={item.id} className={scx('report-category-item')}>
                <button
                  type="button"
                  className={scx('report-category-row')}
                  aria-label={`${item.name}の明細`}
                  onClick={() =>
                    onOpenCategoryEntities({
                      categoryId: item.id,
                      categoryName: item.name,
                      categoryColor: item.color ?? color,
                      iconKey: item.icon_key ?? null,
                      rangeLabel: rangeInfo.label,
                      entryType: state.reportType,
                      fromDate: rangeInfo.apiFrom,
                      toDateExclusive: rangeInfo.apiTo,
                    })
                  }
                >
                  <div className={scx('report-category-main')}>
                    <div className={scx('entry-main')}>
                      <span className={scx('mini-icon')} style={{ background: color }}>
                        {getCategoryIcon(item.icon_key) ?? item.name.slice(0, 1)}
                      </span>
                      <strong>{item.name}</strong>
                    </div>
                    <span className={scx('report-category-arrow')} aria-hidden="true">
                      ›
                    </span>
                  </div>
                  <div className={scx('progress-row report-category-progress')}>
                    <span>
                      ¥{formatAmount(item.total)} ({percent}%)
                    </span>
                    <div className={scx('progress')}>
                      <span style={{ width: `${percent}%`, background: color }} />
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
