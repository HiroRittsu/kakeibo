import dayjs from 'dayjs'
import { useReducer } from 'react'
import type { EntryType } from '../../../types'
import type { EntryInputSeed } from '../../../app/types'
import { splitMemo } from '../../../shared/utils/memo'

type CalcOperator = '+' | '-' | '*' | '/'

type EntryInputState = {
  entryType: EntryType
  entryCategoryId: string
  paymentMethodId: string
  place: string
  memo: string
  dateValue: string
  timeValue: string
  displayValue: string
  accumulator: number | null
  pendingOperator: CalcOperator | null
  freshInput: boolean
  operationUsed: boolean
  awaitingSubmit: boolean
  showCategorySheet: boolean
  showPaymentSheet: boolean
  categorySheetType: EntryType
}

type EntryInputAction =
  | { type: 'PATCH'; payload: Partial<EntryInputState> }
  | { type: 'SET_ENTRY_TYPE'; payload: EntryType }
  | { type: 'RESET_CALC' }

const createInitialState = (seed: EntryInputSeed): EntryInputState => {
  const initialMemo = splitMemo(seed.memo)
  return {
    entryType: seed.entryType,
    entryCategoryId: seed.entryCategoryId ?? '',
    paymentMethodId: seed.paymentMethodId ?? '',
    place: initialMemo.place,
    memo: initialMemo.memo,
    dateValue: dayjs(seed.occurredAt).format('YYYY-MM-DD'),
    timeValue: dayjs(seed.occurredAt).format('HH:mm'),
    displayValue: seed.amount ? String(seed.amount) : '0',
    accumulator: null,
    pendingOperator: null,
    freshInput: !seed.amount,
    operationUsed: false,
    awaitingSubmit: false,
    showCategorySheet: false,
    showPaymentSheet: false,
    categorySheetType: seed.entryType,
  }
}

const reducer = (state: EntryInputState, action: EntryInputAction): EntryInputState => {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload }
    case 'SET_ENTRY_TYPE':
      return { ...state, entryType: action.payload }
    case 'RESET_CALC':
      return {
        ...state,
        displayValue: '0',
        accumulator: null,
        pendingOperator: null,
        freshInput: true,
        operationUsed: false,
        awaitingSubmit: false,
      }
    default:
      return state
  }
}

const applyOperator = (left: number, right: number, operator: CalcOperator) => {
  if (operator === '+') return left + right
  if (operator === '-') return left - right
  if (operator === '*') return left * right
  if (operator === '/') return right === 0 ? left : left / right
  return right
}

export const useEntryInputState = (seed: EntryInputSeed) => {
  const [state, dispatch] = useReducer(reducer, seed, createInitialState)

  const computeResult = () => {
    const current = Number(state.displayValue)
    if (state.accumulator !== null && state.pendingOperator) {
      return applyOperator(state.accumulator, current, state.pendingOperator)
    }
    return current
  }

  const handleAppend = (value: string) => {
    let next = state
    if (state.awaitingSubmit) {
      next = {
        ...next,
        awaitingSubmit: false,
        operationUsed: false,
        accumulator: null,
        pendingOperator: null,
        freshInput: true,
      }
    }

    const currentDisplay = next.displayValue
    let updatedDisplay = currentDisplay
    if (value === '.') {
      if (currentDisplay.includes('.')) {
        dispatch({ type: 'PATCH', payload: { ...next } })
        return
      }
      if (next.freshInput || currentDisplay === '0') {
        updatedDisplay = '0.'
      } else {
        updatedDisplay = `${currentDisplay}.`
      }
    } else if (next.freshInput || currentDisplay === '0') {
      if (value === '00') {
        updatedDisplay = '0'
      } else {
        updatedDisplay = value
      }
    } else {
      updatedDisplay = currentDisplay + value
    }

    dispatch({
      type: 'PATCH',
      payload: {
        ...next,
        displayValue: updatedDisplay,
        freshInput: false,
      },
    })
  }

  const handleOperator = (operator: CalcOperator) => {
    const current = Number(state.displayValue)
    if (state.accumulator === null) {
      dispatch({
        type: 'PATCH',
        payload: {
          operationUsed: true,
          awaitingSubmit: false,
          accumulator: current,
          pendingOperator: operator,
          freshInput: true,
        },
      })
      return
    }

    if (state.pendingOperator) {
      const result = applyOperator(state.accumulator, current, state.pendingOperator)
      dispatch({
        type: 'PATCH',
        payload: {
          operationUsed: true,
          awaitingSubmit: false,
          accumulator: result,
          displayValue: String(Math.round(result)),
          pendingOperator: operator,
          freshInput: true,
        },
      })
      return
    }

    dispatch({
      type: 'PATCH',
      payload: {
        operationUsed: true,
        awaitingSubmit: false,
        pendingOperator: operator,
        freshInput: true,
      },
    })
  }

  const handleClear = () => {
    dispatch({ type: 'RESET_CALC' })
  }

  const handleBackspace = () => {
    const value = state.displayValue.length <= 1 ? '0' : state.displayValue.slice(0, -1)
    dispatch({
      type: 'PATCH',
      payload: {
        displayValue: value,
        freshInput: false,
      },
    })
  }

  const handleEquals = () => {
    const result = computeResult()
    if (!Number.isFinite(result)) return
    dispatch({
      type: 'PATCH',
      payload: {
        displayValue: String(Math.round(result)),
        accumulator: null,
        pendingOperator: null,
        freshInput: true,
        operationUsed: false,
        awaitingSubmit: true,
      },
    })
  }

  return {
    state,
    dispatch,
    computeResult,
    handleAppend,
    handleOperator,
    handleClear,
    handleBackspace,
    handleEquals,
  }
}
