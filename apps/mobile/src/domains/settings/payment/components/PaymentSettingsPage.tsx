import type { FormEvent } from 'react'
import { useMemo } from 'react'
import { usePaymentSettingsState } from '../hooks/usePaymentSettingsState'
import { CATEGORY_COLORS, PAYMENT_ICON_CHOICES } from '../../../../shared/constants'
import styles from '../../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../../shared/utils/cx'
import { renderMaterialIcon } from '../../../../shared/icons/materialIcon'
import { normalizeDayOfMonth } from '../../../../shared/utils/format'
import {
  getPaymentColor,
  getPaymentFallbackIconKey,
  getPaymentIcon,
  getPaymentType,
  paymentTypeLabel,
  sortPaymentMethods,
} from '../../../../shared/utils/payment'
import type { PaymentType } from '../../../../app/types'
import type { PaymentMethod } from '../../../../types'

const scx = createStyleCx(styles)

type PaymentSettingsPageProps = {
  defaultType: PaymentType
  paymentMethods: PaymentMethod[]
  onAdd: (params: {
    name: string
    type: string
    cardClosingDay: number | null
    cardPaymentDay: number | null
    fundingSourcePaymentMethodId: string | null
  }) => void
  onSave: (method: PaymentMethod) => void
  onDelete: (method: PaymentMethod) => void
}

