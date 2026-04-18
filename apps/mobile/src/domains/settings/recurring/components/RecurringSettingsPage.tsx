import type { FormEvent } from 'react'
import { useMemo } from 'react'
import dayjs from 'dayjs'
import { useRecurringSettingsState } from '../hooks/useRecurringSettingsState'
import { IconHome } from '../../../../shared/icons/appIcons'
import { getCategoryIcon, renderMaterialIcon } from '../../../../shared/icons/materialIcon'
import styles from '../../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../../shared/utils/cx'
import { formatAmount } from '../../../../shared/utils/format'
import {
  estimateMonthlyAmount,
  formatRecurringScheduleLabel,
  groupByFrequency,
  normalizeHolidayAdjustment,
} from '../../../../shared/utils/recurring'
import { paymentMethodLabel } from '../../../../shared/utils/payment'
import type { HolidayAdjustment } from '../../../../app/types'
import type { EntryCategory, EntryType, PaymentMethod, RecurringRule } from '../../../../types'

const scx = createStyleCx(styles)

type RecurringSettingsPageProps = {
  rules: RecurringRule[]
  categories: EntryCategory[]
  paymentMethods: PaymentMethod[]
  onAdd: (payload: {
    entryType: EntryType
    amount: number
    entryCategoryId: string | null
    paymentMethodId: string | null
    memo: string | null
    frequency: string
    dayOfMonth: number | null
    holidayAdjustment: HolidayAdjustment
    startAt: string
  }) => void
  onSave: (rule: RecurringRule) => void
  onDelete: (rule: RecurringRule) => void
}

