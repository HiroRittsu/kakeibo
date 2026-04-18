import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import { apiFetch, getApiBaseUrl, setIdentity } from '../../../infra/api'
import { BACKGROUND_SESSION_CHECK_TIMEOUT_MS, SESSION_CHECK_TIMEOUT_MS } from '../../../shared/constants'
import { clearCachedAuthIdentity, loadCachedAuthIdentity, saveCachedAuthIdentity } from '../authCache'
import type { AppAction } from '../../../app/state/appState'
import type { AuthSession } from '../../../app/types'

type UseAuthSessionParams = {
  authStatus: 'loading' | 'logged-out' | 'ready'
  isSessionVerified: boolean
  dispatch: Dispatch<AppAction>
  showToast: (message: string, type?: 'error' | 'info') => void
}

export const useAuthSession = ({ authStatus, isSessionVerified, dispatch, showToast }: UseAuthSessionParams) => {
  const sessionCheckInFlightRef = useRef<Promise<boolean> | null>(null)

  const applyCachedAuthMode = useCallback(
    (options: { showOfflineToast?: boolean } = {}) => {
      const cached = loadCachedAuthIdentity()
      if (!cached) return false
      setIdentity(cached.family_id, cached.user_id)
      dispatch({
        type: 'AUTH_READY',
        payload: { user: null, isOfflineAuthMode: true, isSessionVerified: false },
      })
      if (options.showOfflineToast) {
        showToast('オフラインのため、前回ログイン情報で起動しました', 'info')
      }
      return true
    },
    [dispatch, showToast]
  )

  const loadSession = useCallback(
    async (
      options: {
        timeoutMs?: number
        allowCachedFallback?: boolean
        notifyOfflineFallback?: boolean
        unauthenticatedError?: string | null
      } = {}
    ): Promise<boolean> => {
      if (sessionCheckInFlightRef.current) {
        return await sessionCheckInFlightRef.current
      }

      const request = (async () => {
        const {
          timeoutMs = SESSION_CHECK_TIMEOUT_MS,
          allowCachedFallback = false,
          notifyOfflineFallback = false,
          unauthenticatedError = null,
        } = options
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => {
          controller.abort()
        }, timeoutMs)

        try {
          const response = await apiFetch('/auth/session', { signal: controller.signal })
          if (!response.ok) {
            if (unauthenticatedError) {
              dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: unauthenticatedError } })
            }
            clearCachedAuthIdentity()
            if (!unauthenticatedError) {
              dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: null } })
            }
            return false
          }

          const data = (await response.json()) as { session: AuthSession | null }
          if (!data.session || !data.session.family_id) {
            if (unauthenticatedError) {
              dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: unauthenticatedError } })
            }
            clearCachedAuthIdentity()
            if (!unauthenticatedError) {
              dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: null } })
            }
            return false
          }

          setIdentity(data.session.family_id, data.session.user.id)
          dispatch({
            type: 'AUTH_READY',
            payload: { user: data.session.user, isOfflineAuthMode: false, isSessionVerified: true },
          })
          saveCachedAuthIdentity(data.session.family_id, data.session.user.id)
          return true
        } catch (error) {
          const isAbortError = error instanceof DOMException && error.name === 'AbortError'
          const isNetworkError = error instanceof TypeError
          if (
            (!navigator.onLine || isAbortError || isNetworkError) &&
            allowCachedFallback &&
            applyCachedAuthMode({ showOfflineToast: notifyOfflineFallback })
          ) {
            return false
          }
          const errorMessage = isAbortError
            ? 'セッション確認がタイムアウトしました。ログインして続行してください。'
            : !navigator.onLine
              ? 'オフラインです。オンラインで一度ログインしてください。'
              : null
          dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: errorMessage } })
          return false
        } finally {
          window.clearTimeout(timeoutId)
        }
      })()

      sessionCheckInFlightRef.current = request.finally(() => {
        sessionCheckInFlightRef.current = null
      })
      return await sessionCheckInFlightRef.current
    },
    [applyCachedAuthMode, dispatch]
  )

  const handleLogin = useCallback(() => {
    dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: null } })
    const apiBase = getApiBaseUrl()
    if (!apiBase) {
      dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: 'APIのURLが設定されていません' } })
      return
    }
    const params = new URLSearchParams({
      next: window.location.pathname,
      origin: window.location.origin,
    })
    window.location.href = `${apiBase}/auth/google/start?${params.toString()}`
  }, [dispatch])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('auth_error')
    if (error) {
      const message =
        error === 'email_unverified'
          ? 'Googleアカウントのメール認証が必要です'
          : 'このアカウントは許可されていません'
      dispatch({ type: 'AUTH_LOGGED_OUT', payload: { error: message } })
      params.delete('auth_error')
      const next = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
    }
    if (applyCachedAuthMode()) {
      void loadSession({
        timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback: true,
        notifyOfflineFallback: false,
        unauthenticatedError: 'セッションが切れました。再ログインしてください。',
      })
      return
    }
    void loadSession({
      timeoutMs: SESSION_CHECK_TIMEOUT_MS,
      allowCachedFallback: false,
      notifyOfflineFallback: false,
      unauthenticatedError: null,
    })
  }, [applyCachedAuthMode, dispatch, loadSession])

  useEffect(() => {
    if (authStatus !== 'ready' || isSessionVerified) return
    const onOnline = () => {
      void loadSession({
        timeoutMs: BACKGROUND_SESSION_CHECK_TIMEOUT_MS,
        allowCachedFallback: true,
        notifyOfflineFallback: false,
        unauthenticatedError: 'セッションが切れました。再ログインしてください。',
      })
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [authStatus, isSessionVerified, loadSession])

  return {
    loadSession,
    handleLogin,
  }
}
