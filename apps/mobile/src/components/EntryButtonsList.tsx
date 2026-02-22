import { type ReactNode } from 'react'
import type { Entry, EntryCategory, PaymentMethod } from '../types'

export type EntryListItem = Entry & {
  is_planned?: boolean
  is_carryover?: boolean
}

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
  const memo = entry.memo?.trim()
  return memo && memo.length > 0 ? memo : null
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
    return emptyMessage ? <p className="muted">{emptyMessage}</p> : null
  }

  return (
    <div className="entry-group-card">
      <div className="entry-group-list">
        {entries.map((entry) => {
          const isCarryover = Boolean(entry.is_carryover)
          const isPlanned = Boolean(entry.is_planned)
          const isRecurring = Boolean(entry.recurring_rule_id)
          const category = !isCarryover && entry.entry_category_id ? categoryMap.get(entry.entry_category_id) : null
          const method = !isCarryover && entry.payment_method_id ? paymentMap.get(entry.payment_method_id) : null
          const paymentClass = method?.type === 'card' ? 'credit-card' : method?.type ?? 'unknown'
          const paymentOverlayStyle = method ? { background: getPaymentColor(method), color: '#fff' } : undefined
          const categoryColor = isCarryover ? '#8f9499' : category?.color ?? '#d9554c'
          const categoryIcon = isCarryover ? null : getCategoryIcon(category?.icon_key)
          const categoryFallback = category?.name?.slice(0, 1) ?? '?'
          const categoryLabel = isCarryover ? '繰越し' : category?.name ?? '未分類'
          const creatorAvatarUrl = entry.created_by_avatar_url?.trim() ?? ''
          const creatorName = entry.created_by_user_name?.trim() ?? ''
          const amountPrefix = isPlanned ? (entry.entry_type === 'income' ? '+' : '-') : ''
          const metaText = metaBuilder(entry)
          const buttonDisabled = readOnly || isPlanned || isCarryover || !onEdit

          return (
            <button
              key={entry.id}
              type="button"
              className={`entry-button ${isPlanned ? 'planned' : ''} ${isCarryover ? 'carryover' : ''}`}
              onClick={buttonDisabled ? undefined : () => onEdit(entry)}
              disabled={buttonDisabled}
            >
              <div className="entry-row-main">
                <span className="entry-category-icon" style={{ background: categoryColor }}>
                  {isCarryover ? <span className="material-symbols-outlined">redo</span> : categoryIcon ?? <span className="category-fallback">{categoryFallback}</span>}
                  {showCreatorBadge && !isCarryover && !isPlanned && (
                    <span
                      className="entry-creator-overlay"
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
                  {!isCarryover && (
                    <span className={`entry-payment-overlay ${paymentClass}`} style={paymentOverlayStyle}>
                      {getPaymentIcon(method)}
                    </span>
                  )}
                </span>
                <div className="entry-info">
                  <div className="entry-top-row">
                    <strong className="entry-name">{categoryLabel}</strong>
                    {metaText && <span className="entry-memo">{metaText}</span>}
                    <div className="entry-badges">
                      <span className={`badge ${entry.entry_type}`}>{entry.entry_type === 'income' ? '収入' : '支出'}</span>
                      {isCarryover && <span className="badge carryover">繰越し</span>}
                      {isRecurring && !isCarryover && <span className="badge recurring">定期</span>}
                      {isPlanned && <span className="badge planned">予定</span>}
                    </div>
                  </div>
                  <div className="entry-amount-row">
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
