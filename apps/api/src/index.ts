import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

type Bindings = {
  DB: D1Database
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APP_ORIGIN?: string
  ALLOWED_ORIGINS?: string
}

type SessionRow = {
  id: string
  user_id: string
  family_id: string | null
  is_pending: number | null
  expires_at: string
  created_at: string
  updated_at: string
}

type UserRow = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
}

type OAuthStateRow = {
  id: string
  next_path: string | null
  origin: string | null
  expires_at: string
}

type AllowedUserRow = {
  email: string
  family_id: string | null
  role: string | null
  created_at: string
  updated_at: string
}

type ChangeLogRow = {
  id: number
  entity_type: string
  entity_id: string
  action: string
  payload: string | null
  created_at: string
}

type Variables = {
  session?: SessionRow | null
}

type HonoEnv = {
  Bindings: Bindings
  Variables: Variables
}

const app = new Hono<HonoEnv>()

const parseAllowedOrigins = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const resolveCorsOrigin = (origin: string | undefined, env: Bindings) => {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
  if (!origin) return allowed[0] ?? ''
  if (allowed.length === 0) return origin
  return allowed.includes(origin) ? origin : allowed[0] ?? ''
}

const isAllowedOrigin = (origin: string | null, env: Bindings) => {
  if (!origin) return false
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
  if (allowed.length === 0) return true
  return allowed.includes(origin)
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin')
  const allowedOrigin = resolveCorsOrigin(origin, c.env)
  return cors({
    origin: allowedOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })(c, next)
})

const jsonError = (message: string, status = 400) => {
  return { message, status }
}

const SESSION_COOKIE = 'kakeibo_session'
const SESSION_TTL_DAYS = 30
const OAUTH_STATE_TTL_MINUTES = 10

const buildExpiryIso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

const isLocalRequest = (url: string) => {
  return url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')
}

const setSessionCookie = (c: Context<HonoEnv>, sessionId: string) => {
  const local = isLocalRequest(c.req.url)
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: local ? 'Lax' : 'None',
    secure: !local,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

const clearSessionCookie = (c: Context<HonoEnv>) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

const loadSession = async (c: Context<HonoEnv>) => {
  const cached = c.get('session')
  if (cached !== undefined) return cached
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (!sessionId) {
    c.set('session', null)
    return null
  }
  const session = await c.env.DB
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<SessionRow>()
  if (!session) {
    clearSessionCookie(c)
    c.set('session', null)
    return null
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
    clearSessionCookie(c)
    c.set('session', null)
    return null
  }
  c.set('session', session)
  return session
}

const requireSession = async (c: Context<HonoEnv>) => {
  const session = await loadSession(c)
  if (!session || !session.family_id) {
    return null
  }
  return session
}

const requireFamilyId = (c: Context<HonoEnv>) => {
  const session = c.get('session')
  if (!session?.family_id) return null
  return session.family_id
}

const getActorUserId = (c: Context<HonoEnv>) => {
  return c.get('session')?.user_id ?? 'unknown'
}

const nowIso = () => new Date().toISOString()

const toTokyoDate = (date = new Date()) => {
  const ms = date.getTime() + 9 * 60 * 60 * 1000
  return new Date(ms)
}

const formatTokyoDate = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDateValue = (value?: string | null) => {
  if (!value) return new Date()
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const withTz = new Date(`${value}T00:00:00+09:00`)
    if (!Number.isNaN(withTz.getTime())) return withTz
  }
  return new Date()
}

const formatOccurredOn = (occurredAt?: string | null) => {
  const date = parseDateValue(occurredAt)
  return formatTokyoDate(toTokyoDate(date))
}

const formatTokyoYm = (date = new Date()) => {
  const tokyo = toTokyoDate(date)
  const year = tokyo.getUTCFullYear()
  const month = `${tokyo.getUTCMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

const ymToIndex = (ym: string) => {
  const [yearRaw, monthRaw] = ym.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0
  return year * 12 + (month - 1)
}

const formatYmFromIndex = (index: number) => {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${`${month}`.padStart(2, '0')}`
}

const addMonthsToYm = (ym: string, diff: number) => {
  const nextIndex = ymToIndex(ym) + diff
  return formatYmFromIndex(nextIndex)
}

const monthRangeFromYm = (ym: string) => {
  const start = `${ym}-01`
  const end = `${addMonthsToYm(ym, 1)}-01`
  return { start, end }
}

