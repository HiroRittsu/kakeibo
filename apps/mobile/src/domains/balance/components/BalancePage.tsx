import { useMemo } from 'react'
import dayjs from 'dayjs'
import { PAYMENT_DEFAULT_COLORS } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { cx } from '../../../shared/utils/cx'
import { formatAmount, formatDayLabel, normalizeDayOfMonth } from '../../../shared/utils/format'
import { getPaymentIconFromConfig, getPaymentType } from '../../../shared/utils/payment'
import type { PaymentMethodEntitySeed, PaymentType } from '../../../app/types'
import type { Entry, MonthlyBalance, PaymentMethod } from '../../../types'

type BalancePageProps = {
  entries: Entry[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  paymentMethods: PaymentMethod[]
  onOpenPayment: (type: PaymentType) => void
  onOpenPaymentMethodEntities: (seed: PaymentMethodEntitySeed) => void
}

type BalanceItem = {
  id: string
  name: string
  type: string
  icon_key?: string | null
  color?: string | null
  amount: number
  caption: string
  schedule?: string | null
}

const BalanceSection = ({
  title,
  items,
  onEmpty,
  onOpenItem,
}: {
  title: string
  items: BalanceItem[]
  onEmpty: () => void
  onOpenItem: (item: BalanceItem) => void
}) => {
  const sectionTotal = items.reduce((sum, item) => sum + item.amount, 0)

  return (
    <div className={styles.balanceSection}>
      <div className={styles.balanceHeader}>
        <span>{title}</span>
        {items.length === 0 ? (
          <button className={styles.linkButton} onClick={onEmpty}>
            設定する
          </button>
        ) : (
          <strong className={styles.balanceHeaderTotal}>合計 ¥{formatAmount(sectionTotal)}</strong>
        )}
      </div>
      {items.length > 0 && (
        <ul className={styles.balanceList}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.balanceItemButton} onClick={() => onOpenItem(item)}>
                <div className={styles.balanceInfo}>
                  <span
                    className={styles.paymentMethodIcon}
                    style={{
                      background: item.color ?? PAYMENT_DEFAULT_COLORS[getPaymentType(item.type)],
                      color: '#fff',
                    }}
                  >
                    {getPaymentIconFromConfig(item.type, item.icon_key ?? null)}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.caption}</span>
                    {item.schedule && <span className={styles.balanceCardMeta}>{item.schedule}</span>}
                  </div>
                </div>
                <div className={styles.balanceAmount}>
                  <strong>¥{formatAmount(item.amount)}</strong>
                  <span>›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const BalancePage = ({
  entries,
  monthlyBalanceMap,
  paymentMethods,
  onOpenPayment,
  onOpenPaymentMethodEntities,
}: BalancePageProps) => {
  const currentMonthKey = dayjs().format('YYYY-MM')
  const balanceYm = dayjs(currentMonthKey).subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const monthNet = useMemo(() => {
    const current = dayjs()
    const start = current.startOf('month')
    const end = current.endOf('month')
    let net = 0
    entries.forEach((entry) => {
      const date = dayjs(entry.occurred_at)
      if (date.isBefore(start) || date.isAfter(end)) return
      net += entry.entry_type === 'income' ? entry.amount : -entry.amount
    })
    return net
  }, [entries])

  const totalsByMethod = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>()
    entries.forEach((entry) => {
      if (!entry.payment_method_id) return
      const current = map.get(entry.payment_method_id) ?? { income: 0, expense: 0 }
      if (entry.entry_type === 'income') {
        current.income += entry.amount
      } else {
        current.expense += entry.amount
      }
      map.set(entry.payment_method_id, current)
    })
    return map
  }, [entries])

  const totalBalance = useMemo(() => {
    if (carryoverBalance !== null) {
      return carryoverBalance + monthNet
    }
    return entries.reduce((sum, entry) => {
      return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount)
    }, 0)
  }, [entries, carryoverBalance, monthNet])

  const paymentNameMap = useMemo(() => {
    return new Map(paymentMethods.map((method) => [method.id, method.name]))
  }, [paymentMethods])

  const groupedMethods = useMemo(() => {
    const groups: Record<PaymentType, PaymentMethod[]> = {
      cash: [],
      bank: [],
      emoney: [],
      card: [],
    }
    paymentMethods.forEach((method) => {
      const type = getPaymentType(method.type)
      groups[type].push(method)
    })
    return groups
  }, [paymentMethods])

  const buildItems = (methods: PaymentMethod[], mode: 'balance' | 'card'): BalanceItem[] => {
    return methods.map((method) => {
      const totals = totalsByMethod.get(method.id) ?? { income: 0, expense: 0 }
      const amount = mode === 'card' ? totals.expense : totals.income - totals.expense
      const schedule =
        mode === 'card'
          ? `${formatDayLabel(normalizeDayOfMonth(method.card_closing_day))}締め / ${formatDayLabel(
              normalizeDayOfMonth(method.card_payment_day)
            )}払い`
          : null
      const linkedBankName = method.linked_bank_payment_method_id
        ? paymentNameMap.get(method.linked_bank_payment_method_id) ?? null
        : null
      return {
        id: method.id,
        name: method.name,
        type: method.type,
        icon_key: method.icon_key ?? null,
        color: method.color ?? null,
        amount,
        caption: mode === 'card' ? '総支払予定' : '残高',
        schedule: schedule && linkedBankName ? `${schedule} / 引落: ${linkedBankName}` : schedule,
      }
    })
  }

  const cashItems = buildItems(groupedMethods.cash, 'balance')
  const bankItems = buildItems(groupedMethods.bank, 'balance')
  const emoneyItems = buildItems(groupedMethods.emoney, 'balance')
  const cardItems = buildItems(groupedMethods.card, 'card')

  return (
    <section className={cx(styles.card, styles.balanceCard)}>
      <div className={styles.balanceTotalRow}>
        <span>合計</span>
        <strong>¥{formatAmount(totalBalance)}</strong>
      </div>

      <BalanceSection
        title="現金"
        items={cashItems}
        onEmpty={() => onOpenPayment('cash')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="銀行口座"
        items={bankItems}
        onEmpty={() => onOpenPayment('bank')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="電子マネー"
        items={emoneyItems}
        onEmpty={() => onOpenPayment('emoney')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
      <BalanceSection
        title="クレジット"
        items={cardItems}
        onEmpty={() => onOpenPayment('card')}
        onOpenItem={(item) => onOpenPaymentMethodEntities({ methodId: item.id, methodName: item.name })}
      />
    </section>
  )
}
