import { useCallback, useEffect, type Dispatch } from 'react'
import { db } from '../../../infra/db'
import { syncOutbox } from '../../../infra/sync'
import { BACKGROUND_SESSION_CHECK_TIMEOUT_MS } from '../../../shared/constants'
import { formatSyncFailureMessage } from '../../../shared/utils/syncDiagnostics'
import { clearCachedAuthIdentity } from '../../auth/authCache'
import { disableOfflineAuthMode } from '../../../app/state/appActions'
import type { AppAction } from '../../../app/state/appState'

type UseSyncManagerParams = {
  authStatus: 'loading' | 'logged-out' | 'ready'
  isOfflineAuthMode: boolean
  isSessionVerified: boolean
  dispatch: Dispatch<AppAction>
  loadSession: (options?: {
    timeoutMs?: number
    allowCachedFallback?: boolean
    notifyOfflineFallback?: boolean
    unauthenticatedError?: string | null
  }) => Promise<boolean>
  showToast: (message: string, type?: 'error' | 'info') => void
}

export const useSyncManager = ({
  authStatus,
  isOfflineAuthMode,
  isSessionVerified,
  dispatch,
  loadSession,
  showToast,
}: UseSyncManagerParams) => {
  const runSync = useCallback(
    async (options: { silentIfOffline?: boolean } = {}) => {
      if (!navigator.onLine) {
        if (!options.silentIfOffline) {
          showToast('オフライン中のため同期はスキップしました', 'info')
        }
        return
      }

      if (!isSessionVerified) {
        const verified = await loadSession({
          timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
          allowCachedFallback: true,
          notifyOfflineFallback: false,
          unauthenticatedError: 'セッションが切れました。再ログインしてください。',
        })
        if (!verified) return
      }

      const result = await syncOutbox()
      if (!result.ok) {
        dispatch({ type: 'SYNC_FAILED', payload: result.failure })
        showToast(formatSyncFailureMessage(result.failure))
        if (result.failure.auth_required) {
          clearCachedAuthIdentity()
          dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: 'セッションが切れました。再ログインしてください。' } })
        }
        return
      }
      if (isOfflineAuthMode) {
        dispatch(disableOfflineAuthMode())
      }
      if (result.dead_letters > 0) {
        showToast('要対応の同期エラーがあります。詳細をコピーしてください。')
      }
      const currentDeadLetterCount = await db.outboxDeadLetters.count()
      if (currentDeadLetterCount === 0) {
        dispatch({ type: 'SYNC_FAILED', payload: null })
      }
    },
    [dispatch, isOfflineAuthMode, isSessionVerified, loadSession, showToast]
  )

  useEffect(() => {
    if (authStatus !== 'ready' || !isSessionVerified) return
    void runSync({ silentIfOffline: true })
  }, [authStatus, isSessionVerified, runSync])

  const handleSync = useCallback(async () => {
    if (authStatus !== 'ready') return
    dispatch({ type: 'SYNC_STARTED' })
    try {
      await runSync()
    } finally {
      dispatch({ type: 'SYNC_FINISHED' })
    }
  }, [authStatus, dispatch, runSync])

  return {
    runSync,
    handleSync,
  }
}