const getYmFromDate = (value: string) => value.slice(0, 7)

const minYm = (a: string, b: string) => (ymToIndex(a) <= ymToIndex(b) ? a : b)

app.use('*', async (c, next) => {
  await loadSession(c)
  const path = c.req.path
  if (c.req.method === 'OPTIONS' || path === '/health' || path.startsWith('/auth/')) {
    return next()
  }
  const session = c.get('session')
  if (!session || !session.family_id) {
    return c.json(jsonError('Unauthorized', 401), 401)
  }
  return next()
})

type RecurringRuleRow = {
  id: string
  family_id: string
  entry_type: 'income' | 'expense'
  amount: number
  entry_category_id: string | null
  payment_method_id: string | null
  memo: string | null
  frequency: string | null
  day_of_month: number | null
  holiday_adjustment: string | null
  start_at: string
  end_at: string | null
  is_active: number | null
}

type EntryTotalRow = {
  entry_type: 'income' | 'expense'
  total: number
}

type MonthlyBalanceRow = {
  balance?: number
  is_closed?: number
}

const createSession = async (
  db: D1Database,
  userId: string,
  familyId: string | null,
  isPending = false
) => {
  const now = nowIso()
  const sessionId = crypto.randomUUID()
  const expiresAt = buildExpiryIso(SESSION_TTL_DAYS)
  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, family_id, is_pending, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(sessionId, userId, familyId, isPending ? 1 : 0, expiresAt, now, now)
    .run()
  return { id: sessionId, user_id: userId, family_id: familyId, is_pending: isPending ? 1 : 0 }
}

const ensureUser = async (db: D1Database, user: UserRow) => {
  const now = nowIso()
  await db
    .prepare(
      'INSERT INTO users (id, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at'
    )
    .bind(user.id, user.email, user.name, user.avatar_url, now, now)
    .run()
}

const loadAllowedUser = async (db: D1Database, email: string) => {
  return db
    .prepare('SELECT * FROM allowed_users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<AllowedUserRow>()
}

const ensureFamilyForAllowedUser = async (
  db: D1Database,
  allowed: AllowedUserRow,
  userId: string,
  userName: string | null
) => {
  const now = nowIso()
  let familyId = allowed.family_id
  let role = allowed.role ?? 'member'

  if (!familyId) {
    familyId = crypto.randomUUID()
    const familyName = userName ? `${userName}の家計` : 'Family'
    await db
      .prepare('INSERT INTO families (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(familyId, familyName, now, now)
      .run()
    role = allowed.role ?? 'owner'
    await db
      .prepare('UPDATE allowed_users SET family_id = ?, role = ?, updated_at = ? WHERE email = ?')
      .bind(familyId, role, now, allowed.email)
      .run()
  }

  await db
    .prepare(
      'INSERT INTO members (user_id, family_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, family_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at'
    )
    .bind(userId, familyId, role, now, now)
    .run()

  return familyId
}


const buildGoogleAuthUrl = (clientId: string, redirectUri: string, state: string) => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('access_type', 'offline')
  return url.toString()
}

const exchangeGoogleCode = async (
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!response.ok) {
    return null
  }
  return (await response.json()) as { id_token?: string }
}

const fetchTokenInfo = async (idToken: string) => {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
  if (!response.ok) return null
  return (await response.json()) as {
    sub?: string
    email?: string
    email_verified?: string | boolean
    name?: string
    picture?: string
    aud?: string
  }
}

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

const getDueDay = (target: Date, ruleDay: number | null, fallback: Date) => {
  const candidate = ruleDay ?? fallback.getUTCDate()
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return Math.min(candidate, daysInMonth)
}

const normalizeHolidayAdjustment = (value?: string | null) => {
  if (value === 'previous' || value === 'next') return value
  return 'none'
}

const adjustForWeekend = (date: Date, adjustment: string) => {
  const weekday = date.getUTCDay()
  if (weekday !== 0 && weekday !== 6) return date
  if (adjustment === 'previous') {
    const delta = weekday === 0 ? -2 : -1
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta))
  }
  if (adjustment === 'next') {
    const delta = weekday === 0 ? 1 : 2
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta))
  }
  return date
}

