import { AUTH_CACHE_KEY } from '../../shared/constants'
import type { CachedAuthIdentity } from '../../app/types'

export const loadCachedAuthIdentity = (): CachedAuthIdentity | null => {
  const raw = localStorage.getItem(AUTH_CACHE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CachedAuthIdentity>
    if (typeof parsed.family_id !== 'string' || typeof parsed.user_id !== 'string') return null
    return {
      family_id: parsed.family_id,
      user_id: parsed.user_id,
      verified_at: typeof parsed.verified_at === 'string' ? parsed.verified_at : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

export const saveCachedAuthIdentity = (familyId: string, userId: string) => {
  const payload: CachedAuthIdentity = {
    family_id: familyId,
    user_id: userId,
    verified_at: new Date().toISOString(),
  }
  localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(payload))
}

export const clearCachedAuthIdentity = () => {
  localStorage.removeItem(AUTH_CACHE_KEY)
}
