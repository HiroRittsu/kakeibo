import type { Entry } from '../../types'

export type EntryListItem = Entry & {
  is_planned?: boolean
  is_carryover?: boolean
  display_name?: string | null
  detail_label?: string | null
  use_payment_icon_as_primary?: boolean
}
