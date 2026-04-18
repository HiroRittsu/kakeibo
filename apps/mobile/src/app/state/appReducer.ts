import type { AppAction, AppState } from './appState'

export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'NAVIGATE_TO_PAGE':
      return { ...state, nav: { ...state.nav, page: action.payload } }
    case 'NAVIGATE_WITH_RETURN':
      return {
        ...state,
        nav: {
          ...state.nav,
          page: action.payload.page,
          returnPage: action.payload.returnPage,
          menuOpen: false,
        },
      }
    case 'SELECT_MAIN_TAB':
      return {
        ...state,
        nav: {
          ...state.nav,
          page: 'main',
          activeTab: action.payload,
          menuOpen: false,
        },
      }
    case 'MENU_OPENED':
      return { ...state, nav: { ...state.nav, menuOpen: true } }
    case 'MENU_CLOSED':
      return { ...state, nav: { ...state.nav, menuOpen: false } }
    case 'TOAST_SHOWN':
      return { ...state, sync: { ...state.sync, toast: action.payload } }
    case 'TOAST_CLEARED':
      return { ...state, sync: { ...state.sync, toast: null } }
    case 'HISTORY_MONTH_CHANGED':
      return { ...state, context: { ...state.context, historyMonthYm: action.payload } }
    case 'PREFERRED_ENTRY_TYPE_CHANGED':
      return { ...state, context: { ...state.context, preferredEntryType: action.payload } }
    case 'ENTRY_SEED_TYPE_CHANGED':
      return {
        ...state,
        context: {
          ...state.context,
          entrySeed: state.context.entrySeed ? { ...state.context.entrySeed, entryType: action.payload } : state.context.entrySeed,
        },
      }
    case 'OFFLINE_AUTH_MODE_DISABLED':
      return { ...state, session: { ...state.session, isOfflineAuthMode: false } }
    case 'OPEN_ENTRY_INPUT':
      return {
        ...state,
        nav: {
          ...state.nav,
          page: 'entry-input',
          returnPage: action.payload.returnPage,
          returnTab: action.payload.tab,
          menuOpen: false,
        },
        context: {
          ...state.context,
          preferredEntryType: action.payload.seed.entryType,
          entrySeed: action.payload.seed,
        },
      }
    case 'OPEN_REPORT_CATEGORY_ENTITIES':
      return {
        ...state,
        nav: { ...state.nav, page: 'report-category-entities', returnPage: action.payload.returnPage, menuOpen: false },
        context: { ...state.context, reportCategorySeed: action.payload.seed },
      }
    case 'OPEN_PAYMENT_METHOD_ENTITIES':
      return {
        ...state,
        nav: { ...state.nav, page: 'payment-method-entities', returnPage: action.payload.returnPage, menuOpen: false },
        context: { ...state.context, paymentMethodSeed: action.payload.seed },
      }
    case 'OPEN_PAYMENT_SETTINGS':
      return {
        ...state,
        nav: { ...state.nav, page: 'payment-settings', paymentReturnPage: action.payload.returnPage, menuOpen: false },
        context: { ...state.context, paymentType: action.payload.paymentType },
      }
    case 'BACK_FROM_PAGE': {
      if (state.nav.page === 'payment-settings') {
        return { ...state, nav: { ...state.nav, page: state.nav.paymentReturnPage } }
      }
      if (state.nav.page === 'report-category-entities') {
        return {
          ...state,
          nav: { ...state.nav, page: state.nav.returnPage },
          context: { ...state.context, reportCategorySeed: null },
        }
      }
      if (state.nav.page === 'payment-method-entities') {
        return {
          ...state,
          nav: { ...state.nav, page: state.nav.returnPage },
          context: { ...state.context, paymentMethodSeed: null },
        }
      }
      if (state.nav.page === 'entry-input') {
        return {
          ...state,
          nav: {
            ...state.nav,
            page: state.nav.returnPage,
            activeTab: state.nav.returnPage === 'main' ? state.nav.returnTab : state.nav.activeTab,
          },
          context: { ...state.context, entrySeed: null },
        }
      }
      return { ...state, nav: { ...state.nav, page: state.nav.returnPage } }
    }
    case 'BROWSER_NAV_RESTORED':
      return {
        ...state,
        nav: {
          ...action.payload,
          menuOpen: false,
        },
      }
    case 'SYNC_STARTED':
      return { ...state, sync: { ...state.sync, syncing: true } }
    case 'SYNC_FINISHED':
      return { ...state, sync: { ...state.sync, syncing: false } }
    case 'SYNC_FAILED':
      return { ...state, sync: { ...state.sync, syncFailure: action.payload } }
    case 'AUTH_READY':
      return {
        ...state,
        session: {
          ...state.session,
          authStatus: 'ready',
          authError: null,
          currentUser: action.payload.user,
          isOfflineAuthMode: action.payload.isOfflineAuthMode,
          isSessionVerified: action.payload.isSessionVerified,
        },
      }
    case 'AUTH_LOGGED_OUT':
      return {
        ...state,
        session: {
          ...state.session,
          authStatus: 'logged-out',
          authError: action.payload.error,
          currentUser: null,
          isOfflineAuthMode: false,
          isSessionVerified: false,
        },
      }
    case 'LOGOUT_COMPLETED':
      return {
        ...state,
        nav: {
          ...state.nav,
          activeTab: 'home',
          page: 'main',
          returnPage: 'main',
          paymentReturnPage: 'main',
          returnTab: 'home',
          menuOpen: false,
        },
        session: {
          ...state.session,
          authStatus: 'logged-out',
          authError: null,
          currentUser: null,
          isOfflineAuthMode: false,
          isSessionVerified: false,
        },
        context: {
          ...state.context,
          entrySeed: null,
          reportCategorySeed: null,
          paymentMethodSeed: null,
          preferredEntryType: 'expense',
        },
      }
    default:
      return state
  }
}

export { createInitialAppState } from './appState'
