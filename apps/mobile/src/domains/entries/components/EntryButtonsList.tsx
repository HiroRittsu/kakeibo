import { type ReactNode } from 'react'
import styles from './EntryButtonsList.module.css'
import { cx } from '../../../shared/utils/cx'
import type { PaymentType } from '../../../app/types'
import type { Entry, EntryCategory, PaymentMethod } from '../../../types'
import type { EntryListItem } from '../types'

type EntryButtonsListProps = {
  entries: EntryListItem[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  formatAmount: (amount: number) => string
  getCategoryIcon: (iconKey?: string | null) => ReactNode
  getPaymentIcon: (method?: PaymentMethod | null) => ReactNode
  getPaymentColor: (method?: PaymentMethod | null) => string
  onEdit?: (entry: Entry) => void
  readOnly?: boolean
  showCreatorBadge?: boolean
  emptyMessage?: string
  metaBuilder?: (entry: EntryListItem) => string | null
}

const defaultMetaBuilder = (entry: EntryListItem) => {
  const detailLabel = entry.detail_label?.trim()
  if (detailLabel) return detailLabel
  const memo = entry.memo?.trim()
  return memo && memo.length > 0 ? memo : null
}

type OverlayPaymentType = PaymentType | 'unknown'

const paymentOverlayClassByType: Record<OverlayPaymentType, string> = {
  cash: styles.cash,
  bank: styles.bank,
  emoney: styles.emoney,
  card: styles.creditCard,
  postpaid: styles.creditCard,
  unknown: styles.unknown,
}

const resolveOverlayPaymentType = (method: PaymentMethod | null): OverlayPaymentType => {
  if (!method) return 'unknown'
  if (
    method.type === 'cash' ||
    method.type === 'bank' ||
    method.type === 'emoney' ||
    method.type === 'card' ||
    method.type === 'postpaid'
  ) {
    return method.type
  }
  return 'unknown'
}

export const EntryButtonsList = ({
  entries,
  categoryMap,
  paymentMap,
  formatAmount,
  getCategoryIcon,
  getPaymentIcon,
  getPaymentColor,
  onEdit,
  readOnly = false,
  showCreatorBadge = false,
  emptyMessage,
  metaBuilder = defaultMetaBuilder,
}: EntryButtonsListProps) => {
  if (!entries.length) {
    return emptyMessage ? <p className={styles.muted}>{emptyMessage}</p> : null
  }

  return (
    <div className={styles.entryGroupCard}>
      <div className={styles.entryGroupList}>
        {entries.map((entry) => {
          const isCarryover = Boolean(entry.is_carryover)
          const isPlanned = Boolean(entry.is_planned)
          const isRecurring = Boolean(entry.recurring_rule_id)
          const category = !isCarryover && entry.entry_category_id ? categoryMap.get(entry.entry_category_id) : null
          const method = !isCarryover && entry.payment_method_id ? (paymentMap.get(entry.payment_method_id) ?? null) : null
          const paymentClass = paymentOverlayClassByType[resolveOverlayPaymentType(method)]
          const paymentOverlayStyle = method ? { background: getPaymentColor(method), color: '#fff' } : undefined
          const usePaymentIconAsPrimary = Boolean(entry.use_payment_icon_as_primary && method)
          const categoryColor = isCarryover
            ? '#8f9499'
            : usePaymentIconAsPrimary
              ? getPaymentColor(method)
              : category?.color ?? '#d9554c'
          const categoryIcon = isCarryover
            ? null
            : usePaymentIconAsPrimary
              ? getPaymentIcon(method)
              : getCategoryIcon(category?.icon_key)
          const categoryFallback = usePaymentIconAsPrimary ? '?' : category?.name?.slice(0, 1) ?? '?'
          const displayName = entry.display_name?.trim()
          const categoryLabel = isCarryover ? '繰越し' : displayName || category?.name || '未分類'
          const creatorAvatarUrl = entry.created_by_avatar_url?.trim() ?? ''
          const creatorName = entry.created_by_user_name?.trim() ?? ''
          const amountPrefix = isPlanned ? (entry.entry_type === 'income' ? '+' : '-') : ''
          const metaText = metaBuilder(entry)
          const buttonDisabled = readOnly || isPlanned || isCarryover || !onEdit

          return (
            <button
              key={entry.id}
              type="button"
              className={cx(styles.entryButton, isPlanned && styles.entryButtonPlanned)}
              onClick={buttonDisabled ? undefined : () => onEdit(entry)}
              disabled={buttonDisabled}
            >
              <div className={styles.entryRowMain}>
                <span className={styles.entryCategoryIcon} style={{ background: categoryColor }}>
                  {isCarryover ? (
                    <span className="material-symbols-outlined">redo</span>
                  ) : (
                    categoryIcon ?? <span className={styles.categoryFallback}>{categoryFallback}</span>
                  )}
                  {showCreatorBadge && !isCarryover && !isPlanned && (
                    <span
                      className={styles.entryCreatorOverlay}
                      title={creatorName || 'Googleユーザー'}
                      aria-label={creatorName || 'Googleユーザー'}
                    >
                      {creatorAvatarUrl ? (
                        <img src={creatorAvatarUrl} alt={creatorName ? `${creatorName} のGoogleアイコン` : 'Googleアイコン'} />
                      ) : (
                        <img src="/icons/google-g.svg" alt="Googleアイコン" />
                      )}
                    </span>
                  )}
                  {!isCarryover && !usePaymentIconAsPrimary && (
                    <span className={cx(styles.entryPaymentOverlay, paymentClass)} style={paymentOverlayStyle}>
                      {getPaymentIcon(method)}
                    </span>
                  )}
                </span>
                <div className={styles.entryInfo}>
                  <div className={styles.entryTopRow}>
                    <strong className={styles.entryName}>{categoryLabel}</strong>
                    {metaText && <span className={styles.entryMemo}>{metaText}</span>}
                    <div className={styles.entryBadges}>
                      <span className={cx(styles.badge, entry.entry_type === 'income' ? styles.badgeIncome : styles.badgeExpense)}>
                        {entry.entry_type === 'income' ? '収入' : '支出'}
                      </span>
                      {isCarryover && <span className={cx(styles.badge, styles.badgeCarryover)}>繰越し</span>}
                      {isRecurring && !isCarryover && <span className={cx(styles.badge, styles.badgeRecurring)}>定期</span>}
                      {isPlanned && <span className={cx(styles.badge, styles.badgePlanned)}>予定</span>}
                    </div>
                  </div>
                  <div className={styles.entryAmountRow}>
                    <strong>{amountPrefix}¥{formatAmount(entry.amount)}</strong>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
