export const formatAmount = (amount: number) => {
  return new Intl.NumberFormat('ja-JP').format(amount)
}

export const normalizeDayOfMonth = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  if (normalized < 1 || normalized > 31) return null
  return normalized
}

export const dayToInputValue = (value: number | null | undefined) => (typeof value === 'number' ? String(value) : '')
export const formatDayLabel = (value: number | null | undefined) => (typeof value === 'number' ? `${value}日` : '未設定')
