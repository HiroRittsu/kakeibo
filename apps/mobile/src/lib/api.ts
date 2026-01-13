const DEFAULT_FAMILY_ID = 'family-default'
const DEFAULT_USER_ID = 'user-default'

const getStoredValue = (key: string, fallback: string) => {
  const value = localStorage.getItem(key)
  if (value) return value
  localStorage.setItem(key, fallback)
  return fallback
}

export const getFamilyId = () => getStoredValue('family_id', DEFAULT_FAMILY_ID)
export const getUserId = () => getStoredValue('user_id', DEFAULT_USER_ID)

const envBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
const baseUrl = envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : import.meta.env.PROD ? '' : 'http://127.0.0.1:8787'

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('X-Family-Id', getFamilyId())
  headers.set('X-User-Id', getUserId())

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })

  return response
}
