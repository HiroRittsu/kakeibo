import { useMemo } from 'react'
import dayjs from 'dayjs'
import { EntryButtonsList } from '../../entries/components/EntryButtonsList'
import { WEEKDAY_LABELS } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { cx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import { getCategoryIcon } from '../../../shared/icons/materialIcon'
import { getPaymentColor, getPaymentIcon } from '../../../shared/utils/payment'
import { getEntryDateKey } from '../../../shared/utils/date'
import type { Entry, EntryCategory, PaymentMethod } from '../../../types'
import type { EntryListItem } from '../../entries/components/EntryButtonsList'

type HistoryStyleGroup = {
  dateKey: string
  date: dayjs.Dayjs
  entries: EntryListItem[]
  totals: { income: number; expense: number }
}

const buildHistoryStyleGroups = (entries: Entry[]): HistoryStyleGroup[] => {
  const grouped = new Map<string, HistoryStyleGroup>()
  entries.forEach((entry) => {
    const dateKey = getEntryDateKey(entry)
    const current = grouped.get(dateKey) ?? {
      dateKey,
      date: dayjs(dateKey),
      entries: [],
      totals: { income: 0, expense: 0 },
    }
    current.entries.push(entry)
    if (entry.entry_type === 'income') {
      current.totals.income += entry.amount
    } else {
      current.totals.expense += entry.amount
    }
    grouped.set(dateKey, current)
  })

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => dayjs(a.occurred_at).valueOf() - dayjs(b.occurred_at).valueOf()),
    }))
    .sort((a, b) => b.date.valueOf() - a.date.valueOf())
}

type HistoryStyleGroupedEntriesProps = {
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMap: Map<string, PaymentMethod>
  emptyMessage: string
}

export const HistoryStyleGroupedEntries = ({
  entries,
  categoryMap,
  paymentMap,
  emptyMessage,
}: HistoryStyleGroupedEntriesProps) => {
  const groups = useMemo(() => buildHistoryStyleGroups(entries), [entries])

  return (
    <ul className={styles.list}>
      {groups.length === 0 && <li className={styles.muted}>{emptyMessage}</li>}
      {groups.map((group) => (
        <li key={group.dateKey} className={styles.entryGroup}>
          <div className={styles.entryGroupHeader}>
            <strong className={styles.entryGroupDate}>{`${group.date.format('M/D')} (${WEEKDAY_LABELS[group.date.day()]})`}</strong>
            <div className={styles.entryGroupTotals}>
              <span className={cx(styles.badge, styles.income)}>収入 ¥{formatAmount(group.totals.income)}</span>
              <span className={cx(styles.badge, styles.expense)}>支出 ¥{formatAmount(group.totals.expense)}</span>
            </div>
          </div>
          <EntryButtonsList
            entries={group.entries}
            categoryMap={categoryMap}
            paymentMap={paymentMap}
            formatAmount={formatAmount}
            getCategoryIcon={getCategoryIcon}
            getPaymentIcon={getPaymentIcon}
            getPaymentColor={getPaymentColor}
            readOnly
            showCreatorBadge
          />
        </li>
      ))}
    </ul>
  )
}
