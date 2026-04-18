export const splitMemo = (value: string | null) => {
  if (!value) return { place: '', memo: '' }
  const parts = value.split(' / ')
  if (parts.length >= 2) {
    const [place, ...rest] = parts
    return { place: place ?? '', memo: rest.join(' / ') }
  }
  return { place: '', memo: value }
}

export const combineMemo = (place: string, memo: string) => {
  const trimmedPlace = place.trim()
  const trimmedMemo = memo.trim()
  if (trimmedPlace && trimmedMemo) return `${trimmedPlace} / ${trimmedMemo}`
  if (trimmedPlace) return trimmedPlace
  if (trimmedMemo) return trimmedMemo
  return null
}
