import { createElement } from 'react'

export const renderMaterialIcon = (name: string, className?: string) => {
  return createElement('span', { className: ['material-symbols-outlined', className].filter(Boolean).join(' ') }, name)
}

export const getCategoryIcon = (iconKey?: string | null) => {
  if (!iconKey) return null
  return renderMaterialIcon(iconKey)
}