export const PaymentSettingsPage = ({
  defaultType,
  paymentMethods,
  onAdd,
  onSave,
  onDelete,
}: PaymentSettingsPageProps) => {
  const { state, dispatch } = usePaymentSettingsState(defaultType)

  const sortedMethods = useMemo(() => {
    return sortPaymentMethods(paymentMethods)
  }, [paymentMethods])
  const bankMethodOptions = useMemo(
    () => sortedMethods.filter((method) => getPaymentType(method.type) === 'bank'),
    [sortedMethods]
  )
  const cardMethodOptions = useMemo(
    () => sortedMethods.filter((method) => {
      const type = getPaymentType(method.type)
      return type === 'card' || type === 'postpaid'
    }),
    [sortedMethods]
  )
  const fundingSourceOptions = useMemo(() => {
    if (state.type === 'card' || state.type === 'postpaid') return bankMethodOptions
    if (state.type === 'emoney') return [...bankMethodOptions, ...cardMethodOptions]
    return []
  }, [bankMethodOptions, cardMethodOptions, state.type])
  const editFundingSourceOptions = useMemo(() => {
    if (state.editType === 'card' || state.editType === 'postpaid') return bankMethodOptions
    if (state.editType === 'emoney') return [...bankMethodOptions, ...cardMethodOptions]
    return []
  }, [bankMethodOptions, cardMethodOptions, state.editType])
  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, index) => index + 1), [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!state.name.trim()) return
    onAdd({
      name: state.name.trim(),
      type: state.type,
      cardClosingDay: state.type === 'card' || state.type === 'postpaid' ? normalizeDayOfMonth(state.cardClosingDay) : null,
      cardPaymentDay: state.type === 'card' || state.type === 'postpaid' ? normalizeDayOfMonth(state.cardPaymentDay) : null,
      fundingSourcePaymentMethodId:
        state.type === 'card' || state.type === 'postpaid' || state.type === 'emoney'
          ? state.fundingSourcePaymentMethodId || null
          : null,
    })
    dispatch({
      type: 'PATCH',
      payload: {
        name: '',
        type: defaultType,
        cardClosingDay: '',
        cardPaymentDay: '',
        fundingSourcePaymentMethodId: '',
        showForm: false,
      },
    })
  }

  const handleUpdate = (event: FormEvent) => {
    event.preventDefault()
    if (!state.editingMethod || !state.editName.trim()) return
    void onSave({
      ...state.editingMethod,
      name: state.editName.trim(),
      type: state.editType,
      card_closing_day:
        state.editType === 'card' || state.editType === 'postpaid' ? normalizeDayOfMonth(state.editCardClosingDay) : null,
      card_payment_day:
        state.editType === 'card' || state.editType === 'postpaid' ? normalizeDayOfMonth(state.editCardPaymentDay) : null,
      funding_source_payment_method_id:
        state.editType === 'card' || state.editType === 'postpaid' || state.editType === 'emoney'
          ? state.editFundingSourcePaymentMethodId || null
          : null,
      linked_bank_payment_method_id:
        state.editType === 'card' || state.editType === 'postpaid' ? state.editFundingSourcePaymentMethodId || null : null,
      icon_key: state.editIconKey ?? getPaymentFallbackIconKey(state.editType),
      color: state.editColor,
      updated_at: state.editingMethod.updated_at,
    })
    dispatch({ type: 'CLOSE_EDIT' })
  }

  const handleMove = (method: PaymentMethod, direction: 'up' | 'down') => {
    const index = sortedMethods.findIndex((item) => item.id === method.id)
    if (index < 0) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= sortedMethods.length) return

    const reordered = sortedMethods.slice()
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(targetIndex, 0, moved)

    reordered.forEach((item, orderIndex) => {
      const nextOrder = orderIndex + 1
      if (item.sort_order !== nextOrder) {
        void onSave({ ...item, sort_order: nextOrder, updated_at: item.updated_at })
      }
    })
  }

  const handleDeleteEditing = () => {
    if (!state.editingMethod) return
    onDelete(state.editingMethod)
    dispatch({ type: 'CLOSE_EDIT' })
  }

  const paymentTypeOptions: Array<{ value: PaymentType; label: string }> = [
    { value: 'cash', label: '現金' },
    { value: 'bank', label: '銀行口座' },
    { value: 'emoney', label: '電子マネー' },
    { value: 'card', label: 'クレジットカード' },
    { value: 'postpaid', label: '後払い' },
  ]
  const formatCardMeta = (method: PaymentMethod) => {
    const normalizedType = getPaymentType(method.type)
    const fundingSourceId = method.funding_source_payment_method_id ?? method.linked_bank_payment_method_id
    const fundingSourceName = fundingSourceId
      ? sortedMethods.find((item) => item.id === fundingSourceId)?.name ?? '未設定'
      : '未設定'
    if (normalizedType === 'card' || normalizedType === 'postpaid') {
      return `${normalizeDayOfMonth(method.card_closing_day) ?? '未設定'}日締め / ${normalizeDayOfMonth(method.card_payment_day) ?? '未設定'}日払い / 親: ${fundingSourceName}`
    }
    if (normalizedType === 'emoney') {
      return `親: ${fundingSourceName}`
    }
    return null
  }

  return (
    <div className={scx('page')}>
      <ul className={scx('category-list')}>
        {sortedMethods.map((method, index) => {
          const cardMeta = formatCardMeta(method)
          return (
            <li key={method.id} className={scx('category-row payment-method-row')}>
              <span className={scx('payment-method-icon')} style={{ background: getPaymentColor(method), color: '#fff' }}>
                {getPaymentIcon(method)}
              </span>
              <div className={scx('payment-method-title-wrap')}>
                <strong className={scx('category-title')}>{method.name}</strong>
                <span className={scx('pill')}>{paymentTypeLabel(method.type)}</span>
                {cardMeta && <span className={scx('payment-method-meta')}>{cardMeta}</span>}
              </div>
              <div className={scx('category-actions')}>
                <div className={scx('category-action-buttons')}>
                  <button
                    type="button"
                    className={scx('icon-button-small')}
                    aria-label="編集"
                    onClick={() => dispatch({ type: 'OPEN_EDIT', payload: method })}
                  >
                    {renderMaterialIcon('edit')}
                  </button>
                </div>
                <div className={scx('reorder-buttons')}>
                  <button
                    type="button"
                    className={scx('icon-button-small')}
                    aria-label="上へ"
                    onClick={() => handleMove(method, 'up')}
                    disabled={index === 0}
                  >
                    {renderMaterialIcon('arrow_upward')}
                  </button>
                  <button
                    type="button"
                    className={scx('icon-button-small')}
                    aria-label="下へ"
                    onClick={() => handleMove(method, 'down')}
                    disabled={index === sortedMethods.length - 1}
                  >
                    {renderMaterialIcon('arrow_downward')}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {state.showForm && (
        <div className={scx('sheet')}>
          <form className={scx('sheet-card payment-settings-sheet')} onSubmit={handleSubmit}>
            <h3>支払い方法追加</h3>
            <input
              type="text"
              placeholder="名称"
              value={state.name}
              onChange={(event) => dispatch({ type: 'PATCH', payload: { name: event.target.value } })}
            />
            <label className={scx('sheet-field-label')} htmlFor="payment-type-add">
              支払いカテゴリ
            </label>
            <select
              id="payment-type-add"
              value={state.type}
              onChange={(event) => {
                const nextType = event.target.value as PaymentType
                dispatch({
                  type: 'PATCH',
                  payload: {
                    type: nextType,
                    ...(nextType !== 'card' && nextType !== 'postpaid'
                      ? {
                          cardClosingDay: '',
                          cardPaymentDay: '',
                        }
                      : {}),
                    ...(nextType !== 'card' && nextType !== 'emoney'
                      ? {
                          fundingSourcePaymentMethodId: '',
                        }
                      : {}),
                  },
                })
              }}
            >
              {paymentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {(state.type === 'card' || state.type === 'postpaid' || state.type === 'emoney') && (
              <div className={scx('card-setting-grid')}>
                {(state.type === 'card' || state.type === 'postpaid') && (
                  <>
                    <label className={scx('sheet-field-label')} htmlFor="payment-closing-day-add">
                      締め日
                    </label>
                    <select
                      id="payment-closing-day-add"
                      value={state.cardClosingDay}
                      onChange={(event) => dispatch({ type: 'PATCH', payload: { cardClosingDay: event.target.value } })}
                    >
                      <option value="">未設定</option>
                      {dayOptions.map((day) => (
                        <option key={day} value={String(day)}>
                          {day}日
                        </option>
                      ))}
                    </select>
                    <label className={scx('sheet-field-label')} htmlFor="payment-day-add">
                      支払い日
                    </label>
                    <select
                      id="payment-day-add"
                      value={state.cardPaymentDay}
                      onChange={(event) => dispatch({ type: 'PATCH', payload: { cardPaymentDay: event.target.value } })}
                    >
                      <option value="">未設定</option>
                      {dayOptions.map((day) => (
                        <option key={day} value={String(day)}>
                          {day}日
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label className={scx('sheet-field-label')} htmlFor="payment-funding-source-add">
                  {state.type === 'card' || state.type === 'postpaid' ? '親口座' : '親支払い元'}
                </label>
                <select
                  id="payment-funding-source-add"
                  value={state.fundingSourcePaymentMethodId}
                  onChange={(event) => dispatch({ type: 'PATCH', payload: { fundingSourcePaymentMethodId: event.target.value } })}
                >
                  <option value="">未設定</option>
                  {fundingSourceOptions.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={scx('sheet-actions')}>
              <button type="button" className={scx('ghost')} onClick={() => dispatch({ type: 'PATCH', payload: { showForm: false } })}>
                閉じる
              </button>
              <button type="submit" className={scx('primary')}>
                追加
              </button>
            </div>
          </form>
        </div>
      )}

      {state.editingMethod && (
        <div className={scx('sheet')}>
          <form className={scx('sheet-card scrollable payment-settings-sheet')} onSubmit={handleUpdate}>
            <h3>支払い方法編集</h3>
            <input
              type="text"
              placeholder="名称"
              value={state.editName}
              onChange={(event) => dispatch({ type: 'PATCH', payload: { editName: event.target.value } })}
            />
            <label className={scx('sheet-field-label')} htmlFor="payment-type-edit">
              支払いカテゴリ
            </label>
            <select
              id="payment-type-edit"
              value={state.editType}
              onChange={(event) => {
                const nextType = event.target.value as PaymentType
                dispatch({
                  type: 'PATCH',
                  payload: {
                    editType: nextType,
                    ...(nextType !== 'card' && nextType !== 'postpaid'
                      ? {
                          editCardClosingDay: '',
                          editCardPaymentDay: '',
                        }
                      : {}),
                    ...(nextType !== 'card' && nextType !== 'emoney'
                      ? {
                          editFundingSourcePaymentMethodId: '',
                        }
                      : {}),
                  },
                })
              }}
            >
              {paymentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {(state.editType === 'card' || state.editType === 'postpaid' || state.editType === 'emoney') && (
              <div className={scx('card-setting-grid')}>
                {(state.editType === 'card' || state.editType === 'postpaid') && (
                  <>
                    <label className={scx('sheet-field-label')} htmlFor="payment-closing-day-edit">
                      締め日
                    </label>
                    <select
                      id="payment-closing-day-edit"
                      value={state.editCardClosingDay}
                      onChange={(event) => dispatch({ type: 'PATCH', payload: { editCardClosingDay: event.target.value } })}
                    >
                      <option value="">未設定</option>
                      {dayOptions.map((day) => (
                        <option key={day} value={String(day)}>
                          {day}日
                        </option>
                      ))}
                    </select>
                    <label className={scx('sheet-field-label')} htmlFor="payment-day-edit">
                      支払い日
                    </label>
                    <select
                      id="payment-day-edit"
                      value={state.editCardPaymentDay}
                      onChange={(event) => dispatch({ type: 'PATCH', payload: { editCardPaymentDay: event.target.value } })}
                    >
                      <option value="">未設定</option>
                      {dayOptions.map((day) => (
                        <option key={day} value={String(day)}>
                          {day}日
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label className={scx('sheet-field-label')} htmlFor="payment-funding-source-edit">
                  {state.editType === 'card' || state.editType === 'postpaid' ? '親口座' : '親支払い元'}
                </label>
                <select
                  id="payment-funding-source-edit"
                  value={state.editFundingSourcePaymentMethodId}
                  onChange={(event) => dispatch({ type: 'PATCH', payload: { editFundingSourcePaymentMethodId: event.target.value } })}
                >
                  <option value="">未設定</option>
                  {editFundingSourceOptions.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={scx('icon-picker')}>
              {PAYMENT_ICON_CHOICES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  className={scx('icon-choice', state.editIconKey === iconName && 'active')}
                  aria-label={iconName}
                  onClick={() => dispatch({ type: 'PATCH', payload: { editIconKey: iconName } })}
                >
                  <span className={scx('icon-preview')}>{renderMaterialIcon(iconName)}</span>
                </button>
              ))}
            </div>
            <div className={scx('color-picker')}>
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={scx('color-swatch', state.editColor === color && 'active')}
                  style={{ background: color }}
                  onClick={() => dispatch({ type: 'PATCH', payload: { editColor: color } })}
                />
              ))}
            </div>
            <div className={scx('sheet-actions spread')}>
              <button type="button" className={scx('icon-button-small danger')} aria-label="削除" onClick={handleDeleteEditing}>
                {renderMaterialIcon('delete')}
              </button>
              <div className={scx('sheet-action-buttons')}>
                <button type="button" className={scx('ghost')} onClick={() => dispatch({ type: 'CLOSE_EDIT' })}>
                  キャンセル
                </button>
                <button type="submit" className={scx('primary')}>
                  保存
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {!state.showForm && !state.editingMethod && (
        <button className={scx('floating-button')} onClick={() => dispatch({ type: 'PATCH', payload: { showForm: true } })}>
          +
        </button>
      )}
    </div>
  )
}