const recalcMonthlyBalances = async (db: D1Database, familyId: string, startYm: string) => {
  const currentYm = formatTokyoYm()
  const startIndex = ymToIndex(startYm)
  const endIndex = ymToIndex(currentYm)
  if (startIndex > endIndex) return []

  const prevYm = addMonthsToYm(startYm, -1)
  const previousBalanceRow = await db
    .prepare('SELECT balance FROM monthly_balance WHERE family_id = ? AND ym = ?')
    .bind(familyId, prevYm)
    .first<MonthlyBalanceRow>()
  let previousBalance = typeof previousBalanceRow?.balance === 'number' ? previousBalanceRow.balance : 0

  const updates: { ym: string; balance: number; is_closed: number }[] = []

  for (let index = startIndex; index <= endIndex; index += 1) {
    const ym = formatYmFromIndex(index)
    const { start, end } = monthRangeFromYm(ym)
    const totals = await db
      .prepare(
        'SELECT entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ? GROUP BY entry_type'
      )
      .bind(familyId, start, end)
      .all<EntryTotalRow>()

    let income = 0
    let expense = 0
    totals.results?.forEach((row) => {
      if (row.entry_type === 'income') {
        income = Number(row.total) || 0
      } else if (row.entry_type === 'expense') {
        expense = Number(row.total) || 0
      }
    })

    const balance = previousBalance + income - expense
    const existing = await db
      .prepare('SELECT is_closed FROM monthly_balance WHERE family_id = ? AND ym = ?')
      .bind(familyId, ym)
      .first<MonthlyBalanceRow>()
    const isClosed = existing?.is_closed === 1 ? 1 : 0
    const updatedAt = nowIso()
    const roundedBalance = Math.round(balance)

    await db
      .prepare(
        'INSERT INTO monthly_balance (family_id, ym, balance, is_closed, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(family_id, ym) DO UPDATE SET balance = excluded.balance, is_closed = ?, updated_at = excluded.updated_at'
      )
      .bind(familyId, ym, roundedBalance, isClosed, updatedAt, isClosed)
      .run()

    await recordChange(db, familyId, 'monthly_balance', ym, 'upsert', {
      monthly_balance: { ym, balance: roundedBalance, is_closed: isClosed, updated_at: updatedAt },
    })

    updates.push({ ym, balance: roundedBalance, is_closed: isClosed })
    previousBalance = roundedBalance
  }

  return updates
}

const runMonthStartBalanceUpdate = async (db: D1Database, now = new Date()) => {
  const tokyo = toTokyoDate(now)
  if (tokyo.getUTCDate() !== 1) return

  const currentYm = formatTokyoYm(now)
  const prevYm = addMonthsToYm(currentYm, -1)

  const familyIds = new Set<string>()
  const entryFamilies = await db.prepare('SELECT DISTINCT family_id FROM entries').all<{ family_id: string }>()
  entryFamilies.results?.forEach((row) => {
    if (row.family_id) familyIds.add(row.family_id)
  })
  const balanceFamilies = await db.prepare('SELECT DISTINCT family_id FROM monthly_balance').all<{ family_id: string }>()
  balanceFamilies.results?.forEach((row) => {
    if (row.family_id) familyIds.add(row.family_id)
  })

  for (const familyId of familyIds) {
    await recalcMonthlyBalances(db, familyId, prevYm)
  }
}