export const RecurringSettingsPage = ({
  rules,
  categories,
  paymentMethods,
  onAdd,
  onSave,
  onDelete,
}: RecurringSettingsPageProps) => {
  const { state, dispatch } = useRecurringSettingsState()

  const filteredRules = useMemo(() => rules.filter((rule) => rule.entry_type === state.entryType), [rules, state.entryType])
  const formCategories = useMemo(
    () => categories.filter((category) => category.type === state.entryType),
    [categories, state.entryType]
  )

  const totals = useMemo(() => {
    const monthly = filteredRules.reduce((sum, rule) => sum + estimateMonthlyAmount(rule), 0)
    const yearly = monthly * 12
    return { yearly, monthly }
  }, [filteredRules])

  const grouped = useMemo(() => {
    const map = new Map<string, RecurringRule[]>()
    filteredRules.forEach((rule) => {
      const label = groupByFrequency(rule)
      map.set(label, [...(map.get(label) ?? []), rule])
    })
    return Array.from(map.entries())
  }, [filteredRules])

  const normalizeDayOfMonthValue = (value: string, nextFrequency: string) => {
    if (nextFrequency === 'weekly') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 6) {
        return String(dayjs().day())
      }
      return String(Math.trunc(numeric))
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 31) {
      return '1'
    }
    return String(Math.trunc(numeric))
  }

  const handleFrequencyChange = (value: string) => {
    const nextFrequency = value || 'monthly'
    dispatch({
      type: 'PATCH',
      payload: {
        frequency: nextFrequency,
        dayOfMonth: normalizeDayOfMonthValue(state.dayOfMonth, nextFrequency),
      },
    })
  }

  const handleDayOfMonthChange = (value: string) => {
    dispatch({ type: 'PATCH', payload: { dayOfMonth: normalizeDayOfMonthValue(value, state.frequency) } })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(state.amount)
    if (!Number.isFinite(value) || value <= 0) return
    const parsedDayOfMonth = state.dayOfMonth === '' ? null : Number(state.dayOfMonth)
    const baseStart = dayjs(state.editingRule?.start_at ?? new Date().toISOString())
    const parsedMonth = Number(state.yearlyMonth)
    const monthIndex =
      Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth - 1 : baseStart.month()
    const yearlyBase = baseStart.month(monthIndex).date(1)
    const startAt =
      state.frequency === 'yearly'
        ? yearlyBase.date(Math.min(parsedDayOfMonth ?? baseStart.date(), yearlyBase.daysInMonth())).toISOString()
        : state.editingRule?.start_at ?? baseStart.toISOString()

    if (state.editingRule) {
      const updated: RecurringRule = {
        ...state.editingRule,
        entry_type: state.entryType,
        amount: Math.round(value),
        entry_category_id: state.entryCategoryId || null,
        payment_method_id: state.paymentMethodId || null,
        memo: state.memo.trim() ? state.memo.trim() : null,
        frequency: state.frequency,
        day_of_month: parsedDayOfMonth,
        holiday_adjustment: state.holidayAdjustment,
        start_at: startAt,
        updated_at: state.editingRule.updated_at,
      }
      onSave(updated)
    } else {
      onAdd({
        entryType: state.entryType,
        amount: Math.round(value),
        entryCategoryId: state.entryCategoryId || null,
        paymentMethodId: state.paymentMethodId || null,
        memo: state.memo.trim() ? state.memo.trim() : null,
        frequency: state.frequency,
        dayOfMonth: parsedDayOfMonth,
        holidayAdjustment: state.holidayAdjustment,
        startAt,
      })
    }
    dispatch({ type: 'RESET_FORM' })
  }

  const handleDelete = () => {
    if (!state.editingRule) return
    onDelete(state.editingRule)
    dispatch({ type: 'RESET_FORM' })
  }

  return (
    <div className={scx('page')}>
      <div className={scx('report-summary')}>
        <div>
          <span>年間合計</span>
          <strong>¥{formatAmount(totals.yearly)}</strong>
        </div>
        <div>
          <span>月間平均</span>
          <strong>¥{formatAmount(totals.monthly)}</strong>
        </div>
      </div>

      <div className={scx('pill-toggle')}>
        <button
          type="button"
          className={scx(state.entryType === 'income' && 'active')}
          onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'income' } })}
        >
          収入
        </button>
        <button
          type="button"
          className={scx(state.entryType === 'expense' && 'active')}
          onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'expense' } })}
        >
          支出
        </button>
      </div>

      {grouped.length === 0 && <p className={scx('muted')}>定期ルールがありません</p>}

      {grouped.map(([label, items]) => (
        <div key={label} className={scx('rule-group')}>
          <h3>{label}</h3>
          <div className={scx('rule-list')}>
            {items.map((rule) => {
              const category = categories.find((item) => item.id === rule.entry_category_id)
              const icon = category ? getCategoryIcon(category.icon_key) : null
              return (
                <button key={rule.id} type="button" className={scx('rule-card')} onClick={() => dispatch({ type: 'OPEN_EDIT', payload: rule })}>
                  <span className={scx('rule-icon')}>{icon ?? <IconHome />}</span>
                  <div>
                    <strong>{rule.memo ?? category?.name ?? '未設定'}</strong>
                    <span className={scx('rule-meta')}>
                      {formatRecurringScheduleLabel(rule)} / {paymentMethodLabel(paymentMethods, rule.payment_method_id)}
                    </span>
                  </div>
                  <strong>¥{formatAmount(rule.amount)}</strong>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {state.showForm && (
        <div className={scx('sheet')}>
          <form className={scx('sheet-card recurring-form-sheet')} onSubmit={handleSubmit}>
            <h3>{state.editingRule ? '定期ルール編集' : '定期ルール追加'}</h3>
            <div className={scx('recurring-form-hero')}>
              <div className={scx('pill-toggle recurring-type-toggle')}>
                <button
                  type="button"
                  className={scx(state.entryType === 'expense' && 'active')}
                  onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'expense' } })}
                >
                  支出
                </button>
                <button
                  type="button"
                  className={scx(state.entryType === 'income' && 'active')}
                  onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'income' } })}
                >
                  収入
                </button>
              </div>
              <label className={scx('recurring-amount-field')}>
                <span>金額</span>
                <input type="number" placeholder="0" value={state.amount} onChange={(event) => dispatch({ type: 'PATCH', payload: { amount: event.target.value } })} />
              </label>
            </div>

            <div className={scx('recurring-field-grid')}>
              <label>
                <span>カテゴリ</span>
                <select value={state.entryCategoryId} onChange={(event) => dispatch({ type: 'PATCH', payload: { entryCategoryId: event.target.value } })}>
                  <option value="" disabled>
                    カテゴリ
                  </option>
                  {formCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{state.entryType === 'income' ? '入金方法' : '支払い方法'}</span>
                <select value={state.paymentMethodId} onChange={(event) => dispatch({ type: 'PATCH', payload: { paymentMethodId: event.target.value } })}>
                  <option value="" disabled>
                    {state.entryType === 'income' ? '入金方法' : '支払い方法'}
                  </option>
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={scx('recurring-schedule-box')}>
              <label>
                <span>頻度</span>
                <select value={state.frequency} onChange={(event) => handleFrequencyChange(event.target.value)}>
                  <option value="" disabled>
                    頻度
                  </option>
                  <option value="monthly">月次</option>
                  <option value="bimonthly">隔月</option>
                  <option value="weekly">毎週</option>
                  <option value="yearly">年次</option>
                </select>
              </label>
              {state.frequency === 'weekly' ? (
                <label>
                  <span>曜日</span>
                  <select value={state.dayOfMonth} onChange={(event) => handleDayOfMonthChange(event.target.value)}>
                    <option value="" disabled>
                      曜日
                    </option>
                    {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : state.frequency === 'yearly' ? (
                <>
                  <label>
                    <span>月</span>
                    <select value={state.yearlyMonth} onChange={(event) => dispatch({ type: 'PATCH', payload: { yearlyMonth: event.target.value } })}>
                      <option value="" disabled>
                        月
                      </option>
                      {Array.from({ length: 12 }).map((_, index) => (
                        <option key={String(index + 1)} value={String(index + 1)}>
                          {index + 1}月
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>日</span>
                    <input type="number" min={1} max={31} value={state.dayOfMonth} onChange={(event) => handleDayOfMonthChange(event.target.value)} placeholder="日" />
                  </label>
                </>
              ) : (
                <label>
                  <span>日</span>
                  <input type="number" min={1} max={31} value={state.dayOfMonth} onChange={(event) => handleDayOfMonthChange(event.target.value)} placeholder="日" />
                </label>
              )}
              <label className={scx('recurring-wide-field')}>
                <span>休日調整</span>
                <select value={state.holidayAdjustment} onChange={(event) => dispatch({ type: 'PATCH', payload: { holidayAdjustment: normalizeHolidayAdjustment(event.target.value as HolidayAdjustment) } })}>
                  <option value="" disabled>
                    休日調整
                  </option>
                  <option value="none">休日調整なし</option>
                  <option value="previous">前営業日に移動</option>
                  <option value="next">次営業日に移動</option>
                </select>
              </label>
            </div>

            <label className={scx('recurring-memo-field')}>
              <span>メモ</span>
              <input type="text" placeholder="任意" value={state.memo} onChange={(event) => dispatch({ type: 'PATCH', payload: { memo: event.target.value } })} />
            </label>
            <div className={scx('sheet-actions', state.editingRule && 'spread')}>
              {state.editingRule && (
                <button type="button" className={scx('icon-button-small danger')} aria-label="削除" onClick={handleDelete}>
                  {renderMaterialIcon('delete')}
                </button>
              )}
              <div className={scx('sheet-action-buttons')}>
                <button type="button" className={scx('ghost')} onClick={() => dispatch({ type: 'RESET_FORM' })}>
                  キャンセル
                </button>
                <button type="submit" className={scx('primary')}>
                  {state.editingRule ? '保存' : '追加'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {!state.showForm && (
        <button className={scx('floating-button')} onClick={() => dispatch({ type: 'OPEN_CREATE' })}>
          +
        </button>
      )}
    </div>
  )
}
