import { useMemo } from 'react'
import dayjs from 'dayjs'
import styles from '../../../shared/styles/App.module.css'
import { cx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import { getPaymentColorByType, getPaymentIconFromConfig } from '../../../shared/utils/payment'
import { buildBalanceOverview, type MethodTreeSummary } from '../services/balanceTimeline'
import type { PaymentMethodEntitySeed, PaymentType } from '../../../app/types'
import type { Entry, PaymentMethod, RecurringRule } from '../../../types'

type BalancePageProps = {
  entries: Entry[]
  currentMonthYm: string
  paymentMethods: PaymentMethod[]
  recurringRules: RecurringRule[]
  onChangeMonthYm: (ym: string) => void
  onOpenPayment: (type: PaymentType) => void
  onOpenPaymentMethodEntities: (seed: PaymentMethodEntitySeed) => void
}

const MethodTreeCards = ({
  nodes,
  depth = 0,
  onOpen,
}: {
  nodes: MethodTreeSummary[]
  depth?: number
  onOpen: (seed: PaymentMethodEntitySeed) => void
}) => (
  <div className={styles.balanceChildList}>
    {nodes.map((node) => (
      <div
        key={node.methodId}
        className={styles.balanceTreeNode}
        style={{ '--balance-tree-depth': String(depth) } as Record<string, string>}
      >
        <button
          type="button"
          className={styles.balanceChildCard}
          onClick={() => onOpen({ methodId: node.methodId, methodName: node.methodName })}
        >
          <div className={styles.balanceChildTitle}>
              <span
                className={styles.balanceChildIcon}
                style={{
                  background: getPaymentColorByType(node.type, node.color),
                  color: '#fff',
                }}
              >
              {getPaymentIconFromConfig(node.type, node.iconKey ?? null)}
            </span>
            <div>
              <strong>{node.methodName}</strong>
            </div>
          </div>
          <strong className={styles.balanceChildAmount}>¥{formatAmount(node.amount)}</strong>
        </button>
        {node.children.length > 0 && (
          <MethodTreeCards nodes={node.children} depth={depth + 1} onOpen={onOpen} />
        )}
      </div>
    ))}
  </div>
)

export const BalancePage = ({
  entries,
  currentMonthYm,
  paymentMethods,
  recurringRules,
  onChangeMonthYm,
  onOpenPayment,
  onOpenPaymentMethodEntities,
}: BalancePageProps) => {
  const currentMonth = useMemo(() => dayjs(`${currentMonthYm}-01`), [currentMonthYm])
  const overview = useMemo(
    () => buildBalanceOverview(entries, paymentMethods, recurringRules, currentMonth),
    [currentMonth, entries, paymentMethods, recurringRules]
  )
  const handleChangeMonth = (delta: number) => {
    onChangeMonthYm(currentMonth.add(delta, 'month').format('YYYY-MM'))
  }
  return (
    <section className={cx(styles.card, styles.balanceCard)}>
      <div className={styles.monthHeader}>
        <button type="button" className={styles.iconButton} onClick={() => handleChangeMonth(-1)}>
          ‹
        </button>
        <h2>{currentMonth.format('YYYY年 M月')}</h2>
        <button type="button" className={styles.iconButton} onClick={() => handleChangeMonth(1)}>
          ›
        </button>
      </div>

      <div className={styles.balanceSection}>
        <div className={styles.balanceHeader}>
          <span>銀行口座</span>
          <button className={styles.linkButton} onClick={() => onOpenPayment('bank')}>
            設定する
          </button>
        </div>
        {overview.bankSummaries.length === 0 ? (
          <div className={styles.balanceEmptyState}>銀行口座を追加すると、紐づく引落額をまとめて表示できます。</div>
        ) : (
          <ul className={styles.balanceBankList}>
            {overview.bankSummaries.map((summary) => {
              const segmentTotal = Math.max(1, summary.deductionSegments.reduce((sum, segment) => sum + segment.amount, 0))
              return (
                <li key={summary.bankMethodId} className={styles.balanceBankCard}>
                  <button
                    type="button"
                    className={styles.balanceBankButton}
                    onClick={() =>
                      onOpenPaymentMethodEntities({ methodId: summary.bankMethodId, methodName: summary.bankName })
                    }
                  >
                    <div className={styles.balanceBankHeader}>
                      <div className={styles.balanceInfo}>
                        <span
                          className={styles.paymentMethodIcon}
                          style={{
                            background: summary.color ?? '#2f6db4',
                            color: '#fff',
                          }}
                        >
                          {getPaymentIconFromConfig('bank', summary.iconKey ?? null)}
                        </span>
                        <div>
                          <strong>{summary.bankName}</strong>
                        </div>
                      </div>
                      <div className={styles.balanceAmountBlock}>
                        <span>銀行残高</span>
                        <strong>¥{formatAmount(summary.detailTotal)}</strong>
                      </div>
                    </div>
                  </button>

                  <div className={styles.entityPageHeader}>
                    <span>紐づき合計</span>
                    <strong>¥{formatAmount(summary.linkedTotal)}</strong>
                  </div>

                  {summary.deductionSegments.length > 0 && (
                    <div className={styles.balanceBreakdownBar}>
                      {summary.deductionSegments.map((segment) => (
                        <span
                          key={segment.methodId}
                          className={styles.balanceProgressSegment}
                          style={{
                            width: `${(segment.amount / segmentTotal) * 100}%`,
                            background: segment.color ?? '#3a4bb8',
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className={styles.balanceChildList}>
                    {summary.linkedMethods.length === 0 ? (
                      <div className={styles.balanceChildEmpty}>紐づく支払い方法はありません。</div>
                    ) : (
                      <MethodTreeCards nodes={summary.linkedMethods} onOpen={onOpenPaymentMethodEntities} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={styles.balanceSection}>
        <div className={styles.balanceHeader}>
          <span>未連携の支払い方法</span>
          <button className={styles.linkButton} onClick={() => onOpenPayment('card')}>
            設定する
          </button>
        </div>
        {overview.otherMethodRoots.length === 0 ? (
          <div className={styles.balanceEmptyState}>未連携の支払い方法はありません。</div>
        ) : (
          <div className={styles.balanceChildList}>
            <MethodTreeCards
              nodes={overview.otherMethodRoots}
              onOpen={onOpenPaymentMethodEntities}
            />
          </div>
        )}
      </div>
    </section>
  )
}