const shouldGenerateRule = (rule: RecurringRuleRow, targetTokyo: Date, targetDate: string) => {
  const isActive = rule.is_active === null ? true : rule.is_active === 1
  if (!isActive) return false

  const startTokyo = toTokyoDate(parseDateValue(rule.start_at))
  const startDate = formatTokyoDate(startTokyo)
  if (targetDate < startDate) return false

  if (rule.end_at) {
    const endDate = formatTokyoDate(toTokyoDate(parseDateValue(rule.end_at)))
    if (targetDate > endDate) return false
  }

  const frequency = rule.frequency ?? 'monthly'
  let baseDate: Date | null = null

  if (frequency === 'weekly') {
    const ruleWeekday =
      rule.day_of_month !== null && rule.day_of_month >= 0 && rule.day_of_month <= 6
        ? rule.day_of_month
        : startTokyo.getUTCDay()
    const diff = ruleWeekday - targetTokyo.getUTCDay()
    baseDate = new Date(Date.UTC(targetTokyo.getUTCFullYear(), targetTokyo.getUTCMonth(), targetTokyo.getUTCDate() + diff))
  } else if (frequency === 'bimonthly') {
    const monthDiff =
      (targetTokyo.getUTCFullYear() - startTokyo.getUTCFullYear()) * 12 +
      (targetTokyo.getUTCMonth() - startTokyo.getUTCMonth())
    if (monthDiff < 0 || monthDiff % 2 !== 0) return false
    const dueDay = getDueDay(targetTokyo, rule.day_of_month, startTokyo)
    baseDate = new Date(Date.UTC(targetTokyo.getUTCFullYear(), targetTokyo.getUTCMonth(), dueDay))
  } else if (frequency === 'yearly') {
    if (targetTokyo.getUTCMonth() !== startTokyo.getUTCMonth()) return false
    const dueDay = getDueDay(targetTokyo, rule.day_of_month, startTokyo)
    baseDate = new Date(Date.UTC(targetTokyo.getUTCFullYear(), targetTokyo.getUTCMonth(), dueDay))
  } else {
    const dueDay = getDueDay(targetTokyo, rule.day_of_month, startTokyo)
    baseDate = new Date(Date.UTC(targetTokyo.getUTCFullYear(), targetTokyo.getUTCMonth(), dueDay))
  }

  if (!baseDate) return false
  const baseDateStr = formatTokyoDate(baseDate)
  if (baseDateStr < startDate) return false
  if (rule.end_at) {
    const endDate = formatTokyoDate(toTokyoDate(parseDateValue(rule.end_at)))
    if (baseDateStr > endDate) return false
  }

  const adjusted = adjustForWeekend(baseDate, normalizeHolidayAdjustment(rule.holiday_adjustment))
  return formatTokyoDate(adjusted) === targetDate
}

const generateRecurringEntries = async (db: D1Database, baseDate = new Date()) => {
  const targetTokyo = toTokyoDate(baseDate)
  const targetDate = formatTokyoDate(targetTokyo)
  const occurredAt = new Date(`${targetDate}T00:00:00+09:00`).toISOString()
  const targetYm = getYmFromDate(targetDate)

  const { results } = await db
    .prepare('SELECT * FROM recurring_rules WHERE is_active = 1')
    .all<RecurringRuleRow>()

  if (!results?.length) return

  const affectedFamilies = new Map<string, string>()

  for (const rule of results) {
    if (!shouldGenerateRule(rule, targetTokyo, targetDate)) continue

    const id = crypto.randomUUID()
    const createdAt = nowIso()
    const updatedAt = createdAt

    const result = await db
      .prepare(
        'INSERT OR IGNORE INTO entries (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, occurred_at, occurred_on, recurring_rule_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        id,
        rule.family_id,
        rule.entry_type,
        Math.round(rule.amount),
        rule.entry_category_id,
        rule.payment_method_id,
        rule.memo,
        occurredAt,
        targetDate,
        rule.id,
        createdAt,
        updatedAt
      )
      .run()

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0
    if (changes > 0) {
      await recordAudit(db, rule.family_id, 'system', 'create', 'entries', id, `recurring ${rule.id}`)
      await recordChange(db, rule.family_id, 'entries', id, 'upsert', {
        entry: {
          id,
          family_id: rule.family_id,
          entry_type: rule.entry_type,
          amount: Math.round(rule.amount),
          entry_category_id: rule.entry_category_id,
          payment_method_id: rule.payment_method_id,
          memo: rule.memo,
          occurred_at: occurredAt,
          occurred_on: targetDate,
          recurring_rule_id: rule.id,
          created_at: createdAt,
          updated_at: updatedAt,
        },
      })
      const existing = affectedFamilies.get(rule.family_id)
      if (!existing || ymToIndex(targetYm) < ymToIndex(existing)) {
        affectedFamilies.set(rule.family_id, targetYm)
      }
    }
  }

  for (const [familyId, startYm] of affectedFamilies.entries()) {
    await recalcMonthlyBalances(db, familyId, startYm)
  }
}

const isEntryType = (value: unknown): value is 'income' | 'expense' => {
  return value === 'income' || value === 'expense'
}

const readJson = async <T>(c: Context<HonoEnv>) => {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}

