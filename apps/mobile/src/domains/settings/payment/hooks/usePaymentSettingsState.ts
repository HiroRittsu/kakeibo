import { useEffect, useReducer } from 'react'
import { CATEGORY_COLORS } from '../../../../shared/constants'
import { dayToInputValue, normalizeDayOfMonth } from '../../../../shared/utils/format'
import { getPaymentFallbackIconKey, getPaymentType } from '../../../../shared/utils/payment'
import type { PaymentType } from '../../../../app/types'
import type { PaymentMethod } from '../../../../types'

type State = {
  showForm: boolean
  name: string
  type: PaymentType
  cardClosingDay: string
  cardPaymentDay: string
  linkedBankPaymentMethodId: string
  editingMethod: PaymentMethod | null
  editName: string
  editType: PaymentType
  editCardClosingDay: string
  editCardPaymentDay: string
  editLinkedBankPaymentMethodId: string
  editIconKey: string | null
  editColor: string
}

type Action =
  | { type: 'PATCH'; payload: Partial<State> }
  | { type: 'OPEN_EDIT'; payload: PaymentMethod }
  | { type: 'CLOSE_EDIT' }

const createInitialState = (defaultType: PaymentType): State => ({
  showForm: false,
  name: '',
  type: defaultType,
  cardClosingDay: '',
  cardPaymentDay: '',
  linkedBankPaymentMethodId: '',
  editingMethod: null,
  editName: '',
  editType: defaultType,
  editCardClosingDay: '',
  editCardPaymentDay: '',
  editLinkedBankPaymentMethodId: '',
  editIconKey: null,
  editColor: CATEGORY_COLORS[0],
})

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload }
    case 'OPEN_EDIT': {
      const method = action.payload
      const normalizedType = getPaymentType(method.type)
      return {
        ...state,
        editingMethod: method,
        editName: method.name,
        editType: normalizedType,
        editCardClosingDay: dayToInputValue(normalizeDayOfMonth(method.card_closing_day)),
        editCardPaymentDay: dayToInputValue(normalizeDayOfMonth(method.card_payment_day)),
        editLinkedBankPaymentMethodId: method.linked_bank_payment_method_id ?? '',
        editIconKey: method.icon_key ?? getPaymentFallbackIconKey(method.type),
        editColor: method.color ?? CATEGORY_COLORS[0],
      }
    }
    case 'CLOSE_EDIT':
      return { ...state, editingMethod: null }
    default:
      return state
  }
}

export const usePaymentSettingsState = (defaultType: PaymentType) => {
  const [state, dispatch] = useReducer(reducer, defaultType, createInitialState)

  useEffect(() => {
    dispatch({
      type: 'PATCH',
      payload: {
        type: defaultType,
        editType: defaultType,
      },
    })
  }, [defaultType])

  return { state, dispatch }
}
