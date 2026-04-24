import type { Hono } from 'hono'
import type { AppContext, HonoEnv, OAuthStateRow, UserRow } from '../types'
import {
  OAUTH_STATE_TTL_MINUTES,
  buildGoogleAuthUrl,
  createSession,
  ensureFamilyForAllowedUser,
  ensureUser,
  exchangeGoogleCode,
  fetchTokenInfo,
  isDevAuthBypassEnabled,
  isAllowedOrigin,
  jsonError,
  loadAllowedUser,
  loadSession,
  nowIso,
  recordChange,
  recalcMonthlyBalances,
  setSessionCookie,
  clearSessionCookie,
} from '../shared'

const DEV_USER = {
  id: 'dev-user',
  email: 'dev@example.local',
  name: 'Dev User',
  avatar_url: null,
}
const DEV_FAMILY_ID = 'family-dev'

const DEV_CATEGORY_SEEDS = [
  { id: 'dev-cat-expense-food', name: '食費', type: 'expense', icon_key: 'restaurant', color: '#d9554c', sort_order: 10 },
  { id: 'dev-cat-expense-dining', name: '外食', type: 'expense', icon_key: 'lunch_dining', color: '#ff9800', sort_order: 20 },
  { id: 'dev-cat-expense-daily', name: '日用品', type: 'expense', icon_key: 'local_grocery_store', color: '#8bc34a', sort_order: 30 },
  { id: 'dev-cat-expense-transport', name: '交通', type: 'expense', icon_key: 'train', color: '#2196f3', sort_order: 40 },
  { id: 'dev-cat-expense-home', name: '住居', type: 'expense', icon_key: 'home', color: '#607d8b', sort_order: 50 },
  { id: 'dev-cat-expense-utilities', name: '通信・光熱', type: 'expense', icon_key: 'subscriptions', color: '#5c6bc0', sort_order: 60 },
  { id: 'dev-cat-expense-medical', name: '医療', type: 'expense', icon_key: 'medical_services', color: '#e91e63', sort_order: 70 },
  { id: 'dev-cat-expense-hobby', name: '趣味', type: 'expense', icon_key: 'movie', color: '#795548', sort_order: 80 },
  { id: 'dev-cat-expense-clothes', name: '服飾', type: 'expense', icon_key: 'checkroom', color: '#00bcd4', sort_order: 90 },
  { id: 'dev-cat-expense-social', name: '交際費', type: 'expense', icon_key: 'volunteer_activism', color: '#ff1744', sort_order: 100 },
  { id: 'dev-cat-income-salary', name: '給与', type: 'income', icon_key: 'payments', color: '#2f8f9d', sort_order: 10 },
  { id: 'dev-cat-income-side', name: '副収入', type: 'income', icon_key: 'savings', color: '#2f6db4', sort_order: 20 },
  { id: 'dev-cat-income-bonus', name: 'ボーナス', type: 'income', icon_key: 'redeem', color: '#5c6bc0', sort_order: 30 },
] as const

const DEV_PAYMENT_METHOD_SEEDS = [
  { id: 'dev-pay-cash-wallet', name: '現金', type: 'cash', icon_key: 'payments', color: '#8a6b55', sort_order: 10 },
  { id: 'dev-pay-bank-smbc', name: '三井住友銀行', type: 'bank', icon_key: 'account_balance', color: '#2f6db4', sort_order: 20 },
  { id: 'dev-pay-bank-sbi', name: '住信SBIネット銀行', type: 'bank', icon_key: 'savings', color: '#21666f', sort_order: 30 },
  {
    id: 'dev-pay-card-rakuten',
    name: '楽天カード',
    type: 'card',
    icon_key: 'credit_card',
    color: '#3a4bb8',
    card_closing_day: 20,
    card_payment_day: 10,
    funding_source_payment_method_id: 'dev-pay-bank-smbc',
    linked_bank_payment_method_id: 'dev-pay-bank-smbc',
    sort_order: 40,
  },
  {
    id: 'dev-pay-card-jcb',
    name: 'JCB CARD W',
    type: 'card',
    icon_key: 'credit_card',
    color: '#42558c',
    card_closing_day: 25,
    card_payment_day: 12,
    funding_source_payment_method_id: 'dev-pay-bank-sbi',
    linked_bank_payment_method_id: 'dev-pay-bank-sbi',
    sort_order: 50,
  },
  {
    id: 'dev-pay-card-view',
    name: 'ビューカード',
    type: 'card',
    icon_key: 'credit_card',
    color: '#6d7aa8',
    card_closing_day: 15,
    card_payment_day: 5,
    funding_source_payment_method_id: null,
    linked_bank_payment_method_id: null,
    sort_order: 60,
  },
  {
    id: 'dev-pay-postpaid-paidy',
    name: 'Paidy',
    type: 'postpaid',
    icon_key: 'receipt_long',
    color: '#6d5bd0',
    card_closing_day: 31,
    card_payment_day: 27,
    funding_source_payment_method_id: 'dev-pay-bank-smbc',
    linked_bank_payment_method_id: 'dev-pay-bank-smbc',
    sort_order: 65,
  },
  {
    id: 'dev-pay-emoney-suica',
    name: 'モバイルSuica',
    type: 'emoney',
    icon_key: 'account_balance_wallet',
    color: '#2f8f9d',
    funding_source_payment_method_id: 'dev-pay-card-rakuten',
    sort_order: 70,
  },
] as const

