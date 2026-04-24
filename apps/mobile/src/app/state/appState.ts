import dayjs from 'dayjs'
import type { SyncFailure } from '../../infra/sync'
import type {
  AuthSession,
  EntryInputSeed,
  PageKey,
  PaymentMethodEntitySeed,
  PaymentType,
  ReportCategoryEntitySeed,
  TabKey,
  ToastState,
} from '../types'
import type { EntryType } from '../../types'

export type AppState = {
  nav: {
    activeTab: TabKey
    page: PageKey
    returnPage: PageKey
    paymentReturnPage: PageKey
    returnTab: TabKey
    menuOpen: boolean
  }
  session: {
    authStatus: 'loading' | 'logged-out' | 'ready'
    authError: string | null
    currentUser: AuthSession['user'] | null
    isOfflineAuthMode: boolean
    isSessionVerified: boolean
  }
  sync: {
    syncing: boolean
    syncFailure: SyncFailure | null
    toast: ToastState
  }
  context: {
    preferredEntryType: EntryType
    paymentType: PaymentType
    historyMonthYm: string
    balanceMonthYm: string
    entrySeed: EntryInputSeed | null
    reportCategorySeed: ReportCategoryEntitySeed | null
    paymentMethodSeed: PaymentMethodEntitySeed | null
  }
}

export type AppAction =
  | { type: 'NAVIGATE_TO_PAGE'; payload: PageKey }
  | { type: 'NAVIGATE_WITH_RETURN'; payload: { page: PageKey; returnPage: PageKey } }
  | { type: 'SELECT_MAIN_TAB'; payload: TabKey }
  | { type: 'MENU_OPENED' }
  | { type: 'MENU_CLOSED' }
  | { type: 'TOAST_SHOWN'; payload: NonNullable<ToastState> }
  | { type: 'TOAST_CLEARED' }
  | { type: 'HISTORY_MONTH_CHANGED'; payload: string }
  | { type: 'BALANCE_MONTH_CHANGED'; payload: string }
  | { type: 'PREFERRED_ENTRY_TYPE_CHANGED'; payload: EntryType }
  | { type: 'ENTRY_SEED_TYPE_CHANGED'; payload: EntryType }
  | { type: 'OFFLINE_AUTH_MODE_DISABLED' }
  | { type: 'OPEN_ENTRY_INPUT'; payload: { seed: EntryInputSeed; tab: TabKey; returnPage: PageKey } }
  | {
      type: 'OPEN_REPORT_CATEGORY_ENTITIES'
      payload: { seed: ReportCategoryEntitySeed; returnPage: PageKey }
    }
  | {
      type: 'OPEN_PAYMENT_METHOD_ENTITIES'
      payload: { seed: PaymentMethodEntitySeed; returnPage: PageKey }
    }
  | { type: 'OPEN_PAYMENT_SETTINGS'; payload: { paymentType: PaymentType; returnPage: PageKey } }
  | { type: 'BACK_FROM_PAGE' }
  | { type: 'BROWSER_NAV_RESTORED'; payload: AppState['nav'] }
  | { type: 'SYNC_STARTED' }
  | { type: 'SYNC_FINISHED' }
  | { type: 'SYNC_FAILED'; payload: SyncFailure | null }
  | { type: 'AUTH_READY'; payload: { user: AuthSession['user'] | null; isOfflineAuthMode: boolean; isSessionVerified: boolean } }
  | { type: 'AUTH_LOGGED_OUT'; payload: { error: string | null } }
  | { type: 'LOGOUT_COMPLETED' }

export type AppViewModel = {
  headerTitle: string
  showIconBar: boolean
  iconActive: TabKey | 'balance'
  showSync: boolean
}

export const createInitialAppState = (): AppState => ({
  nav: {
    activeTab: 'home',
    page: 'main',
    returnPage: 'main',
    paymentReturnPage: 'main',
    returnTab: 'home',
    menuOpen: false,
  },
  session: {
    authStatus: 'loading',
    authError: null,
    currentUser: null,
    isOfflineAuthMode: false,
    isSessionVerified: false,
  },
  sync: {
    syncing: false,
    syncFailure: null,
    toast: null,
  },
  context: {
    preferredEntryType: 'expense',
    paymentType: 'cash',
    historyMonthYm: dayjs().format('YYYY-MM'),
    balanceMonthYm: dayjs().format('YYYY-MM'),
    entrySeed: null,
    reportCategorySeed: null,
    paymentMethodSeed: null,
  },
})
