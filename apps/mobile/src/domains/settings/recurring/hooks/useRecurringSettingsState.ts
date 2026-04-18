import dayjs from 'dayjs'
import { useReducer } from 'react'
import type { HolidayAdjustment } from '../../../../app/types'
import type { EntryType, RecurringRule } from '../../../../types'
import { normalizeHolidayAdjustment } from '../../../../shared/utils/recurring'

type State = {
  entryType: EntryType
  showForm: boolean
  editingRule: RecurringRule | null
  amount: string
  entryCategoryId: string
  paymentMethodId: string
  memo: string
  frequency: string
  dayOfMonth: string
  yearlyMonth: string
  holidayAdjustment: HolidayAdjustment
}

type Action =
  | { type: 'PATCH'; payload: Partial<State> }
  | { type: 'RESET_FORM' }
  | { type: 'OPEN_CREATE' }
  | { type: 'OPEN_EDIT'; payload: RecurringRule }

const createInitialState = (): State => ({
  entryType: 'expense',
  showForm: false,
  editingRule: null,
  amount: '',
  entryCategoryId: '',
  paymentMethodId: '',
  memo: '',
  frequency: 'monthly',
  dayOfMonth: '8',
  yearlyMonth: String(dayjs().month() + 1),
  holidayAdjustment: 'none',
})

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload }
    case 'RESET_FORM':
      return { ...state, ...createInitialState(), entryType: state.entryType }
    case 'OPEN_CREATE':
      return { ...state, ...createInitialState(), entryType: state.entryType, showForm: true }
    case 'OPEN_EDIT': {
      const rule = action.payload
      const ruleStart = dayjs(rule.start_at)
      return {
        ...state,
        showForm: true,
        editingRule: rule,
        entryType: rule.entry_type,
        amount: String(rule.amount),
        entryCategoryId: rule.entry_category_id ?? '',
        paymentMethodId: rule.payment_method_id ?? '',
        memo: rule.memo ?? '',
        frequency: rule.frequency ?? 'monthly',
        yearlyMonth: String(ruleStart.month() + 1),
        dayOfMonth:
          (rule.frequency ?? 'monthly') === 'weekly'
            ? String(rule.day_of_month ?? ruleStart.day())
            : String(rule.day_of_month ?? ruleStart.date()),
        holidayAdjustment: normalizeHolidayAdjustment(rule.holiday_adjustment),
      }
    }
    default:
      return state
  }
}

export const useRecurringSettingsState = () => {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  return { state, dispatch }
}