const DEV_ENTRY_SEEDS = [
  {
    id: 'dev-entry-bank-salary-20260401',
    entry_type: 'income',
    amount: 280000,
    entry_category_id: 'dev-cat-income-salary',
    payment_method_id: 'dev-pay-bank-smbc',
    memo: '4月 給与',
    occurred_at: '2026-04-01T09:00:00.000Z',
    occurred_on: '2026-04-01',
  },
  {
    id: 'dev-entry-bank-rent-20260402',
    entry_type: 'expense',
    amount: 82000,
    entry_category_id: 'dev-cat-expense-home',
    payment_method_id: 'dev-pay-bank-smbc',
    memo: '家賃',
    occurred_at: '2026-04-02T09:00:00.000Z',
    occurred_on: '2026-04-02',
  },
  {
    id: 'dev-entry-bank-bonus-20260404',
    entry_type: 'income',
    amount: 210000,
    entry_category_id: 'dev-cat-income-bonus',
    payment_method_id: 'dev-pay-bank-sbi',
    memo: '特別入金',
    occurred_at: '2026-04-04T01:30:00.000Z',
    occurred_on: '2026-04-04',
  },
  {
    id: 'dev-entry-bank-side-20260418',
    entry_type: 'income',
    amount: 24000,
    entry_category_id: 'dev-cat-income-side',
    payment_method_id: 'dev-pay-bank-smbc',
    memo: '副収入',
    occurred_at: '2026-04-18T12:00:00.000Z',
    occurred_on: '2026-04-18',
  },
  {
    id: 'dev-entry-bank-home-20260408',
    entry_type: 'expense',
    amount: 18000,
    entry_category_id: 'dev-cat-expense-home',
    payment_method_id: 'dev-pay-bank-sbi',
    memo: '住宅費',
    occurred_at: '2026-04-08T09:20:00.000Z',
    occurred_on: '2026-04-08',
  },
  {
    id: 'dev-entry-card-rakuten-food-20260405',
    entry_type: 'expense',
    amount: 4280,
    entry_category_id: 'dev-cat-expense-food',
    payment_method_id: 'dev-pay-card-rakuten',
    memo: 'スーパー',
    occurred_at: '2026-04-05T10:30:00.000Z',
    occurred_on: '2026-04-05',
  },
  {
    id: 'dev-entry-card-rakuten-lunch-20260406',
    entry_type: 'expense',
    amount: 1260,
    entry_category_id: 'dev-cat-expense-dining',
    payment_method_id: 'dev-pay-card-rakuten',
    memo: 'ランチ',
    occurred_at: '2026-04-06T03:15:00.000Z',
    occurred_on: '2026-04-06',
  },
  {
    id: 'dev-entry-card-rakuten-utilities-20260410',
    entry_type: 'expense',
    amount: 11800,
    entry_category_id: 'dev-cat-expense-utilities',
    payment_method_id: 'dev-pay-card-rakuten',
    memo: '電気・通信',
    occurred_at: '2026-04-10T11:00:00.000Z',
    occurred_on: '2026-04-10',
  },
  {
    id: 'dev-entry-card-rakuten-pharmacy-20260412',
    entry_type: 'expense',
    amount: 1560,
    entry_category_id: 'dev-cat-expense-medical',
    payment_method_id: 'dev-pay-card-rakuten',
    memo: '薬局',
    occurred_at: '2026-04-12T06:45:00.000Z',
    occurred_on: '2026-04-12',
  },
  {
    id: 'dev-entry-card-rakuten-daily-20260419',
    entry_type: 'expense',
    amount: 9300,
    entry_category_id: 'dev-cat-expense-daily',
    payment_method_id: 'dev-pay-card-rakuten',
    memo: 'まとめ買い',
    occurred_at: '2026-04-19T08:10:00.000Z',
    occurred_on: '2026-04-19',
  },
  {
    id: 'dev-entry-card-jcb-clothes-20260407',
    entry_type: 'expense',
    amount: 8900,
    entry_category_id: 'dev-cat-expense-clothes',
    payment_method_id: 'dev-pay-card-jcb',
    memo: '春服',
    occurred_at: '2026-04-07T13:10:00.000Z',
    occurred_on: '2026-04-07',
  },
  {
    id: 'dev-entry-card-jcb-social-20260414',
    entry_type: 'expense',
    amount: 7200,
    entry_category_id: 'dev-cat-expense-social',
    payment_method_id: 'dev-pay-card-jcb',
    memo: '会食',
    occurred_at: '2026-04-14T12:00:00.000Z',
    occurred_on: '2026-04-14',
  },
  {
    id: 'dev-entry-card-jcb-hobby-20260416',
    entry_type: 'expense',
    amount: 3900,
    entry_category_id: 'dev-cat-expense-hobby',
    payment_method_id: 'dev-pay-card-jcb',
    memo: '映画と書籍',
    occurred_at: '2026-04-16T10:40:00.000Z',
    occurred_on: '2026-04-16',
  },
  {
    id: 'dev-entry-card-view-train-20260408',
    entry_type: 'expense',
    amount: 6400,
    entry_category_id: 'dev-cat-expense-transport',
    payment_method_id: 'dev-pay-card-view',
    memo: '新幹線',
    occurred_at: '2026-04-08T07:45:00.000Z',
    occurred_on: '2026-04-08',
  },
  {
    id: 'dev-entry-postpaid-paidy-gadget-20260409',
    entry_type: 'expense',
    amount: 12400,
    entry_category_id: 'dev-cat-expense-hobby',
    payment_method_id: 'dev-pay-postpaid-paidy',
    memo: 'ガジェット購入',
    occurred_at: '2026-04-09T10:00:00.000Z',
    occurred_on: '2026-04-09',
  },
  {
    id: 'dev-entry-emoney-adjust-20260404',
    entry_type: 'income',
    amount: 15000,
    entry_category_id: 'dev-cat-income-side',
    payment_method_id: 'dev-pay-emoney-suica',
    memo: '電子マネー残高調整',
    occurred_at: '2026-04-04T09:00:00.000Z',
    occurred_on: '2026-04-04',
  },
  {
    id: 'dev-entry-emoney-train-20260411',
    entry_type: 'expense',
    amount: 3200,
    entry_category_id: 'dev-cat-expense-transport',
    payment_method_id: 'dev-pay-emoney-suica',
    memo: '通勤',
    occurred_at: '2026-04-11T09:15:00.000Z',
    occurred_on: '2026-04-11',
  },
  {
    id: 'dev-entry-emoney-cafe-20260417',
    entry_type: 'expense',
    amount: 1300,
    entry_category_id: 'dev-cat-expense-dining',
    payment_method_id: 'dev-pay-emoney-suica',
    memo: '駅ナカ',
    occurred_at: '2026-04-17T03:20:00.000Z',
    occurred_on: '2026-04-17',
  },
  {
    id: 'dev-entry-emoney-store-20260420',
    entry_type: 'expense',
    amount: 2000,
    entry_category_id: 'dev-cat-expense-daily',
    payment_method_id: 'dev-pay-emoney-suica',
    memo: 'コンビニ',
    occurred_at: '2026-04-20T10:20:00.000Z',
    occurred_on: '2026-04-20',
  },
  {
    id: 'dev-entry-cash-train-20260407',
    entry_type: 'expense',
    amount: 640,
    entry_category_id: 'dev-cat-expense-transport',
    payment_method_id: 'dev-pay-cash-wallet',
    memo: '電車',
    occurred_at: '2026-04-07T23:20:00.000Z',
    occurred_on: '2026-04-07',
  },
  {
    id: 'dev-entry-cash-daily-20260415',
    entry_type: 'expense',
    amount: 2380,
    entry_category_id: 'dev-cat-expense-daily',
    payment_method_id: 'dev-pay-cash-wallet',
    memo: '日用品',
    occurred_at: '2026-04-15T08:00:00.000Z',
    occurred_on: '2026-04-15',
  },
] as const

