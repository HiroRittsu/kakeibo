import { useMemo } from 'react'
import dayjs from 'dayjs'
import { EntryButtonsList, type EntryListItem } from '../../entries/components/EntryButtonsList'
import { useHistoryViewState } from '../hooks/useHistoryViewState'
import { getCategoryIcon } from '../../../shared/icons/materialIcon'
import { WEEKDAY_LABELS } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import {
  buildCalendar,
  getDefaultSelectedDateForMonth,
  getEntryDateKey,
  getRangeBounds,
  parseMonthYm,
  toTokyoDateString,
} from '../../../shared/utils/date'
import { buildRecurringOccurrences } from '../../../shared/utils/recurring'
import { getPaymentColor, getPaymentIcon } from '../../../shared/utils/payment'
import { getFamilyId } from '../../../infra/api'
import type { CarryoverDay, EntryInputSeed, HistoryItem, TabKey } from '../../../app/types'
import type { Entry, EntryCategory, EntryType, MonthlyBalance, PaymentMethod, RecurringRule } from '../../../types'

const scx = createStyleCx(styles)

type HistoryTabProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  monthlyBalanceMap: Map<string, MonthlyBalance>
  recurringRules: RecurringRule[]
  currentMonthYm: string
  onChangeMonthYm: (ym: string) => void
  onEdit: (entry: Entry) => void
  onOpenEntryInput: (seed: EntryInputSeed, tab?: TabKey) => void
  defaultEntryType: EntryType
  defaultPaymentMethodId: string | null
}

