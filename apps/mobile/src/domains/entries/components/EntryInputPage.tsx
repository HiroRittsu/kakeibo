import { useMemo, useRef } from 'react'
import dayjs from 'dayjs'
import { CATEGORY_COLORS, PAYMENT_DEFAULT_COLORS, WEEKDAY_LABELS } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import { getCategoryIcon, renderMaterialIcon } from '../../../shared/icons/materialIcon'
import { getPaymentColor, getPaymentIcon, getPaymentType, paymentTypeLabel } from '../../../shared/utils/payment'
import { useEntryInputState } from '../hooks/useEntryInputState'
import type { EntryCategory, EntryType, PaymentMethod } from '../../../types'
import type { EntryInputSeed } from '../../../app/types'

const scx = createStyleCx(styles)

type EntryInputPageProps = {
  seed: EntryInputSeed
  categories: EntryCategory[]
  paymentMethods: PaymentMethod[]
  onSave: (payload: EntryInputSeed) => void
  onDelete?: (entryId: string) => void
  onEntryTypeChange?: (entryType: EntryType) => void
}

export const EntryInputPage = ({
  seed,
  categories,
  paymentMethods,
  onSave,
  onDelete,
  onEntryTypeChange,
}: EntryInputPageProps) => {
  const { state, dispatch, computeResult, handleAppend, handleOperator, handleClear, handleBackspace, handleEquals } =
    useEntryInputState(seed)
  const dateInputRef = useRef<HTMLInputElement>(null)

  const categoriesByType = useMemo(
    () => ({
      income: categories.filter((category) => category.type === 'income'),
      expense: categories.filter((category) => category.type === 'expense'),
    }),
    [categories]
  )
  const visibleCategories = categoriesByType[state.entryType]
  const resolvedEntryCategoryId = visibleCategories.some((category) => category.id === state.entryCategoryId)
    ? state.entryCategoryId
    : ''
  const selectedCategory = visibleCategories.find((category) => category.id === resolvedEntryCategoryId)
  const isEditing = Boolean(seed.id)

  const dateTime = useMemo(() => {
    return dayjs(`${state.dateValue}T${state.timeValue}`)
  }, [state.dateValue, state.timeValue])

  const handleSubmit = () => {
    const result = computeResult()
    if (!Number.isFinite(result) || result <= 0) return
    const payloadMemo = state.memo.trim() ? state.memo.trim() : null
    onSave({
      id: seed.id,
      entryType: state.entryType,
      amount: Math.round(result),
      entryCategoryId: resolvedEntryCategoryId || null,
      paymentMethodId: state.paymentMethodId || null,
      memo: payloadMemo,
      occurredAt: dateTime.toISOString(),
      createdAt: seed.createdAt,
      updatedAt: seed.updatedAt,
      recurringRuleId: seed.recurringRuleId ?? null,
      createdByUserId: seed.createdByUserId ?? null,
      createdByUserName: seed.createdByUserName ?? null,
      createdByAvatarUrl: seed.createdByAvatarUrl ?? null,
    })
  }

  const selectedPaymentMethod = paymentMethods.find((method) => method.id === state.paymentMethodId) ?? null
  const paymentLabel = selectedPaymentMethod?.name ?? '支払い方法を選択'
  const paymentColor = selectedPaymentMethod ? getPaymentColor(selectedPaymentMethod) : PAYMENT_DEFAULT_COLORS.cash
  const paymentSoftColor = paymentColor.startsWith('#') && paymentColor.length === 7 ? `${paymentColor}1f` : '#f8fbff'
  const paymentGroups = useMemo(() => {
    const groupOrder = ['cash', 'card', 'emoney', 'bank'] as const
    return groupOrder
      .map((type) => ({
        type,
        label: paymentTypeLabel(type),
        methods: paymentMethods.filter((method) => getPaymentType(method.type) === type),
      }))
      .filter((group) => group.methods.length > 0)
  }, [paymentMethods])
  const entryTypeLabel = state.entryType === 'income' ? '収入' : '支出'
  const submitLabel = isEditing ? `${entryTypeLabel}を保存` : `${entryTypeLabel}を入力`
  const primaryLabel = state.operationUsed && !state.awaitingSubmit ? '=' : submitLabel
  const dateValue = dayjs(state.dateValue)
  const dateLabel = `${dateValue.format('M/D')}(${WEEKDAY_LABELS[dateValue.day()]})`

  const handleApplyEntryType = (nextType: EntryType) => {
    const nextCategories = categoriesByType[nextType]
    dispatch({
      type: 'PATCH',
      payload: {
        entryType: nextType,
        entryCategoryId: nextCategories.some((category) => category.id === state.entryCategoryId)
          ? state.entryCategoryId
          : '',
      },
    })
    onEntryTypeChange?.(nextType)
  }

  const handleOpenCategorySheet = () => {
    dispatch({ type: 'PATCH', payload: { categorySheetType: state.entryType, showCategorySheet: true } })
  }

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current
    if (!input) return
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void }
    if (pickerInput.showPicker) {
      pickerInput.showPicker()
      return
    }
    input.focus()
  }

  const handlePickCategory = (nextType: EntryType, nextCategoryId: string | null) => {
    handleApplyEntryType(nextType)
    dispatch({
      type: 'PATCH',
      payload: {
        entryCategoryId: nextCategoryId ?? '',
        categorySheetType: nextType,
        showCategorySheet: false,
      },
    })
  }

  const handlePickPaymentMethod = (nextPaymentMethodId: string | null) => {
    dispatch({
      type: 'PATCH',
      payload: {
        paymentMethodId: nextPaymentMethodId ?? '',
        showPaymentSheet: false,
      },
    })
  }

  return (
    <section className={scx('card entry-input entry-input-modern')}>
      <div className={scx('entry-support-panel')}>
        <div className={scx('entry-support-row entry-date-row')}>
          <span>日付</span>
          <strong>{dateLabel}</strong>
          <button type="button" className={scx('entry-pencil-button')} onClick={handleOpenDatePicker} aria-label="日付を編集">
            {renderMaterialIcon('edit')}
          </button>
          <input
            ref={dateInputRef}
            type="date"
            className={scx('entry-date-native')}
            value={state.dateValue}
            onChange={(event) => dispatch({ type: 'PATCH', payload: { dateValue: event.target.value } })}
            tabIndex={-1}
          />
        </div>
        <label className={scx('entry-support-row entry-memo-row')}>
          <span>メモ</span>
          <input
            type="text"
            placeholder="追加"
            value={state.memo}
            onChange={(event) => dispatch({ type: 'PATCH', payload: { memo: event.target.value } })}
          />
        </label>
      </div>

      <div className={scx('entry-context-row')}>
        <button type="button" className={scx('entry-category-quick')} onClick={handleOpenCategorySheet}>
          <span className={scx('entry-chip-icon category-icon')} style={{ background: selectedCategory?.color ?? '#d9554c' }}>
            {selectedCategory ? getCategoryIcon(selectedCategory.icon_key) ?? selectedCategory.name.slice(0, 1) : '?'}
          </span>
          <span className={scx('entry-chip-text')}>
            <span>カテゴリ</span>
            <strong>{selectedCategory?.name ?? 'カテゴリを選択'}</strong>
          </span>
          <span className={scx('entry-category-arrow')}>{renderMaterialIcon('expand_more')}</span>
        </button>
      </div>

      <div className={scx('calc-display entry-amount-display', state.entryType)}>
        <button type="button" className={scx('calc-action')} onClick={handleClear}>
          C
        </button>
        <span className={scx('calc-value')}>¥{formatAmount(Number(state.displayValue) || 0)}</span>
        <button type="button" className={scx('calc-action')} onClick={handleBackspace}>
          ←
        </button>
      </div>

      <div className={scx('calc-keypad')}>
        {['7', '8', '9'].map((value) => (
          <button key={value} type="button" className={scx('calc-key')} onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className={scx('calc-key operator')} onClick={() => handleOperator('/')}>
          ÷
        </button>
        {['4', '5', '6'].map((value) => (
          <button key={value} type="button" className={scx('calc-key')} onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className={scx('calc-key operator')} onClick={() => handleOperator('*')}>
          ×
        </button>
        {['1', '2', '3'].map((value) => (
          <button key={value} type="button" className={scx('calc-key')} onClick={() => handleAppend(value)}>
            {value}
          </button>
        ))}
        <button type="button" className={scx('calc-key operator')} onClick={() => handleOperator('-')}>
          -
        </button>
        <button type="button" className={scx('calc-key')} onClick={() => handleAppend('00')}>
          00
        </button>
        <button type="button" className={scx('calc-key')} onClick={() => handleAppend('0')}>
          0
        </button>
        <button type="button" className={scx('calc-key')} onClick={() => handleAppend('.')}>
          .
        </button>
        <button type="button" className={scx('calc-key operator')} onClick={() => handleOperator('+')}>
          +
        </button>
      </div>

      <div className={scx('entry-actions', isEditing && 'editing')}>
        <button
          type="button"
          className={scx('entry-payment-action')}
          onClick={() => dispatch({ type: 'PATCH', payload: { showPaymentSheet: true } })}
          style={{ background: paymentSoftColor, borderColor: `${paymentColor}4d` }}
        >
          <span className={scx('entry-payment-copy')}>
            <span className={scx('entry-payment-label')} style={{ color: paymentColor }}>
              支払い方法
            </span>
            <strong>{paymentLabel}</strong>
          </span>
          <span className={scx('entry-payment-arrow')}>{renderMaterialIcon('expand_more')}</span>
        </button>
        {isEditing && (
          <button
            type="button"
            className={scx('entry-delete')}
            aria-label="削除"
            onClick={() => {
              if (seed.id) onDelete?.(seed.id)
            }}
          >
            {renderMaterialIcon('delete')}
          </button>
        )}
        <button type="button" className={scx('primary entry-submit-action', state.entryType)} onClick={primaryLabel === '=' ? handleEquals : handleSubmit}>
          {primaryLabel}
        </button>
      </div>

      {state.showCategorySheet && (
        <div
          className={scx('sheet')}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              dispatch({ type: 'PATCH', payload: { showCategorySheet: false } })
            }
          }}
        >
          <div className={scx('sheet-card entry-category-sheet')} role="dialog" aria-modal="true" aria-label="カテゴリ選択">
            <h3>カテゴリ選択</h3>
            <div className={scx('pill-toggle entry-type-toggle')}>
              <button
                type="button"
                className={scx(state.categorySheetType === 'expense' && 'active')}
                onClick={() => dispatch({ type: 'PATCH', payload: { categorySheetType: 'expense' } })}
              >
                支出
              </button>
              <button
                type="button"
                className={scx(state.categorySheetType === 'income' && 'active')}
                onClick={() => dispatch({ type: 'PATCH', payload: { categorySheetType: 'income' } })}
              >
                収入
              </button>
            </div>
            <ul className={scx('entry-category-options')}>
              <li>
                <button
                  type="button"
                  className={scx(
                    'entry-category-option',
                    state.categorySheetType === state.entryType && !resolvedEntryCategoryId && 'active'
                  )}
                  onClick={() => handlePickCategory(state.categorySheetType, null)}
                >
                  <span className={scx('category-icon entry-category-option-icon')} style={{ background: '#8f9499' }}>
                    {renderMaterialIcon('category')}
                  </span>
                  <span className={scx('entry-category-option-name')}>未分類</span>
                  <span className={scx('entry-category-option-check')}>
                    {state.categorySheetType === state.entryType && !resolvedEntryCategoryId
                      ? renderMaterialIcon('check')
                      : null}
                  </span>
                </button>
              </li>
              {categoriesByType[state.categorySheetType].map((category, index) => {
                const color = category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                const isActive = state.categorySheetType === state.entryType && category.id === resolvedEntryCategoryId
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      className={scx('entry-category-option', isActive && 'active')}
                      onClick={() => handlePickCategory(state.categorySheetType, category.id)}
                    >
                      <span className={scx('category-icon entry-category-option-icon')} style={{ background: color }}>
                        {getCategoryIcon(category.icon_key) ?? (
                          <span className={scx('category-fallback')}>{category.name.slice(0, 1)}</span>
                        )}
                      </span>
                      <span className={scx('entry-category-option-name')}>{category.name}</span>
                      <span className={scx('entry-category-option-check')}>{isActive ? renderMaterialIcon('check') : null}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className={scx('sheet-actions')}>
              <button
                type="button"
                className={scx('ghost')}
                onClick={() => dispatch({ type: 'PATCH', payload: { showCategorySheet: false } })}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {state.showPaymentSheet && (
        <div
          className={scx('sheet')}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              dispatch({ type: 'PATCH', payload: { showPaymentSheet: false } })
            }
          }}
        >
          <div className={scx('sheet-card entry-payment-sheet')} role="dialog" aria-modal="true" aria-label="支払い方法選択">
            <h3>支払い方法選択</h3>
            <div className={scx('entry-payment-options')}>
              <div>
                <button
                  type="button"
                  className={scx('entry-payment-option', !state.paymentMethodId && 'active')}
                  onClick={() => handlePickPaymentMethod(null)}
                >
                  <span className={scx('entry-payment-option-icon')} style={{ background: PAYMENT_DEFAULT_COLORS.cash, color: '#fff' }}>
                    {renderMaterialIcon('payments')}
                  </span>
                  <span className={scx('entry-payment-option-text')}>
                    <strong>未設定</strong>
                    <span>支払い方法を設定しない</span>
                  </span>
                  <span className={scx('entry-payment-option-check')}>{!state.paymentMethodId ? renderMaterialIcon('check') : null}</span>
                </button>
              </div>
              {paymentGroups.map((group) => (
                <section key={group.type} className={scx('entry-payment-group')}>
                  <h4>{group.label}</h4>
                  <ul>
                    {group.methods.map((method) => {
                      const isActive = method.id === state.paymentMethodId
                      return (
                        <li key={method.id}>
                          <button
                            type="button"
                            className={scx('entry-payment-option', isActive && 'active')}
                            onClick={() => handlePickPaymentMethod(method.id)}
                          >
                            <span className={scx('entry-payment-option-icon')} style={{ background: getPaymentColor(method), color: '#fff' }}>
                              {getPaymentIcon(method)}
                            </span>
                            <span className={scx('entry-payment-option-text')}>
                              <strong>{method.name}</strong>
                              <span>{paymentTypeLabel(method.type)}</span>
                            </span>
                            <span className={scx('entry-payment-option-check')}>{isActive ? renderMaterialIcon('check') : null}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <div className={scx('sheet-actions')}>
              <button
                type="button"
                className={scx('ghost')}
                onClick={() => dispatch({ type: 'PATCH', payload: { showPaymentSheet: false } })}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
