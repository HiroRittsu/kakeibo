import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../infra/db'
import { apiFetch } from '../infra/api'
import { sortPaymentMethods } from '../shared/utils/payment'
import { buildSyncDiagnosticsLog } from '../shared/utils/syncDiagnostics'
import { copyText } from '../shared/utils/clipboard'
import { PAGE_TITLES, TAB_LABELS } from '../shared/constants'
import { createInitialAppState } from './state/appState'
import { appReducer } from './state/appReducer'
import {
  backFromPage,
  changeBalanceMonth,
  changeEntrySeedType,
  changeHistoryMonth,
  changePreferredEntryType,
  clearToast,
  closeMenu,
  navigateToPage,
  navigateWithReturn,
  openEntryInput,
  openMenu,
  openPaymentMethodEntities,
  openPaymentSettings,
  openReportCategoryEntities,
  restoreBrowserNav,
  selectMainTab,
  showToast as showToastAction,
} from './state/appActions'
import { useAuthSession } from '../domains/auth/hooks/useAuthSession'
import { useSyncManager } from '../domains/sync/hooks/useSyncManager'
import { saveEntry, deleteEntry } from '../domains/entries/services/entryService'
import { addCategory, deleteCategory, saveCategory } from '../domains/settings/category/services/categoryService'
import { addPaymentMethod, deletePaymentMethod, savePaymentMethod } from '../domains/settings/payment/services/paymentService'
import { addRecurringRule, deleteRecurringRule, saveRecurringRule } from '../domains/settings/recurring/services/recurringService'
import { clearLocalData } from './services/localData'
import type {
  EntryInputSeed,
  PageKey,
  PaymentMethodEntitySeed,
  PaymentType,
  ReportCategoryEntitySeed,
  TabKey,
} from './types'
import type { EntryCategory, PaymentMethod, RecurringRule } from '../types'