const recordAudit = async (
  db: D1Database,
  familyId: string,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  summary?: string
) => {
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  await db
    .prepare(
      'INSERT INTO audit_logs (id, family_id, actor_user_id, action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, familyId, actorUserId, action, targetType, targetId, summary ?? null, createdAt)
    .run()
}

const recordChange = async (
  db: D1Database,
  familyId: string,
  entityType: string,
  entityId: string,
  action: 'upsert' | 'delete',
  payload?: Record<string, unknown> | null
) => {
  const createdAt = nowIso()
  await db
    .prepare(
      'INSERT INTO change_logs (family_id, entity_type, entity_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(familyId, entityType, entityId, action, payload ? JSON.stringify(payload) : null, createdAt)
    .run()
}

app.get('/health', (c) => c.json({ ok: true }))

app.get('/sync', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('Unauthorized', 401), 401)

  const cursor = Math.max(0, Number(c.req.query('cursor') ?? 0))
  const limit = Math.max(0, Math.min(500, Number(c.req.query('limit') ?? 200)))
  const serverTime = nowIso()

  if (limit === 0) {
    const latest = await c.env.DB
      .prepare('SELECT MAX(id) as max_id FROM change_logs WHERE family_id = ?')
      .bind(familyId)
      .first<{ max_id?: number | null }>()
    const nextCursor = typeof latest?.max_id === 'number' ? latest.max_id : cursor
    return c.json({ changes: [], next_cursor: nextCursor, server_time: serverTime })
  }

  const { results } = await c.env.DB
    .prepare(
      'SELECT id, entity_type, entity_id, action, payload, created_at FROM change_logs WHERE family_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
    )
    .bind(familyId, cursor, limit)
    .all<ChangeLogRow>()

  const changes = (results ?? []).map((row) => ({
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    payload: row.payload ? JSON.parse(row.payload) : null,
    created_at: row.created_at,
  }))
  const nextCursor = changes.length ? changes[changes.length - 1].id : cursor
  return c.json({ changes, next_cursor: nextCursor, server_time: serverTime })
})

app.get('/entries', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const since = c.req.query('since')
  const db = c.env.DB

  const query = since
    ? db
        .prepare(
          'SELECT * FROM entries WHERE family_id = ? AND updated_at > ? ORDER BY occurred_at DESC, updated_at DESC'
        )
        .bind(familyId, since)
    : db
        .prepare('SELECT * FROM entries WHERE family_id = ? ORDER BY occurred_at DESC, updated_at DESC')
        .bind(familyId)

  const { results } = await query.all()
  return c.json({ entries: results ?? [] })
})

app.post('/entries', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const entryType = payload.entry_type
  const amount = payload.amount
  if (!isEntryType(entryType) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return c.json(jsonError('entry_type and amount are required'), 400)
  }

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const memo = typeof payload.memo === 'string' ? payload.memo : null
  const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : nowIso()
  const occurredOn = formatOccurredOn(occurredAt)
  const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
  const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
  const recurringRuleId = typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : null
  const clientUpdatedAt = typeof payload.client_updated_at === 'string' ? payload.client_updated_at : null
  const createdAt = nowIso()
  const updatedAt = nowIso()

  const db = c.env.DB
  const existing = await db
    .prepare('SELECT occurred_on, updated_at FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  const conflict = !!(existing?.updated_at && clientUpdatedAt && existing.updated_at !== clientUpdatedAt)

  await db
    .prepare(
      'INSERT INTO entries (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, occurred_at, occurred_on, recurring_rule_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, occurred_at = excluded.occurred_at, occurred_on = excluded.occurred_on, recurring_rule_id = excluded.recurring_rule_id, updated_at = excluded.updated_at'
    )
    .bind(
      id,
      familyId,
      entryType,
      Math.round(amount),
      entryCategoryId,
      paymentMethodId,
      memo,
      occurredAt,
      occurredOn,
      recurringRuleId,
      createdAt,
      updatedAt
    )
    .run()

  await recordAudit(
    db,
    familyId,
    getActorUserId(c),
    existing ? 'update' : 'create',
    'entries',
    id,
    `entry ${entryType} ${amount}`
  )

  const startYm = existing?.occurred_on
    ? minYm(getYmFromDate(existing.occurred_on), getYmFromDate(occurredOn))
    : getYmFromDate(occurredOn)
  await recalcMonthlyBalances(db, familyId, startYm)

  const entry = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (entry) {
    await recordChange(db, familyId, 'entries', id, 'upsert', { entry })
  }

  return c.json({ entry, conflict })
})

