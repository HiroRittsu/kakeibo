import type { ReactNode } from 'react'
import styles from '../shared/styles/app-layout.module.css'
import { cx } from '../shared/utils/cx'
import { APP_VERSION } from '../shared/constants'
import { IconCalendar, IconCard, IconChart, IconFolder, IconPencil, IconSettings } from '../shared/icons/appIcons'
import { renderMaterialIcon } from '../shared/icons/materialIcon'
import { MenuItem } from './components/MenuItem'
import type { PageKey, TabKey } from './types'

type AppLayoutProps = {
  page: PageKey
  headerTitle: string
  showSync: boolean
  syncing: boolean
  deadLetterCount: number
  outboxCount: number | undefined
  onSync: () => void
  showIconBar: boolean
  iconActive: TabKey | 'balance'
  onSelectHome: () => void
  onSelectHistory: () => void
  onSelectReports: () => void
  onSelectBalance: () => void
  onOpenMenu: () => void
  onBack: () => void
  menuOpen: boolean
  onCloseMenu: () => void
  onOpenCategorySettings: () => void
  onOpenRecurringSettings: () => void
  onOpenPaymentSettings: () => void
  onLogout: () => void
  toast: { message: string; type: 'error' | 'info' } | null
  syncFailureLog: string
  onCopySyncFailureLog: () => void
  children: ReactNode
}

export const AppLayout = ({
  page,
  headerTitle,
  showSync,
  syncing,
  deadLetterCount,
  outboxCount,
  onSync,
  showIconBar,
  iconActive,
  onSelectHome,
  onSelectHistory,
  onSelectReports,
  onSelectBalance,
  onOpenMenu,
  onBack,
  menuOpen,
  onCloseMenu,
  onOpenCategorySettings,
  onOpenRecurringSettings,
  onOpenPaymentSettings,
  onLogout,
  toast,
  syncFailureLog,
  onCopySyncFailureLog,
  children,
}: AppLayoutProps) => {
  return (
    <div className={cx(styles.app, showIconBar && styles.withTopNav)}>
      <header className={styles.topBar}>
        {page === 'main' || page === 'balance' ? (
          <button className={styles.iconButton} onClick={onOpenMenu} aria-label="menu">
            ☰
          </button>
        ) : (
          <button className={styles.iconButton} onClick={onBack} aria-label="back">
            ←
          </button>
        )}
        <div className={styles.titleGroup}>
          <h1>{headerTitle}</h1>
        </div>
        {showSync ? (
          <button className={styles.ghost} onClick={onSync} disabled={syncing}>
            {syncing ? '同期中' : deadLetterCount > 0 ? `要対応 (${deadLetterCount})` : `更新${outboxCount ? ` (${outboxCount})` : ''}`}
          </button>
        ) : (
          <div />
        )}
      </header>

      {showIconBar && (
        <nav className={styles.iconBar} aria-label="メインナビゲーション">
          <button className={cx(iconActive === 'home' && styles.active)} onClick={onSelectHome} aria-label="入力">
            <IconPencil />
            <span>入力</span>
          </button>
          <button className={cx(iconActive === 'history' && styles.active)} onClick={onSelectHistory} aria-label="履歴">
            <IconCalendar />
            <span>履歴</span>
          </button>
          <button className={cx(iconActive === 'reports' && styles.active)} onClick={onSelectReports} aria-label="集計">
            <IconChart />
            <span>集計</span>
          </button>
          <button className={cx(iconActive === 'balance' && styles.active)} onClick={onSelectBalance} aria-label="残高">
            <IconCard />
            <span>残高</span>
          </button>
        </nav>
      )}

      <main className={styles.content}>{children}</main>

      <div className={cx(styles.sideMenu, menuOpen && styles.open)}>
        <div className={styles.menuBrand}>
          <div className={styles.menuBrandRow}>
            <strong>Kakeibo</strong>
            <span className={styles.menuVersion}>v{APP_VERSION}</span>
          </div>
        </div>
        <div className={styles.menuList}>
          <MenuItem icon={<IconFolder />} label="カテゴリを管理" onClick={onOpenCategorySettings} />
          <MenuItem icon={renderMaterialIcon('autorenew')} label="定期入力を管理" onClick={onOpenRecurringSettings} />
          <MenuItem icon={<IconSettings />} label="支払い方法を管理" onClick={onOpenPaymentSettings} />
          <MenuItem icon={renderMaterialIcon('logout')} label="ローカルデータを削除" onClick={onLogout} variant="danger" />
        </div>
      </div>

      {menuOpen && <div className={styles.backdrop} onClick={onCloseMenu} />}

      {toast && (
        <div className={cx(styles.toast, styles[toast.type])} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}
      {syncFailureLog && (
        <div className={styles.syncErrorCopyWrap}>
          <button className={styles.syncErrorCopyButton} onClick={onCopySyncFailureLog}>
            {deadLetterCount > 0 ? `同期エラー詳細をコピー (${deadLetterCount})` : '同期ログをコピー'}
          </button>
        </div>
      )}
    </div>
  )
}
