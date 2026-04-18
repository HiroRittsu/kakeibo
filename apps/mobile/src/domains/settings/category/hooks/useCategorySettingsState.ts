import { useReducer } from 'react'
import { CATEGORY_COLORS } from '../../../../shared/constants'
import type { EntryType, EntryCategory } from '../../../../types'

type State = {
  entryType: EntryType
  showForm: boolean
  name: string
  editingCategory: EntryCategory | null
  editName: string
  editIconKey: string | null
  editColor: string
}

type Action =
  | { type: 'PATCH'; payload: Partial<State> }
  | { type: 'OPEN_EDIT'; payload: EntryCategory }
  | { type: 'CLOSE_EDIT' }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload }
    case 'OPEN_EDIT':
      return {
        ...state,
        editingCategory: action.payload,
        editName: action.payload.name,
        editIconKey: action.payload.icon_key ?? null,
        editColor: action.payload.color ?? CATEGORY_COLORS[0],
      }
    case 'CLOSE_EDIT':
      return {
        ...state,
        editingCategory: null,
      }
    default:
      return state
  }
}

export const useCategorySettingsState = () => {
  const [state, dispatch] = useReducer(reducer, {
    entryType: 'expense',
    showForm: false,
    name: '',
    editingCategory: null,
    editName: '',
    editIconKey: null,
    editColor: CATEGORY_COLORS[0],
  })

  return { state, dispatch }
}
