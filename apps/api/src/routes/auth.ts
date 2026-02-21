import type { Hono } from 'hono'
import type { HonoEnv, OAuthStateRow, UserRow } from '../types'
import {
  OAUTH_STATE_TTL_MINUTES,
  buildGoogleAuthUrl,
  createSession,
  ensureFamilyForAllowedUser,
  ensureUser,
  exchangeGoogleCode,
  fetchTokenInfo,
  isAllowedOrigin,
  jsonError,
  loadAllowedUser,
  loadSession,
  nowIso,
  setSessionCookie,
  clearSessionCookie,
} from '../shared'

export const registerAuthRoutes = (app: Hono<HonoEnv>) => {
  app.get('/auth/session', async (c) => {
    const session = await loadSession(c)
    if (!session) return c.json({ session: null })
    const user = await c.env.DB.prepare('SELECT id, email, name, avatar_url FROM users WHERE id = ?')
      .bind(session.user_id)
      .first<UserRow>()
    return c.json({
      session: {
        status: 'ready',
        family_id: session.family_id,
        user: user ?? { id: session.user_id, email: '', name: null, avatar_url: null },
      },
    })
  })

  app.get('/auth/google/start', async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID
    if (!clientId) return c.json(jsonError('Missing GOOGLE_CLIENT_ID'), 500)

    const nextPath = c.req.query('next')?.trim() ?? '/'
    const originParam = c.req.query('origin')?.trim() ?? null
    const origin = isAllowedOrigin(originParam, c.env) ? originParam : null
    const stateId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60 * 1000).toISOString()
    const safeNext = nextPath.startsWith('/') ? nextPath : '/'

    await c.env.DB
      .prepare(
        'INSERT INTO oauth_states (id, next_path, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(stateId, safeNext, origin, nowIso(), expiresAt)
      .run()

    const redirectUri = new URL('/auth/google/callback', c.req.url).toString()
    return c.redirect(buildGoogleAuthUrl(clientId, redirectUri, stateId), 302)
  })

  app.get('/auth/google/callback', async (c) => {
    const code = c.req.query('code')
    const stateId = c.req.query('state')
    const clientId = c.env.GOOGLE_CLIENT_ID
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET
    if (!code || !stateId || !clientId || !clientSecret) {
      return c.json(jsonError('Invalid OAuth request'), 400)
    }

    const state = await c.env.DB
      .prepare('SELECT * FROM oauth_states WHERE id = ?')
      .bind(stateId)
      .first<OAuthStateRow>()
    if (!state || new Date(state.expires_at).getTime() <= Date.now()) {
      return c.json(jsonError('OAuth state expired'), 400)
    }
    await c.env.DB.prepare('DELETE FROM oauth_states WHERE id = ?').bind(stateId).run()

    const redirectUri = new URL('/auth/google/callback', c.req.url).toString()
    const token = await exchangeGoogleCode(clientId, clientSecret, code, redirectUri)
    if (!token?.id_token) return c.json(jsonError('Failed to exchange token'), 400)

    const tokenInfo = await fetchTokenInfo(token.id_token)
    if (!tokenInfo?.sub || tokenInfo.aud !== clientId) {
      return c.json(jsonError('Invalid ID token'), 400)
    }

    const targetOrigin = state.origin ?? c.env.APP_ORIGIN
    const safeOrigin = isAllowedOrigin(targetOrigin ?? null, c.env) ? targetOrigin : null
    const targetBase = safeOrigin ?? c.env.APP_ORIGIN ?? new URL(c.req.url).origin
    const redirectToApp = (errorCode?: string) => {
      const url = new URL(state.next_path ?? '/', targetBase)
      if (errorCode) url.searchParams.set('auth_error', errorCode)
      return c.redirect(url.toString(), 302)
    }

    const email = tokenInfo.email?.toLowerCase()
    const emailVerified = tokenInfo.email_verified
    if (!email) {
      return c.json(jsonError('Email is required'), 400)
    }
    if (emailVerified === false || emailVerified === 'false') {
      return redirectToApp('email_unverified')
    }

    const allowed = await loadAllowedUser(c.env.DB, email)
    if (!allowed) {
      return redirectToApp('not_allowed')
    }

    await ensureUser(c.env.DB, {
      id: tokenInfo.sub,
      email,
      name: tokenInfo.name ?? null,
      avatar_url: tokenInfo.picture ?? null,
    })

    const familyId = await ensureFamilyForAllowedUser(
      c.env.DB,
      allowed,
      tokenInfo.sub,
      tokenInfo.name ?? null
    )
    const session = await createSession(c.env.DB, tokenInfo.sub, familyId, false)
    setSessionCookie(c, session.id)

    return redirectToApp()
  })

  app.post('/auth/logout', async (c) => {
    const session = await loadSession(c)
    if (session) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run()
    }
    clearSessionCookie(c)
    return c.json({ ok: true })
  })
}
