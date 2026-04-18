import { useMemo } from 'react'
import dayjs from 'dayjs'
import { HistoryStyleGroupedEntries } from '../../history/components/HistoryStyleGroupedEntries'
import styles from '../../../shared/styles/App.module.css'
import { formatAmount, formatDayLabel, normalizeDayOfMonth } from '../../../shared/utils/format'
import { getPaymentType } from '../../../shared/utils/payment'
import type { PaymentMethodEntitySeed } from '../../../app/types'
import type { Entry, EntryCategory, PaymentMethod } from '../../../types'

type PaymentMethodEntitiesPageProps = {
  seed: PaymentMethodEntitySeed
  entries: Entry[]
  categoryMap: Map<string, EntryCategory>
  paymentMethods: PaymentMethod[]
}

export const PaymentMethodEntitiesPage = ({
  seed,
  entries,
  categoryMap,
  paymentMethods,
}: PaymentMethodEntitiesPageProps) => {
  const filteredEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.payment_method_id === seed.methodId)
      .sort((a, b) => dayjs(b.occurred_at).valueOf() - dayjs(a.occurred_at).valueOf())
  }, [entries, seed])
  const paymentMap = useMemo(() => new Map(paymentMethods.map((item) => [item.id, item])), [paymentMethods])
  const method = paymentMethods.find((item) => item.id === seed.methodId) ?? null

  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (sum, entry) => {
        if (entry.entry_type === 'income') {
          sum.income += entry.amount
        } else {
          sum.expense += entry.amount
        }
        return sum
      },
      { income: 0, expense: 0 }
    )
  }, [filteredEntries])
  const displayTotal = method && getPaymentType(method.type) === 'card' ? totals.expense : totals.income - totals.expense
  const linkedBankName =
    method?.linked_bank_payment_method_id ? paymentMap.get(method.linked_bank_payment_method_id)?.name ?? null : null
  const cardScheduleLabel =
    method && getPaymentType(method.type) === 'card'
      ? `${formatDayLabel(normalizeDayOfMonth(method.card_closing_day))}締め / ${formatDayLabel(
          normalizeDayOfMonth(method.card_payment_day)
        )}払い${linkedBankName ? ` / 引落: ${linkedBankName}` : ''}`
      : null

  return (
    <section className={styles.card}>
      <div className={styles.entityTotalHeader}>
        <span>合計</span>
        <strong>¥{formatAmount(displayTotal)}</strong>
      </div>
      {cardScheduleLabel && <div className={styles.entityTotalMeta}>{cardScheduleLabel}</div>}
      <HistoryStyleGroupedEntries
        entries={filteredEntries}
        categoryMap={categoryMap}
        paymentMap={paymentMap}
        emptyMessage="この支払い方法に紐づく明細はありません"
      />
    </section>
  )
}