app.patch('/entries/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const id = c.req.param('id')
  const db = c.env.DB
  const existing = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (!existing) return c.json(jsonError('Entry not found', 404), 404)

  const entryType = isEntryType(payload.entry_type) ? payload.entry_type : existing.entry_type
  const amount =
    typeof payload.amount === 'number' && Number.isFinite(payload.amount) && payload.amount > 0
      ? Math.round(payload.amount)
      : existing.amount
  const memo = typeof payload.memo === 'string' ? payload.memo : existing.memo
  const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : existing.occurred_at
  const occurredOn = formatOccurredOn(occurredAt)
  const entryCategoryId =
    typeof payload.entry_category_id === 'string' ? payload.entry_category_id : existing.entry_category_id
  const paymentMethodId =
    typeof payload.payment_method_id === 'string' ? payload.payment_method_id : existing.payment_method_id
  const recurringRuleId =
    typeof payload.recurring_rule_id === 'string' ? payload.recurring_rule_id : existing.recurring_rule_id
  const clientUpdatedAt = typeof payload.client_updated_at === 'string' ? payload.client_updated_at : null
  const updatedAt = nowIso()

  const conflict = !!(existing.updated_at && clientUpdatedAt && existing.updated_at !== clientUpdatedAt)

  await db
    .prepare(
      'UPDATE entries SET entry_type = ?, amount = ?, entry_category_id = ?, payment_method_id = ?, memo = ?, occurred_at = ?, occurred_on = ?, recurring_rule_id = ?, updated_at = ? WHERE id = ? AND family_id = ?'
    )
    .bind(
      entryType,
      amount,
      entryCategoryId,
      paymentMethodId,
      memo,
      occurredAt,
      occurredOn,
      recurringRuleId,
      updatedAt,
      id,
      familyId
    )
    .run()

  await recordAudit(db, familyId, getActorUserId(c), 'update', 'entries', id, `entry ${entryType} ${amount}`)

  const startYm = minYm(getYmFromDate(existing.occurred_on), getYmFromDate(occurredOn))
  await recalcMonthlyBalances(db, familyId, startYm)

  const entry = await db
    .prepare('SELECT * FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (entry) {
    await recordChange(db, familyId, 'entries', id, 'upsert', { entry })
  }

  return c.json({ entry, conflict })
})

app.delete('/entries/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  const db = c.env.DB

  const existing = await db
    .prepare('SELECT occurred_on FROM entries WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first<{ occurred_on?: string }>()

  await db.prepare('DELETE FROM entries WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(db, familyId, getActorUserId(c), 'delete', 'entries', id)
  await recordChange(db, familyId, 'entries', id, 'delete', { id })

  if (existing?.occurred_on) {
    const startYm = getYmFromDate(existing.occurred_on)
    await recalcMonthlyBalances(db, familyId, startYm)
  }

  return c.json({ ok: true })
})

app.get('/entry-categories', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM entry_categories WHERE family_id = ? ORDER BY sort_order, name')
    .bind(familyId)
    .all()
  return c.json({ entry_categories: results ?? [] })
})

app.post('/entry-categories', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
  const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : null
  const iconKey = typeof payload.icon_key === 'string' ? payload.icon_key : null
  const color = typeof payload.color === 'string' ? payload.color : null
  if (!name || !type) return c.json(jsonError('name and type are required'), 400)

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO entry_categories (id, family_id, name, type, icon_key, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, icon_key = excluded.icon_key, color = excluded.color, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
    )
    .bind(id, familyId, name, type, iconKey, color, sortOrder, createdAt, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'entry_categories', id, name)

  const entryCategory = await c.env.DB
    .prepare('SELECT * FROM entry_categories WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (entryCategory) {
    await recordChange(c.env.DB, familyId, 'entry_categories', id, 'upsert', { entry_category: entryCategory })
  }

  return c.json({ entry_category: entryCategory })
})

app.delete('/entry-categories/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM entry_categories WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'entry_categories', id)
  await recordChange(c.env.DB, familyId, 'entry_categories', id, 'delete', { id })
  return c.json({ ok: true })
})

app.get('/payment-methods', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM payment_methods WHERE family_id = ? ORDER BY sort_order, name')
    .bind(familyId)
    .all()
  return c.json({ payment_methods: results ?? [] })
})

