import type { AppAction, AppState } from './appState'
import type { EntryInputSeed, PageKey, PaymentMethodEntitySeed, PaymentType, ReportCategoryEntitySeed, TabKey } from '../types'
import type { EntryType } from '../../types'
import type { ToastState } from '../types'

export const navigateToPage = (page: PageKey): AppAction => ({ type: 'NAVIGATE_TO_PAGE', payload: page })
export const navigateWithReturn = (page: PageKey, returnPage: PageKey): AppAction => ({
  type: 'NAVIGATE_WITH_RETURN',
  payload: { page, returnPage },
})
export const selectMainTab = (tab: TabKey): AppAction => ({ type: 'SELECT_MAIN_TAB', payload: tab })
export const openMenu = (): AppAction => ({ type: 'MENU_OPENED' })
export const closeMenu = (): AppAction => ({ type: 'MENU_CLOSED' })
export const showToast = (toast: NonNullable<ToastState>): AppAction => ({ type: 'TOAST_SHOWN', payload: toast })
export const clearToast = (): AppAction => ({ type: 'TOAST_CLEARED' })
export const changeHistoryMonth = (ym: string): AppAction => ({ type: 'HISTORY_MONTH_CHANGED', payload: ym })
export const changePreferredEntryType = (entryType: EntryType): AppAction => ({
  type: 'PREFERRED_ENTRY_TYPE_CHANGED',
  payload: entryType,
})
export const changeEntrySeedType = (entryType: EntryType): AppAction => ({
  type: 'ENTRY_SEED_TYPE_CHANGED',
  payload: entryType,
})
export const disableOfflineAuthMode = (): AppAction => ({ type: 'OFFLINE_AUTH_MODE_DISABLED' })

export const openEntryInput = (seed: EntryInputSeed, tab: TabKey, returnPage: PageKey): AppAction => ({
  type: 'OPEN_ENTRY_INPUT',
  payload: { seed, tab, returnPage },
})

export const openReportCategoryEntities = (seed: ReportCategoryEntitySeed, returnPage: PageKey): AppAction => ({
  type: 'OPEN_REPORT_CATEGORY_ENTITIES',
  payload: { seed, returnPage },
})

export const openPaymentMethodEntities = (seed: PaymentMethodEntitySeed, returnPage: PageKey): AppAction => ({
  type: 'OPEN_PAYMENT_METHOD_ENTITIES',
  payload: { seed, returnPage },
})

export const openPaymentSettings = (paymentType: PaymentType, returnPage: PageKey): AppAction => ({
  type: 'OPEN_PAYMENT_SETTINGS',
  payload: { paymentType, returnPage },
})

export const backFromPage = (): AppAction => ({ type: 'BACK_FROM_PAGE' })
export const restoreBrowserNav = (nav: AppState['nav']): AppAction => ({ type: 'BROWSER_NAV_RESTORED', payload: nav })
