import { useReducer } from 'react'

type HistoryViewState = {
  view: 'list' | 'calendar'
  selectedDate: string
}

type HistoryViewAction =
  | { type: 'SET_VIEW'; payload: 'list' | 'calendar' }
  | { type: 'SET_SELECTED_DATE'; payload: string }

const reducer = (state: HistoryViewState, action: HistoryViewAction): HistoryViewState => {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.payload }
    case 'SET_SELECTED_DATE':
      return { ...state, selectedDate: action.payload }
    default:
      return state
  }
}

export const useHistoryViewState = (initialSelectedDate: string) => {
  const [state, dispatch] = useReducer(reducer, {
    view: 'calendar' as const,
    selectedDate: initialSelectedDate,
  })

  return {
    state,
    dispatch,
  }
}