export const useAppController = () => {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialAppState)
  const toastTimerRef = useRef<number | null>(null)
  const browserHistoryRef = useRef({ initialized: false, key: '', suppressNextPush: false })

  const entries = useLiveQuery(() => db.entries.orderBy('occurred_at').reverse().toArray(), [])
  const entryCategories = useLiveQuery(() => db.entryCategories.orderBy('sort_order').toArray(), [])
  const paymentMethods = useLiveQuery(() => db.paymentMethods.orderBy('sort_order').toArray(), [])
  const recurringRules = useLiveQuery(() => db.recurringRules.orderBy('created_at').reverse().toArray(), [])
  const monthlyBalances = useLiveQuery(() => db.monthlyBalances.orderBy('ym').toArray(), [])
  const outboxCount = useLiveQuery(() => db.outbox.count(), [])
  const outboxDeadLetters = useLiveQuery(() => db.outboxDeadLetters.orderBy('failed_at').reverse().limit(10).toArray(), [])
  const deadLetterCount = useLiveQuery(() => db.outboxDeadLetters.count(), []) ?? 0

  const showToast = useCallback((message: string, type: 'error' | 'info' = 'error') => {
    dispatch(showToastAction({ message, type }))
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    toastTimerRef.current = window.setTimeout(() => {
      dispatch(clearToast())
    }, 3000)
  }, [])

  const { loadSession, handleLogin } = useAuthSession({
    authStatus: state.session.authStatus,
    isSessionVerified: state.session.isSessionVerified,
    dispatch,
    showToast,
  })

  const { runSync, handleSync } = useSyncManager({
    authStatus: state.session.authStatus,
    isOfflineAuthMode: state.session.isOfflineAuthMode,
    isSessionVerified: state.session.isSessionVerified,
    dispatch,
    loadSession,
    showToast,
  })

  const syncFailureLog = useMemo(
    () => buildSyncDiagnosticsLog(state.sync.syncFailure, outboxDeadLetters ?? []),
    [state.sync.syncFailure, outboxDeadLetters]
  )

  const orderedPaymentMethods = useMemo(() => sortPaymentMethods(paymentMethods ?? []), [paymentMethods])

  useEffect(() => {
    if (state.session.authStatus !== 'ready') return

    const navKey = JSON.stringify({
      page: state.nav.page,
      activeTab: state.nav.activeTab,
      returnPage: state.nav.returnPage,
      returnTab: state.nav.returnTab,
      paymentReturnPage: state.nav.paymentReturnPage,
    })
    const historyState = { kakeibo: true, nav: { ...state.nav, menuOpen: false } }

    if (!browserHistoryRef.current.initialized) {
      window.history.replaceState(historyState, '', window.location.href)
      browserHistoryRef.current = { initialized: true, key: navKey, suppressNextPush: false }
      return
    }

    if (browserHistoryRef.current.suppressNextPush) {
      browserHistoryRef.current = { initialized: true, key: navKey, suppressNextPush: false }
      return
    }

    if (browserHistoryRef.current.key !== navKey) {
      window.history.pushState(historyState, '', window.location.href)
      browserHistoryRef.current.key = navKey
    }
  }, [state.nav, state.session.authStatus])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nav = event.state?.kakeibo ? event.state.nav : null
      if (!nav) return
      browserHistoryRef.current.suppressNextPush = true
      dispatch(restoreBrowserNav(nav))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const paymentOptions = useMemo(() => {
    return orderedPaymentMethods.map((method) => ({
      value: method.id,
      label: method.name,
    }))
  }, [orderedPaymentMethods])

  const categoryMap = useMemo(() => {
    return new Map((entryCategories ?? []).map((category) => [category.id, category]))
  }, [entryCategories])

  const paymentMap = useMemo(() => {
    return new Map(orderedPaymentMethods.map((method) => [method.id, method]))
  }, [orderedPaymentMethods])

  const monthlyBalanceMap = useMemo(() => {
    return new Map((monthlyBalances ?? []).map((row) => [row.ym, row]))
  }, [monthlyBalances])

  const handleCopySyncFailureLog = useCallback(async () => {
    if (!syncFailureLog) return
    try {
      await copyText(syncFailureLog)
      showToast('同期エラー詳細をコピーしました', 'info')
    } catch {
      showToast('同期エラー詳細のコピーに失敗しました')
    }
  }, [showToast, syncFailureLog])

  const handleLogout = useCallback(async () => {
    dispatch(closeMenu())
    const confirmed = window.confirm('ログアウトしてこの端末のデータを削除します。よろしいですか？')
    if (!confirmed) return

    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ローカルデータ削除を優先するため、サーバーログアウト失敗時も続行する。
    }

    try {
      await clearLocalData()
    } catch {
      showToast('端末データの削除に失敗しました')
      return
    }

    dispatch({ type: 'LOGOUT_COMPLETED' })
    dispatch(changeHistoryMonth(dayjs().format('YYYY-MM')))
  }, [showToast])

  const handleSaveEntry = useCallback(
    async (payload: EntryInputSeed) => {
      await saveEntry({
        payload,
        entries: entries ?? [],
        currentUser: state.session.currentUser,
      })
      dispatch(changePreferredEntryType(payload.entryType))
      void runSync()
    },
    [entries, runSync, state.session.currentUser]
  )

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      await deleteEntry({ entryId, entries: entries ?? [] })
      void runSync()
    },
    [entries, runSync]
  )

  const handleAddCategory = useCallback(
    async (name: string, type: string) => {
      await addCategory({ name, type, count: entryCategories?.length ?? 0 })
      void runSync()
    },
    [entryCategories, runSync]
  )

  const handleSaveCategory = useCallback(
    async (category: EntryCategory) => {
      await saveCategory(category)
      void runSync()
    },
    [runSync]
  )

  const handleDeleteCategory = useCallback(
    async (category: EntryCategory) => {
      await deleteCategory(category)
      void runSync()
    },
    [runSync]
  )

  const handleAddPaymentMethod = useCallback(
    async (params: {
      name: string
      type: string
      cardClosingDay: number | null
      cardPaymentDay: number | null
      fundingSourcePaymentMethodId: string | null
    }) => {
      await addPaymentMethod({ ...params, orderedMethods: orderedPaymentMethods })
      void runSync()
    },
    [orderedPaymentMethods, runSync]
  )

  const handleSavePaymentMethod = useCallback(
    async (method: PaymentMethod) => {
      await savePaymentMethod(method)
      void runSync()
    },
    [runSync]
  )

  const handleDeletePaymentMethod = useCallback(
    async (method: PaymentMethod) => {
      await deletePaymentMethod(method)
      void runSync()
    },
    [runSync]
  )

  const handleAddRecurringRule = useCallback(
    async (rule: {
      entryType: 'income' | 'expense'
      amount: number
      entryCategoryId: string | null
      paymentMethodId: string | null
      memo: string | null
      frequency: string
      dayOfMonth: number | null
      holidayAdjustment: 'none' | 'previous' | 'next'
      startAt: string
    }) => {
      await addRecurringRule(rule)
      void runSync()
    },
    [runSync]
  )

  const handleSaveRecurringRule = useCallback(
    async (rule: RecurringRule) => {
      await saveRecurringRule(rule)
      void runSync()
    },
    [runSync]
  )

  const handleDeleteRecurringRule = useCallback(
    async (rule: RecurringRule) => {
      await deleteRecurringRule(rule)
      void runSync()
    },
    [runSync]
  )

  const resolveReturnPage = useCallback((): PageKey => {
    return state.nav.page === 'main' || state.nav.page === 'balance' ? state.nav.page : 'main'
  }, [state.nav.page])

  const handleOpenPage = useCallback(
    (next: PageKey) => {
      const returnPage = resolveReturnPage()
      dispatch(navigateWithReturn(next, returnPage))
    },
    [resolveReturnPage]
  )

  const handleOpenPayment = useCallback(
    (type: PaymentType) => {
      dispatch(openPaymentSettings(type, state.nav.page === 'balance' ? 'balance' : 'main'))
    },
    [state.nav.page]
  )

  const handleOpenEntryInput = useCallback(
    (seed: EntryInputSeed, tab: TabKey = state.nav.activeTab) => {
      dispatch(openEntryInput(seed, tab, resolveReturnPage()))
    },
    [resolveReturnPage, state.nav.activeTab]
  )

  const handleOpenReportCategoryEntities = useCallback((seed: ReportCategoryEntitySeed) => {
    dispatch(openReportCategoryEntities(seed, 'main'))
  }, [])

  const handleOpenPaymentMethodEntities = useCallback((seed: PaymentMethodEntitySeed) => {
    dispatch(openPaymentMethodEntities(seed, 'balance'))
  }, [])

  const handleBack = useCallback(() => {
    dispatch(backFromPage())
  }, [])

  const viewModel = useMemo(() => {
    const showIconBar = state.nav.page === 'main' || state.nav.page === 'balance'
    const iconActive: TabKey | 'balance' = state.nav.page === 'balance' ? 'balance' : state.nav.activeTab
    const entryInputTitle = state.context.entrySeed?.entryType === 'income' ? '収入の入力' : '支出の入力'
    const headerTitle =
      state.nav.page === 'entry-input'
        ? entryInputTitle
        : state.nav.page === 'payment-settings'
          ? PAGE_TITLES['payment-settings']
          : state.nav.page === 'report-category-entities'
            ? state.context.reportCategorySeed?.categoryName ?? PAGE_TITLES[state.nav.page]
            : state.nav.page === 'payment-method-entities'
              ? state.context.paymentMethodSeed?.methodName ?? PAGE_TITLES[state.nav.page]
              : state.nav.page === 'main'
                ? TAB_LABELS[state.nav.activeTab]
                : PAGE_TITLES[state.nav.page]
    const showSync = state.nav.page === 'main' || state.nav.page === 'balance'

    return {
      headerTitle,
      showIconBar,
      iconActive,
      showSync,
      syncFailureLog,
      outboxCount,
      deadLetterCount,
      entries: entries ?? [],
      entryCategories: entryCategories ?? [],
      orderedPaymentMethods,
      paymentOptions,
      recurringRules: recurringRules ?? [],
      categoryMap,
      paymentMap,
      monthlyBalanceMap,
    }
  }, [
    categoryMap,
    deadLetterCount,
    entries,
    entryCategories,
    monthlyBalanceMap,
    orderedPaymentMethods,
    outboxCount,
    paymentOptions,
    paymentMap,
    recurringRules,
    state,
    syncFailureLog,
  ])

  return {
    state,
    viewModel,
    actions: {
      auth: {
        handleLogin,
      },
      sync: {
        handleSync,
        handleCopySyncFailureLog,
      },
      navigation: {
        handleOpenPage,
        handleOpenPayment,
        handleOpenEntryInput,
        handleOpenReportCategoryEntities,
        handleOpenPaymentMethodEntities,
        handleBack,
        setHistoryMonthYm: (ym: string) => dispatch(changeHistoryMonth(ym)),
        setBalanceMonthYm: (ym: string) => dispatch(changeBalanceMonth(ym)),
        selectHome: () => dispatch(selectMainTab('home')),
        selectHistory: () => dispatch(selectMainTab('history')),
        selectReports: () => dispatch(selectMainTab('reports')),
        selectBalance: () => dispatch(navigateToPage('balance')),
        openMenu: () => dispatch(openMenu()),
        closeMenu: () => dispatch(closeMenu()),
        setPreferredEntryType: (entryType: 'income' | 'expense') => dispatch(changePreferredEntryType(entryType)),
        updateEntrySeedType: (nextType: 'income' | 'expense') => dispatch(changeEntrySeedType(nextType)),
      },
      mutations: {
        handleSaveEntry,
        handleDeleteEntry,
        handleAddCategory,
        handleSaveCategory,
        handleDeleteCategory,
        handleAddPaymentMethod,
        handleSavePaymentMethod,
        handleDeletePaymentMethod,
        handleAddRecurringRule,
        handleSaveRecurringRule,
        handleDeleteRecurringRule,
        handleLogout,
      },
    },
  }
}