export const HistoryTab = ({
  entries,
  categoryMap,
  paymentMap,
  monthlyBalanceMap,
  recurringRules,
  currentMonthYm,
  onChangeMonthYm,
  onEdit,
  onOpenEntryInput,
  defaultEntryType,
  defaultPaymentMethodId,
}: HistoryTabProps) => {
  const currentMonth = useMemo(() => parseMonthYm(currentMonthYm), [currentMonthYm])
  const { state, dispatch } = useHistoryViewState(getDefaultSelectedDateForMonth(parseMonthYm(currentMonthYm)))

  const displayYm = currentMonth.format('YYYY-MM')
  const balanceYm = currentMonth.subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const monthEntries = useMemo(() => {
    return entries.filter((entry) => dayjs(getEntryDateKey(entry)).isSame(currentMonth, 'month'))
  }, [entries, currentMonth])

  const plannedItems = useMemo<HistoryItem[]>(() => {
    if (!recurringRules.length) return []
    const { start, end } = getRangeBounds('month', currentMonth)
    const existingKeys = new Set(
      entries
        .filter((entry) => entry.recurring_rule_id)
        .map((entry) => `${entry.recurring_rule_id}:${entry.occurred_on ?? toTokyoDateString(entry.occurred_at)}`)
    )
    return buildRecurringOccurrences(recurringRules, 'month', currentMonth)
      .filter((occurrence) => {
        if (occurrence.date.isBefore(start) || occurrence.date.isAfter(end)) return false
        const key = `${occurrence.rule.id}:${occurrence.date.format('YYYY-MM-DD')}`
        return !existingKeys.has(key)
      })
      .map((occurrence) => ({
        id: `planned-${occurrence.rule.id}-${occurrence.date.format('YYYY-MM-DD')}`,
        family_id: occurrence.rule.family_id,
        entry_type: occurrence.rule.entry_type,
        amount: occurrence.rule.amount,
        entry_category_id: occurrence.rule.entry_category_id,
        payment_method_id: occurrence.rule.payment_method_id,
        memo: occurrence.rule.memo,
        occurred_at: occurrence.date.toISOString(),
        occurred_on: occurrence.date.format('YYYY-MM-DD'),
        recurring_rule_id: occurrence.rule.id,
        created_at: occurrence.date.toISOString(),
        updated_at: occurrence.date.toISOString(),
        is_planned: true,
      }))
  }, [recurringRules, currentMonth, entries])

  const carryoverEntry = useMemo<HistoryItem | null>(() => {
    if (carryoverBalance === null) return null
    const date = `${displayYm}-01`
    const baseDate = dayjs(date).startOf('day').toISOString()
    const entryType: EntryType = carryoverBalance >= 0 ? 'income' : 'expense'
    return {
      id: `carryover-${displayYm}`,
      family_id: getFamilyId(),
      entry_type: entryType,
      amount: Math.abs(carryoverBalance),
      entry_category_id: null,
      payment_method_id: null,
      memo: '繰越し',
      occurred_at: baseDate,
      occurred_on: date,
      recurring_rule_id: null,
      created_at: baseDate,
      updated_at: baseDate,
      is_carryover: true,
    }
  }, [carryoverBalance, displayYm])

  const handleChangeMonth = (delta: number) => {
    const next = currentMonth.add(delta, 'month').startOf('month')
    onChangeMonthYm(next.format('YYYY-MM'))
    dispatch({ type: 'SET_SELECTED_DATE', payload: getDefaultSelectedDateForMonth(next) })
  }

  const monthTotals = useMemo(() => {
    const byDay = new Map<string, { income: number; expense: number }>()
    let income = 0
    let expense = 0

    monthEntries.forEach((entry) => {
      const dateKey = getEntryDateKey(entry)
      const current = byDay.get(dateKey) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
        income += entry.amount
      } else {
        current.expense += entry.amount
        expense += entry.amount
      }
      byDay.set(dateKey, current)
    })

    return { income, expense, byDay }
  }, [monthEntries])

  const calendarDays = useMemo(() => buildCalendar(currentMonth, monthTotals.byDay), [currentMonth, monthTotals])

  const groupedEntries = useMemo(() => {
    const map = new Map<
      string,
      {
        date: dayjs.Dayjs
        entries: HistoryItem[]
        planned: HistoryItem[]
        carryover: HistoryItem[]
        totals: { income: number; expense: number }
      }
    >()
    monthEntries.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(entry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.entries.push(entry)
      if (entry.entry_type === 'income') {
        current.totals.income += entry.amount
      } else {
        current.totals.expense += entry.amount
      }
      map.set(key, current)
    })
    plannedItems.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(entry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.planned.push(entry)
      map.set(key, current)
    })
    if (carryoverEntry) {
      const key = getEntryDateKey(carryoverEntry)
      const current = map.get(key) ?? {
        date: dayjs(getEntryDateKey(carryoverEntry)),
        entries: [],
        planned: [],
        carryover: [],
        totals: { income: 0, expense: 0 },
      }
      current.carryover.push(carryoverEntry)
      if (carryoverEntry.entry_type === 'income') {
        current.totals.income += carryoverEntry.amount
      } else {
        current.totals.expense += carryoverEntry.amount
      }
      map.set(key, current)
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()),
        planned: group.planned.sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()),
      }))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())
  }, [monthEntries, plannedItems, carryoverEntry])

  const selectedEntries = useMemo<HistoryItem[]>(() => {
    const actual = monthEntries
      .filter((entry) => getEntryDateKey(entry) === state.selectedDate)
      .map((entry) => ({ ...entry, is_planned: false }))
    const planned = plannedItems.filter((entry) => getEntryDateKey(entry) === state.selectedDate)
    const carryover =
      carryoverEntry && getEntryDateKey(carryoverEntry) === state.selectedDate ? [carryoverEntry] : []
    return [...carryover, ...actual, ...planned].sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf())
  }, [monthEntries, plannedItems, carryoverEntry, state.selectedDate])

  const plannedTotals = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>()
    plannedItems.forEach((entry) => {
      const key = getEntryDateKey(entry)
      const current = map.get(key) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
      } else {
        current.expense += entry.amount
      }
      map.set(key, current)
    })
    return map
  }, [plannedItems])

  const carryoverTotals = useMemo(() => {
    const map = new Map<string, CarryoverDay>()
    if (!carryoverEntry) return map
    map.set(getEntryDateKey(carryoverEntry), {
      entry_type: carryoverEntry.entry_type,
      amount: carryoverEntry.amount,
    })
    return map
  }, [carryoverEntry])

  const selectedTotals = useMemo(() => {
    return selectedEntries.reduce(
      (sum, entry) => {
        if (entry.is_planned) return sum
        if (entry.entry_type === 'income') {
          sum.income += entry.amount
        } else {
          sum.expense += entry.amount
        }
        return sum
      },
      { income: 0, expense: 0 }
    )
  }, [selectedEntries])

  const totalForRatio = monthTotals.income + monthTotals.expense
  const ratio = totalForRatio > 0 ? monthTotals.expense / totalForRatio : 0

  const handleAddFromCalendar = () => {
    const now = dayjs()
    const occurredAt = dayjs(`${state.selectedDate}T${now.format('HH:mm')}`).toISOString()
    onOpenEntryInput(
      {
        entryType: defaultEntryType,
        amount: 0,
        entryCategoryId: null,
        paymentMethodId: defaultPaymentMethodId,
        memo: null,
        occurredAt,
      },
      'history'
    )
  }

  return (
    <section className={scx('card')}>
      <div className={scx('month-header')}>
        <button className={scx('icon-button')} onClick={() => handleChangeMonth(-1)}>
          ‹
        </button>
        <h2>{currentMonth.format('YYYY年 M月')}</h2>
        <button className={scx('icon-button')} onClick={() => handleChangeMonth(1)}>
          ›
        </button>
      </div>
      <div className={scx('pill-toggle')}>
        <button type="button" className={scx(state.view === 'list' && 'active')} onClick={() => dispatch({ type: 'SET_VIEW', payload: 'list' })}>
          リスト
        </button>
        <button
          type="button"
          className={scx(state.view === 'calendar' && 'active')}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: 'calendar' })}
        >
          カレンダ
        </button>
      </div>

      <div className={scx('summary-panel')}>
        <span>支出</span>
        <strong>¥{formatAmount(monthTotals.expense)}</strong>
      </div>
      <div className={scx('summary-progress')}>
        <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>

      {state.view === 'list' && (
        <ul className={scx('list')}>
          {groupedEntries.length === 0 && <li className={scx('muted')}>履歴がありません</li>}
          {groupedEntries.map((group) => (
            <li key={group.date.format('YYYY-MM-DD')} className={scx('entry-group')}>
              <div className={scx('entry-group-header')}>
                <strong className={scx('entry-group-date')}>{`${group.date.format('M/D')} (${WEEKDAY_LABELS[group.date.day()]})`}</strong>
                <div className={scx('entry-group-totals')}>
                  <span className={scx('badge income')}>収入 ¥{formatAmount(group.totals.income)}</span>
                  <span className={scx('badge expense')}>支出 ¥{formatAmount(group.totals.expense)}</span>
                </div>
              </div>
              <EntryButtonsList
                entries={[...group.carryover, ...group.entries, ...group.planned] as EntryListItem[]}
                categoryMap={categoryMap}
                paymentMap={paymentMap}
                formatAmount={formatAmount}
                getCategoryIcon={getCategoryIcon}
                getPaymentIcon={getPaymentIcon}
                getPaymentColor={getPaymentColor}
                onEdit={onEdit}
                showCreatorBadge
              />
            </li>
          ))}
        </ul>
      )}

      {state.view === 'calendar' && (
        <div className={scx('calendar calendar-table')}>
          <div className={scx('calendar-week')}>
            {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className={scx('calendar-grid')}>
            {calendarDays.map((cell) => {
              const day = cell.date.day()
              const weekendClass = day === 0 ? 'sunday' : day === 6 ? 'saturday' : ''
              const cellKey = cell.date.format('YYYY-MM-DD')
              const isSelected = cellKey === state.selectedDate
              const planned = plannedTotals.get(cellKey) ?? { income: 0, expense: 0 }
              const carryover = carryoverTotals.get(cellKey)
              return (
                <button
                  key={cell.date.toISOString()}
                  type="button"
                  className={scx('calendar-cell', !cell.inMonth && 'muted', weekendClass, isSelected && 'selected')}
                  disabled={!cell.inMonth}
                  onClick={() => {
                    if (cell.inMonth) dispatch({ type: 'SET_SELECTED_DATE', payload: cellKey })
                  }}
                >
                  <span className={scx('calendar-date')}>{cell.date.date()}</span>
                  {cell.totals.expense > 0 && (
                    <span className={scx('calendar-amount expense')}>
                      -{formatAmount(cell.totals.expense)}
                    </span>
                  )}
                  {cell.totals.income > 0 && (
                    <span className={scx('calendar-amount income')}>
                      +{formatAmount(cell.totals.income)}
                    </span>
                  )}
                  {planned.expense > 0 && (
                    <span className={scx('calendar-amount expense planned')}>
                      -{formatAmount(planned.expense)}
                    </span>
                  )}
                  {planned.income > 0 && (
                    <span className={scx('calendar-amount income planned')}>
                      +{formatAmount(planned.income)}
                    </span>
                  )}
                  {carryover && (
                    <span className={scx('calendar-amount', 'carryover', carryover.entry_type)}>
                      {carryover.entry_type === 'income' ? '+' : '-'}
                      {formatAmount(carryover.amount)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {state.view === 'calendar' && (
        <div className={scx('calendar-detail')}>
          <div className={scx('entry-group-header')}>
            <strong className={scx('entry-group-date')}>{`${dayjs(state.selectedDate).format('M/D')} (${WEEKDAY_LABELS[dayjs(state.selectedDate).day()]})`}</strong>
            <div className={scx('entry-group-totals')}>
              <span className={scx('badge income')}>収入 ¥{formatAmount(selectedTotals.income)}</span>
              <span className={scx('badge expense')}>支出 ¥{formatAmount(selectedTotals.expense)}</span>
            </div>
          </div>
          <EntryButtonsList
            entries={selectedEntries as EntryListItem[]}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            formatAmount={formatAmount}
            getCategoryIcon={getCategoryIcon}
            getPaymentIcon={getPaymentIcon}
            getPaymentColor={getPaymentColor}
            onEdit={onEdit}
            showCreatorBadge
            emptyMessage="この日の明細はありません"
          />
          <button type="button" className={scx('floating-button')} onClick={handleAddFromCalendar}>
            +
          </button>
        </div>
      )}
    </section>
  )
}
