import { useReducer } from 'react'
import type { EntryType } from '../../../types'

type ReportRange = 'week' | 'month' | 'year'

type ReportsState = {
  range: ReportRange
  reportType: EntryType
  reportOffset: number
}

type ReportsAction =
  | { type: 'SET_RANGE'; payload: ReportRange }
  | { type: 'SET_REPORT_TYPE'; payload: EntryType }
  | { type: 'SET_REPORT_OFFSET'; payload: number }
  | { type: 'SHIFT_REPORT_OFFSET'; payload: number }

const reducer = (state: ReportsState, action: ReportsAction): ReportsState => {
  switch (action.type) {
    case 'SET_RANGE':
      return { ...state, range: action.payload, reportOffset: 0 }
    case 'SET_REPORT_TYPE':
      return { ...state, reportType: action.payload }
    case 'SET_REPORT_OFFSET':
      return { ...state, reportOffset: action.payload }
    case 'SHIFT_REPORT_OFFSET':
      return { ...state, reportOffset: state.reportOffset + action.payload }
    default:
      return state
  }
}

export const useReportsState = () => {
  const [state, dispatch] = useReducer(reducer, {
    range: 'month' as const,
    reportType: 'expense' as const,
    reportOffset: 0,
  })

  return { state, dispatch }
}
