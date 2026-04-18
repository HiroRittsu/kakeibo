import { useMemo } from 'react'
import dayjs from 'dayjs'
import { HistoryStyleGroupedEntries } from '../../history/components/HistoryStyleGroupedEntries'
import styles from '../../../shared/styles/App.module.css'
import { CARRYOVER_CATEGORY_ID } from '../../../shared/constants'
import { getEntryDateKey } from '../../../shared/utils/date'
import type { ReportCategoryEntitySeed } from '../../../app/types'
import type { Entry, EntryCategory, PaymentMethod } from '../../../types'

type ReportCategoryEntitiesPageProps = {
  seed: ReportCategoryEntitySeed
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMethods: PaymentMethod[]
}

export const ReportCategoryEntitiesPage = ({
  seed,
  entries,
  categoryMap,
  paymentMethods,
}: ReportCategoryEntitiesPageProps) => {
  const filteredEntries = useMemo(() => {
    if (seed.categoryId === CARRYOVER_CATEGORY_ID) return [] as Entry[]
    return entries
      .filter((entry) => entry.entry_type === seed.entryType && entry.entry_category_id === seed.categoryId)
      .filter((entry) => {
        const dateKey = getEntryDateKey(entry)
        return dateKey >= seed.fromDate && dateKey < seed.toDateExclusive
      })
      .sort((a, b) => dayjs(b.occurred_at).valueOf() - dayjs(a.occurred_at).valueOf())
  }, [entries, seed])
  const paymentMap = useMemo(() => new Map(paymentMethods.map((item) => [item.id, item])), [paymentMethods])

  return (
    <section className={styles.card}>
      <HistoryStyleGroupedEntries
        entries={filteredEntries}
        categoryMap={categoryMap}
        paymentMap={paymentMap}
        emptyMessage="このカテゴリに紐づく明細はありません"
      />
    </section>
  )
}