app.post('/payment-methods', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
  const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : null
  if (!name || !type) return c.json(jsonError('name and type are required'), 400)

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const sortOrder = typeof payload.sort_order === 'number' ? Math.round(payload.sort_order) : 0
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO payment_methods (id, family_id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
    )
    .bind(id, familyId, name, type, sortOrder, createdAt, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'payment_methods', id, name)

  const paymentMethod = await c.env.DB
    .prepare('SELECT * FROM payment_methods WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (paymentMethod) {
    await recordChange(c.env.DB, familyId, 'payment_methods', id, 'upsert', { payment_method: paymentMethod })
  }

  return c.json({ payment_method: paymentMethod })
})

app.delete('/payment-methods/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM payment_methods WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'payment_methods', id)
  await recordChange(c.env.DB, familyId, 'payment_methods', id, 'delete', { id })
  return c.json({ ok: true })
})

app.get('/recurring-rules', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM recurring_rules WHERE family_id = ? ORDER BY created_at DESC')
    .bind(familyId)
    .all()
  return c.json({ recurring_rules: results ?? [] })
})

app.post('/recurring-rules', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  if (!isEntryType(payload.entry_type) || typeof payload.amount !== 'number' || payload.amount <= 0) {
    return c.json(jsonError('entry_type and amount are required'), 400)
  }

  const id = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const entryCategoryId = typeof payload.entry_category_id === 'string' ? payload.entry_category_id : null
  const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null
  const memo = typeof payload.memo === 'string' ? payload.memo : null
  const frequency = typeof payload.frequency === 'string' ? payload.frequency : 'monthly'
  const dayOfMonth = typeof payload.day_of_month === 'number' ? Math.round(payload.day_of_month) : null
  const holidayAdjustment =
    payload.holiday_adjustment === 'previous' || payload.holiday_adjustment === 'next'
      ? payload.holiday_adjustment
      : 'none'
  const startAt = typeof payload.start_at === 'string' ? payload.start_at : nowIso()
  const endAt = typeof payload.end_at === 'string' ? payload.end_at : null
  const isActive = typeof payload.is_active === 'boolean' ? payload.is_active : true
  const createdAt = nowIso()
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO recurring_rules (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, frequency, day_of_month, holiday_adjustment, start_at, end_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_type = excluded.entry_type, amount = excluded.amount, entry_category_id = excluded.entry_category_id, payment_method_id = excluded.payment_method_id, memo = excluded.memo, frequency = excluded.frequency, day_of_month = excluded.day_of_month, holiday_adjustment = excluded.holiday_adjustment, start_at = excluded.start_at, end_at = excluded.end_at, is_active = excluded.is_active, updated_at = excluded.updated_at'
    )
    .bind(
      id,
      familyId,
      payload.entry_type,
      Math.round(payload.amount),
      entryCategoryId,
      paymentMethodId,
      memo,
      frequency,
      dayOfMonth,
      holidayAdjustment,
      startAt,
      endAt,
      isActive ? 1 : 0,
      createdAt,
      updatedAt
    )
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'recurring_rules', id, memo ?? '')

  const recurringRule = await c.env.DB
    .prepare('SELECT * FROM recurring_rules WHERE id = ? AND family_id = ?')
    .bind(id, familyId)
    .first()

  if (recurringRule) {
    await recordChange(c.env.DB, familyId, 'recurring_rules', id, 'upsert', { recurring_rule: recurringRule })
  }

  return c.json({ recurring_rule: recurringRule })
})

app.delete('/recurring-rules/:id', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM recurring_rules WHERE id = ? AND family_id = ?').bind(id, familyId).run()
  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'delete', 'recurring_rules', id)
  await recordChange(c.env.DB, familyId, 'recurring_rules', id, 'delete', { id })
  return c.json({ ok: true })
})

app.get('/monthly-balance', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)
  const ym = c.req.query('ym')
  if (!ym) return c.json(jsonError('ym is required'), 400)

  const balance = await c.env.DB
    .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym = ?')
    .bind(familyId, ym)
    .first()

  return c.json({ monthly_balance: balance })
})

app.get('/monthly-balances', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json(jsonError('from/to is required'), 400)
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return c.json(jsonError('from/to must be YYYY-MM'), 400)
  }

  const balances = await c.env.DB
    .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym >= ? AND ym <= ? ORDER BY ym')
    .bind(familyId, from, to)
    .all()

  return c.json({ monthly_balances: balances.results ?? [] })
})

