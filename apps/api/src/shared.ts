import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type {
  AllowedUserRow,
  AppContext,
  Bindings,
  EntryTotalRow,
  MonthlyBalanceRow,
  MutationReceiptRow,
  OAuthStateRow,
  RecurringRuleRow,
  SessionRow,
  UserRow,
} from './types'

export const SESSION_COOKIE = 'kakeibo_session'
export const SESSION_TTL_DAYS = 30
export const OAUTH_STATE_TTL_MINUTES = 10
const MUTATION_RECEIPT_TTL_DAYS = 7

export const parseAllowedOrigins = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

export const resolveCorsOrigin = (origin: string | undefined, env: Bindings) => {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
  if (!origin) return allowed[0] ?? ''
  if (allowed.length === 0) return origin
  return allowed.includes(origin) ? origin : allowed[0] ?? ''
}

export const isAllowedOrigin = (origin: string | null, env: Bindings) => {
  if (!origin) return false
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
  if (allowed.length === 0) return true
  return allowed.includes(origin)
}

export const jsonError = (message: string, status = 400) => ({ message, status })

export const buildExpiryIso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

const isLocalRequest = (url: string) => {
  return url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')
}

export const setSessionCookie = (c: AppContext, sessionId: string) => {
  const local = isLocalRequest(c.req.url)
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: local ? 'Lax' : 'None',
    secure: !local,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export const clearSessionCookie = (c: AppContext) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export const loadSession = async (c: AppContext) => {
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

export const requireFamilyId = (c: AppContext) => {
  const session = c.get('session')
  if (!session?.family_id) return null
  return session.family_id
}

export const getActorUserId = (c: AppContext) => c.get('session')?.user_id ?? 'unknown'

export const nowIso = () => new Date().toISOString()

export const toTokyoDate = (date = new Date()) => {
  const ms = date.getTime() + 9 * 60 * 60 * 1000
  return new Date(ms)
}

export const formatTokyoDate = (date: Date) => {
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

export const formatOccurredOn = (occurredAt?: string | null) => {
  const date = parseDateValue(occurredAt)
  return formatTokyoDate(toTokyoDate(date))
}

const formatTokyoYm = (date = new Date()) => {
  const tokyo = toTokyoDate(date)
  const year = tokyo.getUTCFullYear()
  const month = `${tokyo.getUTCMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

export const isSameValue = (left: unknown, right: unknown) => {
  return (left ?? null) === (right ?? null)
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

export const createSession = async (
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

export const ensureUser = async (db: D1Database, user: UserRow) => {
  const now = nowIso()
  await db
    .prepare(
      'INSERT INTO users (id, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at'
    )
    .bind(user.id, user.email, user.name, user.avatar_url, now, now)
    .run()
}

export const loadAllowedUser = async (db: D1Database, email: string) => {
  return db
    .prepare('SELECT * FROM allowed_users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<AllowedUserRow>()
}

export const ensureFamilyForAllowedUser = async (
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

export const buildGoogleAuthUrl = (clientId: string, redirectUri: string, state: string) => {
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

export const exchangeGoogleCode = async (
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
  if (!response.ok) return null
  return (await response.json()) as { id_token?: string }
}

export const fetchTokenInfo = async (idToken: string) => {
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

export const recalcMonthlyBalances = async (db: D1Database, familyId: string, startYm: string) => {
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

export const runMonthStartBalanceUpdate = async (db: D1Database, now = new Date()) => {
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

export const generateRecurringEntries = async (db: D1Database, baseDate = new Date()) => {
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

export const isEntryType = (value: unknown): value is 'income' | 'expense' => {
  return value === 'income' || value === 'expense'
}

export const readJson = async <T>(c: AppContext) => {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}

export const recordAudit = async (
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

export const recordChange = async (
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

export const rangeFrom = (range: string) => {
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

export const addRange = (start: Date, range: string) => {
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

export const getMutationRequestId = (c: AppContext) => {
  const id = c.req.header('X-Outbox-Id')?.trim()
  return id && id.length > 0 ? id : null
}

export const loadMutationReceipt = async (
  db: D1Database,
  requestId: string
): Promise<MutationReceiptRow | null> => {
  const receipt = await db
    .prepare('SELECT * FROM mutation_receipts WHERE request_id = ?')
    .bind(requestId)
    .first<MutationReceiptRow>()
  if (!receipt) return null

  if (new Date(receipt.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM mutation_receipts WHERE request_id = ?').bind(requestId).run()
    return null
  }

  return receipt
}

export const storeMutationReceipt = async (
  db: D1Database,
  params: {
    requestId: string
    familyId: string
    endpoint: string
    method: string
    status: number
    responseBody: Record<string, unknown>
  }
) => {
  const createdAt = nowIso()
  const expiresAt = buildExpiryIso(MUTATION_RECEIPT_TTL_DAYS)
  await db
    .prepare(
      'INSERT OR REPLACE INTO mutation_receipts (request_id, family_id, endpoint, method, status, response_body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      params.requestId,
      params.familyId,
      params.endpoint,
      params.method,
      params.status,
      JSON.stringify(params.responseBody),
      createdAt,
      expiresAt
    )
    .run()
}

export const parseMutationReceiptBody = (receipt: MutationReceiptRow) => {
  try {
    const parsed = JSON.parse(receipt.response_body) as Record<string, unknown>
    return parsed
  } catch {
    return { message: 'stored receipt body parse failed', status: receipt.status }
  }
}

export const cleanupMutationReceipts = async (db: D1Database, now = nowIso()) => {
  await db.prepare('DELETE FROM mutation_receipts WHERE expires_at <= ?').bind(now).run()
}

export const loadOAuthState = async (db: D1Database, id: string) => {
  return db
    .prepare('SELECT * FROM oauth_states WHERE id = ?')
    .bind(id)
    .first<OAuthStateRow>()
}

export const removeOAuthState = async (db: D1Database, id: string) => {
  await db.prepare('DELETE FROM oauth_states WHERE id = ?').bind(id).run()
}

export const minYmFromDates = (a: string, b: string) => minYm(getYmFromDate(a), getYmFromDate(b))
export const ymFromOccurredOn = (value: string) => getYmFromDate(value)
