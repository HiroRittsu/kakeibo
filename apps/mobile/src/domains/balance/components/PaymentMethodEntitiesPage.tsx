import { useMemo } from 'react'
import dayjs from 'dayjs'
import { HistoryStyleGroupedEntries } from '../../history/components/HistoryStyleGroupedEntries'
import styles from '../../../shared/styles/App.module.css'
import { buildMethodDetailEntriesForMonth, findBankSummary } from '../services/balanceTimeline'
import type { PaymentMethodEntitySeed } from '../../../app/types'
import type { Entry, EntryCategory, PaymentMethod, RecurringRule } from '../../../types'
import type { EntryListItem } from '../../entries/types'
import { isBankAccountMethod } from '../services/paymentMethodModel'

type PaymentMethodEntitiesPageProps = {
  currentMonthYm: string
  seed: PaymentMethodEntitySeed
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMethods: PaymentMethod[]
  recurringRules: RecurringRule[]
}

export const PaymentMethodEntitiesPage = ({
  currentMonthYm,
  seed,
  entries,
  categoryMap,
  paymentMethods,
  recurringRules,
}: PaymentMethodEntitiesPageProps) => {
  const currentMonth = useMemo(() => dayjs(`${currentMonthYm}-01`), [currentMonthYm])
  const paymentMap = useMemo(() => new Map(paymentMethods.map((item) => [item.id, item])), [paymentMethods])
  const method = paymentMap.get(seed.methodId) ?? null
  const bankSummary = useMemo(
    () => findBankSummary(entries, paymentMethods, recurringRules, seed.methodId, currentMonth),
    [currentMonth, entries, paymentMethods, recurringRules, seed.methodId]
  )

  const childEntries = useMemo(() => {
    if (!method || isBankAccountMethod(method)) return [] as EntryListItem[]
    return buildMethodDetailEntriesForMonth(method.id, entries, paymentMethods, recurringRules, currentMonth)
  }, [currentMonth, entries, method, paymentMethods, recurringRules])

  if (method && isBankAccountMethod(method) && bankSummary) {
    return (
      <section className={styles.card}>
        <HistoryStyleGroupedEntries
          entries={bankSummary.detailEntries}
          categoryMap={categoryMap}
          paymentMap={paymentMap}
          emptyMessage="この銀行口座に紐づく明細はありません"
        />
      </section>
    )
  }

  if (!method) {
    return (
      <section className={styles.card}>
        <div className={styles.balanceEmptyState}>この支払い方法の明細を表示できません。</div>
      </section>
    )
  }

  return (
    <section className={styles.card}>
      <HistoryStyleGroupedEntries
        entries={childEntries}
        categoryMap={categoryMap}
        paymentMap={paymentMap}
        emptyMessage="この支払い方法に紐づく明細はありません"
      />
    </section>
  )
}