const DEV_RECURRING_RULE_SEEDS = [
  {
    id: 'dev-rule-bank-smbc-income',
    entry_type: 'income',
    amount: 18000,
    entry_category_id: 'dev-cat-income-side',
    payment_method_id: 'dev-pay-bank-smbc',
    memo: '副収入振込',
    frequency: 'monthly',
    day_of_month: 25,
    start_at: '2026-04-01T00:00:00.000Z',
    end_at: null,
    is_active: 1,
  },
  {
    id: 'dev-rule-bank-smbc-utility',
    entry_type: 'expense',
    amount: 12500,
    entry_category_id: 'dev-cat-expense-utilities',
    payment_method_id: 'dev-pay-bank-smbc',
    memo: '水道・ガス',
    frequency: 'monthly',
    day_of_month: 2,
    start_at: '2026-04-01T00:00:00.000Z',
    end_at: null,
    is_active: 1,
  },
  {
    id: 'dev-rule-bank-sbi-subscription',
    entry_type: 'expense',
    amount: 6000,
    entry_category_id: 'dev-cat-expense-utilities',
    payment_method_id: 'dev-pay-bank-sbi',
    memo: '通信費',
    frequency: 'monthly',
    day_of_month: 9,
    start_at: '2026-04-01T00:00:00.000Z',
    end_at: null,
    is_active: 1,
  },
  {
    id: 'dev-rule-card-jcb-subscription',
    entry_type: 'expense',
    amount: 980,
    entry_category_id: 'dev-cat-expense-utilities',
    payment_method_id: 'dev-pay-card-jcb',
    memo: '動画サブスク',
    frequency: 'monthly',
    day_of_month: 24,
    start_at: '2026-04-01T00:00:00.000Z',
    end_at: null,
    is_active: 1,
  },
] as const

