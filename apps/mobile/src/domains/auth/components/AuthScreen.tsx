import styles from './AuthScreen.module.css'
import { cx } from '../../../shared/utils/cx'

type AuthScreenProps = {
  status: 'loading' | 'logged-out'
  onLogin: () => void
  error: string | null
}

export const AuthScreen = ({ status, onLogin, error }: AuthScreenProps) => {
  const isLoading = status === 'loading'
  return (
    <div className={styles.authScreen}>
      <div className={styles.authCard}>
        <h1>Kakeibo</h1>
        <p className={styles.muted}>
          {isLoading
            ? 'セッションを確認しています。時間がかかる場合はそのままログインできます。'
            : 'Googleアカウントでログインします。'}
        </p>
        {error && <p className={styles.authError}>{error}</p>}
        <div className={styles.authActions}>
          <button className={cx(styles.primary, styles.full)} onClick={onLogin}>
            Googleでログイン
          </button>
        </div>
      </div>
    </div>
  )
}
