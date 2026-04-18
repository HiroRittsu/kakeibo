import type { ReactNode } from 'react'
import styles from './MenuItem.module.css'
import { cx } from '../../shared/utils/cx'

type MenuItemProps = {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}

export const MenuItem = ({ icon, label, onClick, disabled, variant = 'default' }: MenuItemProps) => (
  <button
    className={cx(styles.menuItem, disabled && styles.disabled, variant === 'danger' && styles.danger)}
    onClick={onClick}
    disabled={disabled}
  >
    <span className={styles.menuIcon}>{icon}</span>
    <span>{label}</span>
  </button>
)
