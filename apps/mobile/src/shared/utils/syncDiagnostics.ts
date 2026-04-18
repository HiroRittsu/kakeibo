import { getRecentSyncEvents, type SyncFailure } from '../../infra/sync'
import type { OutboxDeadLetter } from '../../types'

export const formatSyncFailureMessage = (failure: SyncFailure) => {
  const status = failure.status
  const actionLabel = failure.stage === 'outbox' ? '送信' : '同期'
  if (status === 401 || status === 403) {
    return 'ログインが必要です'
  }
  if (status === 409) {
    return '要対応の同期競合があります'
  }
  if (status && status >= 500) {
    return `${actionLabel}に失敗しました（サーバーエラー）`
  }
  if (status) {
    return `${actionLabel}に失敗しました`
  }
  return '通信に失敗しました。ネットワークを確認してください'
}

export const buildSyncFailureLog = (failure: SyncFailure) => {
  const lines = [
    '[kakeibo sync error]',
    `occurred_at: ${failure.occurred_at}`,
    `stage: ${failure.stage}`,
    failure.status ? `status: ${failure.status}` : null,
    failure.error_code ? `error_code: ${failure.error_code}` : null,
    failure.method ? `method: ${failure.method}` : null,
    failure.endpoint ? `endpoint: ${failure.endpoint}` : null,
    failure.message ? `message: ${failure.message}` : null,
    failure.detail ? `detail: ${failure.detail}` : null,
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

export const buildDeadLetterLog = (deadLetters: OutboxDeadLetter[]) => {
  if (!deadLetters.length) return ''

  const lines = ['[kakeibo fatal conflicts]']
  deadLetters.forEach((item, index) => {
    lines.push(`--- item_${index + 1} ---`)
    lines.push(`failed_at: ${item.failed_at}`)
    if (typeof item.status === 'number') lines.push(`status: ${item.status}`)
    lines.push(`method: ${item.method}`)
    lines.push(`endpoint: ${item.endpoint}`)
    lines.push(`entity_type: ${item.entity_type}`)
    lines.push(`entity_id: ${item.entity_id}`)
    if (item.error_code) lines.push(`error_code: ${item.error_code}`)
    if (item.error_detail) lines.push(`error_detail: ${item.error_detail}`)
    if (item.server_snapshot) lines.push(`server_snapshot: ${JSON.stringify(item.server_snapshot)}`)
    if (item.request_payload) lines.push(`request_payload: ${JSON.stringify(item.request_payload)}`)
  })

  return lines.join('\n')
}

export const buildSyncDiagnosticsLog = (failure: SyncFailure | null, deadLetters: OutboxDeadLetter[]) => {
  if (!failure && deadLetters.length === 0) return ''

  const lines = ['[kakeibo sync diagnostics]', `generated_at: ${new Date().toISOString()}`]
  if (failure) {
    lines.push('', buildSyncFailureLog(failure))
  }

  if (deadLetters.length) {
    lines.push('', buildDeadLetterLog(deadLetters))
  }

  const events = getRecentSyncEvents(25)
  if (events.length) {
    lines.push('', '[kakeibo sync events]')
    events.forEach((event) => {
      lines.push(
        `${event.occurred_at} level=${event.level} stage=${event.stage} message=${event.message}` +
          `${event.status ? ` status=${event.status}` : ''}` +
          `${event.error_code ? ` error_code=${event.error_code}` : ''}` +
          `${event.method ? ` method=${event.method}` : ''}` +
          `${event.endpoint ? ` endpoint=${event.endpoint}` : ''}`
      )
    })
  }

  return lines.join('\n')
}