const recordSeedChange = async (
  db: D1Database,
  entityType: string,
  entityId: string,
  payloadKey: string
) => {
  const row = await db
    .prepare(`SELECT * FROM ${entityType} WHERE id = ? AND family_id = ?`)
    .bind(entityId, DEV_FAMILY_ID)
    .first<Record<string, unknown>>()
  if (row) {
    await recordChange(db, DEV_FAMILY_ID, entityType, entityId, 'upsert', { [payloadKey]: row })
  }
}

const ensureDevSampleData = async (db: D1Database) => {
  const now = nowIso()
  await db.prepare("DELETE FROM entries WHERE family_id = ? AND id LIKE 'dev-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM entries WHERE family_id = ? AND id LIKE 'sample-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM recurring_rules WHERE family_id = ? AND id LIKE 'dev-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM recurring_rules WHERE family_id = ? AND id LIKE 'sample-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM payment_methods WHERE family_id = ? AND id LIKE 'dev-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM payment_methods WHERE family_id = ? AND id LIKE 'sample-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM entry_categories WHERE family_id = ? AND id LIKE 'dev-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare("DELETE FROM entry_categories WHERE family_id = ? AND id LIKE 'sample-%'").bind(DEV_FAMILY_ID).run()
  await db.prepare('DELETE FROM monthly_balance WHERE family_id = ?').bind(DEV_FAMILY_ID).run()

  for (const category of DEV_CATEGORY_SEEDS) {
    await db
      .prepare(
        'INSERT INTO entry_categories (id, family_id, name, type, sort_order, created_at, updated_at, icon_key, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        category.id,
        DEV_FAMILY_ID,
        category.name,
        category.type,
        category.sort_order,
        now,
        now,
        category.icon_key,
        category.color
      )
      .run()
    await recordSeedChange(db, 'entry_categories', category.id, 'entry_category')
  }

  for (const method of DEV_PAYMENT_METHOD_SEEDS) {
    await db
      .prepare(
        'INSERT INTO payment_methods (id, family_id, name, type, icon_key, color, card_closing_day, card_payment_day, funding_source_payment_method_id, linked_bank_payment_method_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        method.id,
        DEV_FAMILY_ID,
        method.name,
        method.type,
        method.icon_key,
        method.color,
        method.card_closing_day ?? null,
        method.card_payment_day ?? null,
        method.funding_source_payment_method_id ?? null,
        method.linked_bank_payment_method_id ?? null,
        method.sort_order,
        now,
        now,
      )
      .run()
    await recordSeedChange(db, 'payment_methods', method.id, 'payment_method')
  }

  for (const entry of DEV_ENTRY_SEEDS) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO entries (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, occurred_at, occurred_on, recurring_rule_id, created_at, updated_at, created_by_user_id, created_by_user_name, created_by_avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        entry.id,
        DEV_FAMILY_ID,
        entry.entry_type,
        entry.amount,
        entry.entry_category_id,
        entry.payment_method_id,
        entry.memo,
        entry.occurred_at,
        entry.occurred_on,
        null,
        entry.occurred_at,
        entry.occurred_at,
        DEV_USER.id,
        DEV_USER.name,
        DEV_USER.avatar_url
      )
      .run()
    await recordSeedChange(db, 'entries', entry.id, 'entry')
  }

  for (const rule of DEV_RECURRING_RULE_SEEDS) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO recurring_rules (id, family_id, entry_type, amount, entry_category_id, payment_method_id, memo, frequency, day_of_month, start_at, end_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        rule.id,
        DEV_FAMILY_ID,
        rule.entry_type,
        rule.amount,
        rule.entry_category_id,
        rule.payment_method_id,
        rule.memo,
        rule.frequency,
        rule.day_of_month,
        rule.start_at,
        rule.end_at,
        rule.is_active,
        now,
        now
      )
      .run()
    await recordSeedChange(db, 'recurring_rules', rule.id, 'recurring_rule')
  }

  await recalcMonthlyBalances(db, DEV_FAMILY_ID, '2026-03')
}

