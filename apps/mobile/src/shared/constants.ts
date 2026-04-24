import type { EntryType } from '../types'
import type { PageKey, PaymentType, TabKey } from '../app/types'

export const CARRYOVER_CATEGORY_ID = 'carryover'
export const SESSION_CHECK_TIMEOUT_MS = 7000
export const BACKGROUND_SESSION_CHECK_TIMEOUT_MS = 2500
export const AUTH_CACHE_KEY = 'auth_session_cache'
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'dev'

export const TAB_LABELS: Record<TabKey, string> = {
  home: '入力',
  history: '履歴',
  reports: '集計',
}

export const PAGE_TITLES: Record<PageKey, string> = {
  main: '入力',
  balance: '残高',
  'entry-input': '入力',
  'category-settings': 'カテゴリ設定',
  'recurring-settings': '定期的な収入/支出',
  'payment-settings': '支払い設定',
  'report-category-entities': 'カテゴリ明細',
  'payment-method-entities': '口座タイムライン',
}

export const CATEGORY_COLORS = [
  '#d9554c',
  '#8bc34a',
  '#e91e63',
  '#2196f3',
  '#607d8b',
  '#5c6bc0',
  '#00bcd4',
  '#f44336',
  '#795548',
  '#ff9800',
  '#757575',
  '#ff1744',
]

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export const CATEGORY_ICON_CHOICES = [
  'restaurant',
  'local_cafe',
  'lunch_dining',
  'local_bar',
  'local_grocery_store',
  'cleaning_services',
  'checkroom',
  'face',
  'spa',
  'sports_tennis',
  'fitness_center',
  'train',
  'directions_bus',
  'directions_car',
  'local_gas_station',
  'flight',
  'menu_book',
  'school',
  'subscriptions',
  'payments',
  'account_balance',
  'medical_services',
  'local_hospital',
  'healing',
  'home',
  'apartment',
  'garage',
  'savings',
  'child_care',
  'pets',
  'local_florist',
  'movie',
  'music_note',
  'travel',
  'festival',
  'shopping_bag',
  'redeem',
  'volunteer_activism',
  'category',
  'content_cut',
  'settings',
]

export const PAYMENT_ICON_CHOICES = [
  'payments',
  'account_balance_wallet',
  'account_balance',
  'credit_card',
  'paid',
  'savings',
  'point_of_sale',
  'receipt_long',
  'price_check',
  'qr_code',
  'currency_yen',
  'sell',
]

export const PAYMENT_DEFAULT_COLORS: Record<PaymentType, string> = {
  cash: '#8a6b55',
  bank: '#2f6db4',
  emoney: '#2f8f9d',
  card: '#3a4bb8',
  postpaid: '#6d5bd0',
}

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  income: '収入',
  expense: '支出',
}
