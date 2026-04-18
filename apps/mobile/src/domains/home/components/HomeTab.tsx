import { useMemo } from 'react'
import dayjs from 'dayjs'
import { CATEGORY_COLORS } from '../../../shared/constants'
import styles from '../../../shared/styles/App.module.css'
import { cx } from '../../../shared/utils/cx'
import { formatAmount } from '../../../shared/utils/format'
import { getCategoryIcon, renderMaterialIcon } from '../../../shared/icons/materialIcon'
import type { Entry, EntryCategory, EntryType, MonthlyBalance } from '../../../types'
import type { EntryInputSeed, SelectOption, TabKey } from '../../../app/types'

type HomeTabProps = {
  entries: Entry[]
  categories: EntryCategory[]
  paymentMethods: SelectOption[]
  monthlyBalanceMap: Map<string, MonthlyBalance>
  entryType: EntryType
  onEntryTypeChange: (entryType: EntryType) => void
  onOpenCategorySettings: () => void
  onOpenEntryInput: (seed: EntryInputSeed, tab?: TabKey) => void
}

export const HomeTab = ({
  entries,
  categories,
  paymentMethods,
  monthlyBalanceMap,
  entryType,
  onEntryTypeChange,
  onOpenCategorySettings,
  onOpenEntryInput,
}: HomeTabProps) => {
  const currentMonthKey = dayjs().format('YYYY-MM')
  const balanceYm = dayjs(currentMonthKey).subtract(1, 'month').format('YYYY-MM')
  const carryoverBalance = monthlyBalanceMap.get(balanceYm)?.balance ?? null

  const visibleCategories = useMemo(() => {
    return categories.filter((category) => category.type === entryType)
  }, [categories, entryType])

  const monthSummary = useMemo(() => {
    const current = dayjs()
    const start = current.startOf('month')
    const end = current.endOf('month')

    let income = 0
    let expense = 0

    entries.forEach((entry) => {
      const date = dayjs(entry.occurred_at)
      if (date.isBefore(start) || date.isAfter(end)) return
      if (entry.entry_type === 'income') {
        income += entry.amount
      } else {
        expense += entry.amount
      }
    })

    const carryover = carryoverBalance ?? 0
    return { income, expense, balance: carryover + income - expense }
  }, [entries, carryoverBalance])

  const totalForRatio = monthSummary.income + monthSummary.expense
  const ratio = totalForRatio > 0 ? monthSummary.expense / totalForRatio : 0
  const isNegative = monthSummary.balance < 0

  return (
    <section className={styles.card}>
      <div className={cx(styles.summaryPanel, styles.homeSummaryPanel)}>
        <span>収支</span>
        <strong>¥{formatAmount(monthSummary.balance)}</strong>
      </div>
      <div className={cx(styles.summaryProgress, isNegative && styles.negative)}>
        <span style={{ width: `${isNegative ? 100 : Math.min(100, ratio * 100)}%` }} />
      </div>

      <div className={styles.pillToggle}>
        <button
          type="button"
          className={cx(entryType === 'income' && styles.active)}
          onClick={() => onEntryTypeChange('income')}
        >
          収入
        </button>
        <button
          type="button"
          className={cx(entryType === 'expense' && styles.active)}
          onClick={() => onEntryTypeChange('expense')}
        >
          支出
        </button>
      </div>

      <div className={styles.categoryGrid}>
        {visibleCategories.length === 0 && <p className={styles.muted}>カテゴリがありません</p>}
        {visibleCategories.map((category, index) => {
          const color = category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
          const icon = getCategoryIcon(category.icon_key)
          return (
            <button
              type="button"
              key={category.id}
              className={styles.categoryCard}
              onClick={() =>
                onOpenEntryInput(
                  {
                    entryType,
                    amount: 0,
                    entryCategoryId: category.id,
                    paymentMethodId: paymentMethods[0]?.value ?? null,
                    memo: null,
                    occurredAt: new Date().toISOString(),
                  },
                  'home'
                )
              }
            >
              <span className={styles.categoryIcon} style={{ background: color }}>
                {icon ?? <span className={styles.categoryFallback}>{category.name.slice(0, 1)}</span>}
              </span>
              <span className={styles.categoryLabel}>{category.name}</span>
            </button>
          )
        })}
        <button type="button" className={cx(styles.categoryCard, styles.settings)} onClick={onOpenCategorySettings}>
          <span className={cx(styles.categoryIcon, styles.categorySettingsIcon)}>
            {renderMaterialIcon('folder')}
          </span>
          <span className={styles.categoryLabel}>カテゴリ設定</span>
        </button>
      </div>
    </section>
  )
}