const createDevSession = async (c: AppContext) => {
  const now = nowIso()
  await ensureUser(c.env.DB, DEV_USER)
  await c.env.DB
    .prepare(
      'INSERT INTO families (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at'
    )
    .bind(DEV_FAMILY_ID, 'Dev Family', now, now)
    .run()
  await c.env.DB
    .prepare(
      'INSERT INTO allowed_users (email, family_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET family_id = excluded.family_id, role = excluded.role, updated_at = excluded.updated_at'
    )
    .bind(DEV_USER.email, DEV_FAMILY_ID, 'owner', now, now)
    .run()
  await c.env.DB
    .prepare(
      'INSERT INTO members (user_id, family_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, family_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at'
    )
    .bind(DEV_USER.id, DEV_FAMILY_ID, 'owner', now, now)
    .run()
  await ensureDevSampleData(c.env.DB)
  const session = await createSession(c.env.DB, DEV_USER.id, DEV_FAMILY_ID, false)
  setSessionCookie(c, session.id)
  return {
    family_id: DEV_FAMILY_ID,
    user: DEV_USER,
  }
}

export const registerAuthRoutes = (app: Hono<HonoEnv>) => {
  app.get('/auth/session', async (c) => {
    const session = await loadSession(c)
    if (!session && isDevAuthBypassEnabled(c.env, c.req.url)) {
      const devSession = await createDevSession(c)
      return c.json({ session: { status: 'ready', ...devSession } })
    }
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
    if (isDevAuthBypassEnabled(c.env, c.req.url)) {
      await createDevSession(c)
      const nextPath = c.req.query('next')?.trim() ?? '/'
      const originParam = c.req.query('origin')?.trim() ?? null
      const safeNext = nextPath.startsWith('/') ? nextPath : '/'
      const targetBase = isAllowedOrigin(originParam, c.env) ? originParam : new URL(c.req.url).origin
      return c.redirect(new URL(safeNext, targetBase).toString(), 302)
    }

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