app.put('/monthly-balance/:ym', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const ym = c.req.param('ym')
  const payload = await readJson<Record<string, unknown>>(c)
  if (!payload) return c.json(jsonError('Invalid JSON'), 400)

  const balance = typeof payload.balance === 'number' ? Math.round(payload.balance) : null
  if (balance === null) return c.json(jsonError('balance is required'), 400)
  const isClosed = typeof payload.is_closed === 'boolean' ? payload.is_closed : false
  const updatedAt = nowIso()

  await c.env.DB
    .prepare(
      'INSERT INTO monthly_balance (family_id, ym, balance, is_closed, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(family_id, ym) DO UPDATE SET balance = excluded.balance, is_closed = excluded.is_closed, updated_at = excluded.updated_at'
    )
    .bind(familyId, ym, balance, isClosed ? 1 : 0, updatedAt)
    .run()

  await recordAudit(c.env.DB, familyId, getActorUserId(c), 'update', 'monthly_balance', ym)

  const monthlyBalance = await c.env.DB
    .prepare('SELECT * FROM monthly_balance WHERE family_id = ? AND ym = ?')
    .bind(familyId, ym)
    .first()

  return c.json({ monthly_balance: monthlyBalance })
})

const rangeFrom = (range: string) => {
  const tokyo = toTokyoDate()
  if (range === 'week') {
    const day = tokyo.getUTCDay()
    const offset = (day + 6) % 7
    tokyo.setUTCDate(tokyo.getUTCDate() - offset)
    tokyo.setUTCHours(0, 0, 0, 0)
  } else if (range === 'month') {
    tokyo.setUTCDate(1)
    tokyo.setUTCHours(0, 0, 0, 0)
  } else if (range === 'year') {
    tokyo.setUTCMonth(0, 1)
    tokyo.setUTCHours(0, 0, 0, 0)
  }
  return tokyo
}

const addRange = (start: Date, range: string) => {
  const next = new Date(start.getTime())
  if (range === 'week') {
    next.setUTCDate(next.getUTCDate() + 7)
  } else if (range === 'month') {
    next.setUTCMonth(next.getUTCMonth() + 1)
  } else if (range === 'year') {
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  }
  return next
}

app.get('/reports', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const range = c.req.query('range') ?? 'month'
  const fromQuery = c.req.query('from')
  const toQuery = c.req.query('to')
  const recurringOnly = c.req.query('recurring') === '1'

  let from = fromQuery
  let to = toQuery

  if (!from || !to) {
    const start = rangeFrom(range)
    const end = addRange(start, range)
    from = formatTokyoDate(start)
    to = formatTokyoDate(end)
  }

  const db = c.env.DB
  const recurringFilter = recurringOnly ? ' AND recurring_rule_id IS NOT NULL' : ''
  const totals = await db
    .prepare(
      `SELECT entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ?${recurringFilter} GROUP BY entry_type`
    )
    .bind(familyId, from, to)
    .all()

  const categories = await db
    .prepare(
      `SELECT entry_category_id, entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ?${recurringFilter} GROUP BY entry_category_id, entry_type`
    )
    .bind(familyId, from, to)
    .all()

  const series = await db
    .prepare(
      `SELECT occurred_on as day, entry_type, SUM(amount) as total FROM entries WHERE family_id = ? AND occurred_on >= ? AND occurred_on < ?${recurringFilter} GROUP BY day, entry_type ORDER BY day`
    )
    .bind(familyId, from, to)
    .all()

  return c.json({
    range,
    from,
    to,
    totals: totals.results ?? [],
    categories: categories.results ?? [],
    series: series.results ?? [],
  })
})

app.get('/audit-logs', async (c) => {
  const familyId = requireFamilyId(c)
  if (!familyId) return c.json(jsonError('X-Family-Id is required'), 400)

  const limit = Math.min(200, Number(c.req.query('limit') ?? 50))
  const { results } = await c.env.DB
    .prepare('SELECT * FROM audit_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(familyId, limit)
    .all()
  return c.json({ audit_logs: results ?? [] })
})

app.notFound((c) => c.json({ message: 'Not found' }, 404))

export default {
  fetch: app.fetch,
  scheduled: (event: { scheduledTime?: number }, env: Bindings, ctx: ExecutionContext) => {
    const scheduledTime = typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now()
    const scheduledDate = new Date(scheduledTime)
    ctx.waitUntil(generateRecurringEntries(env.DB, scheduledDate))
    ctx.waitUntil(runMonthStartBalanceUpdate(env.DB, scheduledDate))
  },
}
